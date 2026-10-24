import { randomUUID } from 'node:crypto';
import type { ChatMessage, ConversationTimeline, ConversationTimelineEntry, ReasoningSummarySegment, Thread, ToolActivity } from '../../shared/types';
import { HttpError } from '../errors';
import type { RedactionFragment, RedactionStream, SecretRedactor } from './redact';
import type { ReasoningSummaryEvent } from '../../shared/legacy-types';

type TextEntry = Extract<ConversationTimelineEntry, { kind: 'text' }>;
type ReasoningEntry = Extract<ConversationTimelineEntry, { kind: 'reasoning' }>;
type WritableEntry = TextEntry | ReasoningEntry;
const MAX_ENTRIES = 64_000;
const summaryKey = (id: string, index: number) => JSON.stringify([id, index]);

/** Message array order is known for old history; its intra-message order is not. */
export function ensureConversationTimeline(thread: Thread): ConversationTimeline {
  if (thread.timeline?.version === 1) return thread.timeline;
  const timeline: ConversationTimeline = { version: 1, revision: 0, nextSequence: 1, entries: [] };
  for (const message of thread.messages) {
    const sequence = timeline.nextSequence++;
    timeline.entries.push({ id: `historical:${message.id}`, sequence, revision: ++timeline.revision, messageId: message.id,
      kind: message.role === 'assistant' ? 'legacy' : 'message' });
  }
  thread.timeline = timeline;
  return timeline;
}

/** Rewind never reuses a removed position. Forks retain the source evidence and gaps. */
export function projectConversationTimeline(thread: Thread, messages: readonly ChatMessage[]): ConversationTimeline | undefined {
  if (!thread.timeline) return;
  const retained = new Set(messages.map(message => message.id));
  return { ...structuredClone(thread.timeline), revision: thread.timeline.revision + 1,
    entries: structuredClone(thread.timeline.entries.filter(entry => retained.has(entry.messageId))) };
}

/** Writes presentation evidence at the event boundary, never by timestamp. */
export class TimelineWriter {
  readonly timeline: ConversationTimeline;
  private readonly byId = new Map<string, ConversationTimelineEntry>();
  private readonly byMessage = new Map<string, ConversationTimelineEntry[]>();

  constructor(readonly thread: Thread, private readonly publish: (entry: ConversationTimelineEntry) => void) {
    this.timeline = ensureConversationTimeline(thread);
    for (const entry of this.timeline.entries) this.index(entry);
  }

  private index(entry: ConversationTimelineEntry) {
    this.byId.set(entry.id, entry);
    const entries = this.byMessage.get(entry.messageId) ?? [];
    entries.push(entry); this.byMessage.set(entry.messageId, entries);
  }

  private changed(entry: ConversationTimelineEntry, publish = true) {
    if (!Number.isSafeInteger(this.timeline.revision + 1)) throw new HttpError(409, 'This conversation reached its saved update limit. Start a new conversation.', 'TIMELINE_LIMIT');
    entry.revision = ++this.timeline.revision;
    if (publish) this.publish(structuredClone(entry));
  }

  private add<T extends ConversationTimelineEntry['kind']>(messageId: string, kind: T,
    fields: Omit<Extract<ConversationTimelineEntry, { kind: T }>, 'id' | 'sequence' | 'revision' | 'messageId' | 'kind'>, publish = true): Extract<ConversationTimelineEntry, { kind: T }> {
    if (this.timeline.entries.length >= MAX_ENTRIES || !Number.isSafeInteger(this.timeline.nextSequence + 1)) {
      throw new HttpError(409, 'This conversation reached its saved activity limit. Start a new conversation to continue.', 'TIMELINE_LIMIT');
    }
    const entry = { id: `timeline_${randomUUID().replaceAll('-', '')}`, sequence: this.timeline.nextSequence++, revision: 0, messageId, kind, ...fields } as Extract<ConversationTimelineEntry, { kind: T }>;
    this.timeline.entries.push(entry); this.index(entry); this.changed(entry, publish);
    return entry;
  }

  entries(messageId: string): readonly ConversationTimelineEntry[] { return this.byMessage.get(messageId) ?? []; }

  message(message: ChatMessage, publish = true): void {
    const entries = this.entries(message.id);
    const whole = entries.find(entry => entry.kind === 'message' || entry.kind === 'legacy');
    if (whole) { if (publish) this.changed(whole); return; }
    if (message.role !== 'assistant') { this.add(message.id, 'message', {}, publish); return; }
    if (message.content) this.reconcileText(message, message.content);
    else if (message.citations?.length || message.attachments?.length || message.review) this.reserveText(message);
  }

