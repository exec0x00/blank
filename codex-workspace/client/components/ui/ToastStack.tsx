import { useLayoutEffect, useRef } from 'react';
import { Check, CircleAlert, Sparkles, X } from 'lucide-react';

export interface Notice { id: number; message: string; kind: 'error' | 'success' | 'info' }
interface Countdown {
  notice: Notice;
  remaining: number;
  deadline: number | null;
  timer?: number;
  hovered: boolean;
  focused: boolean;
  dismissed: boolean;
  returnFocus: HTMLElement | null;
}

/** Timers belong to the retained queue, not the responsive subset of rows.
 * Pauses consume elapsed time once and ordinary renders never renew a budget. */
export default function ToastStack({ notices, limit = 3, onDismiss }: {
  notices: readonly Notice[]; limit?: 1 | 2 | 3; onDismiss: (id: number) => void;
}) {
  const timers = useRef(new Map<number, Countdown>());
  const dismissRef = useRef(onDismiss); dismissRef.current = onDismiss;
  const visible = notices.slice(-limit);

  function pause(entry: Countdown) {
    if (entry.timer !== undefined) window.clearTimeout(entry.timer);
    if (entry.deadline !== null) entry.remaining = Math.max(0, entry.deadline - performance.now());
    entry.timer = undefined; entry.deadline = null;
  }
  function reconcile(entry: Countdown) {
    if (entry.dismissed || entry.hovered || entry.focused || document.hidden) { pause(entry); return; }
    if (entry.timer !== undefined) return;
    entry.deadline = performance.now() + entry.remaining;
    const timer = window.setTimeout(() => {
      // A replaced record or a timer cancelled by a pause must never dismiss
      // the current notice, even when its old callback was already queued.
      if (timers.current.get(entry.notice.id) !== entry || entry.timer !== timer) return;
      if (entry.hovered || entry.focused || document.hidden) { pause(entry); return; }
      entry.timer = undefined; entry.deadline = null; entry.remaining = 0; entry.dismissed = true;
      dismissRef.current(entry.notice.id);
    }, entry.remaining);
    entry.timer = timer;
  }

  useLayoutEffect(() => {
    const ids = new Set(notices.map(notice => notice.id));
    const visibleIds = new Set(visible.map(notice => notice.id));
    for (const [id, entry] of timers.current) {
      if (!ids.has(id)) { pause(entry); timers.current.delete(id); }
    }
    for (const notice of notices) {
      let entry = timers.current.get(notice.id);
      if (!entry || entry.notice.message !== notice.message || entry.notice.kind !== notice.kind) {
        if (entry) pause(entry);
        entry = { notice, remaining: notice.kind === 'error' ? 10_000 : 3_500, deadline: null,
          hovered: entry?.hovered ?? false, focused: entry?.focused ?? false, dismissed: false, returnFocus: entry?.returnFocus ?? null };
        timers.current.set(notice.id, entry);
      }
      // Removing a responsive row need not emit pointerleave/blur. A hidden
      // row cannot indefinitely retain its old interactive pause.
      if (!visibleIds.has(notice.id)) { entry.hovered = false; entry.focused = false; entry.returnFocus = null; }
      reconcile(entry);
    }
  }, [notices, limit]);

  useLayoutEffect(() => {
    const changed = () => { for (const entry of timers.current.values()) reconcile(entry); };
    document.addEventListener('visibilitychange', changed);
    return () => {
      document.removeEventListener('visibilitychange', changed);
      for (const entry of timers.current.values()) pause(entry);
      timers.current.clear();
    };
  }, []);

  function interaction(id: number, kind: 'hovered' | 'focused', active: boolean) {
    const entry = timers.current.get(id);
    if (!entry) return;
    entry[kind] = active; reconcile(entry);
  }
  function dismiss(notice: Notice, row: HTMLElement | null) {
    const entry = timers.current.get(notice.id);
    if (!entry || entry.dismissed || entry.notice.message !== notice.message || entry.notice.kind !== notice.kind) return;
    pause(entry); entry.dismissed = true;
    const previous = entry.returnFocus;
    // Only explicit dismissal returns focus. Expiry or external replacement
    // must not steal it, and locking never focuses the covered workspace.
    if (row?.contains(document.activeElement) && previous?.isConnected
      && document.body.dataset.workspaceLocked !== 'true' && !previous.matches(':disabled')
      && !previous.closest('[hidden], [inert], [aria-hidden="true"]') && previous.getClientRects().length
      && getComputedStyle(previous).visibility === 'visible') previous.focus({ preventScroll: true });
    dismissRef.current(notice.id);
  }

  return <div className="toast-stack" aria-live="polite" aria-relevant="additions">
    {visible.map(notice => <div className={`toast toast-${notice.kind}`} key={notice.id} role={notice.kind === 'error' ? 'alert' : 'status'}
      onPointerEnter={event => { if (event.pointerType !== 'touch') interaction(notice.id, 'hovered', true); }}
      onPointerLeave={event => { if (event.pointerType !== 'touch') interaction(notice.id, 'hovered', false); }}
      onFocusCapture={event => {
        const entry = timers.current.get(notice.id), previous = event.relatedTarget;
        const focused = event.currentTarget.contains(document.activeElement);
        if (entry && focused && (!(previous instanceof Node) || !event.currentTarget.contains(previous))) entry.returnFocus = previous instanceof HTMLElement ? previous : null;
        interaction(notice.id, 'focused', focused);
      }}
      onBlurCapture={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) interaction(notice.id, 'focused', false); }}>
      {notice.kind === 'success' ? <Check size={17} /> : notice.kind === 'error' ? <CircleAlert size={17} /> : <Sparkles size={17} />}
      <span>{notice.message}</span><button type="button" className="icon-button" onClick={event => dismiss(notice, event.currentTarget.closest('.toast'))} aria-label="Dismiss notification"><X size={15} /></button>
    </div>)}
  </div>;
}
