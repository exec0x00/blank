import type { ChatMessage, ReasoningSummarySegment, Thread, ThreadTurn, WebCitation } from '../../../shared/types';
import type { ConversationTimelineRow } from './ConversationTimeline';
import { isRoutineTurnActivity, isRoutineTurnMessage } from './lifecycle-presentation';
import { groupConversationTimeline } from './activity-groups';

export { groupConversationTimeline } from './activity-groups';

const busy = (thread: Thread) => ['running', 'awaiting_approval', 'awaiting_input', 'compacting'].includes(thread.status);
const liveTurn = (thread: Thread, turn: ThreadTurn | undefined, messageId: string, lastAssistant: string | undefined) => busy(thread)
  && (turn ? turn.status === 'running' && (!thread.native?.activeTurnId || thread.native.activeTurnId === turn.id) : messageId === lastAssistant);

function turnMembership(thread: Thread): { turns: Map<string, ThreadTurn>; messages: Map<string, string> } {
  const turns = new Map((thread.turns ?? []).map(turn => [turn.id, turn]));
  const messages = new Map<string, string>();
  for (const turn of thread.turns ?? []) for (const messageId of turn.messageIds) messages.set(messageId, turn.id);
  return { turns, messages };
}

function hasActivity(message: ChatMessage) {
  return !!message.activities?.some(activity => !isRoutineTurnActivity(activity)) || !!message.reasoningSummary?.some(summary => summary.text.trim());
}

function legacyAppender(thread: Thread, rows: ConversationTimelineRow[]) {
  const membership = turnMembership(thread);
  const lastAssistant = thread.messages.filter(message => message.role === 'assistant').at(-1)?.id;
  let explained = false;
  return (message: ChatMessage) => {
    if (isRoutineTurnMessage(message)) return;
    if (!explained && !rows.some(row => row.key === 'legacy-order-notice') && message.role === 'assistant' && hasActivity(message)
      && (!!message.content || !!message.activities?.length && !!message.reasoningSummary?.some(summary => summary.text.trim()))) {
      rows.push({ kind: 'notice', key: 'legacy-order-notice', text: 'Exact text and activity order was not recorded for these older responses.' });
      explained = true;
    }
    rows.push({ kind: 'message', key: `message:${message.id}`, message, content: message.content, citations: message.citations, first: true, last: true });
    if (message.role !== 'assistant' || !hasActivity(message)) return;
    const turnId = message.turnId || membership.messages.get(message.id);
    const turn = turnId ? membership.turns.get(turnId) : undefined;
    rows.push({ kind: 'legacy-activity', key: `legacy-activity:${message.id}`, message, turn,
      live: liveTurn(thread, turn, message.id, lastAssistant) });
  };
}

function legacyRows(thread: Thread): ConversationTimelineRow[] {
  const rows: ConversationTimelineRow[] = [];
  const append = legacyAppender(thread, rows);
  for (const message of thread.messages) append(message);
  return rows;
}

/** Citation positions belong to canonical sanitized message text, not to a fragment. */
function fragmentCitations(citations: readonly WebCitation[] | undefined, start: number, length: number, last: boolean): WebCitation[] | undefined {
  if (!citations?.length) return;
  const end = start + length;
  const selected = citations.flatMap(citation => {
    if (citation.startIndex === undefined || citation.endIndex === undefined) return last ? [citation] : [];
    if (citation.endIndex <= start || citation.startIndex >= end) return [];
    return [{ ...citation, startIndex: Math.max(0, citation.startIndex - start), endIndex: Math.min(length, citation.endIndex - start) }];
  });
  return selected.length ? selected : undefined;
}

/** The native projector records [itemId, summaryIndex], not a separate step ID. */
function summaryIdentity(key: string, message: ChatMessage, native: boolean): Pick<ReasoningSummarySegment, 'id' | 'summaryIndex'> | undefined {
  try {
    const value: unknown = JSON.parse(key);
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || !value[0]
      || !Number.isSafeInteger(value[1]) || value[1] < 0 || JSON.stringify(value) !== key
      || native && value[0] !== message.id) return;
    return { id: value[0], summaryIndex: value[1] };
  } catch { return; }
}

