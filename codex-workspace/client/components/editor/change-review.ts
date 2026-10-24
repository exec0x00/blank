import type { Thread, ToolActivity } from '../../../shared/types';

interface ChangeIdentity {
  workspaceId: string;
  threadId: string;
  turnId?: string;
  itemId: string;
  path?: string;
  label?: string;
}

/** These identify recorded content. They never identify an editable file model. */
export type ChangeReviewTarget =
  | (ChangeIdentity & { source: 'native-item'; turnId: string; part?: number })
  | (ChangeIdentity & { source: 'saved-tool'; epoch: string; activityId: string; field: 'input' | 'output' })
  | (ChangeIdentity & { source: 'recorded-patch'; patch: string; truncated?: boolean });
export type OpenChange = (target: ChangeReviewTarget) => void;
export interface ChangeReviewRequest { target: ChangeReviewTarget; sequence: number }

export const CHANGE_REVIEW_PAGE_CHARS = 16_000;
export const MAX_RECORDED_PATCH_CHARS = 256_000;
export const MAX_REVIEW_FILES = 128;
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);

export function validChangeReviewTarget(value: unknown): value is ChangeReviewTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const target = value as Partial<ChangeReviewTarget>;
  if (!id(target.workspaceId) || !id(target.threadId) || !id(target.itemId) || target.turnId !== undefined && !id(target.turnId)
    || target.path !== undefined && (typeof target.path !== 'string' || target.path.length > 4096 || /[\u0000-\u001f\u007f]/.test(target.path))
    || target.label !== undefined && (typeof target.label !== 'string' || target.label.length > 240 || /[\u0000-\u001f\u007f]/.test(target.label))) return false;
  if (target.source === 'native-item') return id(target.turnId) && (target.part === undefined || Number.isInteger(target.part) && target.part >= 0 && target.part < MAX_REVIEW_FILES);
  if (target.source === 'saved-tool') return id(target.epoch) && id(target.activityId) && (target.field === 'input' || target.field === 'output');
  return target.source === 'recorded-patch' && typeof target.patch === 'string' && target.patch.length <= MAX_RECORDED_PATCH_CHARS
    && (target.truncated === undefined || typeof target.truncated === 'boolean');
}

export function changeReviewKey(target: ChangeReviewTarget): string {
  return JSON.stringify([target.source, target.workspaceId, target.threadId, target.turnId ?? null, target.itemId,
    target.source === 'saved-tool' ? [target.epoch, target.activityId, target.field] : null]);
}

/** A review page belongs to one editor instance and one exact recorded version. */
export function changeReviewModelUri(target: ChangeReviewTarget, instance: string, version: string, part: string, offset: number): string {
  return 'codex-change-review://review/' + [instance, target.workspaceId, target.threadId, target.turnId ?? '', target.itemId,
    target.source, target.source === 'saved-tool' ? target.activityId : '', version, part, String(offset)].map(encodeURIComponent).join('/');
}

export function isChangeActivity(activity: ToolActivity): boolean {
  return ['apply_patch', 'write_file', 'get_review_diff'].includes(activity.name.replace(/^(?:functions|tools)\./, ''));
}

export function activityChangeReviewTarget(scope: {
  workspaceId: string; threadId: string; messageId: string; turnId?: string; backend?: Thread['backend']; epoch?: string;
}, activity: ToolActivity, path?: string, part?: number): ChangeReviewTarget | null {
  if (!isChangeActivity(activity)) return null;
  const common = { workspaceId: scope.workspaceId, threadId: scope.threadId, turnId: scope.turnId, itemId: scope.messageId, ...(path ? { path } : {}),
    ...(activity.status === 'awaiting_approval' ? { label: 'Proposed file changes' } : activity.status === 'error' ? { label: 'Recorded change attempt' } : {}) };
  if (scope.backend === 'codex-cli') return scope.turnId ? { ...common, source: 'native-item', turnId: scope.turnId, ...(part === undefined ? {} : { part }) } : null;
  if (!scope.epoch) return null;
  return { ...common, source: 'saved-tool', epoch: scope.epoch, activityId: activity.id,
    field: activity.name.replace(/^(?:functions|tools)\./, '') === 'get_review_diff' ? 'output' : 'input' };
}

