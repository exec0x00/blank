import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  createSdkMcpServer, forkSession, getSessionMessages, listSessions, query, tool,
  type PermissionResult, type PermissionUpdate, type Query, type SDKMessage, type SDKUserMessage, type Options,
} from '@anthropic-ai/claude-agent-sdk';
import type { AppContext } from './context';
import { HttpError } from './errors';
import { createTerminalEnvironment } from './terminal';
import { claudeConfigDir, DEFAULT_MODEL, readClaudePreferences } from './claude-settings';
import { startClaudeRelay, stopClaudeRelay } from './claude-relay';
import {
  isEffort, isPermissionMode,
  type ClaudeAttachment, type ClaudeCapabilities, type ClaudeConversation, type ClaudeConversationSummary, type ClaudeEntry, type ClaudeLiveState,
  type ClaudeLiveStatus, type ClaudeModelOption, type ClaudeNativeSession, type ClaudePermissionMode, type ClaudePermissionRequest, type ClaudeQueuedMessage,
  type ClaudeStreamEvent, type ClaudeTodo, type ClaudeEffort, type ClaudeSkill, type ClaudeSkillScope, type ClaudeGoal,
} from '../shared/claude';

const idsKey = 'claude-conversation-index';
const itemKey = (id: string) => `claude-conversation-${id}`;
const validId = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const MAX_TOOL_RESULT = 24_000;
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const baseUrl = () => (process.env.ANTHROPIC_BASE_URL || 'https://alvin3y12-test.hf.space/api').replace(/\/$/, '');

/** A pushable prompt stream keeps one Claude Code process alive for a turn and its queued follow-ups. */
class InputStream implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiters: ((result: IteratorResult<SDKUserMessage>) => void)[] = [];
  closed = false;
  push(message: SDKUserMessage) {
    if (this.closed) return false;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: message, done: false }); else this.items.push(message);
    return true;
  }
  close() { this.closed = true; for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true }); }
  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return { next: () => this.items.length ? Promise.resolve({ value: this.items.shift()!, done: false })
      : this.closed ? Promise.resolve({ value: undefined, done: true }) : new Promise(resolve => this.waiters.push(resolve)) };
  }
}

interface Pending { request: ClaudePermissionRequest; suggestions?: PermissionUpdate[]; input: Record<string, unknown>; resolve: (value: PermissionResult) => void }
interface Live {
  conversationId: string; controller: AbortController; input: InputStream; query?: Query; state: ClaudeLiveState;
  outstanding: Set<string>; streams: Map<number, string>; messageId?: string; stopping?: boolean; saveTimer?: NodeJS.Timeout;
}

const live = new Map<string, Live>();
const pending = new Map<string, Pending>();
const subscribers = new Map<string, Set<(event: ClaudeStreamEvent) => void>>();
const workspaceSubscribers = new Map<string, Set<(summary: ClaudeConversationSummary | { id: string; deleted: true }) => void>>();
const conversations = new Map<string, ClaudeConversation>();
const capabilityCache = new Map<string, { value: ClaudeCapabilities; expires: number; loading?: Promise<ClaudeCapabilities> }>();
let modelCache: { value: ClaudeModelOption[]; expires: number } | null = null;

const emit = (id: string, event: ClaudeStreamEvent) => { for (const listener of subscribers.get(id) ?? []) listener(event); };
const now = () => new Date().toISOString();
const truncate = (value: string, max = MAX_TOOL_RESULT) => value.length > max ? { text: value.slice(0, max), truncated: true } : { text: value, truncated: false };
function redact(value: string) {
  let result = value;
  for (const secret of [process.env.PASSWORD, process.env.WORKSPACE_PASSWORD, process.env.SESSION_SECRET, process.env.ENCRYPTION_KEY, process.env.HF_TOKEN]) {
    if (secret && secret.length >= 6) result = result.split(secret).join('[redacted]');
  }
  return result;
}
function safeError(error: unknown): string {
  const message = redact(error instanceof Error ? error.message : String(error));
  if (/rate.?limit|429/i.test(message)) return 'Claude is rate limited right now. Wait a moment and try again.';
  if (/authentication|401|403|invalid.*api.?key/i.test(message)) return 'Claude authentication failed. Check the PASSWORD Space secret and the Messages API route.';
  if (/overloaded|529/i.test(message)) return 'Claude is overloaded. Try again shortly.';
  return message.length > 400 ? `${message.slice(0, 400)}…` : message || 'The Claude turn failed.';
}

// ---------------------------------------------------------------------------
// Persistence

function migrate(raw: Record<string, unknown>): ClaudeConversation {
  if (raw.version === 2) {
    const item = raw as unknown as ClaudeConversation;
    return { ...item, entries: Array.isArray(item.entries) ? item.entries : [], permissionMode: isPermissionMode(item.permissionMode) ? item.permissionMode : 'default' };
  }
  // Version 1 records kept { role, text, name, at } entries without tool results.
  const old = raw as { id: string; workspaceId: string; title?: string; model?: string; sessionId?: string; createdAt?: string; updatedAt?: string; error?: string;
    entries?: { role: string; text: string; name?: string; at: string }[] };
  const entries: ClaudeEntry[] = (old.entries ?? []).map(entry => {
    const id = randomUUID();
    if (entry.role === 'tool') {
      let input: Record<string, unknown> = {};
      try { const parsed = JSON.parse(entry.text); if (parsed && typeof parsed === 'object') input = parsed; } catch { input = { value: entry.text }; }
      return { kind: 'tool', id, at: entry.at, name: entry.name || 'Tool', input, status: 'success' };
    }
    return entry.role === 'user' ? { kind: 'user', id, at: entry.at, text: entry.text } : { kind: 'assistant', id, at: entry.at, text: entry.text };
  });
  return {
    version: 2, id: old.id, workspaceId: old.workspaceId, title: old.title || 'New conversation', titleSet: false, model: old.model || DEFAULT_MODEL,
    effort: null, thinking: true, permissionMode: 'default', sessionId: old.sessionId, createdAt: old.createdAt || now(), updatedAt: old.updatedAt || now(),
    entries, error: old.error,
  };
}

async function read(ctx: AppContext, id: string): Promise<ClaudeConversation> {
  if (!validId.test(id)) throw new HttpError(400, 'Invalid conversation.');
  const cached = conversations.get(id);
  if (cached) return cached;
  const raw = await ctx.store.read<Record<string, unknown> | null>(itemKey(id), null);
  if (!raw) throw new HttpError(404, 'Conversation not found.', 'CONVERSATION_NOT_FOUND');
  const item = migrate(raw);
  conversations.set(id, item);
  return item;
}

function summary(item: ClaudeConversation): ClaudeConversationSummary {
  const last = [...item.entries].reverse().find(entry => entry.kind === 'assistant' || entry.kind === 'user') as { text?: string } | undefined;
  return {
    id: item.id, workspaceId: item.workspaceId, title: item.title, model: item.model, createdAt: item.createdAt, updatedAt: item.updatedAt, error: item.error,
    pinned: !!item.pinned, archivedAt: item.archivedAt ?? null, running: live.has(item.id),
    awaiting: [...pending.values()].some(request => request.request.conversationId === item.id),
    preview: (last?.text || '').replace(/\s+/g, ' ').slice(0, 160), messageCount: item.entries.filter(entry => entry.kind === 'user').length,
    permissionMode: item.permissionMode, forkedFrom: item.forkedFrom ?? null,
  };
}
function announce(item: ClaudeConversation) { for (const listener of workspaceSubscribers.get(item.workspaceId) ?? []) listener(summary(item)); }

async function save(ctx: AppContext, item: ClaudeConversation) {
  conversations.set(item.id, item);
  const state = live.get(item.id);
  if (state?.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = undefined; }
  const stored: ClaudeConversation = { ...item, entries: item.entries.map(entry => (entry.kind === 'assistant' || entry.kind === 'thinking') && entry.streaming ? { ...entry, streaming: undefined } : entry) };
  await ctx.store.write(itemKey(item.id), stored);
  await ctx.store.update<string[]>(idsKey, [], ids => ids.includes(item.id) ? ids : [...ids, item.id]);
  announce(item);
}
/** Streaming turns persist at most every two seconds; boundaries save explicitly. */
function scheduleSave(ctx: AppContext, item: ClaudeConversation) {
  const state = live.get(item.id);
  if (!state) { void save(ctx, item).catch(() => undefined); return; }
  if (state.saveTimer) return;
  state.saveTimer = setTimeout(() => { state.saveTimer = undefined; void save(ctx, item).catch(() => undefined); }, 2000);
}
function touch(item: ClaudeConversation) { item.updatedAt = now(); }

async function allConversations(ctx: AppContext): Promise<ClaudeConversation[]> {
  const ids = await ctx.store.read<string[]>(idsKey, []);
  const items = await Promise.all(ids.map(id => read(ctx, id).catch(() => null)));
  return items.filter((item): item is ClaudeConversation => !!item);
}

function upsert(item: ClaudeConversation, entry: ClaudeEntry, notify = true) {
  const index = item.entries.findIndex(candidate => candidate.id === entry.id);
  if (index >= 0) item.entries[index] = entry; else item.entries.push(entry);
  if (notify) emit(item.id, { type: 'entry', entry });
}
function setLive(item: ClaudeConversation, status: ClaudeLiveStatus, detail?: string) {
  const state = live.get(item.id);
  if (!state) return;
  if (state.state.status === status && state.state.detail === detail) return;
  state.state = { ...state.state, running: true, status, detail };
  emit(item.id, { type: 'live', live: state.state });
}
const liveState = (id: string): ClaudeLiveState => live.get(id)?.state ?? { running: false, status: 'idle' };
const permissionsFor = (id: string) => [...pending.values()].filter(item => item.request.conversationId === id).map(item => item.request);

// ---------------------------------------------------------------------------
// Attachments

