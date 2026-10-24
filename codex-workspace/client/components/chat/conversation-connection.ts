import type { AgentEvent, Thread } from '../../../shared/types';
import { ApiError } from '../../api';

export type ConversationConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
type Stream = Pick<EventSource, 'onopen' | 'onerror' | 'onmessage' | 'addEventListener' | 'removeEventListener' | 'close'>;
const retryable = (error: unknown) => error instanceof TypeError || error instanceof ApiError
  && ([408, 429, 502, 503, 504].includes(error.status) || error.code === 'CODEX_CONNECTION_CHANGED' || error.code === 'REQUEST_TIMEOUT');
const message = (error: unknown) => error instanceof TypeError ? 'The conversation could not be reached. Reconnecting…'
  : error instanceof Error ? error.message : 'The conversation could not be loaded.';

/** Owns browser reads and SSE only. Native requests are never retried here. */
export function connectConversation(options: {
  threadId: string;
  workspaceId: string;
  read(signal: AbortSignal): Promise<Thread>;
  events(): Stream;
  onThread(thread: Thread): void;
  onEvent(event: AgentEvent): void;
  onConnection(state: ConversationConnectionState): void;
  onError(error: string | null): void;
  onNotice(notice: string | null): void;
  onLoading(loading: boolean): void;
  online?: boolean;
  readTimeoutMs?: number;
  heartbeatTimeoutMs?: number;
}) {
  let disposed = false, online = options.online !== false, attempts = 0, confirmed = false;
  let request: AbortController | undefined, source: Stream | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined, retryTimer: ReturnType<typeof setTimeout> | undefined;
  const seen = new Set<string>();
  const cancel = () => {
    const oldRequest = request; request = undefined; oldRequest?.abort();
    const oldSource = source; source = undefined;
    if (oldSource) { oldSource.onopen = null; oldSource.onerror = null; oldSource.onmessage = null; oldSource.close(); }
    clearTimeout(deadline); clearTimeout(retryTimer);
  };
  const matches = (thread: Thread | undefined) => thread?.id === options.threadId
    && thread.workspaceId === options.workspaceId && Array.isArray(thread.messages);
  function disconnected(error: string, retry = false) {
    if (disposed) return;
    cancel(); options.onLoading(false);
    options.onConnection(retry ? 'reconnecting' : 'disconnected'); options.onError(error);
    if (retry && online) retryTimer = setTimeout(refresh, Math.min(10_000, 1000 * 2 ** Math.min(attempts++, 4)));
  }
  function openEvents() {
    if (disposed || !online) return;
    let initialSnapshot = false;
    const stream = options.events(); source = stream;
    const current = () => !disposed && source === stream;
    const fresh = () => {
      clearTimeout(deadline);
      deadline = setTimeout(() => {
        if (!current()) return;
        disconnected(initialSnapshot ? 'Conversation updates stopped arriving. Reconnecting…'
          : 'The live conversation snapshot did not arrive. Reconnecting…', true);
      }, initialSnapshot ? options.heartbeatTimeoutMs ?? 45_000 : options.readTimeoutMs ?? 35_000);
    };
    fresh();
    stream.onopen = () => {
      if (!current()) return;
      initialSnapshot = false; options.onConnection(confirmed ? 'reconnecting' : 'connecting'); fresh();
    };
    stream.onerror = () => {
      if (!current()) return;
      // EventSource owns ordinary reconnection. The freshness deadline also
      // recovers a silently stalled or permanently closed browser transport.
      initialSnapshot = false; options.onConnection('reconnecting');
    };
    stream.addEventListener('heartbeat', () => { if (current() && initialSnapshot) fresh(); });
    stream.onmessage = envelope => {
      if (!current()) return;
      let event: AgentEvent;
      try { event = JSON.parse(envelope.data) as AgentEvent; }
      catch { disconnected('A conversation update could not be read. Reload the conversation to check its current state.'); return; }
      if (!event || typeof event !== 'object' || event.threadId !== options.threadId) return;
      if (event.type === 'snapshot' && !matches(event.thread as Thread | undefined)) {
        disconnected('A conversation update did not match this workspace. Reload the conversation to check its current state.'); return;
      }
      if (event.type === 'error' && event.streamOnly === true) {
        cancel(); options.onConnection('disconnected'); options.onNotice(String(event.error || 'Conversation updates paused.')); return;
      }
      if (envelope.lastEventId && seen.has(envelope.lastEventId)) return;
      if (!initialSnapshot && event.type !== 'snapshot') return;
      if (envelope.lastEventId) { seen.add(envelope.lastEventId); if (seen.size > 2048) seen.delete(seen.values().next().value!); }
      if (event.type === 'snapshot') {
        initialSnapshot = true; confirmed = true; attempts = 0;
        options.onError(null); options.onNotice(null); options.onConnection('connected');
      }
      fresh(); options.onEvent(event);
    };
  }
  function refresh() {
    if (disposed) return;
    cancel();
    if (!online) {
      options.onLoading(false); options.onConnection('reconnecting'); options.onNotice('Your browser is offline. Conversation updates will reconnect when it returns.'); return;
    }
    options.onNotice(null); options.onLoading(!confirmed); options.onConnection(confirmed ? 'reconnecting' : 'connecting');
    const controller = new AbortController(); request = controller;
    const current = () => !disposed && request === controller && !controller.signal.aborted;
    deadline = setTimeout(() => { if (current()) disconnected('The conversation is taking too long to load. Reconnecting…', true); }, options.readTimeoutMs ?? 35_000);
    void Promise.resolve().then(() => current() ? options.read(controller.signal) : undefined).then(thread => {
      if (!current()) return;
      if (!matches(thread)) throw new Error('The conversation did not match this workspace.');
      clearTimeout(deadline);
      options.onThread(thread!); options.onLoading(false); options.onError(null);
      request = undefined;
      if (thread!.backend !== 'codex-cli' || thread!.readOnly || !thread!.native) { options.onConnection('idle'); return; }
      try { openEvents(); } catch (error) { disconnected(message(error)); }
    }).catch(error => { if (current()) disconnected(message(error), retryable(error)); });
  }
  refresh();
  return {
    refresh,
    setOnline(value: boolean) { online = value; refresh(); },
    stop() { disposed = true; cancel(); },
  };
}
