import { cloneElement, Fragment, isValidElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode, type Ref, type RefObject } from 'react';
import { anchorAt, anchorOffset, indexAt, mountedIndices, offsetForKey, visibleWindow, windowLayout, type WindowAlignment, type WindowAnchor, type WindowLayout } from './window-layout';
import './measured-window.css';

const END_TOLERANCE = 0.5;

export interface MeasuredRange {
  start: number;
  end: number;
  firstKey: string | null;
  lastKey: string | null;
  pinnedKeys: ReadonlySet<string>;
  /** Optional source-entry keys represented by the visible first/last rows. */
  viewportKeys?: ReadonlySet<string>;
  atStart: boolean;
  atEnd: boolean;
}
export interface MeasuredWindowHandle {
  capture: () => void;
  jumpToEnd: () => void;
  jumpToStart: () => void;
  jumpToKey: (key: string, align?: WindowAlignment) => boolean;
}
export interface MeasuredWindowProps<T> {
  items: readonly T[];
  itemKey: (item: T) => string;
  estimateHeight: (item: T) => number;
  renderItem: (item: T, index: number) => ReactNode;
  itemClassName?: (item: T, index: number) => string;
  scrollRef: RefObject<HTMLElement | null>;
  resetKey: string;
  initialEdge?: 'start' | 'end';
  followRef?: RefObject<boolean>;
  handleRef?: RefObject<MeasuredWindowHandle | null>;
  onRangeChange?: (range: MeasuredRange) => void;
  overscan?: number;
}

function MeasuredItem({ children, rowKey, className = '', measure }: { children: ReactNode; rowKey: string; className?: string; measure: (key: string, node: HTMLElement | null) => void }) {
  const originalRef = isValidElement(children) && typeof children.type === 'string' ? (children.props as { ref?: Ref<HTMLElement> }).ref : undefined;
  const ref = useCallback((node: HTMLElement | null) => {
    measure(rowKey, node);
    if (typeof originalRef === 'function') {
      const cleanup = originalRef(node);
      if (typeof cleanup === 'function') return () => { measure(rowKey, null); cleanup(); };
    } else if (originalRef) originalRef.current = node;
  }, [rowKey, measure, originalRef]);
  // Keep native message/article elements in the existing flow. Components that
  // render several nodes get one small measuring container, never a hidden copy.
  if (isValidElement(children) && typeof children.type === 'string') {
    const child = children as ReactElement<{ className?: string; style?: CSSProperties }>;
    return cloneElement(child, { ref, 'data-window-key': rowKey, className: `${child.props.className ?? ''} measured-window-row ${className}` } as Record<string, unknown>);
  }
  return <div ref={ref} data-window-key={rowKey} className={`measured-window-row measured-window-container ${className}`}>{children}</div>;
}

