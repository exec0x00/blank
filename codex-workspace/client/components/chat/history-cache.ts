import type { AgentEvent, ChatMessage, ConversationTimelineEntry, ReasoningSummarySegment, Thread, ToolActivity } from '../../../shared/types';
import type { CodexNativeView } from '../../../shared/codex-cli';
import { applyAgentEvent, publicTimelineEntry } from './state';

type History = NonNullable<Thread['history']>;
type Direction = 'older' | 'newer';
interface Boundary { history: History; oldest: number; newest: number; cursorSequence: number | null }
export const HISTORY_CACHE_PAGES = 4;
export const HISTORY_CACHE_ENTRIES = 160;
const MAX_PROTECTED_PAGES = 6;
const MAX_PROTECTED_ENTRIES = 240;
const contentEvents = new Set(['message', 'delta', 'reasoning_summary', 'activity', 'timeline']);
class HistorySelectionLimit extends Error {}


/** Native pages may contain one item (including a large image). Page count is
 * therefore not a useful native cache bound. A live item can have several
 * observed timeline fragments; those stay together when pages are evicted. */
export const NATIVE_HISTORY_MAX_ITEMS = 256;
export const NATIVE_HISTORY_MAX_ENTRIES = 1024;
const NATIVE_TURN_REVISION_LIMIT = NATIVE_HISTORY_MAX_ITEMS * 3;
interface NativeBoundary { items: string[]; older: string | null; newer: string | null; latest: boolean }
interface SnapshotOptions { canonical?: boolean; preserveMetadata?: boolean }
type NativeTurnView = CodexNativeView['turns'][number];

function nativeView(thread: Thread): CodexNativeView | undefined {
  const view = thread.nativeView;
  if (view === undefined) return;
  const identity = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 256;
  if (!view || !identity(view.epoch) || !Number.isSafeInteger(view.revision) || view.revision < 0
    || !['legacy', 'paginated', 'unknown'].includes(view.historyMode) || !Array.isArray(view.turns) || view.turns.length > 256
    || new Set(view.turns.map(turn => turn?.turnId)).size !== view.turns.length
    || view.turns.some(turn => !turn || !identity(turn.turnId) || !Number.isSafeInteger(turn.revision) || turn.revision < 0
      || !['native', 'legacy'].includes(turn.identity) || !['partial', 'complete'].includes(turn.coverage))
    || thread.messages.some(message => message.turnId && !view.turns.some(turn => turn.turnId === message.turnId))) {
    throw new Error('The conversation history could not be read safely. Refresh it.');
  }
  return view;
}

/** Replace an explicitly covered turn at its existing position, retaining all
 * other turns. Native IDs are never matched by their text or spelling. */
function replaceNativeTurns(current: Thread, incoming: Thread, replacements: ReadonlySet<string>, removed: ReadonlySet<string>): Thread {
  if (!removed.size) return current;
  const oldMessages = new Map(current.messages.map(message => [message.id, message]));
  const newMessages = new Map(incoming.messages.map(message => [message.id, message]));
  const byTurn = new Map<string, ConversationTimelineEntry[]>();
  for (const entry of nativeEntries(incoming)) {
    const turn = newMessages.get(entry.messageId)?.turnId;
    if (turn && replacements.has(turn)) byTurn.set(turn, [...byTurn.get(turn) ?? [], entry]);
  }
  const inserted = new Set<string>();
  const entries = nativeEntries(current).flatMap(entry => {
    if (!removed.has(entry.messageId)) return [entry];
    const turn = oldMessages.get(entry.messageId)?.turnId;
    if (!turn || !replacements.has(turn) || inserted.has(turn)) return [];
    inserted.add(turn); return byTurn.get(turn) ?? [];
  });
  const messages = [...current.messages.filter(message => !removed.has(message.id)),
    ...incoming.messages.filter(message => message.turnId && inserted.has(message.turnId))];
  const turns = new Map(current.turns?.map(turn => [turn.id, turn]) ?? []);
  for (const turn of incoming.turns ?? []) if (replacements.has(turn.id)) turns.set(turn.id, turn);
  return nativeProject({ ...current, messages, turns: [...turns.values()] }, entries);
}

function nativeEntries(thread: Thread, bounded = true): ConversationTimelineEntry[] {
  if (!Array.isArray(thread.messages) || thread.messages.some(message => !message || typeof message.id !== 'string' || !message.id)) {
    throw new Error('The native history view contains invalid item identities.');
  }
  const ids = new Set(thread.messages.map(message => message.id));
  const entries = thread.timeline?.entries ?? thread.messages.map((message, index): ConversationTimelineEntry => ({
    id: `native-message:${message.id}`, messageId: message.id, kind: 'legacy', sequence: index + 1, revision: 0,
  }));
  if (bounded && (thread.messages.length > NATIVE_HISTORY_MAX_ITEMS || entries.length > NATIVE_HISTORY_MAX_ENTRIES)
    || !Array.isArray(entries) || ids.size !== thread.messages.length || new Set(entries.map(entry => entry?.id)).size !== entries.length
    || entries.some(entry => !entry || typeof entry.id !== 'string' || !entry.id || !ids.has(entry.messageId))) throw new Error('The native history view exceeds its display bounds or contains invalid item identities.');
  return entries;
}

function nativeBoundary(thread: Thread, direction: Direction, latest = false): NativeBoundary {
  const page = thread.nativePage;
  if (page && [page.nextCursor, page.backwardsCursor].some(cursor => cursor !== null && (typeof cursor !== 'string' || !cursor || cursor.length > 16384))) {
    throw new Error('The native history page contains an invalid cursor.');
  }
  return { items: thread.messages.map(message => message.id),
    older: (direction === 'older' ? page?.nextCursor : page?.backwardsCursor) ?? null,
    newer: (direction === 'older' ? page?.backwardsCursor : page?.nextCursor) ?? null,
    latest: latest || direction === 'newer' && page?.nextCursor === null };
}

/** Preserve the already rendered ordering, inserting new native entries before
 * their next shared anchor. Canonical pages cannot replace richer live parts. */