  activity(messageId: string, activity: ToolActivity): void {
    const existing = this.entries(messageId).find(entry => entry.kind === 'activity' && entry.activityId === activity.id);
    if (existing) this.changed(existing);
    else this.add(messageId, 'activity', { activityId: activity.id });
  }

  reserveText(message: ChatMessage): TextEntry {
    const tail = this.timeline.entries.at(-1);
    if (tail?.kind === 'text' && tail.messageId === message.id && !tail.revised) return tail;
    return this.add(message.id, 'text', { text: '', startOffset: message.content.length });
  }

  reserveReasoning(message: ChatMessage, key: string): ReasoningEntry {
    const tail = this.timeline.entries.at(-1);
    if (tail?.kind === 'reasoning' && tail.messageId === message.id && tail.summaryId === key && !tail.revised && tail.status === 'streaming') return tail;
    return this.add(message.id, 'reasoning', { summaryId: key, text: '', status: 'streaming' });
  }

  private syncText(message: ChatMessage, changed: Set<TextEntry>) {
    let offset = 0;
    const entries = this.entries(message.id).filter((entry): entry is TextEntry => entry.kind === 'text');
    for (const entry of entries) {
      if (entry.startOffset !== offset) { entry.startOffset = offset; changed.add(entry); }
      offset += entry.text.length;
    }
    message.content = entries.map(entry => entry.text).join('');
    for (const entry of changed) this.changed(entry);
  }

  appendText(message: ChatMessage, additions: ReadonlyMap<string, string>): void {
    const changed = new Set<TextEntry>();
    for (const [id, text] of additions) {
      const entry = this.byId.get(id);
      if (!text || entry?.kind !== 'text' || entry.messageId !== message.id) continue;
      entry.text += text; changed.add(entry);
    }
    if (changed.size) this.syncText(message, changed);
  }

  reconcileText(message: ChatMessage, text: string): void {
    const entries = this.entries(message.id).filter((entry): entry is TextEntry => entry.kind === 'text');
    const recorded = entries.map(entry => entry.text).join('');
    if (recorded === text) return;
    if (text.startsWith(recorded)) {
      const entry = this.reserveText(message);
      this.appendText(message, new Map([[entry.id, text.slice(recorded.length)]]));
      return;
    }
    // A corrected final value does not establish where its changed characters
    // occurred among earlier tools. Publish the replacement where it arrived.
    const changed = new Set<TextEntry>();
    for (const entry of entries) if (entry.text) { entry.text = ''; changed.add(entry); }
    this.syncText(message, changed);
    const replacement = this.add(message.id, 'text', { text, startOffset: 0, revised: true }, false);
    message.content = text;
    this.changed(replacement);
  }

  reasoningEntries(messageId: string, key: string): ReasoningEntry[] {
    return this.entries(messageId).filter((entry): entry is ReasoningEntry => entry.kind === 'reasoning' && entry.summaryId === key);
  }

  publishReasoning(message: ChatMessage, key: string, summary: ReasoningSummarySegment, additions?: ReadonlyMap<string, string>): void {
    let entries = this.reasoningEntries(message.id, key);
    const previous = entries.map(entry => entry.text).join('');
    const changed = new Set<ReasoningEntry>();
    if (!summary.text.startsWith(previous)) {
      for (const entry of entries) if (entry.text) { entry.text = ''; changed.add(entry); }
      if (summary.text) {
        const replacement = this.add(message.id, 'reasoning', { summaryId: key, text: summary.text, status: summary.status,
          ...(summary.truncated ? { truncated: true } : {}), revised: true }, false);
        entries = [...entries, replacement]; changed.add(replacement);
      }
    } else if (summary.text.length > previous.length) {
      let accepted = previous.length;
      for (const [id, text] of additions ?? []) {
        const entry = this.byId.get(id);
        if (!text || entry?.kind !== 'reasoning' || entry.messageId !== message.id || entry.summaryId !== key) continue;
        entry.text += text; accepted += text.length; changed.add(entry);
      }
      if (accepted < summary.text.length) {
        const entry = this.reserveReasoning(message, key);
        entry.text += summary.text.slice(accepted); changed.add(entry);
        if (!entries.includes(entry)) entries.push(entry);
      }
    }
    for (const entry of entries) {
      if (entry.status !== summary.status || entry.truncated !== summary.truncated) {
        entry.status = summary.status;
        if (summary.truncated) entry.truncated = true; else delete entry.truncated;
        changed.add(entry);
      }
    }
    for (const entry of changed) this.changed(entry);
  }
}

interface SourceSpan { start: number; end: number; entryId: string }
interface SafeSpan { start: number; end: number; entryId: string }

/** Source offsets live only in memory. Saved offsets are always sanitized text offsets. */
class SourcePositions {
  private readonly sources: SourceSpan[] = [];
  private readonly safe: SafeSpan[] = [];
  private received = 0;
  private released = 0;
  private sourceCursor = 0;

