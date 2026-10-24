import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import type { AppContext } from './context';
import type { AppSettings, GithubAccountPage, Workspace } from '../shared/types';
import { isEffort, isPermissionMode, type ClaudePreferences, type ClaudeSettingSource } from '../shared/claude';
import { readUiState } from './ui-state';
import { getGithubAccountsPage } from './github';
import { getWorkspacePage } from './workspace-pages';
import { HttpError } from './errors';

const settingsKey = 'claude-settings';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const defaultClaudePreferences: ClaudePreferences = {
  model: DEFAULT_MODEL, effort: null, thinking: true, permissionMode: 'default', maxTurns: null, maxBudgetUsd: null, fallbackModel: null,
  appendSystemPrompt: '', outputStyle: null, additionalDirectories: [], allowedTools: [], disallowedTools: [],
  settingSources: ['user', 'project', 'local'], mcpServers: {}, fileCheckpointing: true,
};
type Saved = Omit<Partial<AppSettings>, 'claude'> & { claude?: Partial<ClaudePreferences> };

const text = (value: unknown, max: number) => typeof value === 'string' ? value.slice(0, max) : undefined;
const list = (value: unknown, max = 100) => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string')
  .map(item => item.trim()).filter(item => item && item.length <= 500))].slice(0, max) : undefined;
const bounded = (value: unknown, min: number, max: number) => value === null ? null
  : typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : undefined;

function validMcpServers(value: unknown): Record<string, Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'MCP servers must be a JSON object keyed by server name.');
  const result: Record<string, Record<string, unknown>> = {};
  for (const [name, config] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[\w.-]{1,64}$/.test(name)) throw new HttpError(400, `“${name}” is not a valid MCP server name. Use letters, numbers, dots, dashes, or underscores.`);
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new HttpError(400, `The ${name} MCP server must be an object.`);
    const server = config as Record<string, unknown>;
    const type = server.type ?? 'stdio';
    if (!['stdio', 'http', 'sse'].includes(String(type))) throw new HttpError(400, `The ${name} MCP server type must be stdio, http, or sse.`);
    if (type === 'stdio' && typeof server.command !== 'string') throw new HttpError(400, `The ${name} MCP server needs a command.`);
    if (type !== 'stdio' && typeof server.url !== 'string') throw new HttpError(400, `The ${name} MCP server needs a url.`);
    result[name] = server;
  }
  if (Object.keys(result).length > 40) throw new HttpError(400, 'Configure at most 40 MCP servers.');
  return result;
}

export function sanitizeClaudePreferences(patch: Partial<ClaudePreferences> | undefined): Partial<ClaudePreferences> {
  if (!patch || typeof patch !== 'object') return {};
  const sources = list(patch.settingSources)?.filter((source): source is ClaudeSettingSource => ['user', 'project', 'local'].includes(source));
  const result: Partial<ClaudePreferences> = {
    model: text(patch.model, 100)?.trim() || undefined,
    effort: patch.effort === null ? null : isEffort(patch.effort) ? patch.effort : undefined,
    thinking: typeof patch.thinking === 'boolean' ? patch.thinking : undefined,
    permissionMode: isPermissionMode(patch.permissionMode) ? patch.permissionMode : undefined,
    maxTurns: bounded(patch.maxTurns, 1, 500) ?? undefined,
    maxBudgetUsd: bounded(patch.maxBudgetUsd, 0.01, 1000) ?? undefined,
    fallbackModel: patch.fallbackModel === null || patch.fallbackModel === '' ? null : text(patch.fallbackModel, 100),
    appendSystemPrompt: text(patch.appendSystemPrompt, 20000),
    outputStyle: patch.outputStyle === null || patch.outputStyle === '' ? null : text(patch.outputStyle, 100),
    additionalDirectories: list(patch.additionalDirectories, 20)?.filter(item => path.isAbsolute(item)),
    allowedTools: list(patch.allowedTools), disallowedTools: list(patch.disallowedTools),
    settingSources: sources, mcpServers: validMcpServers(patch.mcpServers),
    fileCheckpointing: typeof patch.fileCheckpointing === 'boolean' ? patch.fileCheckpointing : undefined,
  };
  if (patch.maxTurns === null) result.maxTurns = null;
  if (patch.maxBudgetUsd === null) result.maxBudgetUsd = null;
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined)) as Partial<ClaudePreferences>;
}