function nativeMerge(current: Thread, incoming: Thread, direction: Direction, incomingWins: boolean,
  protectedItems: ReadonlySet<string>, preserveMetadata = false): Thread {
  const oldEntries = nativeEntries(current, false), nextEntries = nativeEntries(incoming);
  const oldItems = new Map(current.messages.map(message => [message.id, message]));
  const newItems = new Map(incoming.messages.map(message => [message.id, message]));
  const oldByItem = new Map<string, string[]>(), nextIds = new Set(nextEntries.map(entry => entry.id));
  for (const entry of oldEntries) oldByItem.set(entry.messageId, [...oldByItem.get(entry.messageId) ?? [], entry.id]);
  const keep = new Set([...oldItems.keys()].filter(id => !incomingWins || protectedItems.has(id)
    && oldByItem.get(id)?.some(key => !nextIds.has(key))
    || (oldByItem.get(id)?.length ?? 0) > 1 && newItems.has(id) && oldByItem.get(id)?.some(key => !nextIds.has(key))));
  const replacement = new Map(nextEntries.map(entry => [entry.id, entry]));
  const oldIds = new Set(oldEntries.map(entry => entry.id)), before = new Map<string | null, ConversationTimelineEntry[]>();
  const oldEntryTurns = new Map(oldEntries.map(entry => [entry.id, oldItems.get(entry.messageId)?.turnId]));
  const firstInTurn = new Map<string, string>(), afterTurn = new Map<string, string | null>();
  oldEntries.forEach((entry, index) => {
    const turn = oldItems.get(entry.messageId)?.turnId;
    if (!turn) return;
    if (!firstInTurn.has(turn)) firstInTurn.set(turn, entry.id);
    afterTurn.set(turn, oldEntries[index + 1]?.id ?? null);
  });
  let nextAnchor: string | null = null, hasAnchor = false;
  for (let index = nextEntries.length - 1; index >= 0; index--) {
    const entry = nextEntries[index];
    if (oldIds.has(entry.id)) { nextAnchor = entry.id; hasAnchor = true; continue; }
    if (oldItems.has(entry.messageId) && keep.has(entry.messageId)) continue;
    const turn = newItems.get(entry.messageId)?.turnId;
    if (incoming.nativeView && turn && firstInTurn.has(turn) && (!nextAnchor || oldEntryTurns.get(nextAnchor) !== turn)) {
      nextAnchor = direction === 'older' ? firstInTurn.get(turn)! : afterTurn.get(turn) ?? null;
      hasAnchor = true;
    }
    before.set(nextAnchor, [...before.get(nextAnchor) ?? [], entry]);
  }
  const unmatched = (before.get(null) ?? []).reverse();
  const entries = oldEntries.flatMap(entry => [...(before.get(entry.id) ?? []).reverse(),
    !keep.has(entry.messageId) && replacement.has(entry.id) ? replacement.get(entry.id)! : entry]);
  if (!hasAnchor && direction === 'older') entries.unshift(...unmatched); else entries.push(...unmatched);
  const order = [...new Set(entries.map(entry => entry.messageId))];
  const messages = order.map(id => oldItems.has(id) && (!newItems.has(id) || keep.has(id)) ? oldItems.get(id)! : newItems.get(id)!);
  const turns = new Map((current.turns ?? []).map(turn => [turn.id, turn]));
  for (const turn of incoming.turns ?? []) if (!turns.has(turn.id) || incomingWins) turns.set(turn.id, turn);
  const metadata = preserveMetadata ? current : incoming;
  return nativeProject({ ...metadata, nativePage: incoming.nativePage ?? current.nativePage,
    ...(incoming.nativeView ? { nativeView: incoming.nativeView } : {}), messages, turns: [...turns.values()] }, entries);
}

function nativeProject(thread: Thread, entries: ConversationTimelineEntry[], items?: ReadonlySet<string>): Thread {
  const selectedEntries = items ? entries.filter(entry => items.has(entry.messageId)) : entries;
  const order = [...new Set(selectedEntries.map(entry => entry.messageId))];
  const messages = new Map(thread.messages.map(message => [message.id, message]));
  const selected = new Set(order);
  const turnIds = new Set(order.map(id => messages.get(id)?.turnId));
  const { history: _legacyHistory, ...view } = thread;
  return { ...view, messages: order.map(id => messages.get(id)!),
    ...(thread.nativeView ? { nativeView: { ...thread.nativeView, turns: thread.nativeView.turns.filter(turn => turnIds.has(turn.turnId)) } } : {}),
    // These positions are local rendering order only, never native ordinals.
    timeline: { version: 1, revision: thread.timeline?.revision ?? 0, nextSequence: selectedEntries.length + 1,
      entries: selectedEntries.map((entry, index) => ({ ...entry, sequence: index + 1 })) },
    ...(thread.turns ? { turns: thread.turns.filter(turn => turn.messageIds.some(id => selected.has(id)) || order.some(id => messages.get(id)?.turnId === turn.id))
      .map(turn => ({ ...turn, messageIds: order.filter(id => messages.get(id)?.turnId === turn.id || turn.messageIds.includes(id)) })) } : {}) };
}

function bounds(thread: Thread): Boundary | null {
  const history = thread.history;
  if (!history || history.oldestSequence === null || history.newestSequence === null) return null;
  return { history, oldest: history.oldestSequence, newest: history.newestSequence, cursorSequence: history.newerCursor ? history.newestSequence : null };
}

function mergeMessages(current: readonly ChatMessage[], incoming: readonly ChatMessage[], incomingWins: boolean): ChatMessage[] {
  const messages = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) {
    const previous = messages.get(message.id);
    if (!previous) { messages.set(message.id, message); continue; }
    const first = incomingWins ? previous : message, last = incomingWins ? message : previous;
    const activities = new Map((first.activities ?? []).map(activity => [activity.id, activity]));
    for (const activity of last.activities ?? []) activities.set(activity.id, activity);
    messages.set(message.id, { ...first, ...last, ...(activities.size ? { activities: [...activities.values()] } : {}) });
  }
  return [...messages.values()];
}

function project(thread: Thread, entries: ConversationTimelineEntry[], history: History): Thread {
  const messageIds = new Set(entries.map(entry => entry.messageId));
  const activityIds = new Set(entries.filter(entry => entry.kind === 'activity').map(entry => entry.activityId));
  const summaryIds = new Set(entries.filter(entry => entry.kind === 'reasoning').map(entry => `${entry.messageId}:${entry.summaryId}`));
  const legacyIds = new Set(entries.filter(entry => entry.kind === 'legacy').map(entry => entry.messageId));
  const messages = thread.messages.filter(message => messageIds.has(message.id)).map(message => ({
    ...message,
    ...(message.activities ? { activities: message.activities.filter(activity => legacyIds.has(message.id) || activityIds.has(activity.id)) } : {}),
    ...(message.reasoningSummary ? { reasoningSummary: message.reasoningSummary.filter(summary => legacyIds.has(message.id)
      || summaryIds.has(`${message.id}:${summary.id}`) || summaryIds.has(`${message.id}:${JSON.stringify([summary.id, summary.summaryIndex])}`)) } : {}),
  }));
  const turnIds = new Set(messages.map(message => message.turnId));
  return { ...thread, messages, history, timeline: { version: 1, revision: thread.timeline?.revision ?? 0,
    nextSequence: thread.timeline?.nextSequence ?? history.latestSequence + 1, entries },
    ...(thread.turns ? { turns: thread.turns.filter(turn => turnIds.has(turn.id) || turn.messageIds.some(id => messageIds.has(id)))
      .map(turn => ({ ...turn, messageIds: turn.messageIds.filter(id => messageIds.has(id)) })) } : {}) };
}