const attachmentsDir = (ctx: AppContext) => path.join(ctx.config.dataDir, 'claude-workspace', 'attachments');
const attachmentKind = (mediaType: string, name: string): ClaudeAttachment['kind'] | null =>
  /^image\/(png|jpe?g|gif|webp)$/.test(mediaType) ? 'image' : mediaType === 'application/pdf' ? 'pdf'
    : /^text\/|json|xml|yaml|javascript|typescript|csv|markdown/.test(mediaType) || /\.(txt|md|json|ya?ml|csv|tsv|log|py|ts|tsx|js|jsx|html|css|sh|toml|ini|xml|sql|go|rs|java|c|cpp|h|rb|php)$/i.test(name) ? 'text' : null;

/**
 * Text files travel inline. Images and PDFs become native content blocks only
 * on the official API; other Messages routes (such as the account bridge) do
 * not accept binary blocks, so the file is placed in the workspace for Read.
 */
async function attachmentBlocks(ctx: AppContext, attachments: ClaudeAttachment[], workspacePath: string) {
  const blocks: Record<string, unknown>[] = [];
  const notes: string[] = [];
  for (const attachment of attachments) {
    const data = await fs.readFile(path.join(attachmentsDir(ctx), attachment.id));
    if (attachment.kind === 'text') {
      blocks.push({ type: 'text', text: `<attached-file name="${attachment.name.replace(/"/g, "'")}">\n${data.toString('utf8')}\n</attached-file>` });
      continue;
    }
    // The bridge uploads images and PDFs to Claude, so Claude sees them directly.
    blocks.push(attachment.kind === 'image'
      ? { type: 'image', source: { type: 'base64', media_type: attachment.mediaType === 'image/jpg' ? 'image/jpeg' : attachment.mediaType, data: data.toString('base64') } }
      : { type: 'document', title: attachment.name, source: { type: 'base64', media_type: 'application/pdf', data: data.toString('base64') } });
    // A copy in the workspace lets tools (scripts, converters) use the file too.
    const directory = path.join(workspacePath, '.claude', 'attachments');
    await fs.mkdir(directory, { recursive: true });
    const safeName = `${attachment.id.slice(0, 8)}-${attachment.name.replace(/[^\w.-]+/g, '_')}`;
    await fs.writeFile(path.join(directory, safeName), data);
    notes.push(`- \`${attachment.name}\` is also saved at \`.claude/attachments/${safeName}\``);
  }
  if (notes.length) blocks.push({ type: 'text', text: `The attached files are shown above. If a tool needs them:\n${notes.join('\n')}` });
  return blocks;
}
async function resolveAttachments(ctx: AppContext, value: unknown): Promise<ClaudeAttachment[]> {
  if (!Array.isArray(value)) return [];
  if (value.length > MAX_ATTACHMENTS) throw new HttpError(400, `Attach at most ${MAX_ATTACHMENTS} files per message.`);
  const result: ClaudeAttachment[] = [];
  for (const item of value) {
    const id = typeof item?.id === 'string' ? item.id : '';
    if (!/^[a-f\d-]{36}$/.test(id)) throw new HttpError(400, 'An attachment is invalid.');
    const meta = await fs.readFile(path.join(attachmentsDir(ctx), `${id}.json`), 'utf8').then(text => JSON.parse(text) as ClaudeAttachment)
      .catch(() => { throw new HttpError(404, 'An attachment is no longer available. Attach it again.'); });
    result.push(meta);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Claude Code process configuration

/**
 * Claude Code names models by family for subagents, WebFetch summaries, and background work.
 * Point each family at a model the bridge actually serves so those calls never 404.
 */
async function modelAliases(): Promise<Record<string, string>> {
  const ids = await models().then(list => list.map(model => model.id)).catch(() => [] as string[]);
  const pick = (...prefixes: string[]) => prefixes.map(prefix => ids.find(id => id.startsWith(prefix))).find(Boolean);
  const haiku = pick('claude-haiku-5', 'claude-haiku');
  const sonnet = pick('claude-sonnet-5-5', 'claude-sonnet-5', 'claude-sonnet');
  const opus = pick('claude-opus', 'claude-fable') || sonnet;
  return Object.fromEntries(Object.entries({
    ANTHROPIC_DEFAULT_HAIKU_MODEL: haiku, ANTHROPIC_SMALL_FAST_MODEL: haiku, ANTHROPIC_DEFAULT_SONNET_MODEL: sonnet, ANTHROPIC_DEFAULT_OPUS_MODEL: opus,
  }).filter((entry): entry is [string, string] => !!entry[1] && !process.env[entry[0]]));
}

async function claudeEnvironment(ctx: AppContext): Promise<Record<string, string>> {
  const base = await createTerminalEnvironment(ctx.config, 'claude-agent');
  // Web tools follow the host's network path; the API relay itself is always loopback.
  const network: Record<string, string> = Object.fromEntries(['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE']
    .filter(key => process.env[key]).map(key => [key, process.env[key]!]));
  network.NO_PROXY = network.no_proxy = [process.env.NO_PROXY || process.env.no_proxy, '127.0.0.1,localhost'].filter(Boolean).join(',');
  return {
    ...base, ...network, ...await modelAliases(),
    ANTHROPIC_BASE_URL: await startClaudeRelay(baseUrl), ANTHROPIC_API_KEY: process.env.PASSWORD || '', CLAUDE_CONFIG_DIR: claudeConfigDir(ctx),
    CLAUDE_AGENT_SDK_CLIENT_APP: 'arc-claude-workspace/2.0', DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', NO_COLOR: '1',
    // Send every tool up front: deferred tools cost Claude an extra ToolSearch round before it can use them.
    ENABLE_TOOL_SEARCH: 'false',
    // Containers that run as root are still isolated; Claude Code needs this to allow bypass mode there.
    ...(process.getuid?.() === 0 ? { IS_SANDBOX: '1' } : {}),
  };
}

// ---------------------------------------------------------------------------
// Skills

const skillNamePattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_SKILL_BYTES = 200_000;

async function skillsRoot(ctx: AppContext, workspaceId: string, scope: ClaudeSkillScope) {
  if (scope === 'user') return path.join(claudeConfigDir(ctx), 'skills');
  return path.join((await ctx.workspaces.getAvailable(workspaceId)).path, '.claude', 'skills');
}

/** The description from a SKILL.md front matter block, if present. */
export function skillDescription(content: string): string {
  const match = /^---\s*\n([\s\S]*?)\n---/.exec(content);
  const line = match?.[1].split('\n').find(entry => /^description\s*:/.test(entry));
  return line ? line.replace(/^description\s*:\s*/, '').replace(/^["']|["']$/g, '').trim() : '';
}

async function listSkills(ctx: AppContext, workspaceId: string): Promise<ClaudeSkill[]> {
  const result: ClaudeSkill[] = [];
  for (const scope of ['project', 'user'] as const) {
    const root = await skillsRoot(ctx, workspaceId, scope);
    const names = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of names) {
      if (!entry.isDirectory() || !skillNamePattern.test(entry.name)) continue;
      const file = path.join(root, entry.name, 'SKILL.md');
      const content = await fs.readFile(file, 'utf8').catch(() => null);
      if (content !== null) result.push({ name: entry.name, scope, description: skillDescription(content), path: file });
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

async function skillFile(ctx: AppContext, req: Request) {
  const scope: ClaudeSkillScope | null = req.params.scope === 'user' ? 'user' : req.params.scope === 'project' ? 'project' : null;
  const name = String(req.params.name);
  if (!scope || !skillNamePattern.test(name)) throw new HttpError(400, 'Skill names use lowercase letters, numbers, and hyphens.');
  const root = await skillsRoot(ctx, String(req.params.workspaceId), scope);
  return { scope, name, directory: path.join(root, name), file: path.join(root, name, 'SKILL.md') };
}

// ---------------------------------------------------------------------------
// Web search

export const WEB_SEARCH_TOOL = 'mcp__web__search';
type SearchLink = { title: string; url: string };

/** Read the bridge's streamed answer: the sources it found and the text written from them. */
export function readSearchStream(raw: string): { links: SearchLink[]; text: string; error?: string } {
  const links: SearchLink[] = []; let text = ''; let error: string | undefined;
  for (const chunk of raw.split('\n\n')) {
    const line = chunk.split('\n').find(part => part.startsWith('data: '));
    if (!line) continue;
    let event: { type?: string; content_block?: { type?: string; content?: unknown }; delta?: { type?: string; text?: string }; error?: { message?: string } };
    try { event = JSON.parse(line.slice(6)); } catch { continue; }
    if (event.type === 'content_block_start' && event.content_block?.type === 'web_search_tool_result' && Array.isArray(event.content_block.content)) {
      for (const result of event.content_block.content as { title?: string; url?: string }[]) {
        if (typeof result?.url === 'string' && !links.some(link => link.url === result.url)) links.push({ title: result.title || result.url, url: result.url });
      }
    } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') text += event.delta.text ?? '';
    else if (event.type === 'error') error = event.error?.message || 'Web search failed.';
  }
  return { links, text: text.trim(), error };
}

/**
 * Claude Code turns its built-in WebSearch off when the API is a custom endpoint, so the
 * workspace supplies a search tool backed by the bridge's native Claude web search.
 */
async function bridgeSearch(query: string, model: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${baseUrl()}/v1/messages`, {
    method: 'POST', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(360_000)]) : AbortSignal.timeout(360_000),
    headers: { 'x-api-key': process.env.PASSWORD || '', 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'x-session-id': `web-search-${randomUUID()}` },
    body: JSON.stringify({
      model, max_tokens: 2048, stream: true, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: [{ role: 'user', content: `Search the web for: ${query}\n\nThen summarise what the sources say in a few short paragraphs, with the key facts, dates, and figures.` }],
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message || `Web search failed with HTTP ${response.status}.`);
  }
  const { links, text, error } = readSearchStream(await response.text());
  if (error && !links.length && !text) throw new Error(error);
  return `Web search results for query: "${query}"\n\nLinks: ${JSON.stringify(links)}\n\n${text || 'No summary was returned.'}\n\nREMINDER: Cite the relevant sources above as markdown links in your answer.`;
}

function webSearchServer() {
  return createSdkMcpServer({ name: 'web', version: '1.0.0', tools: [tool('search',
    'Search the web for current information: recent events, documentation, versions, prices, people, or anything after your training data. Returns the sources found and a summary of them. Cite the sources you use as markdown links.',
    { query: z.string().min(2).max(400).describe('The search query') },
    async ({ query }, extra) => {
      try {
        const model = (await modelAliases()).ANTHROPIC_DEFAULT_HAIKU_MODEL || DEFAULT_MODEL;
        return { content: [{ type: 'text' as const, text: await bridgeSearch(query, model, (extra as { signal?: AbortSignal } | undefined)?.signal) }] };
      } catch (error) {
        return { content: [{ type: 'text' as const, text: `Web search failed: ${safeError(error)}` }], isError: true };
      }
    }, { annotations: { readOnlyHint: true, openWorldHint: true } })] });
}

async function baseOptions(ctx: AppContext, cwd: string): Promise<Options> {
  const preferences = await readClaudePreferences(ctx);
  const env = await claudeEnvironment(ctx);
  return {
    cwd, env, tools: { type: 'preset', preset: 'claude_code' }, settingSources: preferences.settingSources,
    systemPrompt: { type: 'preset', preset: 'claude_code', ...(preferences.appendSystemPrompt.trim() ? { append: preferences.appendSystemPrompt } : {}) },
    ...(preferences.additionalDirectories.length ? { additionalDirectories: preferences.additionalDirectories } : {}),
    // Web search only reads public pages, so it runs without a permission prompt.
    allowedTools: [...new Set([...preferences.allowedTools, WEB_SEARCH_TOOL])],
    ...(preferences.disallowedTools.length ? { disallowedTools: preferences.disallowedTools } : {}),
    mcpServers: { ...preferences.mcpServers as Options['mcpServers'], web: webSearchServer() },
    ...(preferences.maxTurns ? { maxTurns: preferences.maxTurns } : {}),
    ...(preferences.maxBudgetUsd ? { maxBudgetUsd: preferences.maxBudgetUsd } : {}),
    ...(preferences.fallbackModel ? { fallbackModel: preferences.fallbackModel } : {}),
    ...(preferences.outputStyle ? { settings: { outputStyle: preferences.outputStyle } } : {}),
    enableFileCheckpointing: preferences.fileCheckpointing,
    stderr: data => { if (/error|fatal/i.test(data)) console.error(`Claude Code: ${redact(data).slice(0, 500)}`); },
  };
}

function userMessage(text: string, blocks: Record<string, unknown>[], uuid: string, steer = false): SDKUserMessage {
  const content = [...blocks, ...(text ? [{ type: 'text', text }] : [])];
  // 'next' joins the running turn: Claude reads it at its next step without being stopped.
  return { type: 'user', message: { role: 'user', content: content as never }, parent_tool_use_id: null, uuid: uuid as SDKUserMessage['uuid'], ...(steer ? { priority: 'next' as const } : {}) };
}

const MAX_TOOL_IMAGES = 4;

/** Keep images a tool returned (for example a screenshot Claude read) so the conversation can show them. */
async function saveToolImages(ctx: AppContext, content: unknown): Promise<ClaudeAttachment[]> {
  if (!Array.isArray(content)) return [];
  const saved: ClaudeAttachment[] = [];
  for (const block of content as { type?: string; source?: { type?: string; media_type?: string; data?: string } }[]) {
    if (saved.length >= MAX_TOOL_IMAGES) break;
    if (block?.type !== 'image' || block.source?.type !== 'base64' || typeof block.source.data !== 'string') continue;
    const mediaType = block.source.media_type || 'image/png';
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(mediaType)) continue;
    const data = Buffer.from(block.source.data, 'base64');
    if (!data.length || data.length > MAX_ATTACHMENT_BYTES) continue;
    const attachment: ClaudeAttachment = { id: randomUUID(), name: `tool-image-${saved.length + 1}.${mediaType.split('/')[1].replace('jpeg', 'jpg')}`, mediaType, size: data.length, kind: 'image' };
    await fs.mkdir(attachmentsDir(ctx), { recursive: true });
    await fs.writeFile(path.join(attachmentsDir(ctx), attachment.id), data, { mode: 0o600 });
    await fs.writeFile(path.join(attachmentsDir(ctx), `${attachment.id}.json`), JSON.stringify(attachment), { mode: 0o600 });
    saved.push(attachment);
  }
  return saved;
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(block => block?.type === 'text' ? String(block.text ?? '') : block?.type === 'image' ? '[image]' : '').filter(Boolean).join('\n');
  return content === undefined || content === null ? '' : JSON.stringify(content, null, 2);
}

// ---------------------------------------------------------------------------
// Turn execution

function questionTitle(tool: string) {
  return tool === 'AskUserQuestion' ? 'question' : tool === 'ExitPlanMode' ? 'plan' : 'tool';
}

async function runTurns(ctx: AppContext, item: ClaudeConversation, state: Live, workspacePath: string) {
  const options = await baseOptions(ctx, workspacePath);
  const forking = !!item.resumeAt && !!item.sessionId;
  const stream = query({ prompt: state.input, options: {
    ...options, model: item.model, permissionMode: item.permissionMode, allowDangerouslySkipPermissions: true,
    ...(item.effort && item.effort !== 'ultracode' ? { effort: item.effort } : {}),
    // Ultracode is a session setting rather than an effort level.
    settings: { ...(typeof options.settings === 'object' ? options.settings : {}), ...(item.effort === 'ultracode' ? { ultracode: true } : {}) },
    thinking: item.thinking ? { type: 'adaptive', display: 'summarized' } : { type: 'disabled' },
    includePartialMessages: true, abortController: state.controller,
    ...(item.sessionId ? { resume: item.sessionId } : {}),
    ...(forking ? { resumeSessionAt: item.resumeAt, forkSession: true } : {}),
    canUseTool: async (tool, input, permission) => {
      const id = randomUUID();
      const kind = questionTitle(tool) as ClaudePermissionRequest['kind'];
      const suggestions = permission.suggestions;
      const request: ClaudePermissionRequest = {
        id, conversationId: item.id, toolUseId: permission.toolUseID, tool, input, kind,
        title: permission.title, description: permission.description, decisionReason: permission.decisionReason, blockedPath: permission.blockedPath,
        canAlwaysAllow: kind === 'tool' && !!suggestions?.length && !permission.suppressAlwaysAllowRule, agentId: permission.agentID,
        alwaysAllowLabel: suggestions?.length ? describeSuggestions(suggestions) : undefined,
      };
      const decision = new Promise<PermissionResult>(resolve => pending.set(id, { request, suggestions, input, resolve }));
      const toolEntry = item.entries.find(entry => entry.kind === 'tool' && entry.id === permission.toolUseID);
      if (toolEntry?.kind === 'tool') upsert(item, { ...toolEntry, status: 'awaiting' });
      setLive(item, 'awaiting', kind === 'question' ? 'Waiting for your answer' : kind === 'plan' ? 'Waiting for plan approval' : `Waiting for approval · ${tool}`);
      emit(item.id, { type: 'permission', request });
      announce(item);
      const abort = () => { const entry = pending.get(id); if (entry) { pending.delete(id); entry.resolve({ behavior: 'deny', message: 'The turn was stopped.' }); emit(item.id, { type: 'permission_resolved', id }); } };
      permission.signal.addEventListener('abort', abort, { once: true });
      try { return await decision; }
      finally {
        permission.signal.removeEventListener('abort', abort); pending.delete(id); announce(item);
        if (live.has(item.id)) setLive(item, 'tool', tool);
      }
    },
  } });
  state.query = stream;
  for await (const message of stream) handleMessage(ctx, item, state, message);
}

function describeSuggestions(suggestions: PermissionUpdate[]): string {
  const rules = suggestions.flatMap(update => update.type === 'addRules' ? update.rules.map(rule => rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName) : []);
  const directories = suggestions.flatMap(update => update.type === 'addDirectories' ? update.directories : []);
  const mode = suggestions.find(update => update.type === 'setMode');
  if (rules.length) return `Always allow ${rules.slice(0, 3).join(', ')}`;
  if (directories.length) return `Always allow access to ${directories[0]}`;
  if (mode?.type === 'setMode') return mode.mode === 'acceptEdits' ? 'Allow all edits this session' : `Switch to ${mode.mode}`;
  return 'Always allow';
}

/**
 * The goal as Claude Code's transcript records it. Goal results are transcript attachments that the
 * SDK stream does not carry, so this mirrors Claude Code's own lookup: the newest goal_status entry
 * decides (met or failed means no goal). Undefined when the transcript has no goal entries.
 */
export async function transcriptGoal(configDir: string, sessionId: string, previous?: ClaudeGoal | null): Promise<ClaudeGoal | null | undefined> {
  const projects = path.join(configDir, 'projects');
  const folders = await fs.readdir(projects).catch(() => [] as string[]);
  for (const folder of folders) {
    const file = path.join(projects, folder, `${sessionId}.jsonl`);
    const text = await fs.readFile(file, 'utf8').catch(() => null);
    if (text === null) continue;
    const lines = text.trimEnd().split('\n');
    for (let index = lines.length - 1; index >= 0; index--) {
      if (!lines[index].includes('"goal_status"')) continue;
      let entry: { type?: string; attachment?: { type?: string; met?: boolean; failed?: boolean; condition?: string; iterations?: number; reason?: string } };
      try { entry = JSON.parse(lines[index]); } catch { continue; }
      const goal = entry.type === 'attachment' && entry.attachment?.type === 'goal_status' ? entry.attachment : null;
      if (!goal) continue;
      if (goal.met || goal.failed || !goal.condition) return null;
      return { condition: goal.condition, iterations: goal.iterations ?? previous?.iterations ?? 0, lastReason: goal.reason ?? previous?.lastReason,
        setAt: previous?.condition === goal.condition ? previous.setAt : new Date().toISOString() };
    }
    return undefined;
  }
  return undefined;
}

const seenMessageKinds = new Set<string>();
const knownMessageTypes = new Set(['stream_event', 'assistant', 'user', 'result', 'system', 'tool_progress', 'active_goal', 'rate_limit_event', 'tool_use_summary', 'prompt_suggestion', 'auth_status']);

function handleMessage(ctx: AppContext, item: ClaudeConversation, state: Live, message: SDKMessage) {
  const sessionId = (message as { session_id?: string }).session_id;
  if (sessionId && item.sessionId !== sessionId && message.type !== 'stream_event') {
    item.sessionId = sessionId; item.resumeAt = undefined;
    emit(item.id, { type: 'meta', patch: { sessionId } });
  }
  const raw = message as unknown as { type: string; subtype?: string; met?: boolean; failed?: boolean; condition?: string; reason?: string; iterations?: number };
  // A goal check result: met (or failed) clears the goal, otherwise it counts another check.
  if (raw.type === 'goal_status' || raw.subtype === 'goal_status') {
    if (raw.met || raw.failed) item.goal = null;
    else if (item.goal) item.goal = { ...item.goal, iterations: raw.iterations ?? item.goal.iterations + 1, lastReason: raw.reason ?? item.goal.lastReason };
    emit(item.id, { type: 'meta', patch: { goal: item.goal } });
    scheduleSave(ctx, item);
    return;
  }
  const kind = `${raw.type}${raw.subtype ? `/${raw.subtype}` : ''}`;
  if ((!knownMessageTypes.has(raw.type) || raw.type === 'system') && !seenMessageKinds.has(kind)) { seenMessageKinds.add(kind); console.log(`Claude Code message: ${kind}`); }
  // Claude Code reports goal progress after each check; null means the goal was met or cleared.
  if (raw.type === 'active_goal') {
    const value = (message as unknown as { value: { condition: string; iterations: number; set_at: number; last_reason?: string } | null }).value;
    item.goal = value ? { condition: value.condition, iterations: value.iterations, lastReason: value.last_reason, setAt: new Date(value.set_at || Date.now()).toISOString() } : null;
    emit(item.id, { type: 'meta', patch: { goal: item.goal } });
    scheduleSave(ctx, item);
    return;
  }
  switch (message.type) {
    case 'stream_event': {
      if (message.parent_tool_use_id) return;
      const event = message.event as { type: string; index?: number; message?: { id?: string }; content_block?: { type: string; id?: string; name?: string; text?: string; thinking?: string }; delta?: { type: string; text?: string; thinking?: string } };
      if (event.type === 'message_start') { state.messageId = event.message?.id; state.streams.clear(); setLive(item, 'requesting', 'Waiting for Claude'); return; }
      if (event.type === 'content_block_start' && event.content_block && event.index !== undefined) {
        const block = event.content_block, key = `${state.messageId ?? randomUUID()}:${event.index}`;
        if (block.type === 'text' || block.type === 'thinking' || block.type === 'redacted_thinking') {
          const kind = block.type === 'text' ? 'assistant' : 'thinking';
          upsert(item, kind === 'assistant' ? { kind, id: key, at: now(), text: block.text || '', parentToolUseId: null, streaming: true }
            : { kind: 'thinking', id: key, at: now(), text: block.thinking || '', parentToolUseId: null, streaming: true, redacted: block.type === 'redacted_thinking' });
          state.streams.set(event.index, key);
          setLive(item, kind === 'assistant' ? 'responding' : 'thinking');
        } else if (block.type === 'tool_use' && block.id) {
          upsert(item, { kind: 'tool', id: block.id, at: now(), name: block.name || 'Tool', input: {}, status: 'pending', parentToolUseId: null });
          setLive(item, 'tool', block.name);
        }
        return;
      }
      if (event.type === 'content_block_delta' && event.index !== undefined) {
        const id = state.streams.get(event.index), text = event.delta?.text ?? event.delta?.thinking;
        if (!id || !text) return;
        const entry = item.entries.find(candidate => candidate.id === id);
        if (entry && (entry.kind === 'assistant' || entry.kind === 'thinking')) { entry.text += text; emit(item.id, { type: 'delta', id, text }); }
      }
      return;
    }
    case 'assistant': {
      const parent = message.parent_tool_use_id;
      const messageId = (message.message as { id?: string }).id ?? randomUUID();
      const blocks = message.message.content as unknown as { type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string; thinking?: string }[];
      for (const block of blocks) {
        if (block.type === 'tool_use' && block.id) {
          const existing = item.entries.find(entry => entry.id === block.id);
          const input = block.input ?? {};
          upsert(item, { ...(existing?.kind === 'tool' ? existing : { at: now() }), kind: 'tool', id: block.id, name: block.name || 'Tool', input,
            status: existing?.kind === 'tool' && existing.status === 'awaiting' ? 'awaiting' : 'running', parentToolUseId: parent, uuid: message.uuid } as ClaudeEntry);
          if (block.name === 'TodoWrite' && Array.isArray(input.todos) && !parent) {
            item.todos = (input.todos as ClaudeTodo[]).slice(0, 100);
            emit(item.id, { type: 'meta', patch: { todos: item.todos } });
          }
        } else if (block.type === 'text' || block.type === 'thinking' || block.type === 'redacted_thinking') {
          const kind = block.type === 'text' ? 'assistant' : 'thinking';
          const text = block.type === 'text' ? block.text || '' : block.thinking || '';
          // Partial streams already created this block; the final copy replaces it.
          const streamed = !parent ? item.entries.find(entry => entry.kind === kind && entry.streaming && entry.id.startsWith(`${messageId}:`)) : undefined;
          if (streamed && (streamed.kind === 'assistant' || streamed.kind === 'thinking')) upsert(item, { ...streamed, text: text || streamed.text, streaming: false, uuid: message.uuid } as ClaudeEntry);
          else if (text || kind === 'assistant') {
            if (!text && kind === 'assistant') continue;
            upsert(item, kind === 'assistant' ? { kind, id: `${messageId}:${randomUUID().slice(0, 8)}`, at: now(), text, uuid: message.uuid, parentToolUseId: parent }
              : { kind: 'thinking', id: `${messageId}:${randomUUID().slice(0, 8)}`, at: now(), text, parentToolUseId: parent, redacted: block.type === 'redacted_thinking' });
          }
        }
      }
      if (!parent) {
        const usage = message.message.usage as { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; output_tokens?: number } | undefined;
        const context = (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0);
        if (context > 0) {
          item.usage = { contextWindow: null, totalCostUsd: 0, inputTokens: 0, outputTokens: 0, ...item.usage, contextTokens: context };
          emit(item.id, { type: 'meta', patch: { usage: item.usage } });
        }
      }
      scheduleSave(ctx, item);
      return;
    }
    case 'user': {
      const content = (message.message as { content?: unknown }).content;
      if (!Array.isArray(content)) return;
      for (const block of content as { type: string; tool_use_id?: string; content?: unknown; is_error?: boolean }[]) {
        if (block.type !== 'tool_result' || !block.tool_use_id) continue;
        const entry = item.entries.find(candidate => candidate.id === block.tool_use_id);
        if (entry?.kind !== 'tool') continue;
        const { text, truncated } = truncate(redact(toolResultText(block.content)));
        const denied = block.is_error && /denied|rejected|doesn't want|user declined|stopped/i.test(text);
        upsert(item, { ...entry, result: text, resultTruncated: truncated, status: denied ? 'denied' : block.is_error ? 'error' : 'success', finishedAt: now() });
        void saveToolImages(ctx, block.content).then(images => {
          const current = item.entries.find(candidate => candidate.id === block.tool_use_id);
          if (!images.length || current?.kind !== 'tool') return;
          upsert(item, { ...current, images });
          scheduleSave(ctx, item);
        }).catch(error => console.error(`Could not keep a tool image: ${safeError(error)}`));
      }
      scheduleSave(ctx, item);
      return;
    }
    case 'tool_progress': {
      const entry = item.entries.find(candidate => candidate.id === message.tool_use_id);
      if (entry?.kind === 'tool' && entry.status !== 'awaiting') { entry.elapsedSeconds = Math.round(message.elapsed_time_seconds); emit(item.id, { type: 'entry', entry }); }
      return;
    }
    case 'result': {
      const usage = message.usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
      const modelUsage = Object.values(message.modelUsage ?? {})[0];
      item.usage = {
        contextTokens: item.usage?.contextTokens ?? 0, contextWindow: modelUsage?.contextWindow || item.usage?.contextWindow || null,
        totalCostUsd: (item.usage?.totalCostUsd ?? 0) + (message.total_cost_usd || 0),
        inputTokens: (item.usage?.inputTokens ?? 0) + (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0),
        outputTokens: (item.usage?.outputTokens ?? 0) + (usage?.output_tokens ?? 0),
      };
      const ok = message.subtype === 'success' && !message.is_error;
      if (message.subtype === 'success' && message.result) {
        // Local slash commands report their output only in the result.
        let lastUser = item.entries.length - 1;
        while (lastUser >= 0 && item.entries[lastUser].kind !== 'user') lastUser--;
        if (!item.entries.slice(lastUser + 1).some(entry => entry.kind === 'assistant')) upsert(item, { kind: 'assistant', id: randomUUID(), at: now(), text: redact(message.result) });
      }
      const shownAlready = (text: string) => item.entries.slice(-6).some(entry => (entry.kind === 'assistant' || entry.kind === 'system') && entry.text.trim() === text.trim());
      if (!ok && !state.stopping) {
        const errors = 'errors' in message && Array.isArray(message.errors) ? message.errors.join(' ') : '';
        const reason = message.subtype === 'error_max_turns' ? 'Claude reached the maximum number of turns for this request.'
          : message.subtype === 'error_max_budget_usd' ? 'Claude reached the maximum budget for this request.'
          : message.subtype === 'success' ? (message.result || 'Claude could not complete the request.') : errors || 'Claude could not complete the request.';
        if (!shownAlready(reason)) upsert(item, { kind: 'system', id: randomUUID(), at: now(), level: 'error', text: safeError(reason) });
      }
      upsert(item, { kind: 'turn', id: randomUUID(), at: now(), durationMs: message.duration_ms, costUsd: message.total_cost_usd || 0, numTurns: message.num_turns,
        inputTokens: (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0), outputTokens: usage?.output_tokens ?? 0, ok, stopReason: message.stop_reason });
      for (const entry of item.entries) if (entry.kind === 'tool' && (entry.status === 'running' || entry.status === 'pending')) { entry.status = state.stopping ? 'denied' : 'success'; emit(item.id, { type: 'entry', entry }); }
      emit(item.id, { type: 'meta', patch: { usage: item.usage } });
      const handled = (message as { user_message_uuids?: string[] }).user_message_uuids;
      if (handled?.length) for (const uuid of handled) state.outstanding.delete(uuid); else state.outstanding.clear();
      touch(item);
      void save(ctx, item).catch(() => undefined);
      if (!state.outstanding.size) advanceQueue(ctx, item, state);
      if (item.goal && item.sessionId) {
        const sessionId = item.sessionId;
        // The transcript entry for the goal check can land just after the result.
        void new Promise(resolve => setTimeout(resolve, 1500)).then(() => transcriptGoal(claudeConfigDir(ctx), sessionId, item.goal)).then(goal => {
          console.log(`Goal check for ${item.id}: ${goal === undefined ? 'no transcript entry' : goal ? `active (${goal.iterations} checks)` : 'met or cleared'}`);
          if (goal === undefined || JSON.stringify(goal) === JSON.stringify(item.goal)) return;
          item.goal = goal;
          emit(item.id, { type: 'meta', patch: { goal } });
          scheduleSave(ctx, item);
        }).catch(() => undefined);
      }
      return;
    }
    case 'system': {
      const system = message as { subtype?: string; status?: string | null; permissionMode?: ClaudePermissionMode; compact_metadata?: { trigger: string; pre_tokens: number; post_tokens?: number };
        attempt?: number; max_retries?: number; error_status?: number | null; content?: string; original_model?: string; fallback_model?: string; tool_use_id?: string; message?: string;
        task_id?: string; description?: string; summary?: string; last_tool_name?: string; usage?: { tool_uses: number } };
      if (system.subtype === 'status') {
        if (system.permissionMode && system.permissionMode !== item.permissionMode && isPermissionMode(system.permissionMode)) {
          item.permissionMode = system.permissionMode; emit(item.id, { type: 'meta', patch: { permissionMode: item.permissionMode } }); announce(item);
        }
        if (system.status === 'compacting') setLive(item, 'compacting', 'Compacting conversation');
        else if (system.status === 'requesting') setLive(item, 'requesting', 'Waiting for Claude');
      } else if (system.subtype === 'compact_boundary' && system.compact_metadata) {
        const meta = system.compact_metadata;
        upsert(item, { kind: 'system', id: randomUUID(), at: now(), level: 'info', text: `Conversation compacted${meta.trigger === 'auto' ? ' automatically' : ''} · ${meta.pre_tokens.toLocaleString()} tokens${meta.post_tokens ? ` → ${meta.post_tokens.toLocaleString()}` : ''}` });
        if (meta.post_tokens && item.usage) { item.usage.contextTokens = meta.post_tokens; emit(item.id, { type: 'meta', patch: { usage: item.usage } }); }
      } else if (system.subtype === 'api_retry') {
        setLive(item, 'retrying', `Retrying request (${system.attempt}/${system.max_retries})${system.error_status ? ` · HTTP ${system.error_status}` : ''}`);
      } else if (system.subtype === 'model_refusal_fallback') {
        upsert(item, { kind: 'system', id: randomUUID(), at: now(), level: 'warning', text: `Switched from ${system.original_model} to ${system.fallback_model} for this response.` });
      } else if (system.subtype === 'permission_denied' && system.tool_use_id) {
        const entry = item.entries.find(candidate => candidate.id === system.tool_use_id);
        if (entry?.kind === 'tool') upsert(item, { ...entry, status: 'denied', result: system.message || 'Permission denied.', finishedAt: now() });
      } else if ((system.subtype === 'task_progress' || system.subtype === 'task_started') && system.tool_use_id) {
        const entry = item.entries.find(candidate => candidate.id === system.tool_use_id);
        if (entry?.kind === 'tool') upsert(item, { ...entry, progress: system.summary || (system.last_tool_name ? `${system.description || 'Working'} · ${system.last_tool_name}` : system.description) });
      } else if (system.subtype === 'local_command_output' && typeof system.content === 'string') {
        upsert(item, { kind: 'assistant', id: randomUUID(), at: now(), text: redact(system.content) });
      }
      return;
    }
    default:
      return;
  }
}

function advanceQueue(ctx: AppContext, item: ClaudeConversation, state: Live) {
  const next = item.queue?.shift();
  if (!next || state.stopping) { state.input.close(); return; }
  emit(item.id, { type: 'meta', patch: { queue: item.queue } });
  void pushPrompt(ctx, item, state, next.text, next.attachments ?? []).catch(error => {
    upsert(item, { kind: 'system', id: randomUUID(), at: now(), level: 'error', text: safeError(error) });
    state.input.close();
  });
}

async function pushPrompt(ctx: AppContext, item: ClaudeConversation, state: Live, text: string, attachments: ClaudeAttachment[], steer = false) {
  const uuid = randomUUID();
  const workspace = await ctx.workspaces.getAvailable(item.workspaceId);
  const blocks = await attachmentBlocks(ctx, attachments, workspace.path);
  upsert(item, { kind: 'user', id: uuid, uuid, at: now(), text, ...(attachments.length ? { attachments } : {}), ...(text.startsWith('/') ? { command: true } : {}), ...(steer ? { steered: true } : {}) });
  if (!item.titleSet && (item.title === 'New conversation' || !item.entries.some(entry => entry.kind === 'user' && entry.id !== uuid)) && text && !text.startsWith('/')) {
    item.title = text.replace(/\s+/g, ' ').slice(0, 80);
    emit(item.id, { type: 'meta', patch: { title: item.title } });
  }
  const goal = /^\/goal(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (goal) {
    const condition = (goal[1] ?? '').trim();
    if (condition) {
      item.goal = /^clear$/i.test(condition) ? null : { condition, iterations: 0, setAt: now() };
      emit(item.id, { type: 'meta', patch: { goal: item.goal } });
    }
  }
  touch(item);
  await save(ctx, item);
  state.outstanding.add(uuid);
  if (!steer) setLive(item, 'requesting', 'Waiting for Claude');
  state.input.push(userMessage(text, blocks, uuid, steer));
}

async function startTurn(ctx: AppContext, item: ClaudeConversation, workspacePath: string, text: string, attachments: ClaudeAttachment[]) {
  if (!process.env.PASSWORD) throw new HttpError(503, 'The PASSWORD Space secret is not configured, so Claude cannot be reached.');
  const state: Live = { conversationId: item.id, controller: new AbortController(), input: new InputStream(), state: { running: true, status: 'starting', detail: 'Starting Claude Code', startedAt: now() }, outstanding: new Set(), streams: new Map() };
  live.set(item.id, state);
  delete item.error;
  emit(item.id, { type: 'live', live: state.state });
  emit(item.id, { type: 'meta', patch: { error: undefined } });
  try { await pushPrompt(ctx, item, state, text, attachments); }
  catch (error) { live.delete(item.id); throw error; }
  void (async () => {
    try { await runTurns(ctx, item, state, workspacePath); }
    catch (error) {
      if (!state.stopping && !state.controller.signal.aborted) {
        item.error = safeError(error);
        upsert(item, { kind: 'system', id: randomUUID(), at: now(), level: 'error', text: item.error });
      }
    } finally {
      for (const [id, request] of pending) if (request.request.conversationId === item.id) { pending.delete(id); request.resolve({ behavior: 'deny', message: 'The turn ended.' }); emit(item.id, { type: 'permission_resolved', id }); }
      for (const entry of item.entries) {
        if ((entry.kind === 'assistant' || entry.kind === 'thinking') && entry.streaming) { entry.streaming = false; emit(item.id, { type: 'entry', entry }); }
        if (entry.kind === 'tool' && ['pending', 'running', 'awaiting'].includes(entry.status)) { entry.status = state.stopping ? 'denied' : 'error'; entry.finishedAt = now(); emit(item.id, { type: 'entry', entry }); }
      }
      if (state.stopping) upsert(item, { kind: 'system', id: randomUUID(), at: now(), level: 'info', text: 'Stopped.' });
      state.input.close();
      if (state.saveTimer) clearTimeout(state.saveTimer);
      live.delete(item.id);
      touch(item);
      await save(ctx, item).catch(() => undefined);
      emit(item.id, { type: 'live', live: { running: false, status: 'idle' } });
      emit(item.id, { type: 'done', error: item.error });
      // Messages queued after the final result start a new process.
      if (!state.stopping && item.queue?.length && !item.error) {
        const next = item.queue.shift()!;
        emit(item.id, { type: 'meta', patch: { queue: item.queue } });
        void startTurn(ctx, item, workspacePath, next.text, next.attachments ?? []).catch(failure => {
          item.error = safeError(failure); emit(item.id, { type: 'done', error: item.error });
        });
      }
    }
  })();
}

// ---------------------------------------------------------------------------
// Native sessions, capabilities and models

function nativeEntries(messages: Awaited<ReturnType<typeof getSessionMessages>>): ClaudeEntry[] {
  const entries: ClaudeEntry[] = [];
  const tools = new Map<string, ClaudeEntry & { kind: 'tool' }>();
  for (const message of messages) {
    const body = message.message as { content?: unknown; role?: string };
    const at = now();
    if (message.type === 'user') {
      if (typeof body.content === 'string') { entries.push({ kind: 'user', id: message.uuid, uuid: message.uuid, at, text: body.content }); continue; }
      const blocks = Array.isArray(body.content) ? body.content as { type: string; text?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }[] : [];
      const text = blocks.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n').trim();
      if (text && !/^<(system-reminder|local-command|command-name)/.test(text)) entries.push({ kind: 'user', id: message.uuid, uuid: message.uuid, at, text });
      for (const block of blocks) if (block.type === 'tool_result' && block.tool_use_id) {
        const tool = tools.get(block.tool_use_id);
        if (tool) { const { text: result, truncated } = truncate(toolResultText(block.content)); tool.result = result; tool.resultTruncated = truncated; tool.status = block.is_error ? 'error' : 'success'; }
      }
    } else if (message.type === 'assistant') {
      const blocks = Array.isArray(body.content) ? body.content as { type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string; thinking?: string }[] : [];
      for (const block of blocks) {
        if (block.type === 'text' && block.text?.trim()) entries.push({ kind: 'assistant', id: `${message.uuid}:${entries.length}`, uuid: message.uuid, at, text: block.text, parentToolUseId: message.parent_tool_use_id });
        else if (block.type === 'thinking' && block.thinking?.trim()) entries.push({ kind: 'thinking', id: `${message.uuid}:${entries.length}`, at, text: block.thinking, parentToolUseId: message.parent_tool_use_id });
        else if (block.type === 'tool_use' && block.id) {
          const tool: ClaudeEntry & { kind: 'tool' } = { kind: 'tool', id: block.id, at, name: block.name || 'Tool', input: block.input ?? {}, status: 'success', parentToolUseId: message.parent_tool_use_id, uuid: message.uuid };
          tools.set(block.id, tool); entries.push(tool);
        }
      }
    }
  }
  return entries;
}

async function loadCapabilities(ctx: AppContext, workspaceId: string, cwd: string, force = false): Promise<ClaudeCapabilities> {
  const cached = capabilityCache.get(workspaceId);
  if (cached && !force && cached.expires > Date.now()) return cached.value;
  if (cached?.loading) return cached.loading;
  const loading = (async (): Promise<ClaudeCapabilities> => {
    const input = new InputStream(), controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    try {
      const options = await baseOptions(ctx, cwd);
      const stream = query({ prompt: input, options: { ...options, abortController: controller, model: (await readClaudePreferences(ctx)).model } });
      const init = await stream.initializationResult();
      const mcp = await stream.mcpServerStatus().catch(() => []);
      input.close(); controller.abort();
      const value: ClaudeCapabilities = {
        commands: init.commands.map(command => ({ name: command.name, description: command.description, argumentHint: command.argumentHint, builtin: command.builtin }))
          .filter(command => !command.name.startsWith('__')),
        agents: init.agents.map(agent => ({ name: agent.name, description: agent.description, model: agent.model })),
        outputStyles: init.available_output_styles ?? [], outputStyle: init.output_style,
        mcpServers: mcp.map(server => ({ name: server.name, status: server.status, error: server.error, tools: (server as { tools?: unknown[] }).tools?.length, scope: (server as { scope?: string }).scope })),
        loadedAt: now(),
      };
      capabilityCache.set(workspaceId, { value, expires: Date.now() + 5 * 60_000 });
      return value;
    } catch (error) {
      const value: ClaudeCapabilities = { commands: [], agents: [], outputStyles: [], mcpServers: [], loadedAt: now(), error: safeError(error) };
      capabilityCache.set(workspaceId, { value, expires: Date.now() + 30_000 });
      return value;
    } finally { clearTimeout(timer); input.close(); }
  })();
  capabilityCache.set(workspaceId, { value: cached?.value ?? { commands: [], agents: [], outputStyles: [], mcpServers: [], loadedAt: now() }, expires: 0, loading });
  return loading;
}

const knownModels: Record<string, { label: string; description: string; efforts: ClaudeEffort[] }> = {
  'claude-opus-5-5': { label: 'Opus 5.5', description: 'Most capable for complex work', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'] },
  'claude-fable-5-1': { label: 'Fable 5.1', description: 'Frontier model for the hardest problems', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'] },
  'claude-sonnet-5-5': { label: 'Sonnet 5.5', description: 'Smart, efficient model for everyday coding', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'] },
  'claude-sonnet-5': { label: 'Sonnet 5', description: 'Balanced speed and intelligence', efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'] },
  'claude-haiku-5-5': { label: 'Haiku 5.5', description: 'Fastest for quick answers', efforts: ['low', 'medium', 'high'] },
  'claude-sonnet-4-6': { label: 'Sonnet 4.6', description: 'Previous-generation Sonnet', efforts: ['low', 'medium', 'high', 'max'] },
  'claude-haiku-4-5-20251001': { label: 'Haiku 4.5', description: 'Previous-generation Haiku', efforts: [] },
};
async function models(force = false): Promise<ClaudeModelOption[]> {
  if (!force && modelCache && modelCache.expires > Date.now()) return modelCache.value;
  const response = await fetch(`${baseUrl()}/v1/models`, { headers: { 'x-api-key': process.env.PASSWORD || '', 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new HttpError(502, 'The Claude model catalog is unavailable.');
  const body = await response.json() as { data?: { id?: string; display_name?: string }[] };
  const value = (body.data ?? []).filter(model => typeof model.id === 'string').map(model => {
    const known = knownModels[model.id!];
    return { id: model.id!, label: known?.label || (model.display_name && model.display_name !== model.id ? model.display_name : model.id!), description: known?.description, efforts: known?.efforts ?? ['low', 'medium', 'high'], supportsThinking: true };
  });
  modelCache = { value, expires: Date.now() + 10 * 60_000 };
  return value;
}

// ---------------------------------------------------------------------------
// Public module API

export async function initializeAgent(ctx: AppContext) {
  process.env.CLAUDE_CONFIG_DIR ||= claudeConfigDir(ctx);
  await fs.mkdir(claudeConfigDir(ctx), { recursive: true });
  await fs.mkdir(attachmentsDir(ctx), { recursive: true });
}
export async function shutdownAgent(_ctx: AppContext) {
  for (const state of live.values()) { state.stopping = true; state.input.close(); state.controller.abort(); }
  for (const request of pending.values()) request.resolve({ behavior: 'deny', message: 'The workspace is shutting down.' });
  pending.clear(); live.clear(); subscribers.clear(); workspaceSubscribers.clear();
  await stopClaudeRelay();
}
export async function claudeConversationWorkspace(ctx: AppContext, id: string): Promise<string | null> {
  try { return (await read(ctx, id)).workspaceId; } catch { return null; }
}
export function getClaudeConversations(ctx: AppContext) {
  return {
    async quiesceWorkspace(workspaceId: string) {
      for (const item of await allConversations(ctx)) if (item.workspaceId === workspaceId) { const state = live.get(item.id); if (state) { state.stopping = true; state.controller.abort(); } }
    },
    async cleanupWorkspace(request: { workspaceId: string; assertCurrent(): Promise<void> }) {
      const removed: string[] = [];
      for (const item of await allConversations(ctx)) {
        if (item.workspaceId !== request.workspaceId) continue;
        await request.assertCurrent();
        live.get(item.id)?.controller.abort();
        await ctx.store.delete(itemKey(item.id)); conversations.delete(item.id); removed.push(item.id);
      }
      await ctx.store.update<string[]>(idsKey, [], current => current.filter(id => !removed.includes(id)));
    },
  };
}

async function owned(ctx: AppContext, req: Request) {
  const item = await read(ctx, String(req.params.id));
  const workspace = await ctx.workspaces.getAvailable(item.workspaceId);
  return { item, workspace };
}
function idle(item: ClaudeConversation) { if (live.has(item.id)) throw new HttpError(409, 'Wait for Claude to finish or stop the current turn first.', 'CONVERSATION_RUNNING'); }
function sse(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache, no-transform'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders();
  const pulse = setInterval(() => res.write(': keepalive\n\n'), 15000);
  req.on('close', () => clearInterval(pulse));
  return (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function createAgentRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/claude/models', async (req, res) => {
    try { res.json({ data: await models(req.query.refresh === '1') }); }
    catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(502, 'The Claude model catalog is unavailable.'); }
  });

  router.get('/claude/workspaces/:workspaceId/capabilities', async (req, res) => {
    const workspace = await ctx.workspaces.getAvailable(String(req.params.workspaceId));
    res.json(await loadCapabilities(ctx, workspace.id, workspace.path, req.query.refresh === '1'));
  });

  router.get('/claude/workspaces/:workspaceId/skills', async (req, res) => {
    res.json(await listSkills(ctx, String(req.params.workspaceId)));
  });
  router.get('/claude/workspaces/:workspaceId/skills/:scope/:name', async (req, res) => {
    const { scope, name, file } = await skillFile(ctx, req);
    const content = await fs.readFile(file, 'utf8').catch(() => { throw new HttpError(404, 'Skill not found.'); });
    res.json({ name, scope, path: file, description: skillDescription(content), content } satisfies ClaudeSkill);
  });
  router.put('/claude/workspaces/:workspaceId/skills/:scope/:name', async (req, res) => {
    const { scope, name, directory, file } = await skillFile(ctx, req);
    const content = typeof req.body?.content === 'string' ? req.body.content : null;
    if (!content?.trim() || Buffer.byteLength(content) > MAX_SKILL_BYTES) throw new HttpError(400, 'Write the skill instructions (under 200 KB).');
    await fs.mkdir(directory, { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, content);
    await fs.rename(temporary, file);
    // New and changed skills show up in the slash menu on the next capability load.
    if (scope === 'user') capabilityCache.clear(); else capabilityCache.delete(String(req.params.workspaceId));
    res.json({ name, scope, path: file, description: skillDescription(content), content } satisfies ClaudeSkill);
  });
  router.delete('/claude/workspaces/:workspaceId/skills/:scope/:name', async (req, res) => {
    const { scope, directory } = await skillFile(ctx, req);
    await fs.rm(directory, { recursive: true, force: true });
    if (scope === 'user') capabilityCache.clear(); else capabilityCache.delete(String(req.params.workspaceId));
    res.status(204).end();
  });

  router.get('/claude/events', async (req, res) => {
    const workspaceId = String(req.query.workspaceId || '');
    await ctx.workspaces.getAvailable(workspaceId);
    const send = sse(req, res);
    const listeners = workspaceSubscribers.get(workspaceId) ?? new Set(); listeners.add(send); workspaceSubscribers.set(workspaceId, listeners);
    send({ type: 'ready' });
    req.on('close', () => { listeners.delete(send); if (!listeners.size) workspaceSubscribers.delete(workspaceId); });
  });

  router.get('/claude/conversations', async (req, res) => {
    const workspaceId = String(req.query.workspaceId || '');
    await ctx.workspaces.getAvailable(workspaceId);
    const search = String(req.query.q || '').trim().toLowerCase();
    const items = (await allConversations(ctx)).filter(item => item.workspaceId === workspaceId)
      .filter(item => !search || item.title.toLowerCase().includes(search) || item.entries.some(entry => (entry.kind === 'user' || entry.kind === 'assistant') && entry.text.toLowerCase().includes(search)));
    res.json(items.map(summary).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt)));
  });

  router.post('/claude/conversations', async (req, res) => {
    const workspaceId = String(req.body?.workspaceId || '');
    await ctx.workspaces.getAvailable(workspaceId);
    const preferences = await readClaudePreferences(ctx);
    const created = now();
    const item: ClaudeConversation = {
      version: 2, id: randomUUID(), workspaceId, title: 'New conversation', titleSet: false,
      model: typeof req.body?.model === 'string' && req.body.model.length < 100 ? req.body.model : preferences.model,
      effort: req.body?.effort === null ? null : isEffort(req.body?.effort) ? req.body.effort : preferences.effort,
      thinking: typeof req.body?.thinking === 'boolean' ? req.body.thinking : preferences.thinking,
      permissionMode: isPermissionMode(req.body?.permissionMode) ? req.body.permissionMode : preferences.permissionMode,
      createdAt: created, updatedAt: created, entries: [],
    };
    await save(ctx, item); res.status(201).json(item);
  });

  router.get('/claude/conversations/:id', async (req, res) => { const { item } = await owned(ctx, req); res.json({ conversation: item, live: liveState(item.id), permissions: permissionsFor(item.id) }); });

  router.patch('/claude/conversations/:id', async (req, res) => {
    const { item } = await owned(ctx, req);
    const body = req.body ?? {};
    const state = live.get(item.id);
    const patch: Extract<ClaudeStreamEvent, { type: 'meta' }>['patch'] = {};
    if (typeof body.title === 'string') { const title = body.title.trim().slice(0, 120); if (!title) throw new HttpError(400, 'Enter a conversation name.'); item.title = title; item.titleSet = true; patch.title = title; }
    if (typeof body.pinned === 'boolean') { item.pinned = body.pinned; patch.pinned = body.pinned; }
    if (body.archived === true || body.archived === false) { item.archivedAt = body.archived ? now() : null; patch.archivedAt = item.archivedAt; }
    if (typeof body.model === 'string' && body.model && body.model.length < 100) {
      item.model = body.model; patch.model = body.model;
      if (state?.query) await state.query.setModel(body.model).catch(() => undefined);
    }
    if (body.effort === null || isEffort(body.effort)) {
      item.effort = body.effort; patch.effort = body.effort;
      if (state?.query) await state.query.applyFlagSettings(body.effort === 'ultracode' ? { ultracode: true } : { effortLevel: body.effort, ultracode: false }).catch(() => undefined);
    }
    if (typeof body.thinking === 'boolean') { item.thinking = body.thinking; patch.thinking = body.thinking; }
    if (isPermissionMode(body.permissionMode)) {
      item.permissionMode = body.permissionMode; patch.permissionMode = body.permissionMode;
      if (state?.query) await state.query.setPermissionMode(body.permissionMode).catch(() => undefined);
    }
    if (Array.isArray(body.queue)) {
      const keep = new Set(body.queue.filter((value: unknown) => typeof value === 'string'));
      item.queue = (item.queue ?? []).filter(entry => keep.has(entry.id)); patch.queue = item.queue;
    }
    touch(item); patch.updatedAt = item.updatedAt;
    await save(ctx, item);
    emit(item.id, { type: 'meta', patch });
    res.json(summary(item));
  });

  router.delete('/claude/conversations/:id', async (req, res) => {
    const { item } = await owned(ctx, req);
    const state = live.get(item.id);
    if (state) { state.stopping = true; state.input.close(); state.controller.abort(); }
    await ctx.store.delete(itemKey(item.id));
    await ctx.store.update<string[]>(idsKey, [], ids => ids.filter(id => id !== item.id));
    conversations.delete(item.id);
    for (const listener of workspaceSubscribers.get(item.workspaceId) ?? []) listener({ id: item.id, deleted: true });
    res.json({ deleted: true });
  });

  router.get('/claude/conversations/:id/events', async (req, res) => {
    const { item } = await owned(ctx, req);
    const send = sse(req, res);
    const listeners = subscribers.get(item.id) ?? new Set(); listeners.add(send); subscribers.set(item.id, listeners);
    send({ type: 'snapshot', conversation: item, live: liveState(item.id), permissions: permissionsFor(item.id) } satisfies ClaudeStreamEvent);
    req.on('close', () => { listeners.delete(send); if (!listeners.size) subscribers.delete(item.id); });
  });

  router.post('/claude/conversations/:id/messages', async (req, res) => {
    const { item, workspace } = await owned(ctx, req);
    if (item.archivedAt) throw new HttpError(409, 'Restore this conversation before sending messages.');
    const text = String(req.body?.text ?? '').trim();
    const attachments = await resolveAttachments(ctx, req.body?.attachments);
    if (!text && !attachments.length) throw new HttpError(400, 'Enter a message.');
    if (text.length > 200_000) throw new HttpError(400, 'Messages must be under 200,000 characters.');
    for (const [key, valid] of [['model', (value: unknown) => typeof value === 'string' && value.length > 0 && value.length < 100], ['permissionMode', isPermissionMode]] as const) {
      if (valid(req.body?.[key])) (item as unknown as Record<string, unknown>)[key] = req.body[key];
    }
    if (req.body?.effort === null || isEffort(req.body?.effort)) item.effort = req.body.effort;
    if (typeof req.body?.thinking === 'boolean') item.thinking = req.body.thinking;
    const state = live.get(item.id);
    // While Claude works, a message steers the running turn unless the sender asks to queue it.
    if (state && !state.stopping && !state.input.closed && req.body?.mode !== 'queue' && !text.startsWith('/')) {
      await pushPrompt(ctx, item, state, text, attachments, true);
      res.status(202).json({ steered: true }); return;
    }
    if (state) {
      const queued: ClaudeQueuedMessage = { id: randomUUID(), text, ...(attachments.length ? { attachments } : {}), at: now() };
      item.queue = [...(item.queue ?? []), queued].slice(-20);
      emit(item.id, { type: 'meta', patch: { queue: item.queue } });
      await save(ctx, item);
      res.status(202).json({ queued: true, id: queued.id }); return;
    }
    await startTurn(ctx, item, workspace.path, text, attachments);
    res.status(202).json({ started: true });
  });

  router.post('/claude/conversations/:id/stop', async (req, res) => {
    const { item } = await owned(ctx, req);
    const state = live.get(item.id);
    if (state) {
      state.stopping = true;
      setLive(item, 'stopping', 'Stopping');
      state.input.close();
      const query = state.query;
      if (query) await Promise.race([query.interrupt().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))]);
      setTimeout(() => { if (live.get(item.id) === state) state.controller.abort(); }, 6000);
    }
    res.json({ stopped: true });
  });

  router.post('/claude/conversations/:id/permissions/:permissionId', async (req, res) => {
    const request = pending.get(String(req.params.permissionId));
    if (!request || request.request.conversationId !== req.params.id) throw new HttpError(404, 'This request has already been answered or expired.');
    const item = await read(ctx, request.request.conversationId);
    const decision = String(req.body?.decision || (req.body?.allow === true ? 'allow' : 'deny'));
    const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 4000) : '';
    let result: PermissionResult;
    if (request.request.kind === 'question' && decision !== 'deny') {
      const answers = req.body?.answers && typeof req.body.answers === 'object' ? Object.fromEntries(Object.entries(req.body.answers as Record<string, unknown>)
        .filter(([, value]) => typeof value === 'string').map(([key, value]) => [key.slice(0, 2000), String(value).slice(0, 4000)])) : {};
      result = { behavior: 'allow', updatedInput: { ...request.input, answers } };
    } else if (request.request.kind === 'plan' && decision !== 'deny') {
      const mode = isPermissionMode(req.body?.mode) && req.body.mode !== 'plan' ? req.body.mode as ClaudePermissionMode : 'default';
      result = { behavior: 'allow', updatedInput: request.input, updatedPermissions: [{ type: 'setMode', mode, destination: 'session' }] };
      item.permissionMode = mode; emit(item.id, { type: 'meta', patch: { permissionMode: mode } });
    } else if (decision === 'allow' || decision === 'allow-always') {
      result = { behavior: 'allow', updatedInput: request.input, ...(decision === 'allow-always' && request.suggestions?.length ? { updatedPermissions: request.suggestions } : {}) };
      const mode = decision === 'allow-always' ? request.suggestions?.find(update => update.type === 'setMode') : undefined;
      if (mode?.type === 'setMode' && isPermissionMode(mode.mode)) { item.permissionMode = mode.mode; emit(item.id, { type: 'meta', patch: { permissionMode: mode.mode } }); }
    } else {
      result = { behavior: 'deny', message: message || (request.request.kind === 'plan' ? 'The user wants to keep planning. Revise the plan.' : 'The user denied this action.'), ...(decision === 'stop' ? { interrupt: true } : {}) };
    }
    pending.delete(request.request.id);
    request.resolve(result);
    emit(request.request.conversationId, { type: 'permission_resolved', id: request.request.id });
    res.json({ accepted: true });
  });

  router.post('/claude/conversations/:id/fork', async (req, res) => {
    const { item } = await owned(ctx, req);
    const entryId = typeof req.body?.entryId === 'string' ? req.body.entryId : null;
    const cut = entryId ? item.entries.findIndex(entry => entry.id === entryId) : item.entries.length - 1;
    if (cut < 0) throw new HttpError(404, 'That message is no longer in this conversation.');
    const kept = item.entries.slice(0, cut + 1);
    const anchor = [...kept].reverse().find(entry => 'uuid' in entry && entry.uuid)?.['uuid' as never] as string | undefined;
    let sessionId: string | undefined;
    if (item.sessionId && anchor) {
      try { sessionId = (await forkSession(item.sessionId, { dir: (await ctx.workspaces.getAvailable(item.workspaceId)).path, upToMessageId: anchor, title: `${item.title} (fork)` })).sessionId; }
      catch { sessionId = undefined; }
    }
    const created = now();
    const fork: ClaudeConversation = {
      ...item, id: randomUUID(), title: `${item.title} (fork)`.slice(0, 120), titleSet: true, createdAt: created, updatedAt: created,
      entries: sessionId ? structuredClone(kept) : [], sessionId, resumeAt: undefined, error: undefined, queue: [], pinned: false, archivedAt: null,
      forkedFrom: { id: item.id, title: item.title },
    };
    if (!sessionId && kept.length) {
      fork.entries = structuredClone(kept);
      fork.entries.push({ kind: 'system', id: randomUUID(), at: created, level: 'warning', text: 'Claude Code could not copy the session history, so the next message starts a fresh session with this transcript shown for reference.' });
    }
    await save(ctx, fork); res.status(201).json(fork);
  });

  router.post('/claude/conversations/:id/rewind', async (req, res) => {
    const { item, workspace } = await owned(ctx, req);
    idle(item);
    const entryId = String(req.body?.entryId || '');
    const index = item.entries.findIndex(entry => entry.id === entryId && entry.kind === 'user');
    if (index < 0) throw new HttpError(404, 'Choose one of your messages to rewind to.');
    const target = item.entries[index] as ClaudeEntry & { kind: 'user' };
    let files: { changed: string[]; insertions?: number; deletions?: number } | null = null;
    if (req.body?.restoreFiles === true && item.sessionId && target.uuid) {
      const input = new InputStream(), controller = new AbortController();
      try {
        const stream = query({ prompt: input, options: { ...(await baseOptions(ctx, workspace.path)), resume: item.sessionId, abortController: controller, enableFileCheckpointing: true } });
        await stream.initializationResult();
        const outcome = await stream.rewindFiles(target.uuid);
        if (!outcome.canRewind) throw new HttpError(409, outcome.error || 'Claude Code has no file checkpoint for that message.');
        files = { changed: outcome.filesChanged ?? [], insertions: outcome.insertions, deletions: outcome.deletions };
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(409, `Files could not be restored. ${safeError(error)}`);
      } finally { input.close(); controller.abort(); }
    }
    const previous = [...item.entries.slice(0, index)].reverse().find(entry => (entry.kind === 'assistant' || entry.kind === 'tool') && entry.uuid);
    item.entries = item.entries.slice(0, index);
    item.resumeAt = previous && 'uuid' in previous ? previous.uuid : undefined;
    if (!item.resumeAt) { item.sessionId = undefined; item.usage = undefined; }
    item.todos = undefined; item.error = undefined;
    item.entries.push({ kind: 'system', id: randomUUID(), at: now(), level: 'info', text: files ? `Rewound conversation and restored ${files.changed.length} file${files.changed.length === 1 ? '' : 's'}.` : 'Rewound conversation. Files were left as they are.' });
    touch(item);
    await save(ctx, item);
    emit(item.id, { type: 'snapshot', conversation: item, live: liveState(item.id), permissions: [] });
    res.json({ conversation: item, text: target.text, attachments: target.attachments ?? [], files });
  });

  router.get('/claude/sessions', async (req, res) => {
    const workspace = await ctx.workspaces.getAvailable(String(req.query.workspaceId || ''));
    const linked = new Set((await allConversations(ctx)).map(item => item.sessionId).filter(Boolean));
    const sessions = await listSessions({ dir: workspace.path, limit: 100 }).catch(() => []);
    res.json(sessions.filter(session => !linked.has(session.sessionId)).map((session): ClaudeNativeSession => ({
      sessionId: session.sessionId, title: session.customTitle || session.summary || session.firstPrompt || 'Claude Code session', firstPrompt: session.firstPrompt,
      lastModified: new Date(session.lastModified).toISOString(), gitBranch: session.gitBranch, size: session.fileSize,
    })));
  });

  router.post('/claude/sessions/:sessionId/import', async (req, res) => {
    const workspace = await ctx.workspaces.getAvailable(String(req.body?.workspaceId || ''));
    const sessionId = String(req.params.sessionId);
    if (!validId.test(sessionId)) throw new HttpError(400, 'Invalid session.');
    const existing = (await allConversations(ctx)).find(item => item.sessionId === sessionId && item.workspaceId === workspace.id);
    if (existing) { res.json(existing); return; }
    const messages = await getSessionMessages(sessionId, { dir: workspace.path }).catch(() => { throw new HttpError(404, 'That Claude Code session could not be read.'); });
    const preferences = await readClaudePreferences(ctx);
    const info = (await listSessions({ dir: workspace.path, limit: 200 }).catch(() => [])).find(session => session.sessionId === sessionId);
    const created = now();
    const item: ClaudeConversation = {
      version: 2, id: randomUUID(), workspaceId: workspace.id, title: (info?.customTitle || info?.summary || info?.firstPrompt || 'Imported session').slice(0, 120), titleSet: true,
      model: preferences.model, effort: preferences.effort, thinking: preferences.thinking, permissionMode: preferences.permissionMode, sessionId,
      createdAt: info?.createdAt ? new Date(info.createdAt).toISOString() : created, updatedAt: info ? new Date(info.lastModified).toISOString() : created,
      entries: nativeEntries(messages), importedFrom: 'claude-code',
    };
    await save(ctx, item); res.status(201).json(item);
  });

  router.post('/claude/attachments', async (req, res) => {
    const name = typeof req.body?.name === 'string' ? path.basename(req.body.name).slice(0, 200) : 'attachment';
    const mediaType = typeof req.body?.mediaType === 'string' ? req.body.mediaType.toLowerCase().slice(0, 100) : 'application/octet-stream';
    const data = typeof req.body?.data === 'string' ? Buffer.from(req.body.data.replace(/^data:[^,]*,/, ''), 'base64') : null;
    if (!data?.length) throw new HttpError(400, 'The attachment is empty.');
    if (data.length > MAX_ATTACHMENT_BYTES) throw new HttpError(413, 'Attachments must be 12 MB or smaller.');
    const kind = attachmentKind(mediaType, name);
    if (!kind) throw new HttpError(415, 'Attach images, PDFs, or text files. Other files can be uploaded to the workspace and mentioned by path.');
    if (kind === 'image' && data.length > 5 * 1024 * 1024) throw new HttpError(413, 'Images must be 5 MB or smaller.');
    const attachment: ClaudeAttachment = { id: randomUUID(), name, mediaType: kind === 'text' ? 'text/plain' : mediaType, size: data.length, kind };
    await fs.mkdir(attachmentsDir(ctx), { recursive: true });
    await fs.writeFile(path.join(attachmentsDir(ctx), attachment.id), data, { mode: 0o600 });
    await fs.writeFile(path.join(attachmentsDir(ctx), `${attachment.id}.json`), JSON.stringify(attachment), { mode: 0o600 });
    res.status(201).json(attachment);
  });

  router.get('/claude/attachments/:id', async (req, res) => {
    const id = String(req.params.id);
    if (!/^[a-f\d-]{36}$/.test(id)) throw new HttpError(400, 'Invalid attachment.');
    const meta = await fs.readFile(path.join(attachmentsDir(ctx), `${id}.json`), 'utf8').then(text => JSON.parse(text) as ClaudeAttachment).catch(() => null);
    if (!meta) throw new HttpError(404, 'Attachment not found.');
    res.setHeader('Content-Type', meta.kind === 'text' ? 'text/plain; charset=utf-8' : meta.mediaType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Content-Disposition', `${meta.kind === 'image' ? 'inline' : 'attachment'}; filename="${meta.name.replace(/["\\\r\n]/g, '_')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(await fs.readFile(path.join(attachmentsDir(ctx), id)));
  });

  return router;
}