function recordedRows(thread: Thread): ConversationTimelineRow[] {
  const rows: ConversationTimelineRow[] = [];
  const messages = new Map(thread.messages.map(message => [message.id, message]));
  const membership = turnMembership(thread);
  const lastAssistant = thread.messages.filter(message => message.role === 'assistant').at(-1)?.id;
  const entries = [...thread.timeline!.entries].sort((left, right) => left.sequence - right.sequence);
  const lastTextEntry = new Map(entries.filter(entry => entry.kind === 'text').map(entry => [entry.messageId, entry.id]));
  const appendLegacy = legacyAppender(thread, rows);
  for (const [index, entry] of entries.entries()) {
    const message = messages.get(entry.messageId);
    if (!message || isRoutineTurnMessage(message)) continue; // A child transcript may intentionally show only its recent messages.
    if (entry.kind === 'legacy') { appendLegacy(message); continue; }
    if (entry.kind === 'message') {
      if (entry.legacyOrder && !rows.some(row => row.key === 'legacy-order-notice')) rows.push({ kind: 'notice', key: 'legacy-order-notice', text: 'Exact text and activity order was not recorded for these older responses.' });
      rows.push({ kind: 'message', key: entry.id, message, content: message.content, citations: message.citations, first: true, last: true });
      continue;
    }
    if (entry.kind === 'activity') {
      const activity = message.activities?.find(activity => activity.id === entry.activityId);
      const turnId = message.turnId || membership.messages.get(message.id);
      const turn = turnId ? membership.turns.get(turnId) : undefined;
      if (activity && !isRoutineTurnActivity(activity)) rows.push({ kind: 'activity', key: entry.id, message, activity, turn,
        live: liveTurn(thread, turn, message.id, lastAssistant) });
      continue;
    }
    if (entry.kind === 'reasoning') {
      if (!entry.text) continue;
      const turnId = message.turnId || membership.messages.get(message.id);
      const turn = turnId ? membership.turns.get(turnId) : undefined;
      const previous = rows.at(-1), previousEntry = entries[index - 1];
      const identity = summaryIdentity(entry.summaryId, message, thread.backend === 'codex-cli');
      const summary = { id: identity?.id ?? entry.summaryId, summaryIndex: identity?.summaryIndex ?? 0,
        text: entry.text, status: entry.status, ...(entry.truncated ? { truncated: true } : {}) };
      // The projector emits ordered fragments, not duplicate summaries. Join
      // only adjacent pieces of the very same public summary. Repeated words
      // and whitespace are content; tools/messages remain real boundaries.
      if (previous?.kind === 'reasoning' && previous.message.id === message.id && previous.summary.id === summary.id && previous.summary.summaryIndex === summary.summaryIndex
        && previousEntry?.kind === 'reasoning' && previousEntry.messageId === message.id && previousEntry.summaryId === entry.summaryId
        && (thread.backend !== 'codex-cli' || identity !== undefined)
        && !entry.textTruncated && !previousEntry.textTruncated) {
        previous.summary = { ...previous.summary, text: previous.summary.text + entry.text, status: entry.status,
          ...(entry.truncated ? { truncated: true } : {}) };
        previous.entryKeys = [...(previous.entryKeys ?? [previous.key]), entry.id];
        previous.revised ||= entry.revised;
      } else rows.push({ kind: 'reasoning', key: entry.id, entryKeys: [entry.id], message, turn,
        summary, revised: entry.revised,
        live: liveTurn(thread, turn, message.id, lastAssistant) });
      continue;
    }
    if (!entry.text && (lastTextEntry.get(message.id) !== entry.id || !message.citations?.length && !message.attachments?.length && !message.fileAttachments?.length && !message.review)) continue;
    if (entry.revised) rows.push({ kind: 'notice', key: `updated:${entry.id}`, text: 'Response updated.' });
    const previous = rows.at(-1);
    // Invisible reserved/cleared entries need not split Markdown. An actual
    // intervening tool, public summary, user message or notice always does.
    if (!entry.textTruncated && previous?.kind === 'message' && previous.message.id === message.id && previous.startOffset !== undefined
      && previous.startOffset + previous.content.length === entry.startOffset) {
      previous.content += entry.text;
      previous.entryKeys = [...(previous.entryKeys ?? [previous.key]), entry.id];
    }
    else rows.push({ kind: 'message', key: entry.id, entryKeys: [entry.id], message, content: entry.text, startOffset: entry.startOffset, first: false, last: false });
  }
  const firstParts = new Map<string, string>(), lastParts = new Map<string, string>();
  for (const row of rows) if (row.kind === 'message') {
    if (!firstParts.has(row.message.id)) firstParts.set(row.message.id, row.key);
    lastParts.set(row.message.id, row.key);
  }
  for (const row of rows) if (row.kind === 'message') {
    row.first = firstParts.get(row.message.id) === row.key;
    row.last = lastParts.get(row.message.id) === row.key;
    if (row.startOffset !== undefined) row.citations = fragmentCitations(row.message.citations, row.startOffset, row.content.length, row.last);
  }
  return rows.filter(row => row.kind !== 'reasoning' || row.summary.text.trim());
}

/** Turn actions follow the last visible recorded item, even when it belongs to an earlier message. */
function addTurnEndings(thread: Thread, rows: ConversationTimelineRow[]): ConversationTimelineRow[] {
  const membership = turnMembership(thread);
  const finalPositions = new Map<string, number>();
  rows.forEach((row, index) => {
    if (!('message' in row)) return;
    const turnId = row.message.turnId || membership.messages.get(row.message.id);
    if (turnId) finalPositions.set(turnId, index);
  });
  const endings = new Map<number, ConversationTimelineRow[]>();
  (thread.turns ?? []).forEach((turn, index) => {
    const position = finalPositions.get(turn.id);
    if (turn.status === 'running' || position === undefined) return;
    if (thread.history && turn.lastSequence !== undefined && (thread.history.oldestSequence === null || thread.history.newestSequence === null
      || turn.lastSequence < thread.history.oldestSequence || turn.lastSequence > thread.history.newestSequence)) return;
    const at = endings.get(position) ?? [];
    at.push({ kind: 'turn-end', key: `turn-end:${turn.id}`, turn, ordinal: turn.ordinal ?? index + 1 });
    endings.set(position, at);
  });
  return rows.flatMap((row, index) => [row, ...(endings.get(index) ?? [])]);
}

export function conversationTimeline(thread: Thread | null): ConversationTimelineRow[] {
  return thread ? addTurnEndings(thread, thread.timeline?.version === 1 ? recordedRows(thread) : legacyRows(thread)) : [];
}

export function hasLiveTimelineActivity(rows: readonly ConversationTimelineRow[], thread?: Thread): boolean {
  return groupConversationTimeline(rows, thread).some(row => row.kind === 'activity-group' && row.current);
}