/** Only page boundaries/cursors are stored here. The bounded Thread holds content once. */
export class ConversationHistoryCache {
  private pages: Boundary[] = [];
  private nativePages: NativeBoundary[] = [];
  private nativeProtected = new Set<string>();
  private nativeInteraction = new Set<string>();
  private nativeLatestItem: string | null = null;
  private nativeNewer = false;
  private nativeGapOlder: string | undefined;
  private nativeGapNewer: string | undefined;
  private nativeEpoch: string | null = null;
  private nativeRevision = 0;
  private nativeTurnRevisions = new Map<string, NativeTurnView>();
  private retiredNativeEpochs = new Set<string>();
  private nativePriorEpochTurns = new Set<string>();
  private identity: string | null = null;
  private retiredEpochs = new Set<string>();
  private protectedSequences = new Set<number>();
  private interactionSequences = new Set<number>();
  anchorSequence: number | null = null;
  unseen = 0;
  private unseenEntries = new Set<string>();
  refreshLatest = false;

  reset(thread: Thread | null) {
    if ((thread?.id ?? null) !== this.identity) {
      this.retiredEpochs.clear(); this.retiredNativeEpochs.clear(); this.nativeTurnRevisions.clear(); this.nativePriorEpochTurns.clear(); this.nativeEpoch = null; this.nativeRevision = 0;
      this.identity = thread?.id ?? null;
    }
    this.pages = thread && bounds(thread) ? [bounds(thread)!] : [];
    this.nativePages = thread?.backend === 'codex-cli' ? [nativeBoundary(thread, 'older', true)] : [];
    this.nativeProtected.clear(); this.nativeInteraction.clear(); this.nativeNewer = false;
    this.nativeGapOlder = undefined; this.nativeGapNewer = undefined;
    const visible = thread?.backend === 'codex-cli' ? new Set(nativeEntries(thread).map(entry => entry.messageId)) : null;
    this.nativeLatestItem = visible ? thread!.messages.filter(message => visible.has(message.id)).at(-1)?.id ?? null : null;
    this.anchorSequence = null;
    this.protectedSequences.clear(); this.interactionSequences.clear();
    this.unseen = 0; this.unseenEntries.clear(); this.refreshLatest = false;
    const view = thread?.backend === 'codex-cli' ? nativeView(thread) : undefined;
    if (view) {
      this.nativeEpoch = view.epoch; this.nativeRevision = Math.max(this.nativeRevision, view.revision);
      for (const turn of view.turns) {
        const previous = this.nativeTurnRevisions.get(turn.turnId);
        if (!previous || turn.revision >= previous.revision) this.nativeTurnRevisions.set(turn.turnId, turn);
      }
    }
  }

  anchor(thread: Thread | null, key: string | null, pinnedKeys: ReadonlySet<string>, viewportKeys: ReadonlySet<string> = new Set()) {
    if (thread?.backend === 'codex-cli') {
      const entries = nativeEntries(thread);
      const itemFor = (value: string | null) => {
        if (!value) return undefined;
        const entry = entries.find(entry => entry.id === value || `updated:${entry.id}` === value);
        if (entry) return entry.messageId;
        if (value.startsWith('turn-end:')) return thread.messages.slice().reverse().find(message => `turn-end:${message.turnId}` === value)?.id;
        return thread.messages.find(message => message.id === value || `message:${message.id}` === value)?.id;
      };
      this.nativeInteraction = new Set([...pinnedKeys].map(itemFor).filter((id): id is string => !!id));
      this.nativeProtected = new Set([...pinnedKeys, ...viewportKeys, ...(key ? [key] : [])].map(itemFor).filter((id): id is string => !!id));
      return;
    }
    const entries = thread?.timeline?.entries ?? [];
    const sequenceFor = (key: string | null) => {
      if (!key) return null;
      return entries.find(entry => entry.id === key || `updated:${entry.id}` === key)?.sequence
        ?? (key.startsWith('turn-end:') ? thread?.turns?.find(turn => `turn-end:${turn.id}` === key)?.lastSequence : undefined) ?? null;
    };
    this.anchorSequence = sequenceFor(key);
    this.interactionSequences = new Set([...pinnedKeys].map(sequenceFor).filter((value): value is number => value !== null));
    this.protectedSequences = new Set([...this.interactionSequences, ...[...viewportKeys].map(sequenceFor).filter((value): value is number => value !== null)]);
    if (this.anchorSequence !== null) this.protectedSequences.add(this.anchorSequence);
  }

  markRead() { this.unseen = 0; this.unseenEntries.clear(); }

  /** Consume at most one fallback refresh; a selected old page must not cause a retry loop. */
  takeLatestRefresh(thread: Thread | null): boolean {
    const requested = this.refreshLatest;
    this.refreshLatest = false;
    if (thread?.backend === 'codex-cli') {
      if (!requested || thread.id !== this.identity) return false;
      if (this.nativeInteraction.size) { this.refreshLatest = true; return false; }
      return true;
    }
    if (!requested || this.interactionSequences.size || !thread?.history || thread.id !== this.identity) return false;
    const last = this.pages.at(-1);
    return thread.history.hasNewer || !last || last.cursorSequence === null || last.cursorSequence < last.newest;
  }


  cursor(thread: Thread | null, direction: Direction): string | null {
    if (thread?.id !== this.identity) return null;
    if (thread?.backend === 'codex-cli') {
      const gap = direction === 'older' ? this.nativeGapOlder : this.nativeGapNewer;
      if (gap !== undefined) return gap;
      return (direction === 'older' ? this.nativePages[0]?.older
        : this.nativePages.at(-1)?.newer ?? (this.nativeNewer ? this.nativePages.slice().reverse().find(page => page.newer)?.newer : null)) ?? null;
    }
    return (direction === 'older' ? thread?.history?.olderCursor : thread?.history?.newerCursor) ?? null;
  }

  hasOlder(thread: Thread | null): boolean {
    return thread?.backend === 'codex-cli' ? !!this.cursor(thread, 'older') : !!thread?.history?.hasOlder;
  }

