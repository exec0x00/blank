export type SessionLockState = 'pending' | 'confirmed';
const storageKey = 'codex.workspace-lock.v1';
const locationKey = 'workspace-lock';
let memory: SessionLockState | undefined;

export const UNCONFIRMED_LOCK_MESSAGE = 'This workspace is hidden, but server sign-out is unconfirmed. Retry to close the server session.';
const state = (value: unknown): SessionLockState | undefined => value === 'pending' || value === 'confirmed' ? value : undefined;

/** Only a nonsecret lock preference is stored. Cookies remain HTTP-only. */
export function readSessionLock(): SessionLockState | undefined {
  if (typeof window === 'undefined') return memory;
  let saved: SessionLockState | undefined;
  try { saved = state(window.localStorage.getItem(storageKey)); } catch { /* The URL also preserves this tab's lock. */ }
  const location = state(new URL(window.location.href).searchParams.get(locationKey));
  if ([memory, saved, location].includes('pending')) return 'pending';
  return location ?? saved ?? memory;
}

function writeLocation(value?: SessionLockState): void {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(locationKey, value);
  else url.searchParams.delete(locationKey);
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url);
}

export function rememberSessionLock(value: SessionLockState): void {
  memory = value;
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(storageKey, value); } catch { /* Some embedded browsers disable storage. */ }
  // A per-tab marker prevents reload from accepting the still-valid cookie
  // after failed logout, including when browser storage is unavailable.
  try { writeLocation(value); } catch { /* Keep the storage and in-memory guard. */ }
}

/** Call only after an explicit password login and its bootstrap both succeed. */
export function clearSessionLock(): void {
  memory = undefined;
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(storageKey); } catch { /* The local URL remains independent. */ }
  try { writeLocation(); } catch { /* A retained lock safely asks for sign-in again. */ }
}
