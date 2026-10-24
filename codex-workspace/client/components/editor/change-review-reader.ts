import { api } from '../../api';
import { nativeItemDetailPath, parseNativeItemDetail, type NativeItemDetailTarget } from '../chat/NativeItemDetail';
import { HISTORY_DETAIL_PAGE_CHARS, parseHistoryDetail, type HistoryDetailTarget } from '../chat/HistoryDetail';
import { recordedPatchPage, recordedPatchParts, validChangeReviewTarget, type ChangeReviewTarget } from './change-review';

export interface ChangeReviewQuery { offset: number; part?: string; cursor?: string | null; version?: string; totalChars?: number }
export interface ChangeReviewFile { id: string; label: string; path?: string }
export interface ChangeReviewPage {
  status: 'ready'; text: string; part: string; label: string; path?: string; language: 'diff' | 'plaintext';
  parts: ChangeReviewFile[]; offset: number; totalChars: number; previousOffset: number | null; nextOffset: number | null;
  version: string; cursor?: string | null; notices: string[];
}
export type ChangeReviewResult = ChangeReviewPage | { status: 'searching'; nextCursor: string }
  | { status: 'unavailable'; message: string };

const partPath = (label: string) => /^Change \d+: (.+)$/.exec(label)?.[1];

export async function readChangeReview(target: ChangeReviewTarget, query: ChangeReviewQuery, signal: AbortSignal): Promise<ChangeReviewResult> {
  if (!validChangeReviewTarget(target)) throw new Error('This change cannot be opened. Return to the conversation and choose it again.');
  if (target.source === 'recorded-patch') {
    const parts = recordedPatchParts(target.patch, target.path);
    const selected = parts.find(part => part.id === query.part) ?? (query.part === undefined ? parts.find(part => part.path === target.path) ?? parts[0] : undefined);
    if (!selected) throw new Error('This file is not in the recorded patch.');
    const text = target.patch.slice(selected.start, selected.end);
    return { status: 'ready', ...recordedPatchPage(text, query.offset), part: selected.id, label: selected.label, path: selected.path,
      language: 'diff', totalChars: text.length, parts, version: 'snapshot',
      notices: target.truncated ? ['This recorded preview is truncated. Open an individual file-change activity in the conversation to read its saved patch.'] : [] };
  }
  if (target.source === 'native-item') {
    if (query.part !== undefined && !/^\d{1,3}$/.test(query.part)) throw new Error('This recorded file is unavailable.');
    const part = query.part === undefined ? target.part : Number(query.part);
    const native: NativeItemDetailTarget = { workspaceId: target.workspaceId, threadId: target.threadId, turnId: target.turnId, itemId: target.itemId,
      field: 'output', label: 'Recorded file changes' };
    const requested = { offset: query.offset, ...(part === undefined ? {} : { part }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }), ...(query.version === undefined ? {} : { version: query.version }) };
    const value = await api<unknown>(nativeItemDetailPath(native, requested), { signal, cache: 'no-store' });
    const reply = parseNativeItemDetail(value, native, requested);
    if (reply.status === 'searching') return { status: 'searching', nextCursor: reply.nextCursor };
    if (reply.status === 'notFound' || reply.status === 'unavailable') return { status: 'unavailable', message: reply.message };
    if (reply.itemType !== 'fileChange') return { status: 'unavailable', message: 'This recorded item has no file-change patch.' };
    const parts = reply.parts.map(part => ({ id: String(part.part), label: part.label, path: partPath(part.label) }));
    return { status: 'ready', text: reply.text, part: String(reply.part), label: reply.label, path: partPath(reply.label), language: 'diff',
      parts, offset: reply.offset, totalChars: reply.totalChars, previousOffset: reply.previousOffset, nextOffset: reply.nextOffset,
      version: reply.version, cursor: reply.itemCursor, notices: [] };
  }
  const saved: HistoryDetailTarget = { threadId: target.threadId, epoch: target.epoch, messageId: target.itemId, activityId: target.activityId,
    field: target.field, label: 'Recorded change' };
  if (!Number.isSafeInteger(query.offset) || query.offset < 0 || query.part !== undefined && !/^[a-z][a-z0-9_-]{0,31}$/.test(query.part)
    || query.version !== undefined && (typeof query.version !== 'string' || !query.version || query.version.length > 128)) throw new Error('This recorded patch page is unavailable.');
  const search = new URLSearchParams({ epoch: target.epoch, field: target.field, messageId: target.itemId, activityId: target.activityId,
    offset: String(query.offset), limit: String(HISTORY_DETAIL_PAGE_CHARS) });
  if (query.part !== undefined) search.set('part', query.part);
  if (query.version !== undefined) search.set('version', query.version);
  const value = await api<unknown>('/threads/' + encodeURIComponent(target.threadId) + '/history/detail?' + search, { signal, cache: 'no-store' });
  const reply = parseHistoryDetail(value, saved, query.offset, query.version, query.totalChars, query.part);
  const detail = reply.presentation;
  if (!detail || detail.kind !== 'code') return { status: 'unavailable', message: 'This saved tool section contains no recorded patch or file content.' };
  return { status: 'ready', text: reply.text, part: detail.partId, label: detail.label, path: detail.path ?? target.path,
    language: detail.language === 'diff' ? 'diff' : 'plaintext',
    parts: detail.parts.filter(part => !['path', 'details', 'error', 'metadata'].includes(part.id)).map(part => ({ id: part.id, label: part.label })),
    offset: reply.offset, totalChars: reply.totalChars, previousOffset: reply.previousOffset, nextOffset: reply.nextOffset,
    version: reply.version, notices: detail.notices ?? [] };
}

/** Every subsequent page uses the version and source cursor of the displayed patch. */
export function changeReviewPageQuery(page: ChangeReviewPage, offset: number, part = page.part): ChangeReviewQuery {
  return { part, offset, version: page.version, ...(page.cursor !== undefined ? { cursor: page.cursor } : {}),
    ...(part === page.part ? { totalChars: page.totalChars } : {}) };
}
