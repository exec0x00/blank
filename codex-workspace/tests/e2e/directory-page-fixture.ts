import { createHash } from 'node:crypto';
import type { DirectoryPage, FileEntry } from '../../shared/types';

/** Transport adapter for existing deliberately small mocked filesystem fixtures. */
export function directoryPageFixture(url: URL, entries: FileEntry[]): DirectoryPage {
  const path = url.searchParams.get('path') ?? '';
  const children = entries.filter(entry => entry.path.slice(0, Math.max(0, entry.path.lastIndexOf('/'))) === path);
  if (children.length > 100) throw new Error('Use the real paged filesystem fixture for a large directory.');
  const snapshot = createHash('sha256').update(JSON.stringify([path, children])).digest('base64url');
  return { path, snapshot, order: 'filesystem', nextCursor: null,
    ...(url.searchParams.get('snapshot') === snapshot ? { entries: [], unchanged: true as const } : { entries: children }) };
}
