export interface WorkspaceRewindSnapshot {
  dirtyPaths: string[];
}

export interface WorkspaceRewindReleaseOptions {
  refresh?: boolean;
}

export interface WorkspaceRewindLease extends WorkspaceRewindSnapshot {
  release(options?: WorkspaceRewindReleaseOptions): void;
}

/** Ordinary create/copy operations release this lease when their own request
 * settles. It carries no rewind plan, recovery state or persisted intent. */
export interface WorkspaceExternalMutationLease {
  release(options?: WorkspaceRewindReleaseOptions): void;
}

export interface WorkspaceRewindEditor {
  /** Read live buffers and reject an unavailable or busy editor session. */
  read(): WorkspaceRewindSnapshot;
  /** Synchronously stop editor writes before returning the final live snapshot. */
  acquire(): WorkspaceRewindLease;
  /** Check destination conflicts without collecting every unrelated dirty tab. */
  readExternal?(paths: readonly string[]): void;
  /** Stop local writes synchronously and keep every existing buffer intact. */
  acquireExternal?(paths: readonly string[]): WorkspaceExternalMutationLease;
}

export const MAX_REWIND_DIRTY_PATHS = 100;
export const WORKSPACE_EXTERNAL_MUTATION_LIMITS = Object.freeze({ maxPaths: 100, maxPathLength: 4096 });

function mutationPaths(workspaceId: string, paths: readonly string[]): readonly string[] {
  if (typeof workspaceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(workspaceId)) throw new Error('Select the current workspace before saving a file.');
  if (!Array.isArray(paths) || !paths.length || paths.length > WORKSPACE_EXTERNAL_MUTATION_LIMITS.maxPaths) {
    throw new Error(`A file operation must identify between 1 and ${WORKSPACE_EXTERNAL_MUTATION_LIMITS.maxPaths} destination paths.`);
  }
  for (const path of paths) {
    if (typeof path !== 'string' || !path || path.length > WORKSPACE_EXTERNAL_MUTATION_LIMITS.maxPathLength
      || /[\\\u0000-\u001f\u007f]/.test(path) || path.startsWith('/') || /^[a-z]:/i.test(path)
      || path.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('Use a valid workspace-relative destination path.');
    }
  }
  return Object.freeze([...new Set(paths)]);
}

function dirtyPaths(snapshots: Iterable<WorkspaceRewindSnapshot>): string[] {
  const paths = new Set<string>();
  for (const snapshot of snapshots) {
    for (const path of snapshot.dirtyPaths) {
      paths.add(path);
      if (paths.size > MAX_REWIND_DIRTY_PATHS) {
        throw new Error(`File rewind supports at most ${MAX_REWIND_DIRTY_PATHS} unsaved editor paths. Save or close some edited files before retrying.`);
      }
    }
  }
  return [...paths];
}

interface EditorRegistration {
  editor: WorkspaceRewindEditor;
}

interface HeldLease {
  kind: 'rewind' | 'external';
  paths?: readonly string[];
  participants: Map<EditorRegistration, WorkspaceExternalMutationLease>;
}

/**
 * Browser-local write coordination, independent of Monaco and React. The server
 * still owns the repository snapshot and verifies its current file versions.
 * A pending commit keeps its workspace lease even while no editor is mounted.
 */
export class WorkspaceRewindRegistry {
  private editors = new Map<string, Set<EditorRegistration>>();
  private leases = new Map<string, HeldLease>();

