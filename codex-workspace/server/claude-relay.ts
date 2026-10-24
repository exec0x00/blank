import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { AddressInfo } from 'node:net';

/**
 * A loopback-only relay between Claude Code and the configured Messages API.
 *
 * Claude Code sends consecutive user messages (for example a tool result
 * followed by a system reminder). The account bridge looks for tool results
 * only in the final message, so reminders are folded into the adjacent user
 * turn and consecutive same-role messages are merged before forwarding.
 * Images and documents pass through: the bridge uploads them to Claude.
 */
type Block = Record<string, unknown> & { type?: string };
type Message = { role: string; content: string | Block[] };

const blocks = (content: Message['content']): Block[] => typeof content === 'string' ? (content ? [{ type: 'text', text: content }] : []) : Array.isArray(content) ? content : [];

export function normalizeMessages(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages;
  const result: Message[] = [];
  for (const original of messages as Message[]) {
    // Mid-conversation system reminders travel with the user turn they annotate.
    const message: Message = original.role === 'system'
      ? { role: 'user', content: blocks(original.content).map(block => block.type === 'text' && typeof block.text === 'string' && !/^\s*<system-reminder>/.test(block.text)
        ? { ...block, text: `<system-reminder>\n${block.text}\n</system-reminder>` } : block) }
      : original;
    const previous = result[result.length - 1];
    if (previous && previous.role === message.role) previous.content = [...blocks(previous.content), ...blocks(message.content)];
    else result.push({ ...message });
  }
  // Tool results must lead their user message.
  for (const message of result) {
    if (message.role !== 'user' || !Array.isArray(message.content)) continue;
    const content = message.content;
    if (content.some(block => block.type === 'tool_result')) message.content = [...content.filter(block => block.type === 'tool_result'), ...content.filter(block => block.type !== 'tool_result')];
  }
  return result;
}

const hopHeaders = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'accept-encoding']);

async function relay(req: IncomingMessage, res: ServerResponse, target: string) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  let body: string | undefined = chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined;
  if (body && req.method === 'POST' && /^\/v1\/messages(\?|$)/.test(req.url ?? '')) {
    try {
      const value = JSON.parse(body) as Record<string, unknown>;
      value.messages = normalizeMessages(value.messages);
      body = JSON.stringify(value);
    } catch { /* Forward bodies that are not JSON unchanged. */ }
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) if (!hopHeaders.has(key) && typeof value === 'string') headers[key] = value;
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableFinished) controller.abort(); });
  const response = await fetch(target + (req.url ?? ''), { method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body, signal: controller.signal });
  const out: Record<string, string> = {};
  response.headers.forEach((value, key) => { if (!hopHeaders.has(key) && key !== 'content-encoding') out[key] = value; });
  res.writeHead(response.status, out);
  if (!response.body) { res.end(); return; }
  Readable.fromWeb(response.body as import('node:stream/web').ReadableStream).on('error', () => res.destroy()).pipe(res);
}

let server: Server | null = null;
let address: Promise<string> | null = null;

export function startClaudeRelay(target: () => string): Promise<string> {
  if (address) return address;
  address = new Promise((resolve, reject) => {
    server = createServer((req, res) => {
      relay(req, res, target()).catch(() => {
        if (!res.headersSent) { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'The Messages API could not be reached.' } })); }
        else res.destroy();
      });
    });
    server.on('error', error => { address = null; reject(error); });
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`));
  });
  return address;
}

export async function stopClaudeRelay() {
  const current = server;
  server = null; address = null;
  if (current) await new Promise<void>(resolve => { current.close(() => resolve()); current.closeAllConnections(); });
}
