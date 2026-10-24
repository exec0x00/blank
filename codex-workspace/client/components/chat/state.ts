import type { AgentEvent, ChangeRecord, ChatMessage, ConversationTimelineEntry, ReasoningSummarySegment, Thread, ThreadStatus, ThreadSummary, ThreadTurn, ToolActivity } from '../../../shared/types';

const statuses = new Set<ThreadStatus>(['idle', 'running', 'awaiting_approval', 'awaiting_input', 'compacting', 'error', 'interrupted']);

function mergeActivities(previous: ToolActivity[] = [], incoming: ToolActivity[] = []) {
  const result = new Map(previous.map(activity => [activity.id, activity]));
  for (const activity of incoming) result.set(activity.id, { ...result.get(activity.id), ...activity });
  return [...result.values()];
}

function publicSummary(value: unknown): value is ReasoningSummarySegment {
  if (!value || typeof value !== 'object') return false;
  const summary = value as Partial<ReasoningSummarySegment>;
  return typeof summary.id === 'string' && !!summary.id && Number.isSafeInteger(summary.summaryIndex) && summary.summaryIndex! >= 0
    && typeof summary.text === 'string' && (summary.status === 'streaming' || summary.status === 'complete');
}

function mergeSummaries(previous: ReasoningSummarySegment[] = [], incoming: ReasoningSummarySegment[] = []) {
  const summaries = new Map(previous.filter(publicSummary).map(summary => [JSON.stringify([summary.id, summary.summaryIndex]), summary]));
  for (const summary of incoming.filter(publicSummary)) summaries.set(JSON.stringify([summary.id, summary.summaryIndex]), summary);
  return [...summaries.values()];
}

function updateMessage(thread: Thread, messageId: string, update: (message: ChatMessage) => ChatMessage): Thread {
  const existing = thread.messages.find(message => message.id === messageId);
  const message = update(existing ?? { id: messageId, role: 'assistant', content: '', createdAt: new Date().toISOString() });
  return { ...thread, messages: existing ? thread.messages.map(item => item.id === messageId ? message : item) : [...thread.messages, message] };
}

export function publicTimelineEntry(value: unknown): value is ConversationTimelineEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<ConversationTimelineEntry>;
  if (typeof entry.id !== 'string' || !entry.id || entry.id.length > 256 || typeof entry.messageId !== 'string' || !entry.messageId || entry.messageId.length > 200
    || !Number.isSafeInteger(entry.sequence) || entry.sequence! < 1 || !Number.isSafeInteger(entry.revision) || entry.revision! < 1) return false;
  if (entry.kind === 'message' || entry.kind === 'legacy') return true;
  if (entry.kind === 'activity') return typeof entry.activityId === 'string' && !!entry.activityId && entry.activityId.length <= 256;
  if (entry.kind === 'text') return typeof entry.text === 'string' && Number.isSafeInteger(entry.startOffset) && entry.startOffset! >= 0;
  return entry.kind === 'reasoning' && typeof entry.summaryId === 'string' && !!entry.summaryId && entry.summaryId.length <= 1024
    && typeof entry.text === 'string' && (entry.status === 'streaming' || entry.status === 'complete');
}