  register(workspaceId: string, editor: WorkspaceRewindEditor): () => void {
    const registration = { editor };
    let editors = this.editors.get(workspaceId);
    if (!editors) { editors = new Set(); this.editors.set(workspaceId, editors); }
    editors.add(registration);
    const active = this.leases.get(workspaceId);
    if (active) {
      // A freshly mounted editor joins before it can restore/open saved tabs.
      // It must not make a pending request writable just by changing layouts.
      try {
        if (active.kind === 'external') {
          if (!editor.readExternal || !editor.acquireExternal) throw new Error('The editor cannot safely join the current file operation.');
          active.participants.set(registration, editor.acquireExternal(active.paths!));
        } else active.participants.set(registration, editor.acquire());
      }
      catch (error) {
        editors.delete(registration);
        if (!editors.size) this.editors.delete(workspaceId);
        throw error;
      }
    }
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      const current = this.editors.get(workspaceId);
      current?.delete(registration);
      if (current && !current.size) this.editors.delete(workspaceId);
      const held = this.leases.get(workspaceId);
      const participant = held?.participants.get(registration);
      held?.participants.delete(registration);
      participant?.release();
    };
  }

  active(workspaceId: string): boolean {
    return this.leases.has(workspaceId);
  }

  rewinding(workspaceId: string): boolean {
    return this.leases.get(workspaceId)?.kind === 'rewind';
  }

  blockedReason(workspaceId: string): string | undefined {
    const lease = this.leases.get(workspaceId);
    return lease?.kind === 'rewind' ? 'Wait for the current file rewind to finish.'
      : lease ? 'Wait for the current file operation to finish.' : undefined;
  }

  read(workspaceId: string): WorkspaceRewindSnapshot {
    const blocked = this.blockedReason(workspaceId);
    if (blocked) throw new Error(blocked);
    return { dirtyPaths: dirtyPaths([...(this.editors.get(workspaceId) ?? [])].map(({ editor }) => editor.read())) };
  }

  acquire(workspaceId: string): WorkspaceRewindLease {
    this.read(workspaceId);
    const held: HeldLease = { kind: 'rewind', participants: new Map() };
    this.leases.set(workspaceId, held);
    try {
      const acquired: WorkspaceRewindLease[] = [];
      for (const registration of this.editors.get(workspaceId) ?? []) {
        const participant = registration.editor.acquire();
        held.participants.set(registration, participant);
        acquired.push(participant);
      }
      const paths = dirtyPaths(acquired);
      return {
        dirtyPaths: paths,
        release: options => this.release(workspaceId, held, options),
      };
    } catch (error) {
      try { this.release(workspaceId, held); }
      catch (releaseError) {
        throw new AggregateError([error, releaseError], 'The editor could not safely start file rewind. Your unsaved buffers are retained.');
      }
      throw error;
    }
  }

  acquireExternal(workspaceId: string, paths: readonly string[]): WorkspaceExternalMutationLease {
    const selected = mutationPaths(workspaceId, paths);
    const blocked = this.blockedReason(workspaceId);
    if (blocked) throw new Error(blocked);
    const editors = [...(this.editors.get(workspaceId) ?? [])];
    // Check every participant before changing any widget. An unready participant
    // is never treated as an empty editor or a successful dirty-buffer check.
    for (const { editor } of editors) {
      if (!editor.readExternal || !editor.acquireExternal) throw new Error('The editor cannot safely coordinate this file operation.');
      editor.readExternal(selected);
    }
    const held: HeldLease = { kind: 'external', paths: selected, participants: new Map() };
    this.leases.set(workspaceId, held);
    try {
      for (const registration of editors) held.participants.set(registration, registration.editor.acquireExternal!(selected));
      return { release: options => this.release(workspaceId, held, options) };
    } catch (error) {
      try { this.release(workspaceId, held); }
      catch (releaseError) { throw new AggregateError([error, releaseError], 'The editor could not safely start the file operation. Your buffers are retained.'); }
      throw error;
    }
  }

  private release(workspaceId: string, held: HeldLease, options?: WorkspaceRewindReleaseOptions): void {
    // A repeated or delayed response must never unlock a newer operation.
    if (this.leases.get(workspaceId) !== held) return;
    this.leases.delete(workspaceId);
    const participants = [...held.participants.values()];
    held.participants.clear();
    const failures: unknown[] = [];
    for (const participant of participants) {
      try { participant.release(options); }
      catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, held.kind === 'rewind'
      ? 'The editor could not finish releasing its file rewind guard.' : 'The editor could not finish releasing its file operation guard.');
  }
}

const registry = new WorkspaceRewindRegistry();

export const registerWorkspaceRewindGuard = (workspaceId: string, editor: WorkspaceRewindEditor): (() => void) => registry.register(workspaceId, editor);
export const isWorkspaceRewinding = (workspaceId: string): boolean => registry.rewinding(workspaceId);
export const isWorkspaceWriteHeld = (workspaceId: string): boolean => registry.active(workspaceId);
export const workspaceWriteBlockedReason = (workspaceId: string): string | undefined => registry.blockedReason(workspaceId);
export const readWorkspaceRewindGuard = (workspaceId: string): WorkspaceRewindSnapshot => registry.read(workspaceId);
export const acquireWorkspaceRewindLease = (workspaceId: string): WorkspaceRewindLease => registry.acquire(workspaceId);
export const acquireWorkspaceExternalMutation = (workspaceId: string, paths: readonly string[]): WorkspaceExternalMutationLease => registry.acquireExternal(workspaceId, paths);
