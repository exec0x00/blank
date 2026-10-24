import path from 'node:path';
import { HttpError } from '../errors';

export type WorkspaceActivityKind = 'agent' | 'terminal' | 'git' | 'files' | 'extension' | 'worktree';
interface WorkspaceUse { removing: boolean; users: Map<symbol, WorkspaceActivityKind> }
const activity = new Map<string, WorkspaceUse>();
export interface WorkspaceRecoveryBarrier { recoveryId: string; message: string }
const recoveryBarriers = new Map<string, WorkspaceRecoveryBarrier>();

function key(workspacesDir: string, workspaceId: string): string {
  if (!path.isAbsolute(workspacesDir) || !/^[a-zA-Z0-9_-]{1,128}$/.test(workspaceId)) throw new Error('Workspace activity requires a registered workspace ID.');
  return `${path.resolve(workspacesDir)}\0${workspaceId}`;
}

function busy(): never {
  throw new HttpError(409, 'This repository is in use. Close its terminals and wait for agent, Git, and file operations to finish before removing the checkout.', 'WORKTREE_BUSY');
}

function assertRecoveryAdmission(id: string, expectedRecoveryId?: string): void {
  const recovery = recoveryBarriers.get(id);
  if (recovery && recovery.recoveryId !== expectedRecoveryId) {
    throw new HttpError(409, recovery.message, 'FILE_REWIND_RECOVERY_REQUIRED');
  }
}

/** Only the rewind service installs these after verifying its signed durable
 * records. A barrier grants no permission and carries no process/file handles. */
export function setWorkspaceRecoveryBarrier(workspacesDir: string, workspaceId: string, barrier: WorkspaceRecoveryBarrier): void {
  const id = key(workspacesDir, workspaceId), previous = recoveryBarriers.get(id);
  if (!barrier.recoveryId || barrier.recoveryId.length > 100 || !barrier.message || barrier.message.length > 1000) throw new Error('Invalid workspace recovery barrier.');
  if (previous && previous.recoveryId !== barrier.recoveryId) throw new HttpError(409, 'A different recovery already owns this workspace.', 'FILE_REWIND_RECOVERY_REQUIRED');
  recoveryBarriers.set(id, { ...barrier });
}

export function clearWorkspaceRecoveryBarrier(workspacesDir: string, workspaceId: string, recoveryId: string): void {
  const id = key(workspacesDir, workspaceId);
  if (recoveryBarriers.get(id)?.recoveryId === recoveryId) recoveryBarriers.delete(id);
}

export function workspaceRecoveryBarrier(workspacesDir: string, workspaceId: string): WorkspaceRecoveryBarrier | null {
  const barrier = recoveryBarriers.get(key(workspacesDir, workspaceId));
  return barrier ? { ...barrier } : null;
}

/** Hold until native work has drained, including a terminal's owned descendants. */
export function acquireWorkspaceActivity(workspacesDir: string, workspaceId: string, kind: WorkspaceActivityKind): () => void {
  const id = key(workspacesDir, workspaceId);
  assertRecoveryAdmission(id);
  let state = activity.get(id);
  if (state?.removing) busy();
  if (!state) { state = { removing: false, users: new Map() }; activity.set(id, state); }
  const token = Symbol(kind);
  state.users.set(token, kind);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state!.users.delete(token);
    if (!state!.removing && !state!.users.size && activity.get(id) === state) activity.delete(id);
  };
}

export function workspaceIsBusy(workspacesDir: string, workspaceId: string): boolean {
  const state = activity.get(key(workspacesDir, workspaceId));
  return recoveryBarriers.has(key(workspacesDir, workspaceId)) || !!state && (state.removing || state.users.size > 0);
}

/** Read-only provenance for checkpoint capture. A caller cannot release another
 * operation's lease or turn this observation into a mutation permission. */
export function workspaceActivityKinds(workspacesDir: string, workspaceId: string): {
  exclusive: boolean; counts: Partial<Record<WorkspaceActivityKind, number>>;
} {
  const state = activity.get(key(workspacesDir, workspaceId));
  const counts: Partial<Record<WorkspaceActivityKind, number>> = {};
  for (const kind of state?.users.values() ?? []) counts[kind] = (counts[kind] ?? 0) + 1;
  return { exclusive: state?.removing === true || recoveryBarriers.has(key(workspacesDir, workspaceId)), counts };
}

/** PTYs are real host processes: their initial cwd does not prevent a command
 * from writing another workspace. Checkpoint attribution uses this global
 * count rather than pretending that a terminal lease is filesystem isolation. */
export function allWorkspaceActivityKinds(workspacesDir: string): Partial<Record<WorkspaceActivityKind, number>> {
  if (!path.isAbsolute(workspacesDir)) throw new Error('Workspace activity requires an absolute registry directory.');
  const prefix = `${path.resolve(workspacesDir)}\0`, counts: Partial<Record<WorkspaceActivityKind, number>> = {};
  for (const [id, state] of activity) if (id.startsWith(prefix)) for (const kind of state.users.values()) counts[kind] = (counts[kind] ?? 0) + 1;
  return counts;
}

/** Atomic admission barrier in the app process; native Git still rechecks dirty
 * files itself. The callback must keep this gate until Git and registry writes end.
 */
export async function withWorkspaceRemoval<T>(workspacesDir: string, workspaceId: string, operation: () => Promise<T>): Promise<T> {
  return exclusiveActivity(workspacesDir, workspaceId, operation);
}

/** An explicit recovery review may enter only its own still-blocked workspace.
 * Other writers and removals remain refused until durable acknowledgement. */
export async function withWorkspaceRecoveryReview<T>(workspacesDir: string, workspaceId: string, recoveryId: string, operation: () => Promise<T>): Promise<T> {
  return exclusiveActivity(workspacesDir, workspaceId, operation, recoveryId);
}

async function exclusiveActivity<T>(workspacesDir: string, workspaceId: string, operation: () => Promise<T>, expectedRecoveryId?: string): Promise<T> {
  const id = key(workspacesDir, workspaceId);
  assertRecoveryAdmission(id, expectedRecoveryId);
  const existing = activity.get(id);
  if (existing?.removing || existing?.users.size) busy();
  const state: WorkspaceUse = existing ?? { removing: false, users: new Map() };
  state.removing = true;
  activity.set(id, state);
  try { return await operation(); }
  finally {
    state.removing = false;
    if (!state.users.size && activity.get(id) === state) activity.delete(id);
  }
}
