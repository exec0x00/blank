import {
  cloneElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type ButtonHTMLAttributes, type ReactElement, type ReactNode, type Ref, type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import './dropdown.css';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
  group?: string;
  shortcut?: string;
  keywords?: string;
}

export interface SelectMenuProps<T extends string = string> {
  value: T;
  options: readonly SelectOption<T>[];
  onValueChange: (value: T) => void;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  id?: string;
  name?: string;
  className?: string;
  menuClassName?: string;
  title?: string;
  disabled?: boolean;
  placeholder?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  align?: 'start' | 'end';
  compact?: boolean;
  renderValue?: (option: SelectOption<T> | undefined) => ReactNode;
  /** Full selected text when a custom value is outside the current option page. */
  valueLabel?: string;
  onOpenChange?: (open: boolean) => void;
  /** The caller fetches a bounded server page. Static menus keep local search. */
  remoteSearch?: {
    query: string;
    onQueryChange: (query: string) => void;
    loading?: boolean;
    error?: string;
    onRetry?: () => void;
    footer?: ReactNode;
    onPreviousPage?: () => void;
    onNextPage?: () => void;
  };
}

export interface DropdownAction {
  type?: 'item';
  id: string;
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  description?: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  /** Useful for view toggles. Commands close the menu by default. */
  closeOnSelect?: boolean;
}

export type DropdownItem = DropdownAction
  | { type: 'separator'; id: string }
  | { type: 'label'; id: string; label: string };

export interface DropdownMenuProps {
  trigger: ReactElement<ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> }>;
  items: readonly DropdownItem[];
  'aria-label'?: string;
  align?: 'start' | 'end';
  className?: string;
  onOpenChange?: (open: boolean) => void;
  /** Controlled visibility supports composer slash commands. */
  open?: boolean;
}

type Point = { x: number; y: number };
type FocusPosition = 'selected' | 'first' | 'last';
type Close = (restoreFocus?: boolean) => void;
let dismissActiveDropdown: Close | undefined;

function isAction(item: DropdownItem): item is DropdownAction {
  return item.type !== 'separator' && item.type !== 'label';
}

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

function canOpen() {
  return document.body.dataset.workspaceLocked !== 'true';
}

function visibleViewport() {
  const viewport = window.visualViewport;
  return {
    left: viewport?.offsetLeft || 0, top: viewport?.offsetTop || 0,
    width: viewport?.width || window.innerWidth, height: viewport?.height || window.innerHeight,
  };
}

interface SurfaceProps {
  id: string;
  anchor: RefObject<HTMLElement | null>;
  point?: Point;
  close: Close;
  align?: 'start' | 'end';
  className?: string;
  children: ReactNode;
  onKey: (event: KeyboardEvent) => void;
  focus: () => void;
  tabWithin?: boolean;
}