export async function readClaudePreferences(ctx: AppContext): Promise<ClaudePreferences> {
  const saved = await ctx.store.read<Saved>(settingsKey, {});
  const claude = { ...defaultClaudePreferences, ...sanitizeClaudePreferences(saved.claude ?? {}) };
  if (!saved.claude?.model && typeof saved.model === 'string' && saved.model) claude.model = saved.model;
  return claude;
}

export async function readPreferences(ctx: AppContext): Promise<AppSettings> {
  const saved = await ctx.store.read<Saved>(settingsKey, {});
  const claude = await readClaudePreferences(ctx);
  return {
    model: claude.model, reasoningEffort: claude.effort, autoApprove: claude.permissionMode === 'bypassPermissions', theme: 'dark',
    fontSize: typeof saved.fontSize === 'number' ? saved.fontSize : 14, wordWrap: saved.wordWrap ?? true,
    provider: 'anthropic', apiKeyConfigured: !!process.env.PASSWORD, agentConfigured: !!process.env.PASSWORD, claude,
  };
}

export async function saveSettingsPreferences(ctx: AppContext, patch: Partial<AppSettings>): Promise<AppSettings> {
  const claudePatch = sanitizeClaudePreferences({ ...(typeof patch.model === 'string' ? { model: patch.model } : {}), ...(patch.claude ?? {}) });
  const fontSize = typeof patch.fontSize === 'number' ? Math.min(30, Math.max(10, Math.round(patch.fontSize))) : undefined;
  const wordWrap = typeof patch.wordWrap === 'boolean' ? patch.wordWrap : undefined;
  await ctx.store.update<Saved>(settingsKey, {}, current => ({
    ...current, ...(fontSize !== undefined ? { fontSize } : {}), ...(wordWrap !== undefined ? { wordWrap } : {}),
    claude: { ...(current.claude ?? {}), ...claudePatch },
  }));
  return readPreferences(ctx);
}

export const claudeConfigDir = (ctx: Pick<AppContext, 'config'>) => path.join(ctx.config.dataDir, 'claude-workspace', 'config');

export function createSettingsRouter(ctx: AppContext): Router {
  const router = Router();
  router.get('/settings', async (_req, res) => res.json(await readPreferences(ctx)));
  router.patch('/settings', async (req, res) => res.json(await saveSettingsPreferences(ctx, req.body || {})));
  router.get('/claude/memory', async (_req, res) => {
    const file = path.join(claudeConfigDir(ctx), 'CLAUDE.md');
    const content = await fs.readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error; });
    res.json({ path: file, content });
  });
  router.put('/claude/memory', async (req, res) => {
    const content = typeof req.body?.content === 'string' ? req.body.content : null;
    if (content === null || content.length > 200_000) throw new HttpError(400, 'Memory must be text under 200,000 characters.');
    const directory = claudeConfigDir(ctx);
    await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, 'CLAUDE.md'), temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, content, { mode: 0o600 });
    await fs.rename(temporary, file);
    res.json({ path: file, content });
  });
  router.get('/bootstrap', async (_req, res) => {
    const [page, active, settings, accountsPage, uiState] = await Promise.all([
      getWorkspacePage(ctx), ctx.store.read<string | null>('active-workspace', null), readPreferences(ctx),
      getGithubAccountsPage(ctx).catch((): GithubAccountPage => ({ accounts: [], offset: 0, total: 0, nextCursor: null, previousCursor: null, revision: '' })), readUiState(ctx),
    ]);
    let activeWorkspace: Workspace | null = null;
    if (active) {
      try { activeWorkspace = await ctx.workspaces.getAvailable(active); }
      catch (error) {
        if (!(error instanceof HttpError) || error.status !== 404) throw error;
      }
    }
    activeWorkspace ??= page.workspaces[0] || null;
    const { workspaces, ...workspacePage } = page;
    const { accounts: githubAccounts, selected: _selected, ...githubAccountPage } = accountsPage;
    res.json({
      workspaces, workspacePage, activeWorkspace, activeWorkspaceId: activeWorkspace?.id || null, settings, githubAccounts, githubAccountPage, uiState,
      storage: { path: ctx.config.dataDir, persistent: ctx.config.requirePersistentData, bucket: ctx.config.bucket, writable: true },
    });
  });
  return router;
}
