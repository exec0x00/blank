import { placeTooltip, tooltipText, type TooltipSide } from './tooltip-placement';

const TITLE_TEXT = 'data-tooltip-title';
const NAME_WRITE = 'data-tooltip-owned-name';
const EXPLICIT = `[data-tooltip], [${TITLE_TEXT}]`;
const ICON = 'button[aria-label].icon-button, button[aria-label].nav-item, button[aria-label].sidebar-settings, button[aria-label].lock-button, [data-tooltip-from-label][aria-label]';
const TARGET = `${EXPLICIT}, ${ICON}`;
const EDITABLE = 'input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])';
const OWNED_HOVER = '.monaco-hover, .suggest-details, .xterm, [role="tooltip"]';
const ACTION = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="combobox"]';
const HOLD_ACTION = 'button, [role="button"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="combobox"]';
const installations = new WeakMap<Document, () => void>();
let nextId = 0;

interface TitleState { text: string; generatedLabel?: string }
interface Active { target: Element; origin: 'hover' | 'focus' | 'touch'; text: string }

/**
 * One text-only, nonfocusable layer serves the app. Existing title props are
 * converted without a React wrapper; explicit data-tooltip is also supported.
 * A blank title sentinel is intentional: React can still remove a title prop on
 * a recycled row, and that removal clears its hint instead of leaving old text.
 * Editable surfaces and Monaco's rich documentation/diagnostic hovers stay owned
 * by their controls. No input values, HTML, or selection contents are inspected.
 */