/** A single layer owns dismissal, viewport placement, and dialog-safe keyboard routing. */
function Surface({ id, anchor, point, close, align = 'start', className = '', children, onKey, focus, tabWithin = false }: SurfaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef({ close, onKey, focus, tabWithin });
  latest.current = { close, onKey, focus, tabWithin };
  // A native modal makes body siblings inert. Keep the portal in that dialog;
  // the Popover API promotes it to the top layer so its overflow cannot clip it.
  const portal = anchor.current?.closest('dialog[open]') || document.body;

  useLayoutEffect(() => {
    const surface = ref.current;
    if (!surface) return;
    const dismiss: Close = (restore) => latest.current.close(restore);
    dismissActiveDropdown?.(false);
    dismissActiveDropdown = dismiss;
    let frame = 0;
    let focusFrame = 0;
    const place = () => {
      frame = 0;
      const trigger = anchor.current;
      if (!canOpen() || (!point && (!trigger?.isConnected || !trigger.getClientRects().length))) {
        dismiss(false);
        return;
      }
      const viewport = visibleViewport();
      const margin = 8, gap = 5;
      const bounds = point
        ? { left: point.x, right: point.x, top: point.y, bottom: point.y, width: 0 }
        : trigger!.getBoundingClientRect();
      const width = Math.min(Math.max(bounds.width, 240), 390, Math.max(0, viewport.width - margin * 2));
      surface.style.width = `${width}px`;
      const scroll = surface.querySelector<HTMLElement>('.cw-dropdown-scroll');
      const search = surface.querySelector<HTMLElement>('.cw-dropdown-search');
      const footer = surface.querySelector<HTMLElement>('.cw-dropdown-footer');
      const desiredHeight = Math.min(440, (scroll?.scrollHeight || 0) + (search?.offsetHeight || 0) + (footer?.offsetHeight || 0) + 12);
      const below = viewport.top + viewport.height - margin - bounds.bottom - gap;
      const above = bounds.top - viewport.top - margin - gap;
      const side = below >= desiredHeight || below >= above ? 'bottom' : 'top';
      const availableHeight = Math.max(0, Math.min(viewport.height - margin * 2, side === 'bottom' ? below : above));
      // An anchor covered by the software keyboard still gets a usable menu.
      const height = availableHeight < 96 ? Math.max(0, viewport.height - margin * 2) : availableHeight;
      surface.style.maxHeight = `${Math.min(440, height)}px`;
      const actualHeight = Math.min(desiredHeight, height, 440);
      const desiredLeft = align === 'end' ? bounds.right - width : bounds.left;
      const left = Math.max(viewport.left + margin, Math.min(desiredLeft, viewport.left + viewport.width - width - margin));
      const desiredTop = side === 'bottom' ? bounds.bottom + gap : bounds.top - gap - actualHeight;
      const top = Math.max(viewport.top + margin, Math.min(desiredTop, viewport.top + viewport.height - actualHeight - margin));
      surface.style.left = `${left}px`;
      surface.style.top = `${top}px`;
      surface.dataset.side = side;
      surface.style.visibility = 'visible';
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
    if (typeof surface.showPopover === 'function') {
      try { surface.showPopover(); } catch { /* Fixed-position portal is the fallback. */ }
    }
    place();
    focusFrame = requestAnimationFrame(() => latest.current.focus());
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!surface.contains(target) && (point || !anchor.current?.contains(target))) dismiss(false);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        dismiss(true);
        return;
      }
      if (event.key === 'Tab') {
        if (latest.current.tabWithin && surface.contains(event.target as Node)) {
          const controls = Array.from(surface.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled), a[href]')).filter(element => element.getClientRects().length);
          const index = controls.indexOf(document.activeElement as HTMLElement);
          if (index >= 0 && (event.shiftKey ? index > 0 : index < controls.length - 1)) return;
        }
        // Let the browser or enclosing dialog move to the next real control.
        // Starting at the trigger avoids tabbing from a body-level portal.
        anchor.current?.focus({ preventScroll: true });
        dismiss(false);
        return;
      }
      latest.current.onKey(event);
    };
    const focusOutside = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (!surface.contains(target) && (point || !anchor.current?.contains(target))) dismiss(false);
    };
    const locked = () => dismiss(false);
    const observer = new ResizeObserver(schedule);
    observer.observe(surface);
    if (anchor.current) observer.observe(anchor.current);
    // Window capture runs before dialog capture listeners, so the first Escape
    // always closes the dropdown and preserves the surrounding form.
    window.addEventListener('keydown', keydown, true);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', focusOutside, true);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    window.addEventListener('codex:session-locked', locked);
    window.addEventListener('codex:session-expired', locked);
    return () => {
      if (dismissActiveDropdown === dismiss) dismissActiveDropdown = undefined;
      cancelAnimationFrame(frame); cancelAnimationFrame(focusFrame); observer.disconnect();
      window.removeEventListener('keydown', keydown, true);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', focusOutside, true);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('codex:session-locked', locked);
      window.removeEventListener('codex:session-expired', locked);
      if (typeof surface.hidePopover === 'function') {
        try { surface.hidePopover(); } catch { /* Already closed or detached. */ }
      }
    };
  }, [anchor, point?.x, point?.y, align]);

  return createPortal(<div id={id} ref={ref} popover="manual" className={`cw-dropdown-surface ${className}`} style={{ visibility: 'hidden' }} data-codex-dropdown="true">{children}</div>, portal);
}

