import { describe, expect, it } from 'vitest';
import { AGENT_PANE_MIN, EDITOR_PANE_MIN, EXPLORER_PANE_MIN, calculatePaneGeometry, paneResizePreferences,
  validAgentWidthRatio, validExplorerWidth, type PaneGeometryInput } from '../client/pane-geometry';

const input: PaneGeometryInput = { width: 1500, profile: 'desktop', agentVisible: true, editorVisible: true, explorerVisible: true };

describe('workspace pane geometry', () => {
  it('fits all three panes and both dividers without changing saved desired sizes', () => {
    const preferred = { ...input, agentWidthRatio: 0.6, explorerWidth: 400 };
    const wide = calculatePaneGeometry(preferred);
    const narrow = calculatePaneGeometry({ ...preferred, width: 920, profile: 'laptop' });
    expect(wide.agent).toBeGreaterThan(narrow.agent);
    expect(narrow.agent).toBeGreaterThanOrEqual(AGENT_PANE_MIN);
    expect(narrow.editor).toBeGreaterThanOrEqual(EDITOR_PANE_MIN);
    expect(narrow.explorer).toBeGreaterThanOrEqual(EXPLORER_PANE_MIN);
    expect(narrow.agent + narrow.outerDivider + narrow.editor + narrow.innerDivider + narrow.explorer + narrow.editorFrame).toBeCloseTo(920, 8);
    expect(preferred).toMatchObject({ agentWidthRatio: 0.6, explorerWidth: 400 });
    expect(calculatePaneGeometry(preferred)).toEqual(wide);
  });

  it('moves only the agent/editor boundary while the explorer retains its size', () => {
    const start = calculatePaneGeometry({ ...input, explorerWidth: 260 });
    const nextPreferences = paneResizePreferences('agent', start.agent + 100, start);
    const next = calculatePaneGeometry({ ...input, explorerWidth: 260, ...nextPreferences });
    expect(next.agent - start.agent).toBeCloseTo(100, 2);
    expect(start.editor - next.editor).toBeCloseTo(100, 2);
    expect(next.explorer).toBe(start.explorer);
  });

  it('moves only the editor/explorer boundary even when the desired agent ratio was clamped', () => {
    const preferred = { ...input, width: 1200, agentWidthRatio: 0.7, explorerWidth: 360 };
    const start = calculatePaneGeometry(preferred);
    expect(start.agent).toBeLessThan(start.available * preferred.agentWidthRatio);
    const nextPreferences = paneResizePreferences('explorer', start.explorer - 100, start);
    const next = calculatePaneGeometry({ ...preferred, ...nextPreferences });
    expect(next.explorer).toBe(start.explorer - 100);
    expect(next.agent).toBeCloseTo(start.agent, 2);
    expect(next.editor - start.editor).toBeCloseTo(100, 2);
  });

  it('gives a visible pane the hidden pane space and restores the same preference afterward', () => {
    const preferred = { ...input, agentWidthRatio: 0.45, explorerWidth: 280 };
    const start = calculatePaneGeometry(preferred);
    const editorOnly = calculatePaneGeometry({ ...preferred, agentVisible: false });
    expect(editorOnly.agent).toBe(0);
    expect(editorOnly.outerDivider).toBe(0);
    expect(editorOnly.editorGroup).toBe(input.width);
    expect(editorOnly.explorer).toBe(start.explorer);
    const agentOnly = calculatePaneGeometry({ ...preferred, editorVisible: false });
    expect(agentOnly.agent).toBe(input.width);
    expect(agentOnly.editorGroup + agentOnly.explorer + agentOnly.innerDivider + agentOnly.outerDivider).toBe(0);
    const noExplorer = calculatePaneGeometry({ ...preferred, explorerVisible: false });
    expect(noExplorer.explorer + noExplorer.innerDivider).toBe(0);
    expect(noExplorer.editor).toBeGreaterThan(start.editor);
    expect(calculatePaneGeometry(preferred)).toEqual(start);
  });

  it('uses the whole width for the editor when no agent or explorer is visible', () => {
    const result = calculatePaneGeometry({ ...input, agentVisible: false, explorerVisible: false });
    expect(result.editor + result.editorFrame).toBe(input.width);
    expect(result.agent + result.explorer + result.outerDivider + result.innerDivider).toBe(0);
  });

  it('keeps every width finite and fits unusually small host containers', () => {
    for (const width of [0, 1, 7, 8, 9, 17, 100, 500, 920, 1360, 4096]) {
      for (const ratio of [0.1, 0.4, 0.85]) {
        const result = calculatePaneGeometry({ ...input, width, agentWidthRatio: ratio, explorerWidth: 720 });
        expect(Object.values(result).every(value => Number.isFinite(value) && value >= 0)).toBe(true);
        expect(result.agent + result.outerDivider + result.editorGroup).toBeCloseTo(width, 7);
        expect(result.editor + result.explorer + result.innerDivider + result.editorFrame).toBeCloseTo(result.editorGroup, 7);
        expect(result.agent).toBeGreaterThanOrEqual(result.agentMin - 1e-7);
        expect(result.agent).toBeLessThanOrEqual(result.agentMax + 1e-7);
      }
    }
    expect(calculatePaneGeometry({ ...input, width: NaN }).width).toBe(0);
    expect(calculatePaneGeometry({ ...input, width: Infinity }).width).toBe(0);
  });

  it('makes the keyboard bounds attainable by the persisted ratio on large screens', () => {
    const start = calculatePaneGeometry({ ...input, width: 5000, explorerVisible: false });
    for (const value of [start.agentMin, start.agentMax]) {
      const preferences = paneResizePreferences('agent', value, start);
      expect(validAgentWidthRatio(preferences.agentWidthRatio)).toBe(true);
      expect(calculatePaneGeometry({ ...input, width: 5000, explorerVisible: false, ...preferences }).agent).toBeCloseTo(value, 2);
    }
  });

  it('rejects non-finite, out-of-range and secret-shaped preference values', () => {
    for (const value of [NaN, Infinity, -Infinity, 0, 0.09, 0.86, '0.4', null, { token: 'not a size' }]) expect(validAgentWidthRatio(value)).toBe(false);
    for (const value of [NaN, Infinity, 159, 721, 200.5, '240', null, { width: 240 }]) expect(validExplorerWidth(value)).toBe(false);
    expect(validAgentWidthRatio(0.1)).toBe(true);
    expect(validAgentWidthRatio(0.85)).toBe(true);
    expect(validExplorerWidth(160)).toBe(true);
    expect(validExplorerWidth(720)).toBe(true);
  });
});
