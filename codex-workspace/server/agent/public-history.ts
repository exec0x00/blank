import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { AgentRecord, ChatMessage, ConversationHistoryDetail, ConversationHistoryWindow, ConversationTimeline,
  ConversationTimelineEntry, QueuedThreadInput, ReasoningSummarySegment, Thread, ThreadTurn, ToolActivity } from '../../shared/types';
import { HttpError } from '../errors';
import { ensureConversationTimeline } from './timeline';
import { toolDetailDocument, TOOL_DETAIL_PRESENTATION_VERSION } from './history-tool-details';
import { publicThreadUsage } from './context-usage-projection';
import { generatedImageMetadata } from './generated-image-reference';

/** Presentation limits never apply to saved messages, tool inputs, or model context. */
export const PUBLIC_HISTORY_LIMITS = Object.freeze({
  entries: 40, maxEntries: 60, pageBytes: 384 * 1024,
  textChars: 4096, inputChars: 2048, outputChars: 4096, detailChars: 16384,
  citations: 24, citationBytes: 16 * 1024,
  queuedPromptChars: 1024, agentResultChars: 1024,
});

export interface HistoryPageInput { before?: string; after?: string; limit?: number }
export interface HistoryDetailInput {
  epoch: string; field: 'text' | 'content' | 'input' | 'output' | 'citations'; entryId?: string; messageId?: string; activityId?: string;
  offset?: number; limit?: number; version?: string; part?: string;
}
export interface PublicHistoryState { epoch: string; revision: number }
interface MessagePosition { message: ChatMessage; ordinal: number }
interface PresentationPosition {
  sequence: number; source: ConversationTimelineEntry;
  legacy?: { kind: 'message' } | { kind: 'reasoning'; index: number } | { kind: 'activity'; index: number };
  id: string;
}
interface HistoryIndex {
  timeline: ConversationTimeline; sourceMessages: ChatMessage[]; sourceTurns: ThreadTurn[] | undefined;
  messageCount: number; entryCount: number; turnCount: number; expansion: number;
  messages: Map<string, MessagePosition>; positions: PresentationPosition[]; entries: Map<string, PresentationPosition>;
  turns: Map<string, { turn: ThreadTurn; ordinal: number }>; membership: Map<string, string>;
  turnMessageCounts: Map<string, number>; boundaries: Map<string, { first: number; last: number }>;
}
interface ActivityIndex { source: ToolActivity[] | undefined; count: number; byId: Map<string, ToolActivity> }

/** Do not cut a UTF-16 surrogate pair at either end of a public text page. */
function textSlice(value: string, start: number, limit: number): string {
  let end = Math.min(value.length, start + limit);
  if (end < value.length && end > start && /[\ud800-\udbff]/.test(value[end - 1]) && /[\udc00-\udfff]/.test(value[end])) end--;
  return value.slice(start, end);
}
const preview = (value: string, limit: number) => textSlice(value, 0, limit);
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const missingItem = () => new HttpError(404, 'This saved conversation item is unavailable.', 'HISTORY_ITEM_NOT_FOUND');
const historyChanged = () => new HttpError(409, 'Conversation history changed. Refresh its recent messages before loading another page.', 'HISTORY_CHANGED');

/** Process state often follows a large stdout field. Keep verified state in
 * the preview rather than making a running/nonzero process look successful
 * merely because its late JSON fields fell outside a prefix. Full saved text
 * remains the authority returned by the item-detail endpoint. */