function useTypeahead() {
  const buffer = useRef({ text: '', at: 0 });
  const find = (key: string, labels: string[], current: number) => {
    const now = performance.now();
    const previous = now - buffer.current.at < 650 ? buffer.current.text : '';
    const next = previous + key.toLocaleLowerCase();
    // Repeating a letter cycles through matching entries, like a native select.
    const query = [...next].every((character) => character === next[0]) ? next[0] : next;
    buffer.current = { text: next, at: now };
    const start = query.length === 1 ? current + 1 : Math.max(0, current);
    for (let offset = 0; offset < labels.length; offset++) {
      const index = (start + offset) % labels.length;
      if (labels[index].toLocaleLowerCase().startsWith(query)) return index;
    }
    return current;
  };
  return { find, reset: () => { buffer.current = { text: '', at: 0 }; } };
}

function nextIndex(key: string, current: number, length: number) {
  if (!length) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return length - 1;
  if (current < 0) return key === 'ArrowUp' ? length - 1 : 0;
  return (current + (key === 'ArrowDown' ? 1 : -1) + length) % length;
}

function OptionContent({ label, description, icon, shortcut, checked }: {
  label: string; description?: string; icon?: ReactNode; shortcut?: string; checked?: boolean;
}) {
  return <>
    {icon && <span className="cw-dropdown-icon" aria-hidden="true">{icon}</span>}
    <span className="cw-dropdown-copy"><span className="cw-dropdown-label" data-tooltip={label} data-tooltip-when-truncated="true">{label}</span>{description && <span className="cw-dropdown-description">{description}</span>}</span>
    {shortcut && <kbd className="cw-dropdown-shortcut" aria-hidden="true">{shortcut}</kbd>}
    {checked !== undefined && <span className="cw-dropdown-check" aria-hidden="true">{checked && <Check size={14} strokeWidth={1.8} />}</span>}
  </>;
}