  hasNewer(thread: Thread | null): boolean {
    if (thread?.backend !== 'codex-cli') return !!thread?.history?.hasNewer;
    return thread.id === this.identity && !!this.cursor(thread, 'newer') && (!!this.nativeGapNewer || this.nativeNewer || !this.nativePages.at(-1)?.latest);
  }

  private boundNative(thread: Thread, pages: NativeBoundary[], direction: Direction): Thread {
    const positions = new Map(thread.messages.map((message, index) => [message.id, index]));
    const position = (page: NativeBoundary) => Math.min(...page.items.map(id => positions.get(id) ?? Number.MAX_SAFE_INTEGER));
    const selected = pages.filter(page => page.items.length).sort((left, right) => position(left) - position(right)), entries = nativeEntries(thread, false);
    const keys = () => new Set(selected.flatMap(page => page.items));
    let retained = keys(), count = entries.filter(entry => retained.has(entry.messageId)).length;
    while (selected.length > 1 && (retained.size > HISTORY_CACHE_ENTRIES || count > HISTORY_CACHE_ENTRIES)) {
      const index = direction === 'older' ? selected.length - 1 : 0;
      const remaining = new Set(selected.filter((_, candidate) => candidate !== index).flatMap(page => page.items));
      const removesProtected = selected[index].items.some(id => this.nativeProtected.has(id) && !remaining.has(id));
      if (removesProtected) break;
      selected.splice(index, 1);
      retained = keys(); count = entries.filter(entry => retained.has(entry.messageId)).length;
    }
    if (retained.size > NATIVE_HISTORY_MAX_ITEMS || count > NATIVE_HISTORY_MAX_ENTRIES) {
      throw new HistorySelectionLimit('Move keyboard focus or clear the text selection to continue loading history.');
    }
    this.nativePages = selected.length ? selected : pages.slice(0, 1);
    return nativeProject(thread, entries, retained);
  }

  private nativeMetadata(current: Thread, incoming: Thread, preserveControls = false): Thread {
    const { history: _legacyHistory, ...metadata } = preserveControls ? current : incoming;
    const turns = new Set(current.messages.flatMap(message => message.turnId ? [message.turnId] : []));
    return { ...metadata, messages: current.messages, turns: current.turns, timeline: current.timeline,
      ...(incoming.nativeView ? { nativeView: { ...incoming.nativeView, turns: incoming.nativeView.turns.filter(turn => turns.has(turn.turnId)) } } : {}) };
  }

  private reconcileNativeView(current: Thread, incoming: Thread, following: boolean, explicitJump: boolean, options: SnapshotOptions = {}, paging?: Direction): {
    current: Thread; incoming: Thread; replaced: boolean; replacementItems: ReadonlySet<string>; held: boolean; preserveMetadata: boolean;
  } | null {
    const next = nativeView(incoming), previous = current.nativeView;
    if (!next) return this.nativeEpoch ? null : { current, incoming, replaced: false, replacementItems: new Set(), held: false, preserveMetadata: !!options.preserveMetadata };
    if (this.retiredNativeEpochs.has(next.epoch)) {
      if (paging) throw new Error('Native history changed. Refresh the latest conversation before loading another page.');
      return null;
    }
    if (this.nativeEpoch && this.nativeEpoch !== next.epoch && (options.preserveMetadata || paging)) {
      if (paging) throw new Error('The native connection changed during this history read. Refresh the latest conversation.');
      return null;
    }
    if (this.nativeEpoch && this.nativeEpoch !== next.epoch) {
      this.retiredNativeEpochs.add(this.nativeEpoch);
      while (this.retiredNativeEpochs.size > 16) this.retiredNativeEpochs.delete(this.retiredNativeEpochs.values().next().value!);
      this.nativePriorEpochTurns = new Set(current.messages.flatMap(message => message.turnId ? [message.turnId] : []));
      this.nativeTurnRevisions.clear(); this.nativeRevision = 0;
    }
    this.nativeEpoch = next.epoch;
    const older = next.revision < this.nativeRevision;
    if (older && !options.canonical && !paging) return null;
    this.nativeRevision = Math.max(this.nativeRevision, next.revision);
    const represented = new Map(previous?.turns.map(turn => [turn.turnId, turn]) ?? []);
    const priorIds = new Map<string, string[]>();
    for (const message of current.messages) if (message.turnId) priorIds.set(message.turnId, [...priorIds.get(message.turnId) ?? [], message.id]);
    const incomingIds = new Set(incoming.messages.map(message => message.id));
    const replacements = new Set<string>(), removed = new Set<string>(), omitted = new Set<string>(), held = new Set<string>();
    const accepted = new Map<string, NativeTurnView>();
    for (const turn of next.turns) {
      const highest = this.nativeTurnRevisions.get(turn.turnId), resident = represented.get(turn.turnId);
      if (highest && (turn.revision < highest.revision || turn.revision === highest.revision && turn.identity !== highest.identity)) {
        omitted.add(turn.turnId); continue;
      }
      this.nativeTurnRevisions.delete(turn.turnId); this.nativeTurnRevisions.set(turn.turnId, turn);
      const ids = priorIds.get(turn.turnId) ?? [];
      const incompatible = ids.length > 0 && (previous?.epoch !== next.epoch || this.nativePriorEpochTurns.has(turn.turnId) || !resident || resident.identity !== turn.identity || resident.revision !== turn.revision);
      const obsolete = incompatible ? ids : turn.coverage === 'complete' && !older && !options.preserveMetadata ? ids.filter(id => !incomingIds.has(id)) : [];
      const protectedRemoval = obsolete.some(id => this.nativeInteraction.has(id) || !following && this.nativeProtected.has(id));
      if (!explicitJump && protectedRemoval) {
        omitted.add(turn.turnId); held.add(turn.turnId); this.refreshLatest = true; this.nativeNewer = true;
        continue;
      }
      if (incompatible) replacements.add(turn.turnId);
      for (const id of obsolete) removed.add(id);
      accepted.set(turn.turnId, turn);
      this.nativePriorEpochTurns.delete(turn.turnId);
    }
    // Keep resident/held identities plus a bounded recent tombstone budget.
    // Older live snapshots also face the producer revision fence; old native
    // page cursors are independently bound to the backend's turn fingerprint.
    const protectedTurns = new Set([...priorIds.keys(), ...next.turns.map(turn => turn.turnId)]);
    for (const id of this.nativeTurnRevisions.keys()) {
      if (this.nativeTurnRevisions.size <= NATIVE_TURN_REVISION_LIMIT) break;
      if (!protectedTurns.has(id)) this.nativeTurnRevisions.delete(id);
    }
    let selected = incoming;
    if (omitted.size) {
      const retained = new Set(incoming.messages.filter(message => !message.turnId || !omitted.has(message.turnId)).map(message => message.id));
      selected = nativeProject(incoming, nativeEntries(incoming), retained);
    }
    const nextRepresented = new Map(represented);
    for (const [id, turn] of accepted) nextRepresented.set(id, turn);
    // Metadata describes the rows retained in this browser, including a held
    // selection. The private high-water marks still reject its retired source.
    selected = { ...selected, nativeView: { ...next, revision: this.nativeRevision, turns: [...nextRepresented.values()] } };
    if (!selected.messages.length && incoming.messages.length && !accepted.size && !held.size) return null;
    if (paging && held.size) return { current, incoming: selected, replaced: false, replacementItems: new Set(), held: true, preserveMetadata: true };
    const reconciled = replaceNativeTurns(current, selected, replacements, removed);
    if (removed.size) {
      this.nativePages = this.nativePages.map(page => ({ ...page, items: page.items.filter(id => !removed.has(id)) })).filter(page => page.items.length);
      if (this.nativeLatestItem && removed.has(this.nativeLatestItem)) this.nativeLatestItem = selected.messages.at(-1)?.id ?? reconciled.messages.at(-1)?.id ?? null;
      if (incoming.nativePage && next.turns.some(turn => replacements.has(turn.turnId) && turn.coverage === 'partial')) {
        // Earlier, unrelated turns may remain resident on the other side of a
        // missing portion of this turn. Continue from the actual replacement
        // page cursor until that gap is filled, never from an unrelated page.
        if (paging === 'newer') {
          this.nativeGapNewer = incoming.nativePage.nextCursor ?? undefined;
          this.nativeGapOlder = incoming.nativePage.backwardsCursor ?? undefined;
        } else {
          this.nativeGapOlder = incoming.nativePage.nextCursor ?? undefined;
          this.nativeGapNewer = paging === 'older' ? incoming.nativePage.backwardsCursor ?? undefined : undefined;
        }
      }
    }
    return { current: reconciled, incoming: selected, replaced: removed.size > 0,
      replacementItems: new Set(selected.messages.filter(message => message.turnId && replacements.has(message.turnId)).map(message => message.id)), held: held.size > 0,
      preserveMetadata: !!options.preserveMetadata || older || !!paging };
  }