function outputPreview(value: string, limit: number): string {
  if (value.length <= limit) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return preview(value, limit);
    const source = parsed as Record<string, unknown>;
    const channels = ['output', 'stdout', 'stderr'].filter(key => typeof source[key] === 'string');
    if (!channels.length || typeof source.running !== 'boolean' && typeof source.exit_code !== 'number' && typeof source.exitCode !== 'number') return preview(value, limit);
    const metadata: Record<string, unknown> = {};
    for (const key of ['execution_scope', 'running', 'exit_code', 'exitCode', 'session_id', 'sessionId', 'tty', 'chunk_id', 'chunkId',
      'wall_time_seconds', 'wallTimeSeconds', 'output_suppressed', 'review_pending', 'permission_decision', 'permission_message',
      'review_error', 'error', 'block_reason', 'stop_reason']) {
      const item = source[key];
      if (typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item) || item === null) metadata[key] = item;
      else if (typeof item === 'string') metadata[key] = preview(item, 256);
    }
    metadata.truncated = true;
    // Every published value was observed. Only text bodies/notice text become
    // shorter; status, exit code, session identity and numeric facts stay exact.
    for (let length = Math.floor(limit / (channels.length + 2)); length >= 16; length = Math.floor(length / 2)) {
      const data = { ...metadata, ...Object.fromEntries(channels.map(key => [key, preview(source[key] as string, length)])) };
      const encoded = JSON.stringify(data);
      if (encoded.length <= limit) return encoded;
    }
  } catch { /* Incomplete legacy text remains an explicit prefix, not repaired status. */ }
  return preview(value, limit);
}

/** Signed cursors contain only a scope and a position, never a filesystem path or authority. */
export class PublicCursorCodec {
  constructor(private readonly secret: string, private readonly namespace: string) {}
  encode(payload: unknown): string {
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', this.secret).update(`${this.namespace}:${data}`).digest('base64url');
    return `${data}.${signature}`;
  }
  decode(cursor: string): unknown {
    if (typeof cursor !== 'string' || cursor.length > 1400 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(cursor)) this.invalid();
    const [data, signature] = cursor.split('.');
    const expected = createHmac('sha256', this.secret).update(`${this.namespace}:${data}`).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) this.invalid();
    try {
      const decoded = Buffer.from(data, 'base64url');
      if (decoded.toString('base64url') !== data) this.invalid();
      return JSON.parse(decoded.toString('utf8'));
    } catch { return this.invalid(); }
  }
  private invalid(): never { throw new HttpError(400, 'The conversation page cursor is invalid.', 'INVALID_HISTORY_CURSOR'); }
}

/**
 * Indexes references, not copies of transcript bodies. Modern entries retain
 * their recorded order and revisions. A historical aggregate is expanded only
 * in the public view, with an explicit unknown-order marker; its saved message
 * and model protocol are never rewritten. Appends extend this index in O(new
 * positions), and page materialization visits only the requested positions.
 */
export class PublicConversationHistory {
  private readonly indexes = new WeakMap<Thread, HistoryIndex>();
  private readonly activities = new WeakMap<ChatMessage, ActivityIndex>();
  private readonly cursors: PublicCursorCodec;

  constructor(secret: string) { this.cursors = new PublicCursorCodec(secret, 'conversation-history-v1'); }

  private index(thread: Thread): HistoryIndex {
    const timeline = ensureConversationTimeline(thread);
    let index = this.indexes.get(thread);
    if (!index || index.timeline !== timeline || index.sourceMessages !== thread.messages || index.sourceTurns !== thread.turns
      || index.entryCount > timeline.entries.length || index.messageCount > thread.messages.length || index.turnCount > (thread.turns?.length ?? 0)) {
      index = { timeline, sourceMessages: thread.messages, sourceTurns: thread.turns,
        messageCount: 0, entryCount: 0, turnCount: 0, expansion: 0,
        messages: new Map(), positions: [], entries: new Map(), turns: new Map(), membership: new Map(),
        turnMessageCounts: new Map(), boundaries: new Map() };
      this.indexes.set(thread, index);
    }
    while (index.messageCount < thread.messages.length) {
      const message = thread.messages[index.messageCount++];
      index.messages.set(message.id, { message, ordinal: index.messageCount });
    }
    // Turn membership is metadata. Completed turns do not change; the current
    // turn can acquire messages between any two provider/tool events.
    for (let position = Math.max(0, index.turnCount - 1); position < (thread.turns?.length ?? 0); position++) {
      const turn = thread.turns![position];
      index.turns.set(turn.id, { turn, ordinal: position + 1 });
      const previous = index.turnMessageCounts.get(turn.id) ?? 0;
      for (let item = previous; item < turn.messageIds.length; item++) index.membership.set(turn.messageIds[item], turn.id);
      index.turnMessageCounts.set(turn.id, turn.messageIds.length);
    }
    index.turnCount = thread.turns?.length ?? 0;
    const append = (position: PresentationPosition) => {
      if (!Number.isSafeInteger(position.sequence) || position.sequence < 1 || position.sequence <= (index!.positions.at(-1)?.sequence ?? 0)) {
        this.indexes.delete(thread);
        throw new HttpError(409, 'This conversation has an invalid presentation position.', 'HISTORY_POSITION_LIMIT');
      }
      index!.positions.push(position); index!.entries.set(position.id, position);
      const message = index!.messages.get(position.source.messageId)?.message;
      const turnId = message?.turnId ?? index!.membership.get(position.source.messageId);
      if (turnId) {
        const boundary = index!.boundaries.get(turnId);
        if (boundary) boundary.last = position.sequence;
        else index!.boundaries.set(turnId, { first: position.sequence, last: position.sequence });
      }
    };
    while (index.entryCount < timeline.entries.length) {
      const entry = timeline.entries[index.entryCount++], message = index.messages.get(entry.messageId)?.message;
      if (!message) continue;
      const sequence = entry.sequence + index.expansion;
      if (entry.kind !== 'legacy') { append({ id: entry.id, source: entry, sequence }); continue; }
      append({ id: entry.id, source: entry, sequence, legacy: { kind: 'message' } });
      for (let part = 0; part < (message.reasoningSummary?.length ?? 0); part++) {
        append({ id: `${entry.id}:reasoning:${part}`, source: entry, sequence: entry.sequence + ++index.expansion,
          legacy: { kind: 'reasoning', index: part } });
      }
      for (let part = 0; part < (message.activities?.length ?? 0); part++) {
        append({ id: `${entry.id}:activity:${part}`, source: entry, sequence: entry.sequence + ++index.expansion,
          legacy: { kind: 'activity', index: part } });
      }
    }
    return index;
  }

