import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const modalStack: Array<{ id: symbol; element: HTMLDivElement }> = [];
const focusableSelector = 'button, a[href], input:not([type="hidden"]), select, textarea, [tabindex], [contenteditable="true"]';
function rendered(element: HTMLElement): boolean {
  if (!element.isConnected || element.matches(':disabled') || element.closest('[hidden], [inert], [aria-hidden="true"]') || !element.getClientRects().length) return false;
  const style = getComputedStyle(element);
  return style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.display !== 'none';
}
function focusable(element: HTMLElement): HTMLElement[] {
  return Array.from(element.querySelectorAll<HTMLElement>(focusableSelector)).filter(item => item.tabIndex >= 0 && rendered(item));
}
function focus(element: HTMLElement) { element.focus({ preventScroll: true }); }

interface ModalProps {
  open: boolean;
  title: string;
  titleId: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  description?: string;
}

export default function Modal({ open, title, titleId, onClose, children, className = '', description }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [sessionLocked, setSessionLocked] = useState(typeof document !== 'undefined' && document.body.dataset.workspaceLocked === 'true');
  const lockedRef = useRef(sessionLocked); lockedRef.current = sessionLocked;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    setSessionLocked(document.body.dataset.workspaceLocked === 'true');
    const locked = () => { lockedRef.current = true; setSessionLocked(true); };
    const unlocked = () => { lockedRef.current = false; setSessionLocked(false); };
    window.addEventListener('codex:session-locked', locked);
    window.addEventListener('codex:session-expired', locked);
    window.addEventListener('codex:session-unlocked', unlocked);
    return () => { window.removeEventListener('codex:session-locked', locked); window.removeEventListener('codex:session-expired', locked); window.removeEventListener('codex:session-unlocked', unlocked); };
  }, []);
  useEffect(() => {
    if (!open || sessionLocked || !dialogRef.current) return;
    const element = dialogRef.current;
    const stackId = Symbol('workspace-dialog');
    modalStack.push({ id: stackId, element });
    const previousFocus = document.activeElement as HTMLElement | null;
    const returnContainers: HTMLElement[] = [];
    for (let parent = previousFocus?.parentElement; parent && parent !== document.body; parent = parent.parentElement) returnContainers.push(parent);
    let lastInside: HTMLElement | null = null;
    const ownsStack = () => modalStack.at(-1)?.id === stackId;
    // Custom dropdowns use body portals. Their explicit aria-controls link
    // keeps them in this dialog's keyboard scope without admitting foreign UI.
    function ownedPopovers(): HTMLElement[] {
      const surfaces = new Set<HTMLElement>();
      for (const control of element.querySelectorAll<HTMLElement>('[aria-controls]')) {
        for (const id of (control.getAttribute('aria-controls') ?? '').split(/\s+/)) {
          const surface = document.getElementById(id)?.closest<HTMLElement>('[data-codex-dropdown="true"]');
          if (surface && rendered(surface)) surfaces.add(surface);
        }
      }
      return [...surfaces];
    }
    const containsFocus = (node: Node | null) => element.contains(node) || ownedPopovers().some(surface => surface.contains(node));
    function enter() {
      if (!ownsStack() || lockedRef.current || document.body.dataset.workspaceLocked === 'true') return;
      const preferred = Array.from(element.querySelectorAll<HTMLElement>('[data-autofocus]')).find(rendered);
      const candidates = focusable(element);
      focus(preferred ?? candidates.find(item => item.getAttribute('aria-label') !== 'Close dialog') ?? candidates[0] ?? element);
    }
    const frame = requestAnimationFrame(() => {
      // A new top dialog, hidden control or disabled request cannot strand focus outside.
      enter();
    });
    const handleKey = (event: KeyboardEvent) => {
      if (!ownsStack()) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const items = [...focusable(element), ...ownedPopovers().flatMap(focusable)];
      if (!items.length) { focus(element); event.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === element || !containsFocus(active))) { focus(last); event.preventDefault(); }
      else if (!event.shiftKey && (active === last || active === element || !containsFocus(active))) { focus(first); event.preventDefault(); }
    };
    const handleFocus = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && containsFocus(target)) { lastInside = target; return; }
      if (!ownsStack() || lockedRef.current || document.body.dataset.workspaceLocked === 'true') return;
      if (lastInside && rendered(lastInside)) focus(lastInside); else enter();
    };
    document.addEventListener('keydown', handleKey, true);
    document.addEventListener('focusin', handleFocus, true);
    return () => {
      cancelAnimationFrame(frame); document.removeEventListener('keydown', handleKey, true); document.removeEventListener('focusin', handleFocus, true);
      const wasTop = ownsStack(), active = document.activeElement;
      const ownedFocus = containsFocus(active) || active === document.body && lastInside !== null;
      const index = modalStack.findIndex(item => item.id === stackId); if (index >= 0) modalStack.splice(index, 1);
      if (!wasTop || !ownedFocus || lockedRef.current || document.body.dataset.workspaceLocked === 'true') return;
      const top = modalStack.at(-1)?.element;
      if (previousFocus && rendered(previousFocus) && (!top || top.contains(previousFocus))) { focus(previousFocus); return; }
      // If the opener disappeared, retain the parent dialog's context. Its
      // view can restore a meaningful control after any pending refresh.
      if (top) { focus(top); return; }
      // Native requests can disappear after acknowledgment. Restore within the
      // nearest surviving original container, without stealing an existing focus.
      for (const container of returnContainers) {
        if (!container.isConnected) continue;
        const target = focusable(container)[0];
        if (target) { focus(target); return; }
      }
    };
  }, [open, sessionLocked]);
  if (!open || sessionLocked) return null;
  return createPortal(<div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? `${titleId}-description` : undefined} tabIndex={-1}>
      <div className="modal-heading"><div><h2 id={titleId} className="text-ellipsis" data-tooltip={title}>{title}</h2>{description && <p id={`${titleId}-description`}>{description}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={19} /></button></div>
      {children}
    </div>
  </div>, document.body);
}