  private nativeWindowCheckpoint() {
    const pages = this.nativePages, older = this.nativeGapOlder, newer = this.nativeGapNewer, latest = this.nativeLatestItem;
    const priorEpochTurns = new Set(this.nativePriorEpochTurns), nativeNewer = this.nativeNewer;
    return () => {
      this.nativePages = pages; this.nativeGapOlder = older; this.nativeGapNewer = newer; this.nativeLatestItem = latest;
      this.nativePriorEpochTurns = priorEpochTurns; this.nativeNewer = nativeNewer;
    };
  }

  private nativeSnapshot(current: Thread | null, incoming: Thread, following: boolean, explicitJump: boolean, options: SnapshotOptions): Thread {
    nativeEntries(incoming); nativeView(incoming);
    // Snapshot cursor pairs are descending and handoffs cover the latest tail
    // of each replaced turn. Interior pages use nativePage() with an explicit
    // HTTP direction. Ordinary live snapshots omit cursors; a tagged snapshot
    // carrying them is canonical even if another turn advanced meanwhile.
    if (incoming.nativeView && incoming.nativePage && options.canonical === undefined) options = { ...options, canonical: true };
    const rollback = this.nativeWindowCheckpoint();
    try { return this.nativeSnapshotUpdate(current, incoming, following, explicitJump, options); }
    catch (error) {
      rollback();
      if (!current || !(error instanceof HistorySelectionLimit)) throw error;
      if (explicitJump) {
        // A stale canonical prefix cannot displace a newer, full live tail.
        // Keep its real boundary and let the existing history retry control
        // obtain a fresh page, rather than looping on an oversized read.
        this.refreshLatest = false;
        throw new HistorySelectionLimit('Your current view is kept. Retry to refresh the history.');
      }
      this.nativeNewer = true; this.refreshLatest = true;
      // Observation fences remain advanced, while retained rows continue to
      // advertise their own identity space until a replacement can fit.
      return this.nativeMetadata(current, { ...incoming, nativeView: current.nativeView }, !!options.preserveMetadata
        || !!incoming.nativeView && incoming.nativeView.revision < this.nativeRevision);
    }
  }