export function installTooltips(document: Document = window.document): () => void {
  const installed = installations.get(document);
  if (installed) return installed;
  const view = document.defaultView;
  if (!view || !document.body) return () => {};
  const window = view;
  const titles = new WeakMap<Element, TitleState>();
  const tooltip = document.createElement('div');
  tooltip.id = `cw-tooltip-${++nextId}`;
  tooltip.className = 'cw-tooltip';
  tooltip.tabIndex = -1;
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('dir', 'auto');
  let disposed = false, locked = document.body.dataset.workspaceLocked === 'true';
  let active: Active | undefined, pending: Active | undefined;
  let hoverTarget: Element | null = null, focusTarget: Element | null = null, dismissed: Element | null = null;
  let overTooltip = false, keyboard = true;
  let openTimer: number | undefined, closeTimer: number | undefined, frame = 0;
  let touch: { target: Element; control: Element; pointerId: number; x: number; y: number; shown: boolean } | undefined;
  let touchClick: { control: Element; until: number } | undefined;

  const element = (target: EventTarget | null): Element | null => target instanceof window.Element ? target : target instanceof window.Node ? target.parentElement : null;
  const excluded = (target: Element) => Boolean(target.closest(`${EDITABLE}, ${OWNED_HOVER}, [data-tooltip-disabled="true"]`)) || (target instanceof window.HTMLElement && target.isContentEditable);
  const label = (target: Element) => tooltipText(target.getAttribute('data-tooltip') ?? target.getAttribute(TITLE_TEXT) ?? (target.matches(ICON) ? target.getAttribute('aria-label') : null));
  const viewport = () => ({ left: window.visualViewport?.offsetLeft || 0, top: window.visualViewport?.offsetTop || 0, width: window.visualViewport?.width || window.innerWidth, height: window.visualViewport?.height || window.innerHeight });

  function writeName(target: Element, name: string | null): void {
    target.setAttribute(NAME_WRITE, '');
    if (name === null) target.removeAttribute('aria-label'); else target.setAttribute('aria-label', name);
  }

  function hasNameContent(target: Element): boolean {
    // Naming belongs to the control's content, even while the whole control or
    // workspace is hidden. Only hidden descendants can remove that content;
    // a lock overlay must not replace a text/alt name with the tooltip path.
    const hiddenWithinControl = (content: Element | null) => {
      const hidden = content?.closest('[aria-hidden="true"], [hidden]');
      return Boolean(hidden && hidden !== target && target.contains(hidden));
    };
    if (target.getAttribute('aria-labelledby')?.trim()) return true;
    if (target instanceof window.HTMLButtonElement && Array.from(target.labels || []).some(label => label.textContent?.trim())) return true;
    for (const content of target.querySelectorAll('[aria-label], [aria-labelledby], img[alt], svg title')) {
      if (hiddenWithinControl(content)) continue;
      if (content.getAttribute('aria-label')?.trim() || content.getAttribute('aria-labelledby')?.trim() || content.getAttribute('alt')?.trim() || content.matches('svg title') && content.textContent?.trim()) return true;
    }
    const walker = document.createTreeWalker(target, window.NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) if (node.textContent?.trim() && !hiddenWithinControl(node.parentElement)) return true;
    return false;
  }

  function preserveName(target: Element, state: TitleState): void {
    if (state.generatedLabel && target.getAttribute('aria-label') !== state.generatedLabel) state.generatedLabel = undefined;
    if (state.generatedLabel) {
      if (hasNameContent(target)) { writeName(target, null); state.generatedLabel = undefined; return; }
      const text = tooltipText(state.text);
      if (text !== state.generatedLabel) { writeName(target, text); state.generatedLabel = text; }
      return;
    }
    if (!target.matches(ACTION) || target.hasAttribute('aria-label') || target.hasAttribute('aria-labelledby')) return;
    // Existing visible text/labels stay authoritative. Decorative SVG paths do
    // not name an icon button; a legacy title-only button must retain its name.
    if (hasNameContent(target)) return;
    const text = tooltipText(state.text);
    if (text) { writeName(target, text); state.generatedLabel = text; }
  }

  function clearTitle(target: Element): void {
    const state = titles.get(target);
    if (!state) return;
    target.removeAttribute(TITLE_TEXT);
    if (state.generatedLabel && target.getAttribute('aria-label') === state.generatedLabel) writeName(target, null);
    titles.delete(target);
  }

  function convertTitle(target: Element): void {
    const text = target.getAttribute('title');
    if (!text || excluded(target)) return;
    const state = titles.get(target) || { text };
    state.text = text;
    titles.set(target, state);
    preserveName(target, state);
    // Keep these two mutations adjacent. The observer can recognize our exact
    // write, even if an author assigns the same title and then removes it again
    // in this delivery; matching only an old string value would be ambiguous.
    target.setAttribute(TITLE_TEXT, tooltipText(text));
    target.setAttribute('title', '');
  }

  function scan(root: Element): void {
    if (excluded(root)) return;
    const reconcile = (target: Element) => {
      if (!target.hasAttribute('title')) clearTitle(target); else convertTitle(target);
      const state = titles.get(target);
      if (state) preserveName(target, state);
    };
    if (root.hasAttribute('title') || root.hasAttribute(TITLE_TEXT)) reconcile(root);
    for (const target of root.querySelectorAll(`[title], [${TITLE_TEXT}]`)) reconcile(target);
  }

  function targetAt(node: EventTarget | null): Element | null {
    // Settle authored label ownership before an immediate pointer/focus event
    // converts another title in the same task.
    const queued = observer.takeRecords();
    if (queued.length) mutations(queued);
    let target = element(node);
    if (!target || tooltip.contains(target)) return null;
    // Pointer/focus can occur in the same task that a control was inserted.
    for (let current: Element | null = target; current; current = current.parentElement) if (current.hasAttribute('title')) convertTitle(current);
    target = target.closest(TARGET);
    return target && !excluded(target) && label(target) ? target : null;
  }

  function canShow(target: Element): boolean {
    if (disposed || document.hidden || !target.isConnected || !label(target) || excluded(target)) return false;
    if ((locked || document.body.dataset.workspaceLocked === 'true') && !target.closest('.login-screen')) return false;
    const dropdown = target.closest('[data-codex-dropdown]');
    // Only clipped option labels can show a hint inside an open menu. Keep
    // trigger/action hints suppressed while the menu owns navigation.
    const clippedOption = !!dropdown && target.matches('.cw-dropdown-label[data-tooltip-when-truncated="true"]')
      && target.scrollWidth > target.clientWidth;
    if (target.closest('[hidden], [inert], [aria-haspopup][aria-expanded="true"]') || dropdown && !clippedOption || target.parentElement?.closest('[aria-hidden="true"]')) return false;
    const focusedDialog = document.activeElement?.closest('dialog[open], [role="dialog"][aria-modal="true"]');
    if (focusedDialog && !focusedDialog.contains(target)) return false;
    // Dropdown focus restoration and Escape handling retain their own order.
    if (document.querySelector('[data-codex-dropdown]') && !clippedOption) return false;
    if (!target.getClientRects().length) return false;
    const style = window.getComputedStyle(target);
    if (style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
    const bounds = target.getBoundingClientRect(), view = viewport();
    return bounds.width > 0 && bounds.height > 0 && bounds.right > view.left && bounds.bottom > view.top && bounds.left < view.left + view.width && bounds.top < view.top + view.height;
  }

  function describe(target: Element, add: boolean): void {
    const tokens = (target.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).filter(value => value !== tooltip.id);
    if (add && !target.closest('[aria-hidden="true"]')) tokens.push(tooltip.id);
    const next = tokens.join(' ');
    if (next === (target.getAttribute('aria-describedby') || '')) return;
    if (next) target.setAttribute('aria-describedby', next); else target.removeAttribute('aria-describedby');
  }

  const resizeObserver = new window.ResizeObserver(() => schedulePlace());
  const ancestorObserver = new window.MutationObserver(() => schedulePlace());

  function hide(): void {
    if (openTimer !== undefined) window.clearTimeout(openTimer);
    if (closeTimer !== undefined) window.clearTimeout(closeTimer);
    openTimer = closeTimer = undefined;
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    pending = undefined;
    resizeObserver.disconnect(); ancestorObserver.disconnect();
    if (active) describe(active.target, false);
    active = undefined; overTooltip = false;
    if (typeof tooltip.hidePopover === 'function') {
      try { tooltip.hidePopover(); } catch { /* Already closed or detached. */ }
    }
    tooltip.remove(); tooltip.textContent = '';
  }

  function reset(): void {
    hide(); hoverTarget = focusTarget = dismissed = null; touch = undefined; touchClick = undefined;
  }

  function place(): void {
    frame = 0;
    if (!active || !canShow(active.target)) { hide(); return; }
    const text = label(active.target);
    if (text !== active.text) { active.text = text; tooltip.textContent = text; }
    describe(active.target, true);
    const view = viewport();
    tooltip.style.maxWidth = `${Math.max(0, Math.min(320, view.width - 16))}px`;
    tooltip.style.maxHeight = `${Math.max(0, view.height - 16)}px`;
    const preferred = active.target.getAttribute('data-tooltip-side');
    const side: TooltipSide = preferred === 'bottom' || preferred === 'left' || preferred === 'right' ? preferred : 'top';
    const position = placeTooltip(active.target.getBoundingClientRect(), tooltip.getBoundingClientRect(), view, side);
    tooltip.style.left = `${position.left}px`; tooltip.style.top = `${position.top}px`;
    tooltip.dataset.side = position.side;
    tooltip.style.visibility = 'visible';
  }

  function schedulePlace(): void { if (active && !frame) frame = window.requestAnimationFrame(place); }

  function show(): void {
    if (openTimer !== undefined) window.clearTimeout(openTimer);
    openTimer = undefined;
    const next = pending;
    if (!next || next.target === dismissed || !canShow(next.target)) { hide(); return; }
    if (next.origin === 'hover' && hoverTarget !== next.target || next.origin === 'focus' && focusTarget !== next.target || next.origin === 'touch' && touch?.target !== next.target) { hide(); return; }
    pending = undefined; active = next;
    if (next.origin === 'touch' && touch) {
      touch.shown = true;
      touchClick = { control: touch.control, until: window.performance.now() + 1500 };
    }
    tooltip.textContent = next.text;
    tooltip.style.visibility = 'hidden';
    // Native dialogs make body siblings inert. A manual, nonfocusable popover
    // inside the owning dialog remains visible without joining its focus trap.
    (next.target.closest('dialog[open]') || document.body).append(tooltip);
    if (typeof tooltip.showPopover === 'function') {
      tooltip.setAttribute('popover', 'manual');
      try { tooltip.showPopover(); } catch { tooltip.removeAttribute('popover'); }
    }
    resizeObserver.observe(next.target); resizeObserver.observe(tooltip);
    let depth = 0;
    for (let ancestor: Element | null = next.target; ancestor && depth++ < 64; ancestor = ancestor.parentElement) ancestorObserver.observe(ancestor, { attributes: true, attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-hidden', 'open', 'aria-expanded'] });
    place();
  }

  function request(target: Element | null, origin: Active['origin']): void {
    if (!target || target === dismissed || !canShow(target)) return;
    if (closeTimer !== undefined) { window.clearTimeout(closeTimer); closeTimer = undefined; }
    if (active?.target === target) { active.origin = origin; schedulePlace(); return; }
    if (pending?.target === target && pending.origin === origin) return;
    hide();
    pending = { target, origin, text: label(target) };
    openTimer = window.setTimeout(show, origin === 'touch' ? 550 : origin === 'focus' ? 180 : 420);
  }

  function leave(): void {
    if (pending && pending.origin !== 'touch' && pending.target !== hoverTarget && pending.target !== focusTarget) hide();
    if (!active || overTooltip || active.origin === 'touch' || active.target === focusTarget || active.target === hoverTarget) return;
    if (closeTimer === undefined) closeTimer = window.setTimeout(hide, 140);
  }

  function pointerOver(event: PointerEvent): void {
    if (event.pointerType === 'touch') return;
    if (tooltip.contains(element(event.target))) { overTooltip = true; if (closeTimer !== undefined) window.clearTimeout(closeTimer); closeTimer = undefined; return; }
    const target = targetAt(event.target);
    if (target !== dismissed) dismissed = null;
    hoverTarget = target;
    if (target) request(target, 'hover'); else leave();
  }

  function pointerOut(event: PointerEvent): void {
    if (event.pointerType === 'touch') return;
    const related = element(event.relatedTarget);
    if (tooltip.contains(related)) { overTooltip = true; return; }
    overTooltip = false;
    const next = targetAt(related);
    if (dismissed && !dismissed.contains(related)) dismissed = null;
    hoverTarget = next;
    if (next === active?.target && closeTimer !== undefined) { window.clearTimeout(closeTimer); closeTimer = undefined; }
    leave();
  }

  function pointerDown(event: PointerEvent): void {
    if (tooltip.contains(element(event.target))) return;
    keyboard = false;
    const target = targetAt(event.target);
    dismissed = target;
    hide(); focusTarget = hoverTarget = null; touch = undefined; touchClick = undefined;
    if (event.pointerType !== 'touch' || !target || !event.isPrimary) return;
    const control = target.closest(HOLD_ACTION);
    if (!control) return; // Keep native selection/long-press behavior on plain text.
    dismissed = null;
    touch = { target, control, pointerId: event.pointerId, x: event.clientX, y: event.clientY, shown: false };
    request(target, 'touch');
  }

  function pointerMove(event: PointerEvent): void {
    if (touch?.pointerId === event.pointerId && Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 10) { touch = undefined; hide(); }
  }

  function pointerUp(event: PointerEvent): void {
    if (touch?.pointerId !== event.pointerId) return;
    if (!touch.shown) hide();
    else if (touchClick) touchClick.until = window.performance.now() + 1000;
    touch = undefined;
  }

  function click(event: MouseEvent): void {
    // An ordinary tap always activates. A completed hold reveals help without
    // also firing the button on release; the next deliberate tap still works.
    if (touchClick && window.performance.now() < touchClick.until && touchClick.control.contains(element(event.target))) {
      touchClick = undefined; event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    touchClick = undefined;
    if (!tooltip.contains(element(event.target))) hide();
  }

  function contextMenu(event: MouseEvent): void {
    if (touch && !touch.control.matches('a[href]') && touch.control.contains(element(event.target)) && canShow(touch.target)) {
      // Some touch browsers recognize a hold before our timer. Only hint-bearing
      // action buttons use that gesture; links/text keep their native menus.
      event.preventDefault();
      if (pending?.origin === 'touch') show();
      return;
    }
    dismiss();
  }

  function focusIn(event: FocusEvent): void {
    if (active && !canShow(active.target)) hide();
    if (!keyboard) return;
    const target = targetAt(event.target);
    if (target !== dismissed) dismissed = null;
    focusTarget = target;
    if (target) request(target, 'focus');
  }

  function focusOut(event: FocusEvent): void {
    const next = keyboard ? targetAt(event.relatedTarget) : null;
    if (dismissed && next !== dismissed && hoverTarget !== dismissed) dismissed = null;
    focusTarget = next;
    leave();
  }

  function keydown(event: KeyboardEvent): void {
    keyboard = true;
    touchClick = undefined;
    if (event.key === 'Escape') {
      if (active) {
        const valid = canShow(active.target);
        dismissed = active.target; hide();
        if (valid) { event.preventDefault(); event.stopImmediatePropagation(); }
      }
      else if (pending) { dismissed = pending.target; hide(); }
    } else if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) { hide(); focusTarget = null; }
  }

  function dismiss(): void { dismissed = active?.target || pending?.target || null; hide(); hoverTarget = focusTarget = null; touch = undefined; }
  function lockedSession(): void { locked = true; reset(); }
  function unlockedSession(): void { locked = false; reset(); }
  function visibility(): void { if (document.hidden) reset(); }
  function scrolled(event: Event): void { if (!tooltip.contains(element(event.target))) dismiss(); }

  function mutations(records: MutationRecord[]): void {
    if (disposed) return;
    const titleChanges = new Map<Element, boolean>();
    const nameWrites = new Map<Element, boolean>();
    const additions: Element[] = [];
    const nameChanges = new Set<Element>();
    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      if (record.type === 'childList') {
        for (const node of record.addedNodes) if (node instanceof window.Element && !tooltip.contains(node)) additions.push(node);
      } else if (record.attributeName === 'title' && record.target instanceof window.Element) {
        const previous = records[index - 1];
        titleChanges.set(record.target, previous?.target === record.target && previous.attributeName === TITLE_TEXT);
      } else if (record.attributeName === 'aria-label' && record.target instanceof window.Element) {
        const previous = records[index - 1];
        // Same-value authored writes still take ownership. Process them before
        // a matching title removal so that removal cannot delete the app's name.
        nameWrites.set(record.target, previous?.target === record.target && previous.attributeName === NAME_WRITE);
      }
      const control = element(record.target)?.closest(ACTION);
      if (control && titles.has(control)) nameChanges.add(control);
    }
    for (const [target, ownWrite] of nameWrites) {
      const state = titles.get(target);
      if (state && !ownWrite) state.generatedLabel = undefined;
    }
    for (const [target, ownWrite] of titleChanges) {
      const current = target.getAttribute('title'), state = titles.get(target);
      if (current) convertTitle(target);
      else if (current === '' && state && ownWrite) continue;
      else clearTitle(target);
    }
    // Attribute records describe the state before this delivery. Scanning a new
    // row first would mistake our just-written blank title for an author removal
    // when React inserted the row and assigned its title in the same task.
    for (const added of additions) if (added.isConnected) scan(added);
    for (const target of nameChanges) { const state = titles.get(target); if (state) preserveName(target, state); }
    if (hoverTarget && !hoverTarget.isConnected) hoverTarget = null;
    if (focusTarget && !focusTarget.isConnected) focusTarget = null;
    if (dismissed && !dismissed.isConnected) dismissed = null;
    if (touch && !touch.target.isConnected) touch = undefined;
    if (touchClick && (!touchClick.control.isConnected || window.performance.now() >= touchClick.until)) touchClick = undefined;
    if (pending && !pending.target.isConnected) hide();
    if (active && !active.target.isConnected) hide(); else schedulePlace();
  }
  const observer = new window.MutationObserver(mutations);

  function dispose(): void {
    if (disposed) return;
    const queued = observer.takeRecords();
    if (queued.length) mutations(queued);
    disposed = true; reset(); observer.disconnect();
    for (const target of document.querySelectorAll(`[${TITLE_TEXT}], [${NAME_WRITE}]`)) {
      const state = titles.get(target);
      if (state) {
        if (target.getAttribute('title') === '') target.setAttribute('title', state.text);
        clearTitle(target);
      }
      target.removeAttribute(NAME_WRITE);
    }
    document.removeEventListener('pointerover', pointerOver, true); document.removeEventListener('pointerout', pointerOut, true);
    document.removeEventListener('pointerdown', pointerDown, true); document.removeEventListener('pointermove', pointerMove, true); document.removeEventListener('pointerup', pointerUp, true);
    document.removeEventListener('pointercancel', dismiss, true); document.removeEventListener('click', click, true);
    document.removeEventListener('focusin', focusIn, true); document.removeEventListener('focusout', focusOut, true);
    document.removeEventListener('scroll', scrolled, true); document.removeEventListener('dragstart', dismiss, true); document.removeEventListener('contextmenu', contextMenu, true);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('keydown', keydown, true); window.removeEventListener('blur', reset); window.removeEventListener('pagehide', reset); window.removeEventListener('resize', dismiss);
    window.visualViewport?.removeEventListener('resize', dismiss); window.visualViewport?.removeEventListener('scroll', dismiss);
    window.removeEventListener('codex:session-locked', lockedSession); window.removeEventListener('codex:session-expired', lockedSession); window.removeEventListener('codex:session-unlocked', unlockedSession);
    window.removeEventListener('codex:before-workspace-change', dismiss); window.removeEventListener('codex:workspace-changed', dismiss);
    installations.delete(document);
  }

  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', TITLE_TEXT, NAME_WRITE, 'data-tooltip', 'data-tooltip-disabled', 'aria-label', 'aria-labelledby', 'aria-describedby', 'alt', 'hidden', 'inert', 'aria-hidden', 'open', 'data-workspace-locked'] });
  scan(document.body);
  const passive = { capture: true, passive: true };
  document.addEventListener('pointerover', pointerOver, passive); document.addEventListener('pointerout', pointerOut, passive);
  document.addEventListener('pointerdown', pointerDown, passive); document.addEventListener('pointermove', pointerMove, passive); document.addEventListener('pointerup', pointerUp, passive);
  document.addEventListener('pointercancel', dismiss, passive); document.addEventListener('click', click, true);
  document.addEventListener('focusin', focusIn, true); document.addEventListener('focusout', focusOut, true);
  document.addEventListener('scroll', scrolled, passive); document.addEventListener('dragstart', dismiss, passive); document.addEventListener('contextmenu', contextMenu, true);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('keydown', keydown, true); window.addEventListener('blur', reset); window.addEventListener('pagehide', reset); window.addEventListener('resize', dismiss);
  window.visualViewport?.addEventListener('resize', dismiss); window.visualViewport?.addEventListener('scroll', dismiss);
  window.addEventListener('codex:session-locked', lockedSession); window.addEventListener('codex:session-expired', lockedSession); window.addEventListener('codex:session-unlocked', unlockedSession);
  window.addEventListener('codex:before-workspace-change', dismiss); window.addEventListener('codex:workspace-changed', dismiss);
  installations.set(document, dispose);
  return dispose;
}