  private activity(message: ChatMessage, id: string): ToolActivity | undefined {
    let index = this.activities.get(message);
    if (!index || index.source !== message.activities || index.count > (message.activities?.length ?? 0)) {
      index = { source: message.activities, count: 0, byId: new Map() }; this.activities.set(message, index);
    }
    while (index.count < (message.activities?.length ?? 0)) {
      const activity = message.activities![index.count++]; index.byId.set(activity.id, activity);
    }
    return index.byId.get(id);
  }

  publicActivity(activity: ToolActivity): ToolActivity {
    const input = preview(activity.input, PUBLIC_HISTORY_LIMITS.inputChars);
    const output = activity.output === undefined ? undefined : outputPreview(activity.output, PUBLIC_HISTORY_LIMITS.outputChars);
    const image = generatedImageMetadata(activity.generatedImage);
    return { id: activity.id, name: activity.name, status: activity.status, startedAt: activity.startedAt,
      ...(activity.completedAt ? { completedAt: activity.completedAt } : {}), input,
      inputTruncated: input.length < activity.input.length, inputChars: activity.input.length,
      ...(image ? { generatedImage: image } : {}),
      ...(output === undefined ? {} : { output, outputTruncated: output.length < activity.output!.length, outputChars: activity.output!.length }) };
  }

  publicText(value: string): string { return preview(value, PUBLIC_HISTORY_LIMITS.textChars); }

  publicSummary(summary: ReasoningSummarySegment): ReasoningSummarySegment {
    const text = this.publicText(summary.text);
    return { id: summary.id, summaryIndex: summary.summaryIndex, text, status: summary.status,
      ...(summary.truncated || text.length < summary.text.length ? { truncated: true } : {}) };
  }