  private nativeSnapshotUpdate(current: Thread | null, incoming: Thread, following: boolean, explicitJump: boolean, options: SnapshotOptions): Thread {
    if (!current || current.id !== incoming.id || current.backend !== 'codex-cli') {
      const incomingEntries = nativeEntries(incoming);
      this.reset(incoming);
      return nativeProject(incoming, incomingEntries);
    }
    const source = this.reconcileNativeView(current, incoming, following, explicitJump, options);
    if (!source) return current;
    current = source.current; incoming = source.incoming;
    options = { ...options, preserveMetadata: source.preserveMetadata };
    const incomingEntries = nativeEntries(incoming);
    if (!incomingEntries.length && source.held) return this.nativeMetadata(current, incoming, source.preserveMetadata);
    const visible = new Set(incomingEntries.map(entry => entry.messageId));
    const oldIds = new Set(current.messages.map(message => message.id)), ids = incoming.messages.filter(message => visible.has(message.id)).map(message => message.id);
    const overlap = ids.some(id => oldIds.has(id)), previousLatest = this.nativeLatestItem;
    if (!options.canonical) {
      const latest = ids.at(-1);
      if (latest && latest !== previousLatest) {
        if (!following) {
          const previous = previousLatest ? ids.indexOf(previousLatest) : -1;
          for (const id of previous >= 0 ? ids.slice(previous + 1) : [latest]) this.countUnseen(`native:${id}`);
        }
        this.nativeLatestItem = latest;
      }
    }
    if (explicitJump) {
      // A history-only revert is authoritative. A canonical latest read may
      // still overlap a newer live tail and must retain that observed content.
      if (options.canonical && overlap) {
        const first = current.messages.findIndex(message => message.id === ids[0]);
        const retained = new Set([...ids, ...current.messages.slice(Math.max(0, first)).map(message => message.id)]);
        const merged = nativeMerge(current, incoming, 'newer', false, this.nativeProtected, !!options.preserveMetadata);
        const result = nativeProject(merged, nativeEntries(merged, false), retained);
        const boundary = { ...nativeBoundary(incoming, 'older', true), items: result.messages.map(message => message.id) };
        const bounded = this.boundNative(result, [boundary], 'newer');
        this.reset(bounded); this.nativePages = [{ ...boundary, items: bounded.messages.map(message => message.id) }];
        return bounded;
      }
      if (options.canonical && options.preserveMetadata && !this.hasNewer(current)) return current;
      this.reset(incoming); return nativeProject(incoming, incomingEntries);
    }
    // A live seed may have observed new activity before its first history
    // read finished. Without a native page/cursor it cannot replace a known
    // latest page. Merge that tail below; explicit/canonical replacements and
    // historical viewports retain their normal replacement/focus rules.
    if (!overlap && !source.replaced && (options.canonical || incoming.nativePage || !following || this.nativeInteraction.size)) {
      if (following && !this.nativeInteraction.size) {
        if (options.canonical && options.preserveMetadata && !this.hasNewer(current)) return current;
        if (!incoming.nativeView) { this.reset(incoming); return nativeProject(incoming, incomingEntries); }
      } else {
        this.nativeNewer ||= ids.length > 0 && !oldIds.has(ids.at(-1)!);
        return this.nativeMetadata(current, incoming, source.preserveMetadata);
      }
    }
    const merged = nativeMerge(current, incoming, 'newer', !options.canonical, this.nativeProtected, !!options.preserveMetadata);
    let pages = this.nativePages.map(page => ({ ...page, items: [...page.items] }));
    if ((options.canonical || source.replaced) && incoming.nativePage && ids.length) {
      // Install a real latest-read boundary. The live suffix belongs to that
      // boundary; older spans keep their original native cursors.
      const start = merged.messages.findIndex(message => message.id === ids[0]);
      const prefix = new Set(merged.messages.slice(0, start).map(message => message.id));
      pages = pages.map(page => ({ ...page, items: page.items.filter(id => prefix.has(id)) })).filter(page => page.items.length);
      const tail = merged.messages.slice(start).map(message => message.id);
      pages.push({ ...nativeBoundary(incoming, 'older', true), items: tail });
    } else {
      const assigned = new Set(pages.flatMap(page => page.items));
      const added = merged.messages.filter(message => !assigned.has(message.id)).map(message => message.id);
      if (!pages.length) pages = [{ ...nativeBoundary(incoming, 'older', true), items: added }];
      else { pages[pages.length - 1].items.push(...added); pages[pages.length - 1].latest = true; }
    }
    const result = this.boundNative(merged, pages, following ? 'newer' : 'older');
    this.nativeNewer = this.nativeLatestItem !== null && !result.messages.some(message => message.id === this.nativeLatestItem);
    return result;
  }

  private nativePage(current: Thread, incoming: Thread, direction: Direction): Thread {
    const rollback = this.nativeWindowCheckpoint();
    try { return this.nativePageUpdate(current, incoming, direction); }
    catch (error) { rollback(); throw error; }
  }

  private nativePageUpdate(current: Thread, incoming: Thread, direction: Direction): Thread {
    if (incoming.backend !== 'codex-cli' || incoming.id !== current.id || incoming.workspaceId !== current.workspaceId || !incoming.nativePage) {
      throw new Error('The native history page does not match this conversation. Refresh history to try again.');
    }
    nativeEntries(incoming); nativeBoundary(incoming, direction);
    const cursor = this.cursor(current, direction), next = incoming.nativePage.nextCursor;
    if (next !== null && (typeof next !== 'string' || !next || next === cursor)) throw new Error('The native history cursor did not advance. Refresh the latest history to try again.');
    const source = this.reconcileNativeView(current, incoming, false, false, { canonical: true }, direction);
    if (!source) return current;
    if (source.held) throw new HistorySelectionLimit('Move keyboard focus or return to the latest messages to refresh this native history view.');
    current = source.current; incoming = source.incoming;
    const known = new Set(current.messages.map(message => message.id)), added = incoming.messages.filter(message => !known.has(message.id) || source.replacementItems.has(message.id));
    const pages = this.nativePages.map(page => ({ ...page, items: [...page.items] }));
    if (!added.length) {
      if (!pages.length) pages.push(nativeBoundary(incoming, direction, direction === 'newer' && next === null));
      const edge = direction === 'older' ? pages[0] : pages.at(-1)!;
      if (direction === 'older') edge.older = next;
      else { edge.newer = next; edge.latest = next === null; if (next === null) this.nativeNewer = false; }
      this.nativePages = pages;
      if (direction === 'older' && this.nativeGapOlder !== undefined) this.nativeGapOlder = next ?? undefined;
      if (direction === 'newer' && this.nativeGapNewer !== undefined) this.nativeGapNewer = next ?? undefined;
      return { ...this.nativeMetadata(current, incoming, true), nativePage: incoming.nativePage };
    }
    const boundary = { ...nativeBoundary(incoming, direction), items: added.map(message => message.id) };
    if (direction === 'older') pages.unshift(boundary); else pages.push(boundary);
    const merged = nativeMerge(current, incoming, direction, false, this.nativeProtected, true);
    const result = this.boundNative(merged, pages, direction);
    if (direction === 'older' && this.nativeGapOlder !== undefined) this.nativeGapOlder = next ?? undefined;
    if (direction === 'newer' && this.nativeGapNewer !== undefined) this.nativeGapNewer = next ?? undefined;
    if (direction === 'newer' && next === null) this.nativeNewer = false;
    return result;
  }

  private adopt(thread: Thread, explicitJump: boolean): Thread {
    const queued = this.refreshLatest;
    this.reset(thread);
    if (!explicitJump) this.refreshLatest = queued;
    return thread;
  }

  private countUnseen(key: string) {
    if (this.unseenEntries.has(key)) return;
    this.unseen++;
    this.unseenEntries.add(key);
    if (this.unseenEntries.size > 256) this.unseenEntries.delete(this.unseenEntries.values().next().value!);
  }

  private forgetEpoch(epoch: string) {
    this.retiredEpochs.add(epoch);
    if (this.retiredEpochs.size > 8) this.retiredEpochs.delete(this.retiredEpochs.values().next().value!);
  }

  private boundedPages(pages: Boundary[], entries: readonly ConversationTimelineEntry[], direction: Direction): Boundary[] {
    const selected = [...pages];
    const count = () => entries.filter(entry => selected.length && entry.sequence >= selected[0].oldest && entry.sequence <= selected.at(-1)!.newest).length;
    while (selected.length > HISTORY_CACHE_PAGES || count() > HISTORY_CACHE_ENTRIES) {
      const index = direction === 'older' ? selected.length - 1 : 0;
      if ([...this.protectedSequences].some(sequence => sequence >= selected[index].oldest && sequence <= selected[index].newest)) {
        if (selected.length > MAX_PROTECTED_PAGES || count() > MAX_PROTECTED_ENTRIES) throw new HistorySelectionLimit('Move keyboard focus or clear the text selection to continue loading history.');
        break;
      }
      selected.splice(index, 1);
    }
    return selected;
  }