function applyTimelineEntry(thread: Thread, event: AgentEvent): Thread {
  const entry = event.entry;
  if (event.version !== 1 || !publicTimelineEntry(entry) || !Number.isSafeInteger(event.revision) || event.revision !== entry.revision) return thread;
  const timeline = thread.timeline ?? { version: 1 as const, revision: 0, nextSequence: 1, entries: [] };
  // A snapshot is also a revision barrier: old reconnect frames cannot restore
  // entries that an authoritative rewind/snapshot removed.
  if (entry.revision <= timeline.revision) return thread;
  const previous = timeline.entries.find(item => item.id === entry.id);
  if (previous && (previous.sequence !== entry.sequence || previous.messageId !== entry.messageId || previous.kind !== entry.kind)
    || timeline.entries.some(item => item.id !== entry.id && item.sequence === entry.sequence)) return thread;
  const entries = previous ? timeline.entries.map(item => item.id === entry.id ? entry : item)
    : [...timeline.entries, entry].sort((left, right) => left.sequence - right.sequence);
  let next = { ...thread, timeline: { ...timeline, revision: entry.revision, nextSequence: Math.max(timeline.nextSequence, entry.sequence + 1), entries } };
  const owner = event.message as ChatMessage | undefined;
  if (owner?.id === entry.messageId && ['user', 'assistant', 'system'].includes(owner.role) && typeof owner.createdAt === 'string') {
    const existing = next.messages.find(message => message.id === owner.id);
    const metadata = { id: owner.id, role: owner.role, createdAt: owner.createdAt, ...(owner.turnId ? { turnId: owner.turnId } : {}), ...(owner.ordinal ? { ordinal: owner.ordinal } : {}) };
    next = { ...next, messages: existing ? next.messages.map(message => message.id === owner.id ? { ...message, ...metadata } : message) : [...next.messages, { ...metadata, content: '' }] };
  }
  const ownerTurn = event.turn as ThreadTurn | undefined;
  if (ownerTurn?.id && Array.isArray(ownerTurn.messageIds) && ownerTurn.messageIds.includes(entry.messageId)) {
    const existing = next.turns?.find(turn => turn.id === ownerTurn.id);
    const updated = { ...existing, ...ownerTurn, messageIds: [...new Set([...(existing?.messageIds ?? []), ...ownerTurn.messageIds])] };
    next = { ...next, turns: existing ? next.turns!.map(turn => turn.id === updated.id ? updated : turn) : [...(next.turns ?? []), updated] };
  }
  if (entry.kind !== 'text') return next;
  const parts = entries.filter((item): item is Extract<ConversationTimelineEntry, { kind: 'text' }> => item.messageId === entry.messageId && item.kind === 'text');
  if (thread.history) {
    const message = thread.messages.find(item => item.id === entry.messageId);
    let end = 0;
    // A public page can start halfway through one assistant message. Never
    // replace its canonical copy/citation text with concatenated page fragments.
    for (const part of parts) {
      if (part.textTruncated || part.startOffset !== end) return next;
      end += part.text.length;
    }
    if (end < (message?.contentChars ?? message?.content.length ?? 0)) return next;
  }
  const content = parts.map(item => item.text).join('');
  return updateMessage(next, entry.messageId, message => ({ ...message, content }));
}

/** Snapshots replace local state. Message and activity IDs make repeated envelopes harmless. */
export function applyAgentEvent(thread: Thread | null, event: AgentEvent): Thread | null {
  if (event.type === 'snapshot') {
    const snapshot = event.thread as Thread | undefined;
    if (!snapshot || snapshot.id !== event.threadId || !Array.isArray(snapshot.messages)) return thread;
    if (thread?.id === snapshot.id && thread.history && snapshot.history && snapshot.history.revision < thread.history.revision) return thread;
    // A naming/final snapshot may omit externally stored goal state. Only null
    // or a goal record changes it; absence does not revoke a newer live goal.
    return thread?.id === snapshot.id && !('goal' in snapshot) ? { ...snapshot, goal: thread.goal } : snapshot;
  }
  if (!thread || thread.id !== event.threadId) return thread;
  if (thread.history && typeof event.historyEpoch === 'string' && event.historyEpoch !== thread.history.epoch) return thread;
  if (thread.history && typeof event.historyRevision === 'number' && event.historyRevision < thread.history.revision) return thread;
  if (typeof event.timelineRevision === 'number' && thread.timeline && event.timelineRevision < thread.timeline.revision) return thread;

  switch (event.type) {
    case 'timeline':
      return applyTimelineEntry(thread, event);
    case 'message': {
      const incoming = event.message as ChatMessage | undefined;
      if (!incoming || typeof incoming.id !== 'string' || typeof incoming.content !== 'string') return thread;
      return updateMessage(thread, incoming.id, previous => ({
        ...previous,
        ...incoming,
        // A duplicate initial message must not erase text that has already streamed.
        content: previous.content.length > incoming.content.length && previous.content.startsWith(incoming.content) ? previous.content : incoming.content,
        activities: mergeActivities(previous.activities, incoming.activities),
        ...(previous.reasoningSummary || incoming.reasoningSummary ? { reasoningSummary: mergeSummaries(previous.reasoningSummary, incoming.reasoningSummary) } : {}),
      }));
    }
    case 'delta':
      if (typeof event.messageId !== 'string' || typeof event.text !== 'string') return thread;
      // v1 sends full, revisioned text entries. Append-only compatibility
      // deltas must not duplicate their text on live replay or reconnect.
      if (thread.timeline?.version === 1) return thread;
      return updateMessage(thread, event.messageId, message => ({ ...message, content: message.content + event.text }));
    case 'reasoning_summary':
      if (typeof event.messageId !== 'string' || !publicSummary(event.summary)) return thread;
      return updateMessage(thread, event.messageId, message => ({ ...message, reasoningSummary: mergeSummaries(message.reasoningSummary, [event.summary as ReasoningSummarySegment]) }));
    case 'activity': {
      const activity = event.activity as ToolActivity | undefined;
      if (typeof event.messageId !== 'string' || !activity || typeof activity.id !== 'string') return thread;
      return updateMessage(thread, event.messageId, message => ({ ...message, activities: mergeActivities(message.activities, [activity]) }));
    }
    case 'status': {
      const status = event.status as ThreadStatus;
      if (!statuses.has(status)) return thread;
      return {
        ...thread,
        status,
        error: status === 'running' ? undefined : thread.error,
        pendingApproval: 'pendingApproval' in event ? (event.pendingApproval ?? undefined) as Thread['pendingApproval'] : status === 'awaiting_approval' ? thread.pendingApproval : undefined,
        pendingQuestion: 'pendingQuestion' in event ? (event.pendingQuestion ?? undefined) as Thread['pendingQuestion'] : status === 'awaiting_input' ? thread.pendingQuestion : undefined,
        ...(Array.isArray(event.queuedInput) ? { queuedInput: event.queuedInput as NonNullable<Thread['queuedInput']> } : {}),
      };
    }
    case 'approval': {
      const approval = event.approval as Thread['pendingApproval'];
      return approval ? { ...thread, status: 'awaiting_approval', pendingApproval: approval } : thread;
    }
    case 'question': {
      const question = event.question as Thread['pendingQuestion'];
      return question?.id && Array.isArray(question.questions) ? { ...thread, status: 'awaiting_input', pendingQuestion: question } : thread;
    }
    case 'agent_change': {
      const agent = event.agent as NonNullable<Thread['agents']>[number] | undefined;
      if (!agent?.id || agent.rootThreadId !== (thread.rootThreadId || thread.id)) return thread;
      const agents = new Map((thread.agents ?? []).map(item => [item.id, item]));
      agents.set(agent.id, agent);
      return { ...thread, agents: [...agents.values()] };
    }
    case 'compaction': {
      const compaction = event.compaction as Thread['compaction'];
      return compaction?.id ? { ...thread, compaction, ...(compaction.status === 'running' ? { status: 'compacting' as const } : {}) } : thread;
    }
    case 'usage':
      return { ...thread, ...(event.usage ? { usage: event.usage as Thread['usage'] } : {}), ...(event.contextUsage ? { contextUsage: event.contextUsage as Thread['contextUsage'] } : {}) };
    case 'goal': {
      const goal = event.goal as Thread['goal'];
      if (goal === null) return { ...thread, goal: null };
      if (!goal || goal.threadId !== thread.id) return thread;
      if (thread.goal?.id === goal.id && thread.goal.revision > goal.revision) return thread;
      return { ...thread, goal };
    }
    case 'review': {
      const review = event.review as Thread['review'];
      if (!review?.id) return thread;
      const next = { ...thread, review };
      return review.messageId && review.result ? updateMessage(next, review.messageId, message => ({ ...message, review: review.result, reviewId: review.id })) : next;
    }
    case 'error':
      // Connection notices are shown by each stream owner; they never describe
      // an agent failure or cancel a pending question/approval in saved state.
      if (event.streamOnly === true) return thread;
      return { ...thread, status: 'error', pendingApproval: undefined, pendingQuestion: undefined, error: typeof event.error === 'string' ? event.error : 'The agent encountered an error.' };
    case 'done':
      return { ...thread, status: isThreadBusy(thread) ? 'idle' : thread.status, pendingApproval: undefined, pendingQuestion: undefined };
    default:
      return thread;
  }
}