  publicMessage(thread: Thread, message: ChatMessage, activityIds: ReadonlySet<string> = new Set(), summaryIds: ReadonlySet<string> = new Set()): ChatMessage {
    const index = this.index(thread), content = preview(message.content, PUBLIC_HISTORY_LIMITS.textChars);
    const citations: NonNullable<ChatMessage['citations']> = [];
    let citationBytes = 2;
    for (const source of message.citations ?? []) {
      if (citations.length >= PUBLIC_HISTORY_LIMITS.citations) break;
      const citation = { url: source.url, title: source.title,
        ...(source.startIndex !== undefined ? { startIndex: source.startIndex } : {}),
        ...(source.endIndex !== undefined ? { endIndex: source.endIndex } : {}) };
      const size = bytes(citation) + 1;
      if (citationBytes + size > PUBLIC_HISTORY_LIMITS.citationBytes) continue;
      citations.push(citation); citationBytes += size;
    }
    return { id: message.id, role: message.role, content, createdAt: message.createdAt,
      ordinal: index.messages.get(message.id)?.ordinal,
      ...(message.turnId || index.membership.get(message.id) ? { turnId: message.turnId ?? index.membership.get(message.id) } : {}),
      contentTruncated: content.length < message.content.length, contentChars: message.content.length,
      ...(message.attachments?.length ? { attachments: structuredClone(message.attachments) } : {}),
      ...(message.fileAttachments?.length ? { fileAttachments: structuredClone(message.fileAttachments) } : {}),
      ...(message.citations?.length ? { citations, citationsTruncated: citations.length < message.citations.length, citationsCount: message.citations.length } : {}),
      ...(message.review ? { review: structuredClone(message.review) } : {}),
      ...(message.reviewId ? { reviewId: message.reviewId } : {}),
      ...(summaryIds.size ? { reasoningSummary: (message.reasoningSummary ?? [])
        .filter(summary => summaryIds.has(JSON.stringify([summary.id, summary.summaryIndex])))
        .map(summary => this.publicSummary(summary)) } : {}),
      ...(activityIds.size ? { activities: [...activityIds].flatMap(id => {
        const activity = this.activity(message, id); return activity ? [this.publicActivity(activity)] : [];
      }) } : {}),
    };
  }

  private entry(index: HistoryIndex, position: PresentationPosition, fullText = false): ConversationTimelineEntry {
    const source = position.source;
    const common = { id: position.id, sequence: position.sequence, revision: source.revision, messageId: source.messageId };
    let value: ConversationTimelineEntry;
    if (!position.legacy) {
      if (source.kind === 'text') value = { ...common, kind: 'text', text: source.text, startOffset: source.startOffset,
        ...(source.revised ? { revised: true } : {}) };
      else if (source.kind === 'reasoning') value = { ...common, kind: 'reasoning', summaryId: source.summaryId, text: source.text,
        status: source.status, ...(source.truncated ? { truncated: true } : {}), ...(source.revised ? { revised: true } : {}) };
      else if (source.kind === 'activity') value = { ...common, kind: 'activity', activityId: source.activityId };
      else value = { ...common, kind: 'message' };
    }
    else if (position.legacy.kind === 'message') value = { ...common, kind: 'message', legacyOrder: true };
    else {
      const message = index.messages.get(source.messageId)!.message;
      if (position.legacy.kind === 'activity') value = { ...common, kind: 'activity', activityId: message.activities![position.legacy.index].id };
      else {
        const summary = message.reasoningSummary![position.legacy.index];
        value = { ...common, kind: 'reasoning', summaryId: JSON.stringify([summary.id, summary.summaryIndex]),
          text: summary.text, status: summary.status, ...(summary.truncated ? { truncated: true } : {}) };
      }
    }
    if (!fullText && (value.kind === 'text' || value.kind === 'reasoning')) {
      const text = preview(value.text, PUBLIC_HISTORY_LIMITS.textChars);
      return { ...value, text, ...(text.length < value.text.length ? { textTruncated: true, textChars: value.text.length } : {}) };
    }
    return value;
  }

  publicEntry(thread: Thread, entryId: string): ConversationTimelineEntry | undefined {
    const index = this.index(thread), position = index.entries.get(entryId);
    return position ? this.entry(index, position) : undefined;
  }

  entryCursor(thread: Thread, state: PublicHistoryState, entryId: string): string | undefined {
    const position = this.index(thread).entries.get(entryId);
    return position ? this.cursor(thread.id, state, position.sequence) : undefined;
  }

  owner(thread: Thread, messageId: string): { message?: ChatMessage; turn?: ThreadTurn } {
    const index = this.index(thread), item = index.messages.get(messageId);
    if (!item) return {};
    const source = item.message, turnId = source.turnId ?? index.membership.get(messageId);
    const message: ChatMessage = { id: source.id, role: source.role, createdAt: source.createdAt, content: '', ordinal: item.ordinal,
      ...(turnId ? { turnId } : {}) };
    const turn = turnId ? index.turns.get(turnId) : undefined, boundary = turnId ? index.boundaries.get(turnId) : undefined;
    return { message, ...(turn ? { turn: { ...turn.turn, ordinal: turn.ordinal, messageIds: [messageId],
      ...(boundary ? { firstSequence: boundary.first, lastSequence: boundary.last } : {}) } } : {}) };
  }

