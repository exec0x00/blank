import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClaudeConversation, ClaudeLiveState, ClaudePermissionRequest, ClaudeStreamEvent } from '../../../shared/claude';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting';
const IDLE: ClaudeLiveState = { running: false, status: 'idle' };

/** Owns one conversation's live event stream, reconnecting with backoff. */
export function useConversation(id: string | null, onDone?: (error?: string) => void) {
  const [conversation, setConversation] = useState<ClaudeConversation | null>(null);
  const [live, setLive] = useState<ClaudeLiveState>(IDLE);
  const [permissions, setPermissions] = useState<ClaudePermissionRequest[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const done = useRef(onDone); done.current = onDone;

  useEffect(() => {
    setConversation(current => current?.id === id ? current : null);
    setPermissions([]); setLive(IDLE); setLoadError(null);
    if (!id) { setConnection('idle'); return; }
    let closed = false, attempts = 0, source: EventSource | null = null, timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (closed) return;
      setConnection(attempts ? 'reconnecting' : 'connecting');
      source = new EventSource(`/api/claude/conversations/${encodeURIComponent(id)}/events`);
      source.onopen = () => { attempts = 0; setConnection('connected'); };
      source.onmessage = message => {
        if (closed) return;
        let event: ClaudeStreamEvent;
        try { event = JSON.parse(message.data); } catch { return; }
        switch (event.type) {
          case 'snapshot': setConversation(event.conversation); setLive(event.live); setPermissions(event.permissions); setLoadError(null); setConnection('connected'); break;
          case 'entry': setConversation(current => {
            if (!current) return current;
            const index = current.entries.findIndex(entry => entry.id === event.entry.id);
            const entries = index >= 0 ? current.entries.map((entry, position) => position === index ? event.entry : entry) : [...current.entries, event.entry];
            return { ...current, entries };
          }); break;
          case 'remove': setConversation(current => current ? { ...current, entries: current.entries.filter(entry => entry.id !== event.id) } : current); break;
          case 'delta': setConversation(current => {
            if (!current) return current;
            return { ...current, entries: current.entries.map(entry => entry.id === event.id && (entry.kind === 'assistant' || entry.kind === 'thinking') ? { ...entry, text: entry.text + event.text } : entry) };
          }); break;
          case 'live': setLive(event.live); break;
          case 'meta': setConversation(current => current ? { ...current, ...event.patch } : current); break;
          case 'permission': setPermissions(current => [...current.filter(item => item.id !== event.request.id), event.request]); break;
          case 'permission_resolved': setPermissions(current => current.filter(item => item.id !== event.id)); break;
          case 'done': setLive(IDLE); setPermissions([]); done.current?.(event.error); break;
        }
      };
      source.onerror = () => {
        source?.close(); source = null;
        if (closed) return;
        attempts++;
        setConnection('reconnecting');
        if (attempts > 3) {
          // A missing conversation returns an error immediately on every retry.
          void fetch(`/api/claude/conversations/${encodeURIComponent(id)}`, { credentials: 'same-origin' }).then(response => {
            if (response.status === 404 && !closed) { setLoadError('This conversation no longer exists.'); closed = true; }
            if (response.status === 401) window.dispatchEvent(new CustomEvent('codex:session-expired'));
          }).catch(() => undefined);
        }
        timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** Math.min(attempts, 5)));
      };
    };
    // A saved selection can point at a conversation that no longer exists.
    void fetch(`/api/claude/conversations/${encodeURIComponent(id)}`, { credentials: 'same-origin' }).then(response => {
      if (closed) return;
      if (response.status === 404 || response.status === 400) { setLoadError('This conversation no longer exists.'); closed = true; return; }
      connect();
    }, () => { if (!closed) connect(); });
    return () => { closed = true; source?.close(); clearTimeout(timer); };
  }, [id, revision]);

  const reconnect = useCallback(() => setRevision(value => value + 1), []);
  return { conversation, setConversation, live, permissions, connection, loadError, reconnect };
}
