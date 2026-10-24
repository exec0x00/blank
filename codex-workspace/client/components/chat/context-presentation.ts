import type { CodexTokenUsage } from '../../../shared/codex-cli';
import { compactTokenCount, exactTokenCount, tokenCount } from './compact-number';

export function currentContext(usage: CodexTokenUsage | null | undefined) {
  const count = tokenCount(usage?.contextTokens);
  const capacity = tokenCount(usage?.modelContextWindow);
  const limit = capacity && capacity > 0 ? capacity : undefined;
  const reportedAt = typeof usage?.reportedAt === 'string' && Number.isFinite(Date.parse(usage.reportedAt)) ? usage.reportedAt : undefined;
  return { count, limit, reportedAt, label: count === undefined ? 'Current context' : 'Last reported context', compact: count === undefined ? 'Not reported'
    : compactTokenCount(count) + (limit ? ' / ' + compactTokenCount(limit) : '') };
}
export function contextDescription(usage: CodexTokenUsage | null | undefined): string {
  const current = currentContext(usage);
  return (current.count === undefined ? 'Codex has not reported the current context.' : 'Last reported context: ' + exactTokenCount(current.count) + ' tokens.')
    + (current.limit ? ' Reported context window: ' + exactTokenCount(current.limit) + ' tokens.' : ' The context window has not been reported.')
    + (current.count !== undefined ? (current.reportedAt ? ' Report received ' + new Date(current.reportedAt).toLocaleString() + '.' : '')
      + ' Later activity may have changed the context.' : '');
}
export function newestContext(live: CodexTokenUsage | null | undefined, saved: CodexTokenUsage | null | undefined): CodexTokenUsage | undefined {
  if (!live) return saved ?? undefined;
  if (!saved) return live;
  return Date.parse(saved.reportedAt) > Date.parse(live.reportedAt) ? saved : live;
}
export function contextSource() { return { label: 'Reported by native Codex' }; }