  private cursor(threadId: string, state: PublicHistoryState, sequence: number): string {
    return this.cursors.encode([1, threadId, state.epoch, sequence]);
  }

  private position(threadId: string, state: PublicHistoryState, cursor: string): number {
    const value = this.cursors.decode(cursor);
    if (!Array.isArray(value) || value.length !== 4 || value[0] !== 1 || value[1] !== threadId
      || typeof value[2] !== 'string' || !Number.isSafeInteger(value[3]) || value[3] < 1) {
      throw new HttpError(400, 'The conversation page cursor does not belong to this conversation.', 'INVALID_HISTORY_CURSOR');
    }
    if (value[2] !== state.epoch) throw historyChanged();
    return value[3];
  }

  private boundary(positions: PresentationPosition[], sequence: number, after: boolean): number {
    let low = 0, high = positions.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (positions[middle].sequence < sequence || after && positions[middle].sequence === sequence) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  window(thread: Thread, state: PublicHistoryState, input: HistoryPageInput = {}): Pick<Thread, 'messages' | 'timeline' | 'turns' | 'history'> {
    if (input.before && input.after) throw new HttpError(400, 'Choose one conversation page direction.', 'INVALID_INPUT');
    const limit = input.limit ?? PUBLIC_HISTORY_LIMITS.entries;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > PUBLIC_HISTORY_LIMITS.maxEntries) throw new HttpError(400, 'The conversation page size is invalid.', 'INVALID_INPUT');
    const index = this.index(thread), positions = index.positions;
    const forward = !!input.after;
    const anchor = input.before || input.after;
    const anchorSequence = anchor ? this.position(thread.id, state, anchor) : undefined;
    const boundary = anchorSequence !== undefined ? this.boundary(positions, anchorSequence, forward) : positions.length;
    let first = forward ? boundary : Math.max(0, boundary - limit), last = forward ? Math.min(positions.length, boundary + limit) : boundary;
    const materialize = () => {
      const entries = positions.slice(first, last).map(position => this.entry(index, position));
      const messageActivities = new Map<string, Set<string>>();
      const messageSummaries = new Map<string, Set<string>>();
      for (const entry of entries) {
        let selected = messageActivities.get(entry.messageId);
        if (!selected) { selected = new Set(); messageActivities.set(entry.messageId, selected); }
        if (entry.kind === 'activity') selected.add(entry.activityId);
        if (entry.kind === 'reasoning') {
          const summaries = messageSummaries.get(entry.messageId) ?? new Set<string>();
          summaries.add(entry.summaryId); messageSummaries.set(entry.messageId, summaries);
        }
      }
      const messages = [...messageActivities].map(([id, selected]) => this.publicMessage(thread, index.messages.get(id)!.message, selected, messageSummaries.get(id)))
        .sort((left, right) => (left.ordinal ?? 0) - (right.ordinal ?? 0));
      const selectedMessages = new Set(messageActivities.keys());
      const turnIds = new Set(messages.flatMap(message => message.turnId ? [message.turnId] : []));
      const turns = [...turnIds].flatMap(id => {
        const item = index.turns.get(id), boundary = index.boundaries.get(id);
        return item ? [{ ...item.turn, ordinal: item.ordinal, messageIds: item.turn.messageIds.filter(id => selectedMessages.has(id)),
          ...(boundary ? { firstSequence: boundary.first, lastSequence: boundary.last } : {}) }] : [];
      }).sort((left, right) => left.ordinal - right.ordinal);
      return { entries, messages, turns };
    };
    let page = materialize();
    // A single structured review is already bounded by its review subsystem.
    // Keep that one item accessible even when it fills an otherwise short page.
    while (last - first > 1 && bytes(page) > PUBLIC_HISTORY_LIMITS.pageBytes) {
      const remove = Math.max(1, Math.floor((last - first) / 4));
      if (forward) last -= remove; else first += remove;
      page = materialize();
    }
    const oldest = positions[first]?.sequence ?? null, newest = last > first ? positions[last - 1].sequence : null;
    const nextSequence = index.timeline.nextSequence + index.expansion;
    if (!Number.isSafeInteger(nextSequence) || nextSequence < 1) throw new HttpError(409, 'This conversation reached its presentation position limit.', 'HISTORY_POSITION_LIMIT');
    const history: ConversationHistoryWindow = { version: 1, epoch: state.epoch, revision: state.revision,
      oldestSequence: last > first ? oldest : null, newestSequence: newest,
      latestSequence: positions.at(-1)?.sequence ?? 0, totalMessages: thread.messages.length,
      olderCursor: first > 0 ? this.cursor(thread.id, state, oldest ?? anchorSequence ?? positions[first - 1].sequence) : null,
      // Retain the latest boundary cursor, too: newer entries can arrive after
      // this page while its reader is browsing an older window.
      newerCursor: newest !== null || anchorSequence !== undefined ? this.cursor(thread.id, state, newest ?? anchorSequence!) : null,
      hasOlder: first > 0, hasNewer: last < positions.length };
    return { messages: page.messages, turns: page.turns,
      timeline: { version: 1, revision: index.timeline.revision, nextSequence, entries: page.entries }, history };
  }

