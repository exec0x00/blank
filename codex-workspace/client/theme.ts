import type { AppSettings } from '../shared/types';

/** The workspace has one appearance, including before session restoration. */
export function applyDarkTheme(): void {
  document.documentElement.dataset.theme = 'dark';
  document.documentElement.style.colorScheme = 'dark';
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', 'dark');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#090909');
  try { localStorage.removeItem('codex.theme'); } catch { /* Browser storage is optional. */ }
}

/** A stale response from an older release must not restore a retired theme. */
export function darkSettings(settings: AppSettings): AppSettings {
  return { ...settings, theme: 'dark' };
}
