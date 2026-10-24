import type { FileTransferPage, FileTransferStatus } from '../../../shared/types';

export const FILE_TRANSFER_PAGE_SIZE = 25;
export interface FileTransferPageRequest { offset: number; q: string }
export interface FileTransferPageSnapshot { workspaceId: string; query: string; page: FileTransferPage }

function validOperationPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 4096 || new TextEncoder().encode(value).byteLength > 4096
    || value.startsWith('/') || /^[a-z]:/i.test(value) || /[\\\u0000-\u001f\u007f]/.test(value)) return false;
  return value.split('/').every(part => !!part && part !== '.' && part !== '..' && new TextEncoder().encode(part).byteLength <= 255);
}

/** Only validated paths from this exact workspace may reach Inspect actions. */
export function readFileTransferPage(value: unknown, workspaceId: string): FileTransferPage {
  const page = value as FileTransferPage | null;
  const unreadable = () => new Error('The server returned an unreadable file operation page. Refresh to try again.');
  if (!page || !Array.isArray(page.items) || page.limit !== FILE_TRANSFER_PAGE_SIZE || page.items.length > FILE_TRANSFER_PAGE_SIZE
    || !Number.isSafeInteger(page.offset) || page.offset < 0 || page.offset > 512
    || !Number.isSafeInteger(page.total) || page.total < 0 || page.total > 512
    || page.offset + page.items.length > page.total || page.items.length !== Math.min(page.limit, page.total - page.offset)
    || page.hasMore !== (page.offset + page.limit < page.total)) throw unreadable();
  const ids = new Set<string>();
  const items: FileTransferStatus[] = page.items.map(entry => {
    if (!entry || entry.workspaceId !== workspaceId || typeof entry.id !== 'string' || !entry.id || entry.id.length > 100
      || ids.has(entry.id) || !['move', 'copy'].includes(entry.kind) || !['running', 'interrupted'].includes(entry.state)
      || !['copying', 'verifying', 'removing'].includes(entry.phase) || typeof entry.createdAt !== 'string' || typeof entry.updatedAt !== 'string'
      || entry.createdAt.length > 100 || entry.updatedAt.length > 100 || !Number.isFinite(Date.parse(entry.createdAt)) || !Number.isFinite(Date.parse(entry.updatedAt))
      || !validOperationPath(entry.path) || !validOperationPath(entry.newPath)
      || entry.issue !== undefined && (typeof entry.issue !== 'string' || entry.issue.length > 1024)) throw unreadable();
    ids.add(entry.id);
    return { id: entry.id, workspaceId: entry.workspaceId, kind: entry.kind, path: entry.path, newPath: entry.newPath,
      state: entry.state, phase: entry.phase, createdAt: entry.createdAt, updatedAt: entry.updatedAt,
      ...(entry.issue ? { issue: entry.issue.slice(0, 1000) } : {}) };
  });
  return { items, offset: page.offset, limit: page.limit, total: page.total, hasMore: page.hasMore };
}

/** A partial page cannot establish how many unseen operations are interrupted. */
export function fileTransferStatusLabel(page: FileTransferPage | null, error: string): string | null {
  if (error) return 'File operation status unavailable';
  if (!page?.total) return null;
  if (page.offset !== 0 || page.items.length !== page.total) return `${page.total} unfinished file ${page.total === 1 ? 'operation' : 'operations'}`;
  const interrupted = page.items.filter(entry => entry.state === 'interrupted').length;
  return interrupted ? `${interrupted} interrupted file ${interrupted === 1 ? 'operation' : 'operations'}`
    : `${page.total} file ${page.total === 1 ? 'operation' : 'operations'} in progress`;
}