/** The existing aggregate preview carries no trustworthy turn ID. Keep it a snapshot. */
export function currentTurnChangeReviewTarget(thread: Thread | undefined | null): ChangeReviewTarget | null {
  const patch = thread?.backend === 'codex-cli' ? thread.native?.diff : null;
  if (!thread || !patch) return null;
  return { source: 'recorded-patch', workspaceId: thread.workspaceId, threadId: thread.id, itemId: 'native-turn-diff',
    label: 'Recorded turn patch', patch: patch.slice(0, MAX_RECORDED_PATCH_CHARS),
    truncated: patch.length > MAX_RECORDED_PATCH_CHARS || /… \[truncated\]$/.test(patch) };
}

export interface RecordedPatchPart { id: string; label: string; path?: string; start: number; end: number }
function patchPath(raw: string): string | undefined {
  let path = raw.split('\t')[0].trim();
  if (path.startsWith('"')) { try { const decoded: unknown = JSON.parse(path); if (typeof decoded === 'string') path = decoded; } catch { /* Retain the recorded spelling. */ } }
  if (!path || path === '/dev/null' || /[\u0000-\u001f\u007f]/.test(path)) return undefined;
  return path.replace(/^[ab]\//, '');
}

/** Index exact recorded spans. No missing lines or historical file versions are synthesized. */
export function recordedPatchParts(patch: string, fallbackPath?: string): RecordedPatchPart[] {
  const git = [...patch.matchAll(/^diff --git .+$/gm)].map(match => match.index!);
  const apply = [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: .+$/gm)].map(match => match.index!);
  const allBoundaries = git.length ? git : apply;
  const boundaries = allBoundaries.slice(0, MAX_REVIEW_FILES);
  if (!boundaries.length) boundaries.push(0);
  // Preserve any preamble, including *** Begin Patch, with the first file.
  const starts = boundaries.map((offset, index) => index === 0 ? 0 : offset);
  return starts.map((start, index) => {
    const end = starts[index + 1] ?? patch.length;
    const text = patch.slice(start, end);
    if (index === MAX_REVIEW_FILES - 1 && allBoundaries.length > MAX_REVIEW_FILES) return { id: String(index), label: 'Additional recorded files', start, end };
    const applyPath = /^\*\*\* (?:Move to|(?:Add|Update|Delete) File): (.+)$/m.exec(text)?.[1];
    const moved = /^rename to (.+)$/m.exec(text)?.[1];
    const newer = /^\+\+\+ (.+)$/m.exec(text)?.[1];
    const older = /^--- (.+)$/m.exec(text)?.[1];
    const header = /^diff --git (?:.+) ("?b\/.+)$/m.exec(text)?.[1];
    const path = applyPath || moved || patchPath(newer ?? '') || patchPath(older ?? '') || patchPath(header ?? '') || (starts.length === 1 ? fallbackPath : undefined);
    return { id: String(index), label: path || (starts.length === 1 ? 'Recorded patch' : `Patch ${index + 1}`), ...(path ? { path } : {}), start, end };
  });
}

export function recordedPatchPage(text: string, requestedOffset: number): { text: string; offset: number; previousOffset: number | null; nextOffset: number | null } {
  if (!Number.isSafeInteger(requestedOffset) || requestedOffset < 0 || requestedOffset > text.length) throw new Error('This patch page is unavailable. Open the change again.');
  let offset = requestedOffset;
  if (offset > 0 && /[\uDC00-\uDFFF]/.test(text[offset] ?? '') && /[\uD800-\uDBFF]/.test(text[offset - 1])) offset--;
  let end = Math.min(text.length, offset + CHANGE_REVIEW_PAGE_CHARS);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
  let previous = Math.max(0, offset - CHANGE_REVIEW_PAGE_CHARS);
  if (previous > 0 && /[\uDC00-\uDFFF]/.test(text[previous]) && /[\uD800-\uDBFF]/.test(text[previous - 1])) previous++;
  return { text: text.slice(offset, end), offset, previousOffset: offset ? previous : null, nextOffset: end < text.length ? end : null };
}
