import type { UiLayoutProfile } from '../shared/types';

export const PANE_SPLITTER_SIZE = 8;
export const AGENT_PANE_MIN = 300;
export const EDITOR_PANE_MIN = 320;
export const EXPLORER_PANE_MIN = 180;
export const EXPLORER_PREFERENCE_MIN = 160;
export const EXPLORER_PREFERENCE_MAX = 720;
export const AGENT_RATIO_MIN = 0.1;
export const AGENT_RATIO_MAX = 0.85;
const EDITOR_FRAME = 2;

export type ResizablePane = 'agent' | 'explorer';
export interface PanePreferences { agentWidthRatio?: number; explorerWidth?: number }
export interface PaneGeometryInput extends PanePreferences {
  width: number;
  profile: UiLayoutProfile;
  agentVisible: boolean;
  editorVisible: boolean;
  explorerVisible: boolean;
}
export interface PaneGeometry {
  width: number;
  /** Space shared by the outer panes, after their divider. */
  available: number;
  agent: number;
  editorGroup: number;
  editor: number;
  explorer: number;
  outerDivider: number;
  innerDivider: number;
  editorFrame: number;
  agentMin: number;
  agentMax: number;
  explorerMin: number;
  explorerMax: number;
}

const finite = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
export const clampPaneSize = (value: number, min: number, max: number) => Math.min(Math.max(min, max), Math.max(min, finite(value) ? value : min));
export const validAgentWidthRatio = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= AGENT_RATIO_MIN && value <= AGENT_RATIO_MAX;
export const validExplorerWidth = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= EXPLORER_PREFERENCE_MIN && value <= EXPLORER_PREFERENCE_MAX;

/**
 * Resolve only the rendered sizes. In particular, shrinking a viewport must not
 * turn a temporary clamp into a new saved preference.
 */
export function calculatePaneGeometry(input: PaneGeometryInput): PaneGeometry {
  const width = finite(input.width) ? Math.max(0, input.width) : 0;
  const both = input.agentVisible && input.editorVisible;
  const outerDivider = both ? Math.min(width, PANE_SPLITTER_SIZE) : 0;
  const available = width - outerDivider;
  const frame = input.editorVisible ? Math.min(available, EDITOR_FRAME) : 0;
  const hasExplorer = input.editorVisible && input.explorerVisible;
  const innerDivider = hasExplorer ? Math.min(Math.max(0, available - frame), PANE_SPLITTER_SIZE) : 0;
  const paneSpace = Math.max(0, available - frame - innerDivider);
  const requestedMinimum = (input.agentVisible ? AGENT_PANE_MIN : 0) + (input.editorVisible ? EDITOR_PANE_MIN : 0) + (hasExplorer ? EXPLORER_PANE_MIN : 0);
  // Normally the desktop/laptop breakpoints provide all three usable minima.
  // A very small embedding/container still fits instead of overflowing its host.
  const scale = requestedMinimum ? Math.min(1, paneSpace / requestedMinimum) : 0;
  const agentMin = input.agentVisible ? Math.max(AGENT_PANE_MIN * scale, both && scale === 1 ? available * AGENT_RATIO_MIN : 0) : 0;
  const editorMin = input.editorVisible ? EDITOR_PANE_MIN * scale : 0;
  const explorerMin = hasExplorer ? EXPLORER_PANE_MIN * scale : 0;
  const globalExplorerMax = hasExplorer ? Math.max(explorerMin, Math.min(EXPLORER_PREFERENCE_MAX, paneSpace - agentMin - editorMin)) : 0;
  const defaultExplorer = input.profile === 'laptop' ? 200 : 216;
  const explorer = hasExplorer ? clampPaneSize(validExplorerWidth(input.explorerWidth) ? input.explorerWidth : defaultExplorer, explorerMin, globalExplorerMax) : 0;
  const agentMax = input.agentVisible ? Math.max(agentMin, Math.min(both ? available * AGENT_RATIO_MAX : available,
    available - (input.editorVisible ? frame + innerDivider + editorMin + explorer : 0))) : 0;
  const defaultAgent = input.profile === 'laptop'
    ? clampPaneSize(available * 0.42, 360, 460)
    : clampPaneSize(available * 0.36, 380, 640);
  const agent = input.agentVisible ? input.editorVisible
    ? clampPaneSize(validAgentWidthRatio(input.agentWidthRatio) ? available * input.agentWidthRatio : defaultAgent, agentMin, agentMax)
    : available : 0;
  const editorGroup = input.editorVisible ? Math.max(0, available - agent) : 0;
  const editor = input.editorVisible ? Math.max(0, editorGroup - frame - innerDivider - explorer) : 0;
  const explorerMax = hasExplorer ? Math.max(explorerMin, Math.min(EXPLORER_PREFERENCE_MAX, editorGroup - frame - innerDivider - editorMin)) : 0;
  return { width, available, agent, editorGroup, editor, explorer, outerDivider, innerDivider, editorFrame: frame,
    agentMin: both ? agentMin : agent, agentMax: both ? agentMax : agent, explorerMin, explorerMax };
}

/** Save an explicit gesture, preserving the non-adjacent pane's rendered size. */
export function paneResizePreferences(pane: ResizablePane, size: number, geometry: PaneGeometry): PanePreferences {
  const agentWidthRatio = (pixels: number) => clampPaneSize(Number((pixels / Math.max(1, geometry.available)).toFixed(6)), AGENT_RATIO_MIN, AGENT_RATIO_MAX);
  if (pane === 'agent') return { agentWidthRatio: agentWidthRatio(clampPaneSize(size, geometry.agentMin, geometry.agentMax)) };
  const explorerWidth = Math.round(clampPaneSize(size, geometry.explorerMin, geometry.explorerMax));
  return {
    explorerWidth: clampPaneSize(explorerWidth, EXPLORER_PREFERENCE_MIN, EXPLORER_PREFERENCE_MAX),
    // If the agent was clamped by a wide explorer, releasing the explorer must
    // not cause the agent to jump. This is an explicit resize, unlike a viewport
    // change, so pinning its current ratio is part of the new layout choice.
    ...(geometry.agent > 0 && geometry.editorGroup > 0 ? { agentWidthRatio: agentWidthRatio(geometry.agent) } : {}),
  };
}
