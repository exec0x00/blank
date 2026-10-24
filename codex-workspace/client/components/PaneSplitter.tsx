import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { clampPaneSize } from '../pane-geometry';
import './pane-splitter.css';

export interface PaneSplitterControl {
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  sessionKey: string;
  onStart: () => void;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
  onCancel: () => void;
}
interface PaneSplitterProps extends PaneSplitterControl {
  label: string;
  controls: string;
  /** A pane on the right grows when the divider moves left. */
  direction?: 1 | -1;
  className?: string;
}
interface Drag {
  pointerId: number;
  startX: number;
  value: number;
  latest: number;
  sessionKey: string;
  element: HTMLDivElement;
  frame: number | null;
  restoreBody: () => void;
}

export default function PaneSplitter(props: PaneSplitterProps) {
  const descriptionId = useId();
  const drag = useRef<Drag | null>(null);
  const latestProps = useRef(props);
  latestProps.current = props;
  const [dragging, setDragging] = useState(false);

  const finish = (commit: boolean) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (current.frame !== null) cancelAnimationFrame(current.frame);
    current.restoreBody();
    try { if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId); } catch { /* The browser may have canceled capture already. */ }
    setDragging(false);
    const next = latestProps.current;
    if (commit && !next.disabled && current.sessionKey === next.sessionKey) next.onCommit(clampPaneSize(current.latest, next.min, next.max));
    else next.onCancel();
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    const current = drag.current;
    if (current && (props.disabled || props.sessionKey !== current.sessionKey)) finishRef.current(false);
  }, [props.disabled, props.sessionKey]);
  useEffect(() => {
    const cancel = () => finishRef.current(false);
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !drag.current) return;
      event.preventDefault(); event.stopPropagation(); cancel();
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('codex:session-locked', cancel);
    window.addEventListener('codex:session-expired', cancel);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('codex:session-locked', cancel);
      window.removeEventListener('codex:session-expired', cancel);
      const current = drag.current;
      if (current) {
        drag.current = null;
        if (current.frame !== null) cancelAnimationFrame(current.frame);
        current.restoreBody();
        try { if (current.element.hasPointerCapture(current.pointerId)) current.element.releasePointerCapture(current.pointerId); } catch { /* Detached capture is already canceled. */ }
        latestProps.current.onCancel();
      }
    };
  }, []);

  const start = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (props.disabled || props.max <= props.min || event.button !== 0 || event.isPrimary === false || drag.current || document.body.dataset.resizingPane === 'true') return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { return; }
    props.onStart();
    const previous = document.body.dataset.resizingPane;
    document.body.dataset.resizingPane = 'true';
    drag.current = { pointerId: event.pointerId, startX: event.clientX, value: props.value, latest: props.value,
      sessionKey: props.sessionKey, element: event.currentTarget, frame: null,
      restoreBody: () => { if (previous === undefined) delete document.body.dataset.resizingPane; else document.body.dataset.resizingPane = previous; } };
    setDragging(true);
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    current.latest = clampPaneSize(current.value + (event.clientX - current.startX) * (props.direction ?? 1), props.min, props.max);
    if (current.frame === null) current.frame = requestAnimationFrame(() => {
      current.frame = null;
      if (drag.current === current) latestProps.current.onChange(current.latest);
    });
  };
  const keyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (props.disabled || drag.current || event.altKey || event.ctrlKey || event.metaKey) return;
    const step = event.shiftKey ? 48 : 16;
    let value: number;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') value = props.value + (event.key === 'ArrowRight' ? 1 : -1) * (props.direction ?? 1) * step;
    else if (event.key === 'Home') value = props.min;
    else if (event.key === 'End') value = props.max;
    else return;
    event.preventDefault(); event.stopPropagation();
    const next = clampPaneSize(value, props.min, props.max);
    if (Math.abs(next - props.value) < 0.01) return;
    props.onStart(); props.onChange(next); props.onCommit(next);
  };
  return <div role="separator" aria-label={props.label} aria-orientation="vertical" aria-controls={props.controls}
    aria-valuemin={Math.round(props.min)} aria-valuemax={Math.round(props.max)} aria-valuenow={Math.round(clampPaneSize(props.value, props.min, props.max))}
    aria-valuetext={`${Math.round(props.value)} pixels`} aria-describedby={descriptionId} aria-disabled={props.disabled || props.max <= props.min || undefined}
    tabIndex={props.disabled || props.max <= props.min ? -1 : 0} data-resizing={dragging || undefined}
    className={`pane-splitter ${props.className || ''}`} onPointerDown={start} onPointerMove={move}
    onPointerUp={(event) => { if (event.pointerId === drag.current?.pointerId) { move(event); finish(true); } }}
    onPointerCancel={(event) => { if (event.pointerId === drag.current?.pointerId) finish(false); }}
    onLostPointerCapture={(event) => { if (event.pointerId === drag.current?.pointerId) finish(false); }} onKeyDown={keyDown}>
    <span className="pane-splitter-line" aria-hidden="true" />
    <span className="pane-splitter-grip" data-pane-splitter-grip aria-hidden="true"><span /></span>
    <span className="pane-splitter-instructions" id={descriptionId}>Use Left and Right to resize, Shift for a larger step, Home or End for the minimum or maximum width. Press Escape to cancel dragging.</span>
  </div>;
}
