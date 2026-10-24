import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { UiLayoutProfile } from '../shared/types';
import { calculatePaneGeometry, paneResizePreferences, type PaneGeometry, type PanePreferences, type ResizablePane } from './pane-geometry';
import { setUiLayout } from './ui-state';
import type { PaneSplitterControl } from './components/PaneSplitter';

export interface EditorPaneSizing {
  wide: boolean;
  explorerWidth: number;
  explorerControl: PaneSplitterControl;
}
interface Options {
  profile: UiLayoutProfile;
  preferences?: PanePreferences;
  workspaceId?: string;
  agentVisible: boolean;
  editorVisible: boolean;
  explorerVisible: boolean;
  disabled: boolean;
}
interface ResizeSession { pane: ResizablePane; scope: string; geometry: PaneGeometry }
interface Preview { scope: string; preferences: PanePreferences }

/** Render live widths locally and write only completed gestures to durable UI state. */
export function usePaneSizing(options: Options) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const session = useRef<ResizeSession | null>(null);
  const wide = options.profile === 'desktop' || options.profile === 'laptop';
  const scope = [options.workspaceId || '', options.profile, options.agentVisible ? 1 : 0, options.editorVisible ? 1 : 0,
    options.explorerVisible ? 1 : 0, options.disabled ? 1 : 0, Math.round(width * 100) / 100].join(':');
  const preferences = preview?.scope === scope ? { ...options.preferences, ...preview.preferences } : options.preferences;
  const geometry = useMemo(() => calculatePaneGeometry({ width, profile: options.profile,
    agentVisible: options.agentVisible, editorVisible: options.editorVisible, explorerVisible: options.explorerVisible,
    ...preferences }), [width, options.profile, options.agentVisible, options.editorVisible, options.explorerVisible,
    preferences?.agentWidthRatio, preferences?.explorerWidth]);
  const latest = useRef({ options, scope, geometry, wide });
  latest.current = { options, scope, geometry, wide };

  useEffect(() => {
    if (!element) return;
    const measure = () => { const next = element.getBoundingClientRect().width; if (next > 0) setWidth(next); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  useEffect(() => {
    if (session.current?.scope !== scope) session.current = null;
    setPreview(previous => previous && previous.scope !== scope ? null : previous);
  }, [scope]);

  const cancel = useCallback(() => { session.current = null; setPreview(null); }, []);
  const begin = useCallback((pane: ResizablePane) => {
    const current = latest.current;
    if (current.options.disabled || !current.wide || !current.options.workspaceId) return;
    session.current = { pane, scope: current.scope, geometry: current.geometry };
  }, []);
  const apply = useCallback((pane: ResizablePane, value: number, commit: boolean) => {
    const current = latest.current;
    const active = session.current;
    if (!active || active.pane !== pane || active.scope !== current.scope || current.options.disabled || !current.wide) { cancel(); return; }
    const changed = paneResizePreferences(pane, value, active.geometry);
    if (!commit) { setPreview({ scope: current.scope, preferences: changed }); return; }
    // A click without a drag, or dragging back to the starting position, must
    // not replace an unclamped preference with today's smaller rendered size.
    const initial = pane === 'agent' ? active.geometry.agent : active.geometry.explorer;
    const final = pane === 'agent' ? value : Math.round(value);
    if (Math.abs(final - initial) >= 0.5) setUiLayout(current.options.profile, changed);
    session.current = null;
    setPreview(null);
  }, [cancel]);
  const control = (pane: ResizablePane): PaneSplitterControl => ({
    value: pane === 'agent' ? geometry.agent : geometry.explorer,
    min: pane === 'agent' ? geometry.agentMin : geometry.explorerMin,
    max: pane === 'agent' ? geometry.agentMax : geometry.explorerMax,
    disabled: options.disabled || !wide || !options.workspaceId || !width,
    sessionKey: scope,
    onStart: () => begin(pane),
    onChange: (value) => apply(pane, value, false),
    onCommit: (value) => apply(pane, value, true),
    onCancel: cancel,
  });
  return {
    stageRef: setElement,
    stageStyle: { '--agent-pane-width': `${geometry.agent}px` } as CSSProperties,
    enabled: wide && options.agentVisible && options.editorVisible,
    agentControl: control('agent'),
    editorSizing: { wide, explorerWidth: geometry.explorer, explorerControl: control('explorer') } satisfies EditorPaneSizing,
  };
}