export function SelectMenu<T extends string>({ value, options, onValueChange, placeholder = 'Select…', searchable = false, searchPlaceholder = 'Search…', align = 'start', compact = false, className = '', menuClassName = '', renderValue, valueLabel, onOpenChange, remoteSearch, ...button }: SelectMenuProps<T>) {
  const uid = useId();
  const surfaceId = `select-${uid}`;
  const listId = `${surfaceId}-list`;
  const anchor = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const restoreAfterUpdate = useRef<'requested' | 'waiting' | null>(null);
  const [open, setOpen] = useState(false);
  const [localQuery, setLocalQuery] = useState('');
  const query = remoteSearch?.query ?? localQuery;
  const setQuery = (next: string) => { setLocalQuery(next); remoteSearch?.onQueryChange(next); };
  const showSearch = searchable || !!remoteSearch;
  const [active, setActive] = useState<T | undefined>(value);
  const typeahead = useTypeahead();
  const selection = options.find((option) => option.value === value);
  const renderedValue = renderValue?.(selection);
  const selectedLabel = valueLabel || selection?.label || (typeof renderedValue === 'string' ? renderedValue : value || placeholder);
  const filtered = useMemo(() => {
    if (remoteSearch) return options;
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return options.filter((option) => words.every((word) => `${option.value} ${option.label} ${option.description || ''} ${option.group || ''} ${option.keywords || ''}`.toLocaleLowerCase().includes(word)));
  }, [options, query, !!remoteSearch]);
  const groups = useMemo(() => {
    const result: Array<{ label?: string; options: SelectOption<T>[] }> = [];
    for (const option of filtered) {
      const last = result.at(-1);
      if (last && last.label === option.group) last.options.push(option);
      else result.push({ label: option.group, options: [option] });
    }
    return result;
  }, [filtered]);
  const enabled = filtered.filter((option) => !option.disabled);
  const activeOption = enabled.find((option) => option.value === active);
  const activeId = activeOption ? `${listId}-${options.indexOf(activeOption)}` : undefined;
  const label = button['aria-label'] || (button['aria-labelledby'] ? document.getElementById(button['aria-labelledby'])?.textContent || undefined : undefined) || button.title || 'Options';

  const close = useCallback((restore = false) => {
    setOpen(false); onOpenChange?.(false);
    if (restore && canOpen()) anchor.current?.focus({ preventScroll: true });
  }, [onOpenChange]);
  const show = (position: FocusPosition = 'selected') => {
    if (button.disabled || !canOpen()) return;
    const available = options.filter((option) => !option.disabled);
    const chosen = position === 'last' ? available.at(-1) : position === 'first' ? available[0] : available.find((option) => option.value === value) || available[0];
    typeahead.reset();
    setActive(chosen?.value); setQuery(''); setOpen(true); onOpenChange?.(true);
  };
  const choose = (option: SelectOption<T>) => {
    if (option.disabled) return;
    restoreAfterUpdate.current = 'requested';
    close(true);
    if (option.value !== value) onValueChange(option.value);
  };

  useLayoutEffect(() => {
    if (button.disabled && restoreAfterUpdate.current === 'requested') restoreAfterUpdate.current = 'waiting';
    else if (!button.disabled && restoreAfterUpdate.current === 'waiting') {
      // A repository switch briefly disables its selector. Browsers blur a
      // disabled button; restore its keyboard position after the real update,
      // provided the user has not moved to another control in the meantime.
      if (canOpen() && document.activeElement === document.body && anchor.current?.getClientRects().length) anchor.current.focus({ preventScroll: true });
      restoreAfterUpdate.current = null;
    } else if (!button.disabled && !open) restoreAfterUpdate.current = null;
  }, [button.disabled, open]);
  useEffect(() => {
    if (!button.disabled || restoreAfterUpdate.current !== 'waiting') return;
    const cancel = (event: PointerEvent) => { if (!anchor.current?.contains(event.target as Node)) restoreAfterUpdate.current = null; };
    document.addEventListener('pointerdown', cancel, true);
    return () => document.removeEventListener('pointerdown', cancel, true);
  }, [button.disabled]);
  useEffect(() => { if (open && button.disabled) close(false); }, [button.disabled, open, close]);
  useEffect(() => {
    if (open && !enabled.some((option) => option.value === active)) setActive(enabled[0]?.value);
  }, [open, filtered, active]);
  useEffect(() => {
    if (open && activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId, open]);

  const onKey = (event: KeyboardEvent) => {
    const writing = event.target === input.current;
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (remoteSearch && (event.key === 'PageUp' || event.key === 'PageDown')) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!remoteSearch.loading) (event.key === 'PageUp' ? remoteSearch.onPreviousPage : remoteSearch.onNextPage)?.();
      return;
    }
    if (remoteSearch && (event.target as HTMLElement).closest?.('.cw-dropdown-footer')) return;
    const index = enabled.findIndex((option) => option.value === active);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && !(writing && (event.key === 'Home' || event.key === 'End'))) {
      event.preventDefault(); event.stopImmediatePropagation();
      const next = nextIndex(event.key, index, enabled.length);
      setActive(enabled[next]?.value);
    } else if (event.key === 'Enter' || (event.key === ' ' && !writing)) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (activeOption) choose(activeOption);
    } else if (!writing && event.key.length === 1 && enabled.length) {
      event.preventDefault(); event.stopImmediatePropagation();
      setActive(enabled[typeahead.find(event.key, enabled.map((option) => option.label), index)]?.value);
    }
  };

  return <>
    <button {...button} ref={anchor} type="button" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-activedescendant={open ? activeId : undefined}
      aria-description={selectedLabel} data-tooltip={button.title ? `${button.title} · ${selectedLabel}` : selectedLabel}
      className={`cw-select ${compact ? 'cw-select-compact' : ''} ${className}`} data-dropdown-trigger="true"
      onClick={() => open ? close(false) : show()}
      onKeyDown={(event) => {
        if (open || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
        if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
          event.preventDefault();
          show(event.key === 'ArrowUp' || event.key === 'End' ? 'last' : event.key === 'Home' ? 'first' : 'selected');
        } else if (event.key.length === 1) {
          event.preventDefault();
          show();
          if (showSearch) setQuery(event.key);
          else {
            const available = options.filter((option) => !option.disabled);
            const index = available.findIndex((option) => option.value === value);
            setActive(available[typeahead.find(event.key, available.map((option) => option.label), index)]?.value);
          }
        }
      }}>
      {renderValue ? <span className={`cw-select-value${typeof renderedValue === 'string' || typeof renderedValue === 'number' ? '' : ' cw-select-value-custom'}`}>{renderedValue}</span> : <>{selection?.icon && <span className="cw-dropdown-icon" aria-hidden="true">{selection.icon}</span>}<span className={`cw-select-value${selection ? '' : ' is-placeholder'}`}>{selection?.label || placeholder}</span></>}
      <ChevronDown className="cw-select-chevron" size={13} aria-hidden="true" />
    </button>
    {button.name && <input type="hidden" name={button.name} value={value} disabled={button.disabled} />}
    {open && <Surface id={surfaceId} anchor={anchor} close={close} align={align} className={menuClassName} onKey={onKey} tabWithin={!!remoteSearch} focus={() => (showSearch ? input.current : list.current)?.focus({ preventScroll: true })}>
      {showSearch && <div className="cw-dropdown-search"><Search size={14} aria-hidden="true" /><input ref={input} type="search" role="combobox" aria-label={`Search ${label}`} aria-controls={listId} aria-expanded="true" aria-autocomplete="list" aria-activedescendant={activeId} placeholder={searchPlaceholder} autoComplete="off" spellCheck={false} maxLength={remoteSearch ? 300 : undefined} value={query} onChange={(event) => setQuery(event.target.value)} /></div>}
      <div ref={list} id={listId} className="cw-dropdown-scroll" role="listbox" tabIndex={-1} aria-label={label} aria-activedescendant={activeId} aria-busy={remoteSearch?.loading || undefined}>
        {groups.map((group, groupIndex) => <div key={`${group.label || ''}-${groupIndex}`} role={group.label ? 'group' : 'presentation'} aria-label={group.label}>
          {group.label && <div className="cw-dropdown-group" aria-hidden="true">{group.label}</div>}
          {group.options.map((option) => <div key={option.value} id={`${listId}-${options.indexOf(option)}`} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined}
            className={`cw-dropdown-item${option.value === active ? ' is-active' : ''}${option.disabled ? ' is-disabled' : ''}`} data-value={option.value}
            onPointerMove={(event) => { if (event.pointerType !== 'touch' && !option.disabled && active !== option.value) setActive(option.value); }}
            onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>
            <OptionContent {...option} checked={option.value === value} />
          </div>)}
        </div>)}
        {!filtered.length && <div className="cw-dropdown-empty" role="status">{remoteSearch?.loading ? 'Loading options…' : remoteSearch?.error ? 'Options could not be loaded.' : 'No options found.'}</div>}
      </div>
      {remoteSearch && <div className="cw-dropdown-footer">
        {remoteSearch.error && <div className="cw-dropdown-read-error" role="alert"><p>{remoteSearch.error}</p>{remoteSearch.onRetry && <button type="button" className="button ghost" disabled={remoteSearch.loading} onClick={remoteSearch.onRetry}>Retry list</button>}</div>}
        {remoteSearch.footer}
      </div>}
    </Surface>}
  </>;
}