  private metadataOnly(current: Thread, incoming: Thread): Thread {
    const currentHistory = current.history!, incomingHistory = incoming.history!;
    const metadata = incomingHistory.revision >= currentHistory.revision ? incoming : current;
    const latestSequence = Math.max(currentHistory.latestSequence, incomingHistory.latestSequence);
    return { ...metadata, ...(!('goal' in metadata) ? { goal: current.goal } : {}), messages: current.messages, turns: current.turns, timeline: current.timeline,
      history: { ...currentHistory, revision: Math.max(currentHistory.revision, incomingHistory.revision), latestSequence,
        totalMessages: Math.max(currentHistory.totalMessages, incomingHistory.totalMessages), hasNewer: (currentHistory.newestSequence ?? 0) < latestSequence } };
  }

  private combine(current: Thread, incoming: Thread, pages: Boundary[], direction: Direction): Thread {
    const history = current.history!, nextHistory = incoming.history!;
    const sorted = [...pages].sort((a, b) => a.oldest - b.oldest || a.newest - b.newest);
    const distinct = sorted.filter((page, index) => !sorted.some((other, otherIndex) => otherIndex !== index
      && other.oldest <= page.oldest && other.newest >= page.newest
      && (other.oldest !== page.oldest || other.newest !== page.newest || otherIndex > index))).map(page => {
        // Cursorless compatibility frames may extend an existing page. A saved
        // sub-page can still advance its signed cursor without replacing its rows.
        let latest = page;
        for (const candidate of sorted) if (candidate.cursorSequence !== null && candidate.cursorSequence <= page.newest
          && candidate.cursorSequence > (latest.cursorSequence ?? 0)) latest = { ...page, cursorSequence: candidate.cursorSequence,
            history: { ...page.history, newerCursor: candidate.history.newerCursor } };
        return latest;
      });
    const incomingWins = nextHistory.revision >= history.revision;
    const combined = new Map(current.timeline?.entries.map(entry => [entry.id, entry]) ?? []);
    for (const entry of incoming.timeline?.entries ?? []) {
      const previous = combined.get(entry.id);
      if (!previous || entry.revision >= previous.revision) combined.set(entry.id, entry);
    }
    const compact = this.boundedPages(distinct, [...combined.values()], direction);
    const first = compact[0], last = compact.at(-1);
    if (!first || !last) return current;
    const entries = [...combined.values()].filter(entry => entry.sequence >= first.oldest && entry.sequence <= last.newest).sort((a, b) => a.sequence - b.sequence);
    const latestSequence = Math.max(history.latestSequence, nextHistory.latestSequence);
    const turns = new Map((current.turns ?? []).map(turn => [turn.id, turn]));
    for (const turn of incoming.turns ?? []) if (!turns.has(turn.id) || incomingWins) turns.set(turn.id, turn);
    const metadata = incomingWins ? incoming : current;
    const merged = { ...metadata, ...(!('goal' in metadata) ? { goal: current.goal } : {}),
      messages: mergeMessages(current.messages, incoming.messages, incomingWins), turns: [...turns.values()],
      timeline: { version: 1 as const, revision: Math.max(current.timeline?.revision ?? 0, incoming.timeline?.revision ?? 0),
        nextSequence: Math.max(current.timeline?.nextSequence ?? 1, incoming.timeline?.nextSequence ?? 1), entries } };
    this.pages = compact;
    return project(merged, entries, { ...metadata.history!, revision: Math.max(history.revision, nextHistory.revision), latestSequence,
      oldestSequence: first.oldest, newestSequence: last.newest,
      olderCursor: first.history.olderCursor, hasOlder: first.history.hasOlder,
      newerCursor: last.history.newerCursor, hasNewer: last.history.hasNewer || last.newest < latestSequence });
  }

  snapshot(current: Thread | null, incoming: Thread, following: boolean, explicitJump = false, options: SnapshotOptions = {}): Thread {
    if (incoming.backend === 'codex-cli') return this.nativeSnapshot(current, incoming, following, explicitJump, options);
    if (!current || current.id !== incoming.id || !current.history || !incoming.history) {
      this.reset(incoming);
      return current?.id === incoming.id && !('goal' in incoming) ? { ...incoming, goal: current.goal } : incoming;
    }
    if (this.retiredEpochs.has(incoming.history.epoch)) return current;
    if (current.history.epoch !== incoming.history.epoch) {
      if (incoming.history.revision < current.history.revision) return current;
      this.forgetEpoch(current.history.epoch);
      this.reset(incoming);
      return !('goal' in incoming) ? { ...incoming, goal: current.goal } : incoming;
    }
    const nextBounds = bounds(incoming), oldBounds = bounds(current);
    if (!nextBounds) return this.metadataOnly(current, incoming);
    if (!oldBounds) {
      const selected = this.combine(current, incoming, [nextBounds], 'newer');
      return this.adopt(selected, explicitJump);
    }
    if (incoming.history.revision < current.history.revision && !current.history.hasNewer && nextBounds.oldest >= oldBounds.oldest && nextBounds.newest <= oldBounds.newest
      && (this.pages.at(-1)?.cursorSequence ?? 0) >= (nextBounds.cursorSequence ?? 0)) return current;
    if (explicitJump) {
      const selected = this.combine(current, incoming, [nextBounds], 'newer');
      return this.adopt(selected, true);
    }
    if (!following && incoming.history.latestSequence > current.history.latestSequence) this.countUnseen(`snapshot:${incoming.history.latestSequence}`);
    if (nextBounds.oldest > oldBounds.newest || nextBounds.newest < oldBounds.oldest) {
      if (following && !this.interactionSequences.size) return this.adopt(this.combine(current, incoming, [nextBounds], 'newer'), false);
      if (following && incoming.history.latestSequence > current.history.latestSequence) this.countUnseen(`snapshot:${incoming.history.latestSequence}`);
      // Current controls remain live while the historical viewport retains only
      // its resident pages. The newest snapshot's transcript is discarded.
      return this.metadataOnly(current, incoming);
    }
    try { return this.combine(current, incoming, [...this.pages, nextBounds], following ? 'newer' : 'older'); }
    catch (error) { if (error instanceof HistorySelectionLimit) return this.metadataOnly(current, incoming); throw error; }
  }

