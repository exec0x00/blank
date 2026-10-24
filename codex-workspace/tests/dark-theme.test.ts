import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../shared/types';
import { applyDarkTheme, darkSettings } from '../client/theme';

const settings: AppSettings = {
  model: 'gpt-daybreak-red-latest', reasoningEffort: 'max', webSearchMode: 'live',
  autoApprove: true, theme: 'dark', fontSize: 19, wordWrap: true,
  provider: 'openai', apiKeyConfigured: true, agentConfigured: true,
};

afterEach(() => vi.unstubAllGlobals());

describe('dark-only client settings', () => {
  it.each(['light', 'system', undefined])('normalizes a legacy %s response without altering agent or editor preferences', theme => {
    // Persisted state and in-flight responses from older releases are runtime
    // inputs, even though the current TypeScript contract only permits dark.
    const legacy = Object.freeze({ ...settings, theme });
    expect(darkSettings(legacy as unknown as AppSettings)).toEqual(settings);
    expect(legacy.theme).toBe(theme);
  });

  it('keeps normalization safe to repeat without mutating shared settings', () => {
    const original = Object.freeze({ ...settings });
    expect(darkSettings(darkSettings(original))).toEqual(settings);
    expect(original).toEqual(settings);
  });

  it('applies the dark browser appearance even when browser storage is unavailable', () => {
    const root = { dataset: { theme: 'light' }, style: { colorScheme: 'light' } };
    const metadata = new Map([
      ['meta[name="color-scheme"]', 'light dark'],
      ['meta[name="theme-color"]', '#ffffff'],
    ]);
    vi.stubGlobal('document', {
      documentElement: root,
      querySelector: (selector: string) => metadata.has(selector) ? {
        setAttribute: (_name: string, value: string) => metadata.set(selector, value),
      } : null,
    });
    vi.stubGlobal('localStorage', { removeItem: () => { throw new Error('Browser storage is disabled.'); } });
    expect(() => applyDarkTheme()).not.toThrow();
    expect(root.dataset.theme).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
    expect(metadata.get('meta[name="color-scheme"]')).toBe('dark');
    expect(metadata.get('meta[name="theme-color"]')).toBe('#090909');
  });
});
