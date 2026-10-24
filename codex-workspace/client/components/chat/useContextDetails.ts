import { useCallback, useEffect, useRef, useState } from 'react';
import type { Thread } from '../../../shared/types';
import { api } from '../../api';
import { errorMessage } from './state';
import { agentDescendsFrom } from './agent-navigation';

export interface NativeContextDetails { thread: Thread; children: readonly Thread[] }
export function contextDescendants(thread: Thread, candidates: readonly Thread[]): Thread[] {
  const eligible = new Map(candidates.filter(child => child.id !== thread.id && child.backend === 'codex-cli'
    && child.workspaceId === thread.workspaceId).map(child => [child.id, child]));
  const family = new Map(eligible); family.set(thread.id, thread);
  return [...eligible.values()].filter(child => agentDescendsFrom(child, thread.id, family));
}
interface Options {
  workspaceId: string; thread: Thread | null; nativeThreads: readonly Thread[]; open: boolean; locked: boolean;
  onSnapshot: (thread: Thread) => void;
}
/** Only native per-thread reported usage is displayed. A refresh is a read. */
export function useContextDetails(options: Options) {
  const latest = useRef(options); latest.current = options;
  const key = JSON.stringify([options.workspaceId, options.thread?.id]);
  const [state, setState] = useState({ key, loading: false, error: null as string | null });
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    const current = latest.current, selected = current.thread;
    if (!current.open || current.locked || document.body.dataset.workspaceLocked === 'true' || selected?.backend !== 'codex-cli' || selected.readOnly) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const captured = JSON.stringify([current.workspaceId, selected.id]);
    setState({ key: captured, loading: true, error: null });
    try {
      const incoming = await api<Thread>('/threads/' + encodeURIComponent(selected.id), { signal: controller.signal });
      if (controller.signal.aborted || !latest.current.open || latest.current.locked
        || latest.current.thread?.id !== selected.id || latest.current.workspaceId !== current.workspaceId) return;
      if (incoming.id !== selected.id || incoming.workspaceId !== current.workspaceId || incoming.backend !== 'codex-cli' || !incoming.native) {
        throw new Error('The context report did not match this conversation.');
      }
      // A context refresh reads the whole history view. A live snapshot or a
      // rewind received meanwhile has priority over that older HTTP result.
      if (latest.current.thread === selected) latest.current.onSnapshot(incoming);
      setState({ key: captured, loading: false, error: null });
    } catch (error) {
      if (!controller.signal.aborted && latest.current.thread?.id === selected.id) setState({ key: captured, loading: false, error: errorMessage(error) });
    } finally { if (request.current === controller) request.current = null; }
  }, []);
  useEffect(() => {
    request.current?.abort(); request.current = null; setState({ key, loading: false, error: null });
    if (options.open && !options.locked) void refresh();
    return () => { request.current?.abort(); request.current = null; };
  }, [key, options.open, options.locked, refresh]);
  useEffect(() => {
    const stop = () => { request.current?.abort(); request.current = null; };
    window.addEventListener('codex:session-locked', stop); window.addEventListener('codex:session-expired', stop);
    return () => { stop(); window.removeEventListener('codex:session-locked', stop); window.removeEventListener('codex:session-expired', stop); };
  }, []);
  const current = options.thread, visible = options.open && !options.locked && current?.backend === 'codex-cli'
    && current.workspaceId === options.workspaceId && document.body.dataset.workspaceLocked !== 'true';
  const data: NativeContextDetails | undefined = visible ? { thread: current, children: contextDescendants(current, options.nativeThreads) } : undefined;
  return { data, loading: state.key === key && state.loading, error: state.key === key ? state.error : null, refresh, retry: refresh };
}