  detail(thread: Thread, state: PublicHistoryState, input: HistoryDetailInput): ConversationHistoryDetail {
    if (input.epoch !== state.epoch) throw historyChanged();
    if (input.part !== undefined && (!/^[a-z][a-z0-9_-]{0,31}$/.test(input.part) || !['input', 'output'].includes(input.field))) {
      throw new HttpError(400, 'Choose a readable part of a recorded tool request or result.', 'INVALID_INPUT');
    }
    const index = this.index(thread);
    let value: string | undefined;
    let presentation: ConversationHistoryDetail['presentation'], activity: ToolActivity | undefined;
    if (input.field === 'text' && input.entryId && !input.messageId && !input.activityId) {
      const position = index.entries.get(input.entryId);
      const entry = position ? this.entry(index, position, true) : undefined;
      if (entry?.kind === 'text' || entry?.kind === 'reasoning') value = entry.text;
    } else if (input.field === 'content' && input.messageId && !input.entryId && !input.activityId) {
      value = index.messages.get(input.messageId)?.message.content;
    } else if (input.field === 'citations' && input.messageId && !input.entryId && !input.activityId) {
      const message = index.messages.get(input.messageId)?.message;
      if (message) value = (message.citations ?? []).map(citation => `${citation.title}\n${citation.url}`).join('\n\n');
    } else if ((input.field === 'input' || input.field === 'output') && input.messageId && input.activityId && !input.entryId) {
      const message = index.messages.get(input.messageId)?.message;
      if (message) activity = this.activity(message, input.activityId);
      const document = activity ? toolDetailDocument(activity, input.field) : undefined;
      if (document) {
        const part = document.parts.find(part => part.id === (input.part ?? document.defaultPartId));
        if (!part) throw missingItem();
        value = part.text;
        presentation = { label: part.label, kind: part.kind, partId: part.id,
          ...(part.language ? { language: part.language } : {}), ...(part.path ? { path: part.path } : {}),
          parts: document.parts.map(({ id, label }) => ({ id, label })),
          ...(document.notices.length ? { notices: document.notices } : {}) };
      }
    } else throw new HttpError(400, 'Choose one public conversation text item.', 'INVALID_INPUT');
    if (value === undefined) throw missingItem();
    // Only saved public message/tool/summary fields can reach this endpoint.
    // Saved model items, private reasoning and encrypted_content are never read.
    const digest = createHash('sha256').update(state.epoch).update('\0').update(input.field).update('\0')
      .update(input.entryId ?? input.messageId ?? '').update('\0').update(input.activityId ?? '').update('\0');
    if (activity && presentation) digest.update(TOOL_DETAIL_PRESENTATION_VERSION).update('\0').update(presentation.partId).update('\0')
      .update(activity.name).update('\0').update(activity.status).update('\0').update(activity.input).update('\0').update(activity.output ?? '').update('\0');
    const version = digest.update(value).digest('hex');
    if (input.version !== undefined && input.version !== version) throw new HttpError(409, 'This item changed while it was being inspected. Reopen it to read the updated text.', 'HISTORY_ITEM_CHANGED');
    const offset = input.offset ?? 0, limit = input.limit ?? PUBLIC_HISTORY_LIMITS.detailChars;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > value.length || !Number.isSafeInteger(limit) || limit < 1 || limit > PUBLIC_HISTORY_LIMITS.detailChars) {
      throw new HttpError(400, 'The public item text range is invalid.', 'INVALID_INPUT');
    }
    if (offset > 0 && /[\ud800-\udbff]/.test(value[offset - 1]) && /[\udc00-\udfff]/.test(value[offset] ?? '')) {
      throw new HttpError(400, 'Use the next text offset returned by the previous page.', 'INVALID_INPUT');
    }
    const text = textSlice(value, offset, limit);
    // A one-character request for a surrogate pair must still make progress.
    const body = text || (offset < value.length ? value.slice(offset, offset + 2) : '');
    const next = offset + body.length;
    let previousOffset = offset === 0 ? null : Math.max(0, offset - limit);
    if (previousOffset !== null && previousOffset > 0 && /[\ud800-\udbff]/.test(value[previousOffset - 1]) && /[\udc00-\udfff]/.test(value[previousOffset])) {
      previousOffset = previousOffset + 1 < offset ? previousOffset + 1 : previousOffset - 1;
    }
    return { threadId: thread.id, epoch: state.epoch, revision: state.revision, version,
      text: body, totalChars: value.length, offset, nextOffset: next < value.length ? next : null, previousOffset,
      ...(presentation ? { presentation } : {}) };
  }
}