function CommandSurface({ anchor, point, items, label, close, align, className, initial = 'first', menuId }: {
  anchor: RefObject<HTMLElement | null>; point?: Point; items: readonly DropdownItem[];
  label: string; close: Close; align?: 'start' | 'end'; className?: string; initial?: 'first' | 'last'; menuId?: string;
}) {
  const uid = useId();
  const id = menuId || `menu-${uid}`;
  const enabled = items.filter(isAction).filter((item) => !item.disabled);
  const [active, setActive] = useState(initial === 'last' ? enabled.at(-1)?.id : enabled[0]?.id);
  const typeahead = useTypeahead();
  const menuRef = useRef<HTMLDivElement>(null);
  const rowId = (itemId: string) => `${id}-${items.findIndex((item) => item.id === itemId)}`;
  const focusActive = () => {
    const element = active ? document.getElementById(rowId(active)) : menuRef.current;
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: 'nearest' });
  };
  useEffect(() => { focusActive(); }, [active]);
  useEffect(() => {
    if (!enabled.some((item) => item.id === active)) setActive(enabled[0]?.id);
  }, [items, active]);
  const invoke = (item: DropdownAction) => {
    if (item.disabled) return;
    if (item.closeOnSelect !== false) close(true);
    item.onSelect();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const index = enabled.findIndex((item) => item.id === active);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      const next = nextIndex(event.key, index, enabled.length);
      setActive(enabled[next]?.id);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopImmediatePropagation();
      if (enabled[index]) invoke(enabled[index]);
    } else if (event.key.length === 1 && enabled.length) {
      event.preventDefault(); event.stopImmediatePropagation();
      setActive(enabled[typeahead.find(event.key, enabled.map((item) => item.label), index)]?.id);
    }
  };
  return <Surface id={`${id}-surface`} anchor={anchor} point={point} close={close} align={align} className={className} onKey={onKey} focus={focusActive}>
    <div ref={menuRef} id={id} className="cw-dropdown-scroll" role="menu" aria-label={label} tabIndex={-1}>
      {items.map((item) => item.type === 'separator' ? <div className="cw-dropdown-separator" role="separator" key={item.id} /> : item.type === 'label' ? <div className="cw-dropdown-group" key={item.id} role="presentation">{item.label}</div> : <button key={item.id} id={rowId(item.id)} type="button"
        role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={item.checked} aria-disabled={item.disabled || undefined} disabled={item.disabled} tabIndex={-1}
        className={`cw-dropdown-item${active === item.id ? ' is-active' : ''}${item.danger ? ' is-danger' : ''}`}
        onPointerMove={(event) => { if (event.pointerType !== 'touch' && !item.disabled && active !== item.id) setActive(item.id); }}
        onFocus={() => setActive(item.id)} onClick={() => invoke(item)}>
        <OptionContent {...item} />
      </button>)}
      {!items.length && <div className="cw-dropdown-empty">No actions available.</div>}
    </div>
  </Surface>;
}