  page(current: Thread, incoming: Thread, direction: Direction): Thread {
    if (current.backend === 'codex-cli') return this.nativePage(current, incoming, direction);
    if (incoming.id !== current.id || !current.history || incoming.history?.epoch !== current.history.epoch) return current;
    const next = bounds(incoming);
    if (!next) return { ...current, history: { ...current.history, ...(direction === 'older'
      ? { hasOlder: incoming.history.hasOlder, olderCursor: incoming.history.olderCursor }
      : { hasNewer: incoming.history.hasNewer, newerCursor: incoming.history.newerCursor }) } };
    return this.combine(current, incoming, [...this.pages, next], direction);
  }

  event(current: Thread | null, event: AgentEvent, following: boolean): Thread | null {
    if (current?.backend === 'codex-cli' && event.code === 'NATIVE_VIEW_WINDOW_LIMIT') {
      this.refreshLatest = true; this.nativeNewer = true;
      return { ...current };
    }
    if (event.type === 'snapshot') {
      const snapshot = event.thread as Thread | undefined;
      return snapshot?.id === event.threadId && Array.isArray(snapshot.messages) ? this.snapshot(current, snapshot, following) : current;
    }
    if (current?.backend === 'codex-cli') {
      // Native content is published as a bounded Thread view. Legacy deltas have
      // different ordering/revision semantics and cannot mutate that view.
      return current;
    }
    if (!current || current.id !== event.threadId || !current.history) return applyAgentEvent(current, event);
    const history = current.history;
    if (typeof event.historyEpoch === 'string' && event.historyEpoch !== history.epoch) return current;
    if (typeof event.historyRevision === 'number' && event.historyRevision < history.revision) return current;
    const previousEntries = current.timeline?.entries ?? [];
    const entry = event.type === 'timeline' && publicTimelineEntry(event.entry) && event.version === 1 && event.revision === event.entry.revision ? event.entry : undefined;
    if (event.type === 'timeline' && !entry) return current;
    const cursor = typeof event.historyCursor === 'string' && event.historyCursor.length <= 4096 ? event.historyCursor : null;
    const messageId = typeof event.messageId === 'string' ? event.messageId : event.type === 'message' ? (event.message as ChatMessage | undefined)?.id : undefined;
    const full = previousEntries.length >= HISTORY_CACHE_ENTRIES;
    let retain = true;
    if (contentEvents.has(event.type)) {
      if (entry) retain = previousEntries.some(item => item.id === entry.id)
        || !history.hasNewer && entry.sequence > (history.newestSequence ?? 0) && (!full || following && !!cursor);
      else if (event.type === 'activity') {
        const activity = event.activity as ToolActivity | undefined;
        retain = !!activity && previousEntries.some(item => item.kind === 'activity' && item.messageId === messageId && item.activityId === activity.id);
      } else if (event.type === 'reasoning_summary') {
        const summary = event.summary as ReasoningSummarySegment | undefined;
        retain = !!summary && previousEntries.some(item => item.kind === 'reasoning' && item.messageId === messageId
          && (item.summaryId === summary.id || item.summaryId === JSON.stringify([summary.id, summary.summaryIndex])));
      } else if (event.type === 'delta') retain = false;
      else retain = !!messageId && current.messages.some(message => message.id === messageId) || !history.hasNewer && !full;
      if (entry && !cursor && following) {
        const cursorSequence = this.pages.at(-1)?.cursorSequence ?? 0;
        if (previousEntries.filter(item => item.sequence > cursorSequence).length >= 40
          || full && entry.sequence > (history.newestSequence ?? 0)) this.refreshLatest = true;
      }
    }
    const updated = retain ? applyAgentEvent(current, event) ?? current : current;
    if (entry && retain && updated === current) return current;
    if ((!following || !retain) && (entry || event.type === 'message')) this.countUnseen(entry?.id ?? messageId ?? event.type);
    const latestSequence = Math.max(history.latestSequence, entry?.sequence ?? 0);
    const owner = event.message as ChatMessage | undefined;
    let newHistory: History = { ...history,
      revision: Math.max(history.revision, typeof event.historyRevision === 'number' ? event.historyRevision : 0), latestSequence,
      totalMessages: Math.max(history.totalMessages, Number.isSafeInteger(owner?.ordinal) ? owner!.ordinal! : 0),
      ...(entry && retain ? { oldestSequence: Math.min(history.oldestSequence ?? entry.sequence, entry.sequence),
        newestSequence: Math.max(history.newestSequence ?? entry.sequence, entry.sequence) } : {}),
      hasNewer: history.hasNewer || !!entry && !retain && entry.sequence > (history.newestSequence ?? 0) };
    let entries = updated.timeline?.entries ?? previousEntries;
    if (entry && retain && entry.sequence > (history.newestSequence ?? 0)) {
      const last = this.pages.at(-1);
      const inLast = last ? previousEntries.filter(item => item.sequence >= last.oldest && item.sequence <= last.newest).length : 0;
      let pages: Boundary[];
      if (!last || cursor && inLast >= 40) {
        const edge: History = { ...newHistory, oldestSequence: entry.sequence, newestSequence: entry.sequence,
          olderCursor: previousEntries.length ? cursor : history.olderCursor, hasOlder: previousEntries.length > 0 || history.hasOlder,
          newerCursor: cursor ?? history.newerCursor, hasNewer: false };
        pages = [...this.pages, { oldest: entry.sequence, newest: entry.sequence, history: edge, cursorSequence: cursor ? entry.sequence : null }];
      } else pages = [...this.pages.slice(0, -1), { ...last, newest: entry.sequence, ...(cursor ? { cursorSequence: entry.sequence } : {}), history: { ...last.history,
        newestSequence: entry.sequence, ...(cursor ? { newerCursor: cursor } : {}), hasNewer: false } }];
      try { this.pages = this.boundedPages(pages, entries, following ? 'newer' : 'older'); }
      catch (error) {
        if (!(error instanceof HistorySelectionLimit)) throw error;
        // A background stream cannot destroy an active selection or drop an
        // approval batch. Keep its metadata and expose the unread newer edge.
        entries = previousEntries;
        newHistory = { ...newHistory, oldestSequence: history.oldestSequence, newestSequence: history.newestSequence, hasNewer: true };
      }
    }
    const first = this.pages[0], last = this.pages.at(-1);
    if (first && last) {
      entries = entries.filter(item => item.sequence >= first.oldest && item.sequence <= last.newest);
      newHistory = { ...newHistory, oldestSequence: first.oldest, newestSequence: last.newest,
        olderCursor: first.history.olderCursor, hasOlder: first.history.hasOlder, newerCursor: last.history.newerCursor,
        hasNewer: last.newest < latestSequence };
    }
    return contentEvents.has(event.type) && retain ? project(updated, entries, newHistory) : { ...updated, history: newHistory };
  }
}