export function publicQueuedInput(items: readonly QueuedThreadInput[]): QueuedThreadInput[] {
  return items.map(item => {
    const prompt = preview(item.prompt, PUBLIC_HISTORY_LIMITS.queuedPromptChars);
    return { id: item.id, createdAt: item.createdAt, prompt,
      ...(item.delivery ? { delivery: item.delivery } : {}),
      ...(item.state ? { state: item.state } : {}),
      ...(typeof item.cancellable === 'boolean' ? { cancellable: item.cancellable } : {}),
      ...(item.holdReason ? { holdReason: item.holdReason } : {}),
      ...(item.model ? { model: item.model } : {}),
      ...(item.acceptedAt ? { acceptedAt: item.acceptedAt } : {}),
      ...(prompt.length < item.prompt.length ? { promptTruncated: true, promptChars: item.prompt.length } : {}),
      ...(item.attachments?.length ? { attachments: structuredClone(item.attachments) } : {}),
      ...(item.fileAttachments?.length ? { fileAttachments: structuredClone(item.fileAttachments) } : {}) };
  });
}

export function publicAgentRecords(agents: readonly AgentRecord[]): AgentRecord[] {
  return agents.map(agent => {
    const result = { ...agent };
    if (agent.finalMessage) {
      result.finalMessage = preview(agent.finalMessage, PUBLIC_HISTORY_LIMITS.agentResultChars);
      if (result.finalMessage.length < agent.finalMessage.length) result.finalMessageTruncated = true;
    }
    return structuredClone(result);
  });
}

/** Current controls remain independent of the historical page being viewed. */
export function publicThreadMetadata(source: Thread): Omit<Thread, 'messages'> {
  const result: Omit<Thread, 'messages'> = { id: source.id, workspaceId: source.workspaceId, title: source.title,
    createdAt: source.createdAt, updatedAt: source.updatedAt, status: source.status };
  for (const field of ['error', 'mode', 'pendingApproval', 'pendingQuestion', 'permissionMode', 'titleSource', 'titleRevision',
    'parentThreadId', 'rootThreadId', 'taskName', 'agentRole', 'archivedAt', 'forkedFrom', 'compaction', 'contextUsage', 'goal'] as const) {
    if (source[field] !== undefined) Object.assign(result, { [field]: structuredClone(source[field]) });
  }
  const usage = publicThreadUsage(source.usage);
  if (usage) result.usage = usage;
  // The current structured review has its own fixed result-size limit; it is
  // a current control/result, independent of which historical page is open.
  if (source.review) result.review = structuredClone(source.review);
  return result;
}
