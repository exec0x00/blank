import { createHash } from 'node:crypto';
import type { ChangeDetailPage, ChangePage, ChangeRecord, ChangeReviewSummary, ChangeSummary, ChangeTextPage } from '../../shared/types';

/** Browser transport fixture only; server snapshot/undo tests use real files. */
export const changeReviewRevisionFixture = (changes: ChangeRecord[]) => createHash('sha256').update(JSON.stringify(changes)).digest('hex');
export function changeSummaryFixture(change: ChangeRecord): ChangeSummary {
  const side = (text: string | null) => text === null ? null : { bytes: Buffer.byteLength(text), chars: text.length, binary: false, mode: 0o644 };
  return { ...change, original: side(change.original), modified: side(change.modified), version: changeReviewRevisionFixture([change]) };
}
export function changeReviewSummaryFixture(workspaceId: string, changes: ChangeRecord[]): ChangeReviewSummary {
  const pending = changes.filter(change => change.workspaceId === workspaceId && change.status === 'pending');
  return { workspaceId, revision: changeReviewRevisionFixture(changes), total: pending.length, fileCount: new Set(pending.map(change => change.path)).size };
}
export function changeReviewPageFixture(url: URL, changes: ChangeRecord[] = []): ChangePage {
  const workspaceId = url.searchParams.get('workspaceId') || 'fixture-workspace';
  const summary = changeReviewSummaryFixture(workspaceId, changes);
  const query = (url.searchParams.get('query') || '').trim().toLowerCase();
  const offset = Number(url.searchParams.get('cursor')?.split(':').at(-1) || 0), limit = Number(url.searchParams.get('limit') || 25);
  const matching = changes.filter(change => change.workspaceId === workspaceId && change.status === 'pending' && change.path.toLowerCase().includes(query));
  const token = (index: number) => `fixture:${summary.revision}:${index}`;
  return { ...summary, matchedTotal: matching.length, offset, limit, items: matching.slice(offset, offset + limit).map(changeSummaryFixture),
    nextCursor: offset + limit < matching.length ? token(offset + limit) : null, previousCursor: offset > 0 ? token(Math.max(0, offset - limit)) : null };
}
export function changeDetailFixture(url: URL, change: ChangeRecord): ChangeDetailPage {
  const boundary = (text: string, offset: number) => offset > 0 && offset < text.length && (
    text.charCodeAt(offset - 1) >= 0xd800 && text.charCodeAt(offset - 1) <= 0xdbff && text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff
    || text.charCodeAt(offset - 1) === 13 && text.charCodeAt(offset) === 10) ? offset - 1 : offset;
  const limit = Number(url.searchParams.get('limit') || 16_384);
  const side = (text: string | null, key: string): ChangeTextPage | null => {
    if (text === null) return null;
    const offset = boundary(text, Number(url.searchParams.get(key) || 0)), end = boundary(text, Math.min(text.length, offset + limit));
    return { text: text.slice(offset, end), offset, totalChars: text.length, nextOffset: end < text.length ? end : null,
      previousOffset: offset ? boundary(text, Math.max(0, offset - limit)) : null };
  };
  return { change: changeSummaryFixture(change), original: side(change.original, 'originalOffset'), modified: side(change.modified, 'modifiedOffset') };
}