export function DropdownMenu({ trigger, items, 'aria-label': label, align = 'end', className, onOpenChange, open: controlledOpen }: DropdownMenuProps) {
  const uid = useId();
  const menuId = `menu-${uid}`;
  const anchor = useRef<HTMLButtonElement>(null);
  const [internalOpen, setOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [initial, setInitial] = useState<'first' | 'last'>('first');
  const close = useCallback((restore = false) => {
    setOpen(false); onOpenChange?.(false);
    if (restore && canOpen()) anchor.current?.focus({ preventScroll: true });
  }, [onOpenChange]);
  useEffect(() => { if (open && trigger.props.disabled) close(false); }, [trigger.props.disabled, open, close]);
  const show = (position: 'first' | 'last' = 'first') => {
    if (trigger.props.disabled || !canOpen()) return;
    setInitial(position); setOpen(true); onOpenChange?.(true);
  };
  const button = cloneElement(trigger, {
    ref: (element) => { anchor.current = element; setRef(trigger.props.ref, element); },
    type: trigger.props.type || 'button',
    className: `${trigger.props.className || ''} cw-menu-trigger`.trim(),
    'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? menuId : undefined,
    onClick: (event) => { trigger.props.onClick?.(event); if (!event.defaultPrevented) open ? close(false) : show(); },
    onKeyDown: (event) => {
      trigger.props.onKeyDown?.(event);
      if (event.defaultPrevented || open || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); show(event.key === 'ArrowUp' || event.key === 'End' ? 'last' : 'first');
    },
  });
  return <>{button}{open && <CommandSurface menuId={menuId} anchor={anchor} items={items} label={label || trigger.props['aria-label'] || trigger.props.title || 'Actions'} close={close} align={align} className={className} initial={initial} />}</>;
}

/** Shared command rows and keyboard behavior for pointer/keyboard file menus. */
export function DropdownContextMenu({ point, anchor, items, 'aria-label': label, onClose, className }: {
  point: Point; anchor: RefObject<HTMLElement | null>; items: readonly DropdownItem[];
  'aria-label': string; onClose: () => void; className?: string;
}) {
  const close = useCallback((restore = false) => {
    onClose();
    if (restore && canOpen()) anchor.current?.focus({ preventScroll: true });
  }, [onClose, anchor]);
  return <CommandSurface anchor={anchor} point={point} items={items} label={label} close={close} className={className} />;
}
