const IDLE_MS = 850;
const FADE_MS = 180;
const MAX_ACTIVE_ELEMENTS = 128;
const MAX_VIRTUAL_OBSERVERS = 32;
const ATTRIBUTE = 'data-scroll-active';
const AUXILIARY_SCROLLER = '.monaco-scrollable-element:not(.editor-scrollable)';
const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp', 'Home', 'End', ' ']);

interface Activity {
  deadline: number;
  animation?: Animation;
  fading?: boolean;
}

interface ScrollActivity {
  mark(element: Element): void;
  dispose(): void;
}

interface VirtualObservation {
  deadline: number;
  observer: MutationObserver;
}

const installations = new WeakMap<Document, ScrollActivity>();

/** Virtual editors use their actual scroll notification; native panes need no hook. */
export function markScrollActivity(element: Element): void {
  installations.get(element.ownerDocument)?.mark(element);
}

/** Passive listeners and one idle timer serve nested panes without measuring layout. */
export function installScrollActivity(document: Document = window.document): () => void {
  const installed = installations.get(document);
  if (installed) return installed.dispose;
  const window = document.defaultView;
  if (!window) return () => {};

  const active = new Map<Element, Activity>();
  const virtual = new Map<Element, VirtualObservation>();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let timer: number | undefined;
  let disposed = false;
  const now = () => window.performance.now();

  function clear(element: Element, activity: Activity): void {
    activity.animation?.cancel();
    element.removeAttribute(ATTRIBUTE);
    active.delete(element);
  }

  function reset(): void {
    if (timer !== undefined) window!.clearTimeout(timer);
    timer = undefined;
    for (const [element, activity] of active) clear(element, activity);
    for (const observation of virtual.values()) observation.observer.disconnect();
    virtual.clear();
  }

  function schedule(): void {
    if (timer !== undefined || !active.size && !virtual.size) return;
    let deadline = Infinity;
    for (const activity of active.values()) deadline = Math.min(deadline, activity.deadline);
    for (const observation of virtual.values()) deadline = Math.min(deadline, observation.deadline);
    timer = window!.setTimeout(expire, Math.max(0, deadline - now()));
  }

  function expire(): void {
    timer = undefined;
    const time = now();
    for (const [element, observation] of virtual) {
      if (!element.isConnected || observation.deadline <= time) {
        observation.observer.disconnect();
        virtual.delete(element);
      }
    }
    for (const [element, activity] of active) {
      if (!element.isConnected) { clear(element, activity); continue; }
      if (activity.deadline > time) continue;
      if (activity.fading || reducedMotion.matches) { clear(element, activity); continue; }
      // Animate only our registered property. Existing panel transitions and
      // animations are unaffected; neither the scroll geometry nor hitbox changes.
      activity.fading = true;
      activity.deadline = time + FADE_MS;
      if (typeof element.animate === 'function') {
        activity.animation = element.animate([
          { '--codex-scrollbar-opacity': '1' },
          { '--codex-scrollbar-opacity': '0' },
        ], { duration: FADE_MS, easing: 'ease-out' });
      }
      element.removeAttribute(ATTRIBUTE);
    }
    schedule();
  }

  function mark(element: Element): void {
    if (disposed || document.hidden || !element.isConnected || element.ownerDocument !== document) return;
    let activity = active.get(element);
    if (!activity) {
      if (active.size >= MAX_ACTIVE_ELEMENTS) {
        const oldest = active.entries().next().value;
        if (oldest) clear(...oldest);
      }
      activity = { deadline: now() + IDLE_MS };
      active.set(element, activity);
      element.setAttribute(ATTRIBUTE, 'true');
    } else {
      activity.deadline = now() + IDLE_MS;
      if (activity.fading) {
        activity.animation?.cancel();
        activity.animation = undefined;
        activity.fading = false;
        element.setAttribute(ATTRIBUTE, 'true');
      }
    }
    schedule();
  }

  function onScroll(event: Event): void {
    if (!event.isTrusted) return;
    const target = event.target;
    if (target === document) {
      if (document.scrollingElement) mark(document.scrollingElement);
    } else if (target instanceof window!.Element) mark(target);
  }

  function watchVirtual(element: Element): void {
    const existing = virtual.get(element);
    if (existing) { existing.deadline = now() + IDLE_MS; return; }
    const nodes = [...element.querySelectorAll<HTMLElement>(':scope > .scrollbar > .slider, :scope > .monaco-list-rows')];
    if (!nodes.length) return;
    // Monaco does not expose public scroll subscriptions for completion/hover
    // lists. Observe only their position styles, only after relevant input, and
    // only until idle. Resize/hover/class changes never count as scrolling.
    const position = (node: HTMLElement) => `${node.style.top}|${node.style.left}|${node.style.transform}`;
    const positions = new Map(nodes.map(node => [node, position(node)]));
    const observation: VirtualObservation = {
      deadline: now() + IDLE_MS,
      observer: new window!.MutationObserver(records => {
        let moved = false;
        for (const record of records) {
          const node = record.target as HTMLElement;
          const next = position(node);
          if (next !== positions.get(node)) { positions.set(node, next); moved = true; }
        }
        if (moved) { observation.deadline = now() + IDLE_MS; mark(element); }
      }),
    };
    if (virtual.size >= MAX_VIRTUAL_OBSERVERS) {
      const oldest = virtual.entries().next().value;
      if (oldest) { oldest[1].observer.disconnect(); virtual.delete(oldest[0]); }
    }
    virtual.set(element, observation);
    for (const node of nodes) observation.observer.observe(node, { attributes: true, attributeFilter: ['style'] });
    schedule();
  }

  function onVirtualInput(event: Event): void {
    if (!event.isTrusted || disposed || document.hidden || !(event.target instanceof window!.Element)) return;
    if (event instanceof window!.KeyboardEvent) {
      if (!SCROLL_KEYS.has(event.key) || !event.target.closest('.monaco-editor, .monaco-list, .monaco-menu-container')) return;
      // Focus stays in the source textarea while arrows navigate completions.
      // Widgets can also be portalled outside their editor root.
      for (const element of document.querySelectorAll(AUXILIARY_SCROLLER)) watchVirtual(element);
    } else {
      const element = event.target.closest(AUXILIARY_SCROLLER);
      if (element) watchVirtual(element);
    }
  }

  function onVisibility(): void {
    if (document.hidden) reset();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    reset();
    document.removeEventListener('scroll', onScroll, true);
    document.removeEventListener('wheel', onVirtualInput, true);
    document.removeEventListener('pointerdown', onVirtualInput, true);
    document.removeEventListener('keydown', onVirtualInput, true);
    document.removeEventListener('visibilitychange', onVisibility);
    window!.removeEventListener('pagehide', reset);
    document.documentElement.removeAttribute('data-scrollbars');
    installations.delete(document);
  }

  installations.set(document, { mark, dispose });
  document.documentElement.setAttribute('data-scrollbars', 'activity');
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  document.addEventListener('wheel', onVirtualInput, { capture: true, passive: true });
  document.addEventListener('pointerdown', onVirtualInput, { capture: true, passive: true });
  document.addEventListener('keydown', onVirtualInput, { capture: true, passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', reset);
  return dispose;
}