/** Dynamic-height windowing shared by root/child conversations and the chooser. */
export function MeasuredWindow<T>({ items, itemKey, estimateHeight, renderItem, itemClassName, scrollRef, resetKey, initialEdge = 'start', followRef, handleRef, onRangeChange, overscan = 500 }: MeasuredWindowProps<T>) {
  const marker = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const heights = useRef(new Map<string, number>());
  const anchor = useRef<WindowAnchor | null>(null);
  const pinned = useRef(new Set<string>());
  const focusOrigin = useRef<string | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const recordSizes = useRef<(() => boolean) | null>(null);
  const pendingJump = useRef<{ key: string; align: WindowAlignment; passes: number } | null>(null);
  const frame = useRef(0);
  const appliedScroll = useRef<number | null>(null);
  const pendingReset = useRef(true);
  const priorReset = useRef(resetKey);
  const measuredWidth = useRef(0);
  const [measurement, setMeasurement] = useState(0);
  const [viewport, setViewport] = useState({ top: initialEdge === 'end' ? Number.MAX_SAFE_INTEGER : 0, height: 700 });
  const latest = useRef({ onRangeChange, followRef });
  latest.current = { onRangeChange, followRef };
  if (priorReset.current !== resetKey) {
    priorReset.current = resetKey;
    heights.current.clear(); anchor.current = null; pinned.current.clear(); focusOrigin.current = null; pendingJump.current = null; appliedScroll.current = null; pendingReset.current = true;
  }
  const keys = useMemo(() => items.map(itemKey), [items, itemKey]);
  const layout = useMemo(() => windowLayout(keys, heights.current, index => estimateHeight(items[index])), [keys, items, estimateHeight, measurement, resetKey]);
  const layoutRef = useRef<WindowLayout>(layout);
  const range = visibleWindow(layout, Math.min(viewport.top, Math.max(0, layout.total - viewport.height)), viewport.height, overscan);
  const indices = mountedIndices(layout, range.start, range.end, pinned.current);

  const origin = useCallback(() => {
    const scroller = scrollRef.current, start = marker.current;
    return scroller && start ? start.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop : 0;
  }, [scrollRef]);

  const capture = useCallback((preserveAnchor = false) => {
    const scroller = scrollRef.current;
    if (!scroller || scroller.clientHeight <= 0) return;
    const top = scroller.scrollTop - origin();
    if (!preserveAnchor) anchor.current = anchorAt(layoutRef.current, top);
    setViewport(previous => Math.abs(previous.top - top) < 0.5 && previous.height === scroller.clientHeight ? previous : { top, height: scroller.clientHeight });
  }, [origin, scrollRef]);

  const captureNativeScroll = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller?.clientHeight || appliedScroll.current === scroller.scrollTop) return;
    appliedScroll.current = null;
    anchor.current = anchorAt(layoutRef.current, scroller.scrollTop - origin());
    if (latest.current.followRef?.current && scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop >= END_TOLERANCE) latest.current.followRef.current = false;
  }, [origin, scrollRef]);

  const schedule = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => { frame.current = 0; capture(appliedScroll.current === scrollRef.current?.scrollTop); });
  }, [capture, scrollRef]);

  const measure = useCallback((key: string, node: HTMLElement | null) => {
    const previous = nodes.current.get(key);
    if (previous) observer.current?.unobserve(previous);
    if (!node) { nodes.current.delete(key); return; }
    nodes.current.set(key, node);
    observer.current?.observe(node);
  }, []);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const recordSize = () => {
      if (!scroller.clientHeight) return false;
      let changed = false;
      for (const [key, node] of nodes.current) {
        const style = getComputedStyle(node);
        const height = Math.max(1, node.getBoundingClientRect().height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0));
        if (Math.abs((heights.current.get(key) ?? 0) - height) > 0.5) { heights.current.set(key, height); changed = true; }
      }
      if (changed) setMeasurement(value => value + 1);
      else schedule();
      return changed;
    };
    const resized = () => {
      if (scroller.clientWidth && measuredWidth.current !== scroller.clientWidth) {
        measuredWidth.current = scroller.clientWidth;
        heights.current.clear();
      }
      recordSize();
    };
    recordSizes.current = recordSize;
    observer.current = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resized);
    observer.current?.observe(scroller);
    for (const node of nodes.current.values()) observer.current?.observe(node);
    const protectInteraction = () => {
      // Focusing an offscreen control can scroll before the browser dispatches
      // its scroll event. Preserve that position before pinning causes a render.
      captureNativeScroll();
      const next = new Set<string>();
      const active = document.activeElement;
      let focusedKey: string | null = null;
      if (active instanceof Element) {
        let node = active.closest<HTMLElement>('[data-window-key]');
        while (node) {
          if (nodes.current.get(node.dataset.windowKey!) === node) { focusedKey = node.dataset.windowKey!; next.add(focusedKey); break; }
          node = node.parentElement?.closest<HTMLElement>('[data-window-key]') ?? null;
        }
        if (focusedKey) focusOrigin.current = focusedKey;
        else if (active.closest('[role="dialog"], [role="menu"], [role="listbox"]') && focusOrigin.current) next.add(focusOrigin.current);
        else focusOrigin.current = null;
      }
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.rangeCount) {
        const selected = selection.getRangeAt(0);
        for (const [key, node] of nodes.current) {
          try { if (selected.intersectsNode(node)) next.add(key); } catch { /* A detached selection is no longer a visible interaction. */ }
        }
      }
      if (next.size !== pinned.current.size || [...next].some(key => !pinned.current.has(key))) {
        pinned.current = next;
        setMeasurement(value => value + 1);
      }
    };
    const scrolled = () => {
      if (!scroller.clientHeight) return;
      // Capture user intent before a live React update can commit in this frame.
      captureNativeScroll();
      schedule();
    };
    const userNavigation = () => { pendingJump.current = null; };
    scroller.addEventListener('scroll', scrolled, { passive: true });
    scroller.addEventListener('wheel', userNavigation, { passive: true });
    scroller.addEventListener('pointerdown', userNavigation, { passive: true });
    scroller.addEventListener('keydown', userNavigation, true);
    document.addEventListener('focusin', protectInteraction);
    document.addEventListener('selectionchange', protectInteraction);
    window.addEventListener('resize', resized);
    protectInteraction();
    recordSize();
    return () => {
      if (recordSizes.current === recordSize) recordSizes.current = null;
      observer.current?.disconnect(); observer.current = null;
      cancelAnimationFrame(frame.current); frame.current = 0;
      scroller.removeEventListener('scroll', scrolled);
      scroller.removeEventListener('wheel', userNavigation);
      scroller.removeEventListener('pointerdown', userNavigation);
      scroller.removeEventListener('keydown', userNavigation, true);
      document.removeEventListener('focusin', protectInteraction);
      document.removeEventListener('selectionchange', protectInteraction);
      window.removeEventListener('resize', resized);
    };
  }, [scrollRef, schedule, resetKey, captureNativeScroll]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !scroller.clientHeight) { layoutRef.current = layout; return; }
    captureNativeScroll();
    // Margins can change on prepend without changing a ResizeObserver box.
    const sizesChanged = recordSizes.current?.() ?? false;
    const first = pendingReset.current && items.length > 0;
    const previousAnchor = anchor.current;
    layoutRef.current = layout;
    let preserveAnchor = false;
    if (pendingJump.current) {
      const jump = pendingJump.current;
      const target = offsetForKey(layout, jump.key, scroller.scrollTop - origin(), scroller.clientHeight, jump.align);
      if (target !== null) scroller.scrollTop = jump.align === 'start' ? Math.ceil(origin() + target) : origin() + target;
      if (target === null || ++jump.passes >= 8 || !sizesChanged && nodes.current.has(jump.key) && heights.current.has(jump.key)) pendingJump.current = null;
    } else if (first) {
      pendingReset.current = false;
      scroller.scrollTop = initialEdge === 'end' ? scroller.scrollHeight : 0;
    } else if (latest.current.followRef?.current) scroller.scrollTop = scroller.scrollHeight;
    else {
      const target = anchorOffset(layout, previousAnchor);
      if (target !== null && previousAnchor) {
        scroller.scrollTop = origin() + target;
        anchor.current = 'edge' in previousAnchor
          ? { edge: 'after', offset: target - layout.total }
          : { key: previousAnchor.key, offset: target - layout.offsets[layout.indices.get(previousAnchor.key)!] };
        preserveAnchor = true;
      }
    }
    // Correction scrolls must not replace a reading anchor with an estimated
    // predecessor newly inserted above it. Native movement releases this guard.
    appliedScroll.current = scroller.scrollTop;
    // Do not hold a transcript's entire measurement history in a long-lived tab.
    const resident = new Set(keys);
    for (const key of heights.current.keys()) if (!resident.has(key)) heights.current.delete(key);
    capture(preserveAnchor);
  });

  useLayoutEffect(() => {
    if (!handleRef) return;
    const jump = (edge: 'start' | 'end') => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      pendingJump.current = null;
      if (latest.current.followRef) latest.current.followRef.current = edge === 'end';
      scroller.scrollTop = edge === 'end' ? scroller.scrollHeight : 0;
      appliedScroll.current = scroller.scrollTop;
      capture();
    };
    const jumpToKey = (key: string, align: WindowAlignment = 'nearest') => {
      const scroller = scrollRef.current;
      if (!scroller || !scroller.clientHeight) return false;
      const target = offsetForKey(layoutRef.current, key, scroller.scrollTop - origin(), scroller.clientHeight, align);
      if (target === null) return false;
      if (latest.current.followRef) latest.current.followRef.current = false;
      pendingReset.current = false;
      pendingJump.current = { key, align, passes: 0 };
      // Scrollers round fractional positions; rounding back can retain the
      // preceding logical row even with zero overscan at a requested start.
      scroller.scrollTop = align === 'start' ? Math.ceil(origin() + target) : origin() + target;
      appliedScroll.current = scroller.scrollTop;
      capture();
      return true;
    };
    const handle = { capture, jumpToEnd: () => jump('end'), jumpToStart: () => jump('start'), jumpToKey };
    handleRef.current = handle;
    return () => { if (handleRef.current === handle) handleRef.current = null; };
  }, [handleRef, scrollRef, capture, origin]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !scroller.clientHeight) return;
    const first = indexAt(layout, Math.max(0, viewport.top));
    const last = indexAt(layout, Math.max(0, viewport.top) + viewport.height);
    latest.current.onRangeChange?.({ ...range, firstKey: keys[first] ?? null, lastKey: keys[last] ?? null, pinnedKeys: new Set(pinned.current),
      // A near-end threshold recaptures the first small native PageUp step.
      // Resume following only when the viewport actually reaches the tail.
      atStart: scroller.scrollTop < 220, atEnd: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop < END_TOLERANCE });
  }, [layout, range.start, range.end, viewport, keys, scrollRef, measurement]);

  let prior = 0;
  return <><div ref={marker} className="measured-window-origin" aria-hidden="true" />{indices.map(index => {
    const gap = layout.offsets[index] - layout.offsets[prior];
    prior = index + 1;
    return <Fragment key={keys[index]}>{gap > 0 && <div className="measured-window-space" style={{ height: gap }} aria-hidden="true" />}
      <MeasuredItem rowKey={keys[index]} className={itemClassName?.(items[index], index)} measure={measure}>{renderItem(items[index], index)}</MeasuredItem>
    </Fragment>;
  })}{layout.total > layout.offsets[prior] && <div className="measured-window-space" style={{ height: layout.total - layout.offsets[prior] }} aria-hidden="true" />}</>;
}