  reserve(length: number, entry: WritableEntry) {
    if (!length) return;
    const previous = this.sources.at(-1);
    if (previous?.entryId === entry.id) previous.end += length;
    else this.sources.push({ start: this.received, end: this.received + length, entryId: entry.id });
    this.received += length;
  }

  accept(fragment: RedactionFragment) {
    let source = fragment.sourceStart, offset = 0;
    while (offset < fragment.text.length) {
      while (this.sources[this.sourceCursor]?.end <= source) this.sourceCursor++;
      const owner = this.sources[this.sourceCursor];
      if (!owner || owner.start > source) throw new Error('The safe text source is missing from its timeline.');
      const length = fragment.redacted ? fragment.text.length : Math.min(fragment.text.length - offset, owner.end - source);
      const previous = this.safe.at(-1);
      if (previous?.entryId === owner.entryId && previous.end === this.released) previous.end += length;
      else this.safe.push({ start: this.released, end: this.released + length, entryId: owner.entryId });
      this.released += length; offset += length; source += fragment.redacted ? fragment.sourceEnd - fragment.sourceStart : length;
    }
  }

  additions(text: string, from: number): Map<string, string> {
    const additions = new Map<string, string>();
    for (const span of this.safe) {
      let boundaryStart = span.start, boundaryEnd = span.end;
      const high = (index: number) => text.charCodeAt(index) >= 0xd800 && text.charCodeAt(index) <= 0xdbff;
      const low = (index: number) => text.charCodeAt(index) >= 0xdc00 && text.charCodeAt(index) <= 0xdfff;
      // A Unicode character split by two callbacks belongs to the position of
      // its first code unit. Never leave two permanent half-characters around
      // an intervening tool/public-summary row.
      if (boundaryStart > 0 && high(boundaryStart - 1) && low(boundaryStart)) boundaryStart++;
      if (boundaryEnd > 0 && high(boundaryEnd - 1) && low(boundaryEnd)) boundaryEnd++;
      const start = Math.max(from, boundaryStart), end = Math.min(text.length, boundaryEnd);
      if (end <= start) continue;
      additions.set(span.entryId, (additions.get(span.entryId) ?? '') + text.slice(start, end));
    }
    return additions;
  }
}

/** Delayed redaction output returns to the entry reserved by its actual text event. */
export class TimelineTextStream {
  private readonly positions = new SourcePositions();
  private readonly stream: RedactionStream;
  private safe = '';

  constructor(private readonly writer: TimelineWriter, private readonly message: ChatMessage, privacy: SecretRedactor) {
    this.stream = privacy.stream(fragment => this.positions.accept(fragment));
  }

  push(text: string): string {
    if (!text) return '';
    this.positions.reserve(text.length, this.writer.reserveText(this.message));
    return this.commit(this.stream.push(text));
  }

  finish(): string { return this.commit(this.stream.finish()); }

  private commit(text: string) {
    if (!text) return '';
    const previous = this.safe.length; this.safe += text;
    this.writer.appendText(this.message, this.positions.additions(this.safe, previous));
    return text;
  }
}

/** Wraps the existing bounded public-summary accumulator without accepting private events. */
export class TimelineReasoningStreams {
  readonly privacy: SecretRedactor;
  private active?: ReasoningSummaryEvent;
  private readonly positions = new Map<string, SourcePositions>();

  constructor(private readonly writer: TimelineWriter, private readonly message: ChatMessage, privacy: SecretRedactor) {
    this.privacy = {
      text: value => privacy.text(value),
      stream: () => {
        if (!this.active) throw new Error('A public summary stream has no recorded source.');
        const key = summaryKey(this.active.itemId, this.active.summaryIndex);
        const positions = new SourcePositions(); this.positions.set(key, positions);
        const stream = privacy.stream(fragment => positions.accept(fragment));
        return {
          push: text => { if (text) positions.reserve(text.length, this.writer.reserveReasoning(this.message, key)); return stream.push(text); },
          finish: () => stream.finish(),
        };
      },
    };
  }

  during<T>(event: ReasoningSummaryEvent, apply: () => T): T {
    this.active = event;
    try { return apply(); } finally { this.active = undefined; }
  }

  publish(summary: ReasoningSummarySegment) {
    const key = summaryKey(summary.id, summary.summaryIndex);
    const previous = this.writer.reasoningEntries(this.message.id, key).map(entry => entry.text).join('');
    this.writer.publishReasoning(this.message, key, summary,
      summary.text.startsWith(previous) ? this.positions.get(key)?.additions(summary.text, previous.length) : undefined);
  }
}