export function threadSummary(thread: Thread): ThreadSummary {
  const { id, workspaceId, title, createdAt, updatedAt, status } = thread;
  return { id, workspaceId, title, createdAt, updatedAt, status,
    ...(thread.parentThreadId ? { parentThreadId: thread.parentThreadId } : {}),
    ...(thread.rootThreadId ? { rootThreadId: thread.rootThreadId } : {}),
    ...(thread.taskName ? { taskName: thread.taskName } : {}),
    ...(thread.agentRole ? { agentRole: thread.agentRole } : {}),
    ...(thread.archivedAt ? { archivedAt: thread.archivedAt } : {}),
    ...(thread.forkedFrom ? { forkedFrom: thread.forkedFrom } : {}),
  };
}

export function mergeThreadSummary(threads: ThreadSummary[], incoming: ThreadSummary): ThreadSummary[] {
  return [...threads.filter(thread => thread.id !== incoming.id), incoming].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 80);
}

export function mergeChanges(previous: ChangeRecord[], incoming: ChangeRecord[]): ChangeRecord[] {
  const records = new Map(previous.map(record => [record.id, record]));
  for (const record of incoming) records.set(record.id, record);
  return [...records.values()];
}

export function isThreadBusy(thread: Pick<Thread, 'status'> | null): boolean {
  return thread?.status === 'running' || thread?.status === 'awaiting_approval' || thread?.status === 'awaiting_input' || thread?.status === 'compacting';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export function stripAnsi(text: string): string {
  return text.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const previous = document.activeElement as HTMLElement | null;
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  previous?.focus({ preventScroll: true });
  if (!copied) throw new Error('Clipboard access is unavailable in this browser.');
}
