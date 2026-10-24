import { validNavigationId } from './window-navigation';

const channelName = 'codex:workspace-windows:v1';
type WindowNotice = { version: 1; type: 'workspace' | 'thread' | 'runtime' | 'locked'; workspaceId?: string; threadId?: string };
export function validWindowNotice(value: unknown): value is WindowNotice {
  if (!value || typeof value !== 'object') return false;
  const item = value as WindowNotice;
  return item.version === 1 && Object.keys(item).every(key => ['version', 'type', 'workspaceId', 'threadId'].includes(key))
    && (item.type === 'workspace' ? validNavigationId(item.workspaceId) && item.threadId === undefined
      : item.type === 'thread' ? validNavigationId(item.workspaceId) && validNavigationId(item.threadId)
        : (item.type === 'runtime' || item.type === 'locked') && item.workspaceId === undefined && item.threadId === undefined);
}

/** Only invalidations cross windows. Drafts, files, credentials and selection never do. */
export function connectWindowEvents(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  let channel: BroadcastChannel;
  try { channel = new BroadcastChannel(channelName); } catch { return () => undefined; }
  const received = new WeakSet<Event>();
  const relay = (name: string, detail?: unknown) => {
    const event = new CustomEvent(name, { detail }); received.add(event); window.dispatchEvent(event);
  };
  channel.onmessage = event => {
    if (!validWindowNotice(event.data)) return;
    const notice = event.data;
    if (notice.type === 'locked') { relay('codex:session-expired'); return; }
    if (document.body.dataset.workspaceLocked === 'true') return;
    if (notice.type === 'runtime') relay('codex:runtime-changed');
    else relay(notice.type === 'workspace' ? 'codex:workspace-changed' : 'codex:thread-changed',
      { workspaceId: notice.workspaceId, ...(notice.threadId ? { threadId: notice.threadId } : {}), source: 'other-window' });
  };
  const publish = (type: WindowNotice['type']) => (event: Event) => {
    if (received.has(event)) return;
    const detail = (event as CustomEvent<{ workspaceId?: string; threadId?: string }>).detail;
    const notice: WindowNotice = { version: 1, type, ...(type === 'workspace' || type === 'thread' ? { workspaceId: detail?.workspaceId } : {}),
      ...(type === 'thread' ? { threadId: detail?.threadId } : {}) };
    if (validWindowNotice(notice)) channel.postMessage(notice);
  };
  const listeners = [
    ['codex:workspace-changed', publish('workspace')], ['codex:thread-changed', publish('thread')],
    ['codex:runtime-changed', publish('runtime')], ['codex:settings-saved', publish('runtime')],
    ['codex:session-expired', publish('locked')], ['codex:session-ended', publish('locked')],
    ['codex:session-lock-requested', publish('locked')],
  ] as const;
  for (const [name, listener] of listeners) window.addEventListener(name, listener);
  return () => { for (const [name, listener] of listeners) window.removeEventListener(name, listener); channel.close(); };
}
