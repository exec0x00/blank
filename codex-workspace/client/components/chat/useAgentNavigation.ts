import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Thread } from '../../../shared/types';
import { api } from '../../api';
import { agentAncestors, agentChildren, verifiedAgentFamily, type AgentFamily } from './agent-navigation';
import { errorMessage } from './state';

/** Read-only family navigation. Lifecycle and message history remain in Codex. */
export function useAgentNavigation({ workspaceId, thread, locked }: { workspaceId: string; thread: Thread | null; locked: boolean }) {
  const enabled = !locked && thread?.workspaceId === workspaceId && thread.backend === 'codex-cli';
  const key = enabled ? JSON.stringify([workspaceId, thread.id, thread.parentThreadId ?? null]) : '';
  const scope = useRef({ workspaceId, thread, locked, key }); scope.current = { workspaceId, thread, locked, key };
  const [state, setState] = useState<{ key: string; family: AgentFamily | null; loading: boolean; error: string | null }>({ key: '', family: null, loading: false, error: null });
  const request = useRef<AbortController | null>(null), generation = useRef(0);
  const completion = useRef<{ key: string; done: Promise<Error | null> } | null>(null);
  const refresh = useCallback(async (rejectOnError = false) => {
    const selected = scope.current;
    if (!selected.key || !selected.thread || selected.locked || document.body.dataset.workspaceLocked === 'true') return;
    if (request.current) {
      // An explicit check can join an in-flight background refresh without
      // issuing another read or hiding its failure behind the request dialog.
      const pending = completion.current;
      if (rejectOnError && pending?.key === selected.key) {
        const failure = await pending.done;
        if (failure && selected.key === scope.current.key && !scope.current.locked && document.body.dataset.workspaceLocked !== 'true') throw failure;
      }
      return;
    }
    const controller = new AbortController(), version = ++generation.current; request.current = controller;
    let finish!: (failure: Error | null) => void, failure: Error | null = null;
    const outcome = { key: selected.key, done: new Promise<Error | null>(resolve => { finish = resolve; }) }; completion.current = outcome;
    const currentScope = () => version === generation.current && selected.key === scope.current.key && !scope.current.locked && document.body.dataset.workspaceLocked !== 'true';
    const current = () => !controller.signal.aborted && currentScope();
    const failed = (error: unknown) => {
      const message = errorMessage(error); failure = new Error(message);
      setState(previous => ({ key: selected.key, family: previous.key === selected.key ? previous.family : null, loading: false, error: message }));
    };
    setState(previous => ({ key: selected.key, family: previous.key === selected.key ? previous.family : null, loading: true, error: null }));
    const timeout = setTimeout(() => {
      if (!current()) return;
      failed(new Error('The agent activity check took too long. Try checking it again.'));
      controller.abort();
    }, 35_000);
    try {
      const ancestors = await agentAncestors(selected.thread, selected.workspaceId, id => api<Thread>('/threads/' + encodeURIComponent(id), { signal: controller.signal }));
      if (current()) {
        const root = ancestors.at(-1)!;
        const incoming = await api<Thread[]>('/threads/' + encodeURIComponent(root.id) + '/agents', { signal: controller.signal });
        if (current()) {
          const family = verifiedAgentFamily(ancestors, incoming, selected.workspaceId);
          setState({ key: selected.key, family, loading: false, error: null });
        }
      }
    } catch (error) {
      if (current()) failed(error);
    } finally {
      clearTimeout(timeout); finish(failure);
      if (completion.current === outcome) completion.current = null;
      if (request.current === controller) request.current = null;
    }
    if (rejectOnError && failure && currentScope()) throw failure;
  }, []);
  useEffect(() => {
    generation.current++; request.current?.abort(); request.current = null;
    setState({ key, family: null, loading: !!key, error: null });
    if (!key) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => { generation.current++; request.current?.abort(); request.current = null; clearInterval(timer); };
  }, [key, refresh]);
  const family = state.key === key && key ? state.family : null;
  const nativeThreads = useMemo(() => agentChildren(family, thread?.id ?? null), [family, thread?.id]);
  return { family, nativeThreads, refresh, loading: state.key === key && state.loading, error: state.key === key ? state.error : null };
}
