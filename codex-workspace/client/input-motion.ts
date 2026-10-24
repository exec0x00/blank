import { CARET_BLINK_DELAY_MS, CARET_BLINK_HALF_CYCLE_MS, MAX_CARET_TEXT, clipCaret, layoutInputCaret, type CaretLayout } from './input-motion-layout';

type TextField = HTMLInputElement | HTMLTextAreaElement;
const ACTIVE = 'data-input-motion-active';
const TEXT_TYPES = new Set(['text', 'search', 'url', 'tel']);
const installations = new WeakMap<Document, () => void>();
const number = (value: string) => Number.parseFloat(value) || 0;

/**
 * One passive document controller handles existing, lazy and portalled fields.
 * It never changes a value, selection, type, tab order or editing event, and it
 * never mirrors text into DOM/attributes. Monaco/xterm own their actual cursors.
 */
export function installInputMotion(document: Document = window.document): () => void {
  const existing = installations.get(document);
  if (existing) return existing;
  const window = document.defaultView;
  if (!window) return () => {};
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const canvas = document.createElement('canvas');
  let context: CanvasRenderingContext2D | null;
  try { context = canvas.getContext('2d'); } catch { return () => {}; }
  if (!context) return () => {};
  const layer = document.createElement('span');
  layer.className = 'cw-input-motion-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.setAttribute('inert', '');
  layer.hidden = true;
  const caret = document.createElement('span');
  caret.className = 'cw-input-motion-caret';
  const bar = document.createElement('span');
  bar.className = 'cw-input-motion-bar';
  caret.append(bar);
  layer.append(caret);
  // A manual, inert popover keeps the decorative caret above native <dialog>
  // without stealing focus or inheriting its opening transform. No backdrop UI.
  const topLayer = typeof layer.showPopover === 'function';
  if (topLayer) layer.setAttribute('popover', 'manual');

  let active: TextField | null = null;
  let composing = false;
  let pointerSelecting = false;
  let disposed = false;
  let suspended = false;
  let frame = 0;
  let settleUntil = 0;
  let snap = true;
  let resetBlink = true;
  let blink: Animation | undefined;
  let lastGeometry = '';
  let lastSelection = '';
  let lastViewport = '';
  let lastLine: number | undefined;
  // A field that was private stays native if a reveal control changes its type.
  // These weak identities never retain or inspect the secret itself.
  const privateFields = new WeakSet<TextField>();
  // Only the focused, ordinary field has a bounded measurement cache.
  // Switching/locking clears the cache immediately.
  let measured: { text: string; key: string; point: CaretLayout } | undefined;
  const resize = new window.ResizeObserver(() => schedule());
  const attributes = new window.MutationObserver(records => {
    if (records.some(record => {
      if (record.target === layer || layer.contains(record.target)) return false;
      if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(node => node === layer || layer.contains(node))) return false;
      return true;
    })) schedule();
  });

  function field(value: EventTarget | null): TextField | null {
    if (!(value instanceof window!.HTMLInputElement) && !(value instanceof window!.HTMLTextAreaElement)) return null;
    if ((value instanceof window!.HTMLInputElement && value.type === 'password')
      || /(?:^|\s)(?:current-password|new-password|one-time-code)(?:\s|$)/.test(value.autocomplete)
      || value.closest('[data-private-input="true"]')) privateFields.add(value);
    if (privateFields.has(value)) return null;
    if (value instanceof window!.HTMLInputElement && !TEXT_TYPES.has(value.type)) return null;
    if (value.disabled || value.readOnly || value.getAttribute('aria-readonly') === 'true'
      || value.closest('[inert], [data-input-motion="off"], [data-private-input="true"]') || value.getAttribute('aria-hidden') === 'true'
      || value.matches('.monaco-editor textarea.inputarea, .xterm-helper-textarea') || value.closest('.xterm')) return null;
    return value;
  }

  function hide(): void {
    active?.removeAttribute(ACTIVE);
    layer.hidden = true;
    if (topLayer && layer.matches(':popover-open')) layer.hidePopover();
    blink?.cancel();
    blink = undefined;
    measured = undefined;
    lastGeometry = '';
    lastViewport = '';
    lastLine = undefined;
  }

  function startBlink(): void {
    blink?.cancel();
    blink = undefined;
    if (motion.matches || typeof bar.animate !== 'function') return;
    // Same keyframes, delay and finite idle cycle as Monaco's smooth cursor.
    blink = bar.animate([
      { opacity: 1, offset: 0, easing: 'ease-in-out' },
      { opacity: 1, offset: .2, easing: 'ease-in-out' },
      { opacity: 0, offset: .6, easing: 'ease-in-out' },
      { opacity: 0, offset: 1 },
    ], {
      delay: CARET_BLINK_DELAY_MS, duration: CARET_BLINK_HALF_CYCLE_MS,
      easing: 'linear', direction: 'alternate', iterations: 20,
    });
  }

  function activate(): void {
    const next = field(document.activeElement);
    if (next === active) return;
    hide();
    resize.disconnect();
    attributes.disconnect();
    active = next;
    composing = false;
    pointerSelecting = false;
    lastSelection = '';
    measured = undefined;
    if (!active) return;
    let ancestor: Element | null = active;
    for (let count = 0; ancestor && count < 32; count++, ancestor = ancestor.parentElement) resize.observe(ancestor);
    // A sibling can move a same-sized field without triggering its ResizeObserver.
    // One observer exists only while a field is focused; frame scheduling coalesces
    // streamed/React updates, ignores our own writes and reuses text measurements.
    attributes.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'type', 'disabled', 'readonly', 'dir', 'wrap', 'value', 'autocomplete', 'data-input-motion', 'data-private-input'] });
    attributes.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'dir'] });
    // Capture dialog/pane entrance motion without a permanently running loop.
    settleUntil = window!.performance.now() + 240;
    schedule(true, true);
  }

  function schedule(immediate = false, restart = false): void {
    if (disposed || suspended) return;
    snap ||= immediate;
    resetBlink ||= restart;
    if (!frame) frame = window!.requestAnimationFrame(render);
  }

  function render(): void {
    frame = 0;
    if (disposed || suspended) return;
    if (active !== document.activeElement) activate();
    const target = active;
    if (!target || !target.isConnected || !field(target) || document.hidden || !document.hasFocus() || composing || pointerSelecting
      || target.selectionStart === null || target.selectionEnd === null || target.selectionStart !== target.selectionEnd) { hide(); return; }
    const start = window!.performance.now();
    const style = window!.getComputedStyle(target);
    const rect = target.getBoundingClientRect();
    if (style.visibility !== 'visible' || style.direction !== 'ltr' || style.writingMode !== 'horizontal-tb'
      || style.textTransform !== 'none' || rect.width < 1 || rect.height < 1 || target.value.length > MAX_CARET_TEXT) { hide(); return; }
    // On older browsers without the top layer API, leave transformed dialogs to
    // their native caret rather than positioning an inaccurate second cursor.
    if (!topLayer && target.closest('dialog[open]')) { hide(); return; }
    const multiline = target instanceof window!.HTMLTextAreaElement;
    const scaleX = target.offsetWidth ? rect.width / target.offsetWidth : 1;
    const scaleY = target.offsetHeight ? rect.height / target.offsetHeight : 1;
    const paddingLeft = number(style.paddingLeft);
    const paddingRight = number(style.paddingRight);
    const paddingTop = number(style.paddingTop);
    const paddingBottom = number(style.paddingBottom);
    const width = target.clientWidth - paddingLeft - paddingRight;
    const innerHeight = target.clientHeight - paddingTop - paddingBottom;
    const fontSize = number(style.fontSize);
    const lineHeight = number(style.lineHeight) || fontSize * 1.2;
    if (width <= 0 || innerHeight <= 0 || lineHeight <= 0) { hide(); return; }
    context!.font = style.font || `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    context!.direction = 'ltr';
    context!.fontKerning = style.fontKerning as CanvasFontKerning;
    // A native caret follows the font box, not the extra leading between lines.
    // Keep the probe constant so empty drafts, glyphs and password masks cannot
    // change its height. Browsers without reliable metrics retain their caret.
    const fontMetrics = context!.measureText('Mg');
    const fontHeight = fontMetrics.fontBoundingBoxAscent + fontMetrics.fontBoundingBoxDescent;
    if (!Number.isFinite(fontHeight) || fontMetrics.fontBoundingBoxAscent <= 0
      || fontMetrics.fontBoundingBoxDescent < 0 || fontHeight <= 0) { hide(); return; }
    // Modern canvas spacing properties avoid per-character rounding/shaping.
    const canvasSpacing = context as CanvasRenderingContext2D & { letterSpacing?: string; wordSpacing?: string };
    const letterSpacing = number(style.letterSpacing);
    const nativeSpacing = 'letterSpacing' in context!;
    if (nativeSpacing) canvasSpacing.letterSpacing = `${letterSpacing}px`;
    if ('wordSpacing' in context!) canvasSpacing.wordSpacing = style.wordSpacing === 'normal' ? '0px' : style.wordSpacing;
    const value = { text: target.value, position: target.selectionStart };
    const wrap = multiline && (target as HTMLTextAreaElement).wrap !== 'off' && style.whiteSpace !== 'pre';
    const measureKey = `${value.position}:${width}:${multiline}:${wrap}:${context!.font}:${style.fontKerning}:${style.letterSpacing}:${style.wordSpacing}:${style.tabSize}:${style.textAlign}`;
    const point = measured?.text === value.text && measured.key === measureKey ? measured.point : layoutInputCaret({
      ...value, width, multiline,
      wrap,
      tabSize: number(style.tabSize) || 8, align: style.textAlign,
      measure: text => context!.measureText(text).width + (nativeSpacing ? 0 : Math.max(0, [...text].length) * letterSpacing),
      canContinue: () => window!.performance.now() - start < 8,
    });
    if (!point) { hide(); return; }
    measured = { text: value.text, key: measureKey, point };
    const height = Math.min(fontHeight, multiline ? lineHeight : innerHeight);
    const x = paddingLeft + number(style.textIndent) + point.x - target.scrollLeft;
    const y = paddingTop + (multiline
      ? point.line * lineHeight + Math.floor((lineHeight - height) / 2) - target.scrollTop
      : Math.floor((innerHeight - height) / 2));
    const fieldLeft = rect.left + target.clientLeft * scaleX;
    const fieldTop = rect.top + target.clientTop * scaleY;
    // Native text carets settle on the physical pixel grid. Keep a thin stroke
    // sharp by aligning both the popover origin and the caret within its layer.
    const pixels = window!.devicePixelRatio || 1;
    const left = Math.round(fieldLeft * pixels) / pixels;
    const top = Math.round(fieldTop * pixels) / pixels;
    const geometry = clipCaret(
      Math.round((fieldLeft + x * scaleX) * pixels) / pixels - left,
      Math.round((fieldTop + y * scaleY) * pixels) / pixels - top,
      height * scaleY, target.clientWidth * scaleX, target.clientHeight * scaleY, scaleX,
    );
    if (!geometry) { hide(); return; }
    // Native scrolling can also move the whole field outside an ancestor pane.
    const edgeLeft = left + geometry.x;
    const edgeRight = Math.min(left + target.clientWidth * scaleX, edgeLeft + geometry.width);
    const edgeTop = top + geometry.y;
    const edgeBottom = edgeTop + geometry.height;
    // The top layer escapes ancestor overflow. If any painted corner is clipped
    // or covered, preserve the correctly clipped native caret instead of bleeding
    // a partial caret into a neighboring pane or modal.
    if (edgeLeft < 0 || edgeRight > window!.innerWidth || edgeTop < 0 || edgeBottom > window!.innerHeight
      || [edgeLeft + .1, edgeRight - .1].some(x => [edgeTop + .1, edgeBottom - .1].some(y => document.elementFromPoint(x, y) !== target))) { hide(); return; }
    const wasHidden = layer.hidden;
    if (!layer.isConnected) document.body.append(layer);
    layer.hidden = false;
    if (topLayer && !layer.matches(':popover-open')) {
      try { layer.showPopover(); } catch { hide(); return; }
    }
    const viewportKey = `${left}:${top}:${target.clientWidth}:${target.clientHeight}:${target.scrollLeft}:${target.scrollTop}:${paddingLeft}:${paddingTop}:${paddingRight}:${paddingBottom}:${lineHeight}:${fontHeight}:${scaleX}:${scaleY}:${context!.font}:${style.letterSpacing}:${style.textIndent}`;
    const geometryKey = `${geometry.x}:${geometry.y}:${geometry.width}:${geometry.height}`;
    layer.dataset.reducedMotion = String(motion.matches);
    // React value writes and unrelated streaming updates must not turn a normal
    // keystroke into a snapped caret. Only actual layout/scroll changes snap.
    // Smooth travel belongs within a line. A wrap/newline moves directly to
    // the new baseline instead of sweeping a diagonal stroke across the draft.
    // Keep that decision until a real move. Unrelated streamed DOM updates
    // must not re-enable a transition before the snapped baseline is painted.
    if (snap || wasHidden || viewportKey !== lastViewport || geometryKey !== lastGeometry) {
      layer.dataset.snap = String(snap || wasHidden || viewportKey !== lastViewport || point.line !== lastLine);
    }
    lastLine = point.line;
    lastViewport = viewportKey;
    layer.style.left = `${left}px`;
    layer.style.top = `${top}px`;
    layer.style.width = `${target.clientWidth * scaleX}px`;
    layer.style.height = `${target.clientHeight * scaleY}px`;
    layer.style.color = style.color;
    if (geometryKey !== lastGeometry) {
      caret.style.transform = `translate(${geometry.x}px, ${geometry.y}px)`;
      caret.style.width = `${geometry.width}px`;
      caret.style.height = `${geometry.height}px`;
      lastGeometry = geometryKey;
    }
    const selectionKey = `${target.selectionStart}:${target.value.length}`;
    if (resetBlink || wasHidden || lastSelection !== selectionKey) startBlink();
    lastSelection = selectionKey;
    target.setAttribute(ACTIVE, 'true');
    resetBlink = false;
    snap = false;
    if (window!.performance.now() < settleUntil) schedule();
  }

  function onEdit(event: Event): void {
    if (event.target !== active) return;
    schedule(false, true);
  }
  function onSelection(): void { schedule(false, true); }
  function onFocus(): void { activate(); schedule(true, true); }
  function onBlur(): void { hide(); schedule(true); }
  function onCompositionStart(event: Event): void { if (event.target === active) { composing = true; hide(); } }
  function onCompositionEnd(event: Event): void { if (event.target === active) { composing = false; schedule(true, true); } }
  function onPointerDown(event: PointerEvent): void { if (event.target === active) { pointerSelecting = true; hide(); } }
  function onPointerUp(): void { pointerSelecting = false; schedule(true, true); }
  function onScroll(): void { schedule(); }
  function onFontsLoaded(): void { measured = undefined; schedule(true); }
  function onMotion(): void { schedule(true, true); }
  function onVisibility(): void { if (document.hidden) hide(); else onFocus(); }
  function onPageHide(): void { suspended = true; hide(); if (frame) window!.cancelAnimationFrame(frame); frame = 0; }
  function onPageShow(): void { suspended = false; onFocus(); }
  function onTransition(event: Event): void {
    if (!(event.target instanceof window!.Element) || !active || !event.target.contains(active)) return;
    settleUntil = window!.performance.now() + 350;
    schedule();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    hide();
    if (frame) window!.cancelAnimationFrame(frame);
    resize.disconnect();
    attributes.disconnect();
    layer.remove();
    active = null;
    measured = undefined;
    document.removeEventListener('focusin', onFocus, true);
    document.removeEventListener('focusout', onBlur, true);
    document.removeEventListener('input', onEdit, true);
    document.removeEventListener('keyup', onEdit, true);
    document.removeEventListener('selectionchange', onSelection);
    document.removeEventListener('compositionstart', onCompositionStart, true);
    document.removeEventListener('compositionend', onCompositionEnd, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('pointercancel', onPointerUp, true);
    document.removeEventListener('scroll', onScroll, true);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('animationstart', onTransition, true);
    document.removeEventListener('animationend', onTransition, true);
    document.removeEventListener('transitionrun', onTransition, true);
    document.removeEventListener('transitionend', onTransition, true);
    document.fonts?.removeEventListener('loadingdone', onFontsLoaded);
    window!.removeEventListener('resize', onScroll);
    window!.removeEventListener('blur', onBlur);
    window!.removeEventListener('focus', onFocus);
    window!.removeEventListener('pagehide', onPageHide);
    window!.removeEventListener('pageshow', onPageShow);
    window!.visualViewport?.removeEventListener('resize', onScroll);
    window!.visualViewport?.removeEventListener('scroll', onScroll);
    motion.removeEventListener('change', onMotion);
    installations.delete(document);
  }

  document.addEventListener('focusin', onFocus, true);
  document.addEventListener('focusout', onBlur, true);
  document.addEventListener('input', onEdit, { capture: true, passive: true });
  document.addEventListener('keyup', onEdit, { capture: true, passive: true });
  document.addEventListener('selectionchange', onSelection);
  document.addEventListener('compositionstart', onCompositionStart, true);
  document.addEventListener('compositionend', onCompositionEnd, true);
  document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  document.addEventListener('pointerup', onPointerUp, { capture: true, passive: true });
  document.addEventListener('pointercancel', onPointerUp, { capture: true, passive: true });
  document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('animationstart', onTransition, true);
  document.addEventListener('animationend', onTransition, true);
  document.addEventListener('transitionrun', onTransition, true);
  document.addEventListener('transitionend', onTransition, true);
  document.fonts?.addEventListener('loadingdone', onFontsLoaded);
  window.addEventListener('resize', onScroll, { passive: true });
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  window.visualViewport?.addEventListener('resize', onScroll, { passive: true });
  window.visualViewport?.addEventListener('scroll', onScroll, { passive: true });
  motion.addEventListener('change', onMotion);
  installations.set(document, dispose);
  activate();
  return dispose;
}
