import { describe, expect, it, vi } from 'vitest';
import { MAX_REWIND_DIRTY_PATHS, WorkspaceRewindRegistry, type WorkspaceRewindEditor, type WorkspaceRewindReleaseOptions } from '../client/workspace-rewind-guard';
import { acquireWorkspaceExternalMutation, acquireWorkspaceRewindLease, isWorkspaceRewinding, isWorkspaceWriteHeld, registerWorkspaceRewindGuard, WORKSPACE_EXTERNAL_MUTATION_LIMITS } from '../client/workspace-rewind-guard';

function editor(paths: string[] = []) {
  let buffers = paths;
  let frozen = false;
  let busy = false;
  const refreshed = vi.fn();
  const release = vi.fn((options?: WorkspaceRewindReleaseOptions) => {
    frozen = false;
    if (options?.refresh) refreshed();
  });
  const bridge: WorkspaceRewindEditor = {
    read: vi.fn(() => {
      if (busy) throw new Error('A save is still pending.');
      return { dirtyPaths: [...buffers] };
    }),
    acquire: vi.fn(() => {
      if (busy) throw new Error('A save is still pending.');
      frozen = true;
      return { dirtyPaths: [...buffers], release };
    }),
  };
  return {
    bridge, refreshed, release,
    isFrozen: () => frozen,
    busy: (value: boolean) => { busy = value; },
    edit: (paths: string[]) => { if (frozen) return false; buffers = paths; return true; },
  };
}

describe('workspace editor rewind coordination', () => {
  it('reads the latest unsaved paths again when acquiring, then blocks edits synchronously', async () => {
    const registry = new WorkspaceRewindRegistry();
    const main = editor(['notes.md']);
    registry.register('workspace', main.bridge);
    const preview = registry.read('workspace');
    expect(preview.dirtyPaths).toEqual(['notes.md']);
    main.edit(['notes.md', 'src/unsaved.ts']);
    const lease = registry.acquire('workspace');
    expect(lease.dirtyPaths).toEqual(['notes.md', 'src/unsaved.ts']);
    expect(main.isFrozen()).toBe(true);
    expect(main.edit(['raced.txt'])).toBe(false);
    await Promise.resolve();
    expect(main.edit(['late.txt'])).toBe(false);
    lease.release({ refresh: true });
    expect(main.refreshed).toHaveBeenCalledOnce();
    expect(registry.read('workspace').dirtyPaths).toEqual(['notes.md', 'src/unsaved.ts']);
    expect(main.edit(['after.txt'])).toBe(true);
    expect(preview.dirtyPaths).toEqual(['notes.md']);
  });

  it('refuses pending saves before freezing any editor', () => {
    const registry = new WorkspaceRewindRegistry();
    const first = editor(['draft.md']);
    const saving = editor(['other.md']);
    saving.busy(true);
    registry.register('workspace', first.bridge);
    registry.register('workspace', saving.bridge);
    expect(() => registry.acquire('workspace')).toThrow('A save is still pending.');
    expect(registry.active('workspace')).toBe(false);
    expect(first.bridge.acquire).not.toHaveBeenCalled();
    expect(first.edit(['preserved.md'])).toBe(true);
  });

  it('deduplicates dirty paths across editors and never truncates an oversized snapshot', () => {
    const registry = new WorkspaceRewindRegistry();
    const paths = Array.from({ length: MAX_REWIND_DIRTY_PATHS }, (_, index) => `drafts/文件-${index}.txt`);
    const first = editor(paths);
    const second = editor([paths[0]]);
    registry.register('workspace', first.bridge);
    registry.register('workspace', second.bridge);
    expect(registry.read('workspace').dirtyPaths).toEqual(paths);
    second.edit([paths[0], 'one-too-many.txt']);
    expect(() => registry.read('workspace')).toThrow('at most 100');
    expect(() => registry.acquire('workspace')).toThrow('at most 100');
    expect(first.bridge.acquire).not.toHaveBeenCalled();
    expect(registry.active('workspace')).toBe(false);
    second.edit([paths[0]]);
    const lease = registry.acquire('workspace');
    expect(lease.dirtyPaths).toHaveLength(100);
    lease.release();
  });

  it('rolls back acquired participants when a later editor becomes unavailable', () => {
    const registry = new WorkspaceRewindRegistry();
    const first = editor(['keep.md']);
    const unavailable = editor();
    registry.register('workspace', first.bridge);
    const unregister = registry.register('workspace', { ...unavailable.bridge, acquire: () => { throw new Error('Editor session changed.'); } });
    expect(() => registry.acquire('workspace')).toThrow('Editor session changed.');
    expect(first.isFrozen()).toBe(false);
    expect(first.release).toHaveBeenCalledOnce();
    expect(first.refreshed).not.toHaveBeenCalled();
    expect(registry.active('workspace')).toBe(false);
    unregister();
    const next = registry.acquire('workspace');
    expect(next.dirtyPaths).toEqual(['keep.md']);
    next.release();
  });

  it('validates the post-freeze snapshot and releases every participant if it grew too large', () => {
    const registry = new WorkspaceRewindRegistry();
    const source = editor();
    registry.register('workspace', {
      ...source.bridge,
      acquire: () => ({ ...source.bridge.acquire(), dirtyPaths: Array.from({ length: 101 }, (_, index) => `file-${index}`) }),
    });
    expect(() => registry.acquire('workspace')).toThrow('at most 100');
    expect(registry.active('workspace')).toBe(false);
    expect(source.isFrozen()).toBe(false);
  });

  it('retains an unresolved workspace lease after unmount and immediately guards a remount', () => {
    const registry = new WorkspaceRewindRegistry();
    const previous = editor(['keep-unsaved.md']);
    const unregister = registry.register('workspace', previous.bridge);
    const lease = registry.acquire('workspace');
    unregister();
    expect(registry.active('workspace')).toBe(true);
    expect(() => registry.acquire('workspace')).toThrow('current file rewind');
    const current = editor();
    registry.register('workspace', current.bridge);
    expect(current.isFrozen()).toBe(true);
    expect(current.edit(['must-wait.md'])).toBe(false);
    unregister();
    expect(current.isFrozen()).toBe(true);
    lease.release({ refresh: true });
    expect(current.isFrozen()).toBe(false);
    expect(current.refreshed).toHaveBeenCalledOnce();
    expect(previous.refreshed).not.toHaveBeenCalled();
  });

  it('holds a workspace with no mounted editor and leaves other workspaces usable', () => {
    const registry = new WorkspaceRewindRegistry();
    expect(registry.read('pending').dirtyPaths).toEqual([]);
    const lease = registry.acquire('pending');
    const unrelated = editor(['local-draft.txt']);
    registry.register('elsewhere', unrelated.bridge);
    expect(unrelated.edit(['new-local-draft.txt'])).toBe(true);
    const mounted = editor();
    registry.register('pending', mounted.bridge);
    expect(mounted.isFrozen()).toBe(true);
    const other = registry.acquire('elsewhere');
    expect(other.dirtyPaths).toEqual(['new-local-draft.txt']);
    lease.release();
    expect(registry.active('elsewhere')).toBe(true);
    expect(unrelated.isFrozen()).toBe(true);
    other.release();
  });

  it('does not let a delayed release or old unmount callback clear a newer lease', () => {
    const registry = new WorkspaceRewindRegistry();
    const source = editor(['draft.md']);
    const unregisterOld = registry.register('workspace', source.bridge);
    const old = registry.acquire('workspace');
    old.release();
    unregisterOld();
    const current = editor(['new-draft.md']);
    registry.register('workspace', current.bridge);
    const latest = registry.acquire('workspace');
    unregisterOld();
    old.release({ refresh: true });
    expect(registry.active('workspace')).toBe(true);
    expect(current.isFrozen()).toBe(true);
    expect(current.release).not.toHaveBeenCalled();
    latest.release({ refresh: true });
    latest.release({ refresh: true });
    expect(current.release).toHaveBeenCalledOnce();
    expect(current.refreshed).toHaveBeenCalledOnce();
  });

  it('releases the remaining editors and reports a participant cleanup failure', () => {
    const registry = new WorkspaceRewindRegistry();
    const first = editor();
    const second = editor(['retain.md']);
    registry.register('workspace', {
      ...first.bridge,
      acquire: () => ({ ...first.bridge.acquire(), release: () => { first.release(); throw new Error('Widget cleanup failed.'); } }),
    });
    registry.register('workspace', second.bridge);
    const lease = registry.acquire('workspace');
    expect(() => lease.release({ refresh: true })).toThrow('releasing its file rewind guard');
    expect(registry.active('workspace')).toBe(false);
    expect(second.isFrozen()).toBe(false);
    expect(second.refreshed).toHaveBeenCalledOnce();
    expect(registry.read('workspace').dirtyPaths).toEqual(['retain.md']);
  });
});

function externalEditor(paths: string[] = []) {
  let buffers = paths;
  let frozen = false;
  let busy = false;
  const refreshed = vi.fn();
  const release = vi.fn((options?: WorkspaceRewindReleaseOptions) => {
    frozen = false;
    if (options?.refresh) refreshed();
  });
  const assertAvailable = () => { if (busy) throw new Error('A destination save is pending.'); };
  const readExternal = vi.fn((_paths: readonly string[]) => assertAvailable());
  const acquireExternal = vi.fn((_paths: readonly string[]) => {
    assertAvailable();
    frozen = true;
    return { release };
  });
  const bridge: WorkspaceRewindEditor = {
    read: vi.fn(() => ({ dirtyPaths: [...buffers] })),
    acquire: vi.fn(() => {
      frozen = true;
      return { dirtyPaths: [...buffers], release };
    }),
    readExternal, acquireExternal,
  };
  return {
    bridge, readExternal, acquireExternal, release, refreshed,
    isFrozen: () => frozen,
    busy: (value: boolean) => { busy = value; },
    edit: (next: string[]) => { if (frozen) return false; buffers = next; return true; },
    buffers: () => [...buffers],
  };
}

describe('ordinary external workspace writes', () => {
  it('exposes an ordinary-write module lease without presenting it as a conversation rewind', () => {
    const workspaceId = 'external-mutation-module-fixture';
    const source = externalEditor(['keep.md']);
    const unregister = registerWorkspaceRewindGuard(workspaceId, source.bridge);
    let lease: ReturnType<typeof acquireWorkspaceExternalMutation> | undefined;
    try {
      lease = acquireWorkspaceExternalMutation(workspaceId, ['images/saved.png']);
      expect(source.acquireExternal).toHaveBeenCalledWith(['images/saved.png']);
      expect(source.bridge.acquire).not.toHaveBeenCalled();
      expect(isWorkspaceRewinding(workspaceId)).toBe(false);
      expect(isWorkspaceWriteHeld(workspaceId)).toBe(true);
      expect(() => acquireWorkspaceRewindLease(workspaceId)).toThrow();
      lease.release({ refresh: true });
      expect(isWorkspaceWriteHeld(workspaceId)).toBe(false);
      expect(source.refreshed).toHaveBeenCalledOnce();
      expect(source.buffers()).toEqual(['keep.md']);
    } finally {
      lease?.release();
      unregister();
    }
  });

  it('uses destination checks without applying the rewind dirty-path ceiling', async () => {
    const registry = new WorkspaceRewindRegistry();
    const drafts = Array.from({ length: MAX_REWIND_DIRTY_PATHS + 25 }, (_, index) => `drafts/unsaved-${index}.md`);
    const source = externalEditor(drafts);
    registry.register('workspace', source.bridge);
    const targets = ['images/generated.png', 'images/文件 with spaces.png'];
    const lease = registry.acquireExternal('workspace', targets);
    expect(source.readExternal).toHaveBeenCalledWith(targets);
    expect(source.acquireExternal).toHaveBeenCalledWith(targets);
    expect(source.bridge.read).not.toHaveBeenCalled();
    expect(source.bridge.acquire).not.toHaveBeenCalled();
    expect(lease).not.toHaveProperty('dirtyPaths');
    expect(registry.active('workspace')).toBe(true);
    expect(registry.rewinding('workspace')).toBe(false);
    expect(source.edit(['racing-editor-change.txt'])).toBe(false);
    await Promise.resolve();
    expect(source.isFrozen()).toBe(true);
    expect(source.buffers()).toEqual(drafts);
    lease.release({ refresh: true });
    expect(source.refreshed).toHaveBeenCalledOnce();
    expect(source.buffers()).toEqual(drafts);
    expect(source.edit(['later-edit.md'])).toBe(true);
  });

  it('prechecks every participant before freezing any editor', () => {
    const registry = new WorkspaceRewindRegistry();
    const first = externalEditor(['keep.md']);
    const pending = externalEditor();
    pending.busy(true);
    registry.register('workspace', first.bridge);
    registry.register('workspace', pending.bridge);
    expect(() => registry.acquireExternal('workspace', ['images/new.png'])).toThrow('A destination save is pending.');
    expect(first.readExternal).toHaveBeenCalledWith(['images/new.png']);
    expect(pending.readExternal).toHaveBeenCalledWith(['images/new.png']);
    expect(first.acquireExternal).not.toHaveBeenCalled();
    expect(pending.acquireExternal).not.toHaveBeenCalled();
    expect(registry.active('workspace')).toBe(false);
    expect(first.buffers()).toEqual(['keep.md']);
    pending.busy(false);
    const lease = registry.acquireExternal('workspace', ['images/new.png']);
    expect(first.isFrozen()).toBe(true);
    expect(pending.isFrozen()).toBe(true);
    lease.release();
  });

  it('rejects registered editors that cannot provide both external-write methods', () => {
    for (const unsupported of [
      editor(['draft.md']).bridge,
      { ...externalEditor().bridge, acquireExternal: undefined },
      { ...externalEditor().bridge, readExternal: undefined },
    ]) {
      const registry = new WorkspaceRewindRegistry();
      const first = externalEditor();
      registry.register('workspace', first.bridge);
      registry.register('workspace', unsupported);
      expect(() => registry.acquireExternal('workspace', ['images/new.png'])).toThrow();
      expect(registry.active('workspace')).toBe(false);
      expect(first.acquireExternal).not.toHaveBeenCalled();
      expect(unsupported.acquire).not.toHaveBeenCalled();
    }
  });

  it('never acquires an ordinary write and a rewind for the same workspace together', () => {
    const registry = new WorkspaceRewindRegistry();
    const source = externalEditor(['draft.md']);
    registry.register('workspace', source.bridge);
    const saving = registry.acquireExternal('workspace', ['images/first.png']);
    expect(() => registry.acquireExternal('workspace', ['images/second.png'])).toThrow();
    expect(() => registry.acquire('workspace')).toThrow();
    expect(() => registry.read('workspace')).toThrow();
    expect(source.acquireExternal).toHaveBeenCalledOnce();
    expect(source.bridge.acquire).not.toHaveBeenCalled();
    saving.release();
    const rewind = registry.acquire('workspace');
    expect(registry.rewinding('workspace')).toBe(true);
    expect(() => registry.acquireExternal('workspace', ['images/third.png'])).toThrow();
    expect(source.acquireExternal).toHaveBeenCalledOnce();
    rewind.release();
    expect(registry.active('workspace')).toBe(false);
    expect(registry.rewinding('workspace')).toBe(false);
  });

  it('reserves the workspace before calling editor freeze callbacks', () => {
    const registry = new WorkspaceRewindRegistry();
    const source = externalEditor(['keep.md']);
    registry.register('workspace', {
      ...source.bridge,
      acquireExternal: paths => {
        expect(registry.active('workspace')).toBe(true);
        expect(registry.rewinding('workspace')).toBe(false);
        expect(() => registry.acquire('workspace')).toThrow();
        expect(() => registry.acquireExternal('workspace', ['images/reentrant.png'])).toThrow();
        return source.acquireExternal(paths);
      },
    });
    const lease = registry.acquireExternal('workspace', ['images/selected.png']);
    expect(source.acquireExternal).toHaveBeenCalledOnce();
    expect(source.bridge.acquire).not.toHaveBeenCalled();
    lease.release();
  });

  it('unwinds a partial external acquisition and preserves every buffer when a later editor rejects it', () => {
    const registry = new WorkspaceRewindRegistry();
    const first = externalEditor(['keep.md']);
    const second = externalEditor(['also-keep.md']);
    registry.register('workspace', first.bridge);
    const unregister = registry.register('workspace', {
      ...second.bridge,
      acquireExternal: () => { throw new Error('Destination changed after preview.'); },
    });
    expect(() => registry.acquireExternal('workspace', ['images/new.png'])).toThrow('Destination changed after preview.');
    expect(first.acquireExternal).toHaveBeenCalledOnce();
    expect(first.release).toHaveBeenCalledOnce();
    expect(first.refreshed).not.toHaveBeenCalled();
    expect(first.isFrozen()).toBe(false);
    expect(first.buffers()).toEqual(['keep.md']);
    expect(second.buffers()).toEqual(['also-keep.md']);
    expect(registry.active('workspace')).toBe(false);
    unregister();
    const retry = registry.acquireExternal('workspace', ['images/new.png']);
    retry.release();
  });

  it('holds the original destination after caller-array changes and editor remounts', () => {
    const registry = new WorkspaceRewindRegistry();
    const previous = externalEditor(['unsaved.md']);
    const unregister = registry.register('workspace', previous.bridge);
    const targets = ['images/selected.png'];
    const lease = registry.acquireExternal('workspace', targets);
    targets[0] = 'images/changed-after-request.png';
    unregister();
    expect(registry.active('workspace')).toBe(true);
    expect(registry.rewinding('workspace')).toBe(false);
    const current = externalEditor();
    registry.register('workspace', current.bridge);
    expect(current.acquireExternal).toHaveBeenCalledWith(['images/selected.png']);
    expect(current.bridge.acquire).not.toHaveBeenCalled();
    expect(current.isFrozen()).toBe(true);
    unregister();
    expect(current.isFrozen()).toBe(true);
    lease.release({ refresh: true });
    expect(current.isFrozen()).toBe(false);
    expect(current.refreshed).toHaveBeenCalledOnce();
    expect(previous.refreshed).not.toHaveBeenCalled();
    expect(previous.buffers()).toEqual(['unsaved.md']);
  });

  it('guards a newly mounted editor during an existing write with no initial editor', () => {
    const registry = new WorkspaceRewindRegistry();
    const lease = registry.acquireExternal('workspace', ['images/new.png']);
    expect(() => registry.register('workspace', editor().bridge)).toThrow();
    expect(registry.active('workspace')).toBe(true);
    expect(registry.rewinding('workspace')).toBe(false);
    const current = externalEditor();
    registry.register('workspace', current.bridge);
    expect(current.acquireExternal).toHaveBeenCalledWith(['images/new.png']);
    expect(current.isFrozen()).toBe(true);
    lease.release();
    expect(current.isFrozen()).toBe(false);
    expect(registry.read('workspace').dirtyPaths).toEqual([]);
  });

  it('leaves a different workspace editable while an asynchronous save remains pending', async () => {
    const registry = new WorkspaceRewindRegistry();
    const first = externalEditor(['first-draft.md']);
    const other = externalEditor(['other-draft.md']);
    registry.register('saving', first.bridge);
    registry.register('other', other.bridge);
    const saving = registry.acquireExternal('saving', ['images/new.png']);
    let complete!: () => void;
    const pending = new Promise<void>(resolve => { complete = resolve; }).finally(() => saving.release({ refresh: true }));
    await Promise.resolve();
    expect(first.isFrozen()).toBe(true);
    expect(other.edit(['new-unrelated-draft.md'])).toBe(true);
    const otherLease = registry.acquireExternal('other', ['images/another.png']);
    complete();
    await pending;
    expect(first.isFrozen()).toBe(false);
    expect(registry.active('saving')).toBe(false);
    expect(registry.active('other')).toBe(true);
    expect(other.isFrozen()).toBe(true);
    otherLease.release();
    expect(other.buffers()).toEqual(['new-unrelated-draft.md']);
  });

  it('does not let an old ordinary-write release clear a new lease after unmount', () => {
    const registry = new WorkspaceRewindRegistry();
    const previous = externalEditor(['previous.md']);
    const unregister = registry.register('workspace', previous.bridge);
    const old = registry.acquireExternal('workspace', ['images/old.png']);
    old.release();
    unregister();
    const current = externalEditor(['current.md']);
    registry.register('workspace', current.bridge);
    const latest = registry.acquireExternal('workspace', ['images/current.png']);
    old.release({ refresh: true });
    unregister();
    expect(registry.active('workspace')).toBe(true);
    expect(current.isFrozen()).toBe(true);
    expect(current.release).not.toHaveBeenCalled();
    latest.release({ refresh: true });
    latest.release({ refresh: true });
    expect(current.release).toHaveBeenCalledOnce();
    expect(current.refreshed).toHaveBeenCalledOnce();
  });

  it('rejects unsafe or empty destinations before invoking participant checks', () => {
    const invalid = [[], [''], ['/images/new.png'], ['../new.png'], ['images/../new.png'], ['./new.png'], ['images/./new.png'], ['images//new.png'], ['images/'], ['images\\new.png'], ['images/\0new.png'], ['images/\nnew.png'], ['images/\tnew.png'], ['images/\u007fnew.png'], ['C:/images/new.png']];
    const registry = new WorkspaceRewindRegistry();
    const source = externalEditor(['keep.md']);
    registry.register('workspace', source.bridge);
    for (const paths of invalid) {
      expect(() => registry.acquireExternal('workspace', paths)).toThrow();
      expect(registry.active('workspace')).toBe(false);
    }
    expect(source.readExternal).not.toHaveBeenCalled();
    expect(source.acquireExternal).not.toHaveBeenCalled();
    expect(source.buffers()).toEqual(['keep.md']);
  });

  it('bounds destination count and length and presents deduplicated targets to participants', () => {
    const registry = new WorkspaceRewindRegistry();
    const source = externalEditor(['keep.md']);
    registry.register('workspace', source.bridge);
    const longest = 'x'.repeat(WORKSPACE_EXTERNAL_MUTATION_LIMITS.maxPathLength);
    const maximum = Array.from({ length: WORKSPACE_EXTERNAL_MUTATION_LIMITS.maxPaths }, (_, index) => index === 0 ? longest : `images/${index}.png`);
    const boundary = registry.acquireExternal('workspace', maximum);
    expect(source.readExternal).toHaveBeenCalledWith(maximum);
    expect(source.acquireExternal).toHaveBeenCalledWith(maximum);
    boundary.release();
    source.readExternal.mockClear(); source.acquireExternal.mockClear();
    for (const targets of [[...maximum, 'images/over-limit.png'], [`${longest}x`]]) {
      expect(() => registry.acquireExternal('workspace', targets)).toThrow();
      expect(registry.active('workspace')).toBe(false);
    }
    expect(source.readExternal).not.toHaveBeenCalled();
    expect(source.acquireExternal).not.toHaveBeenCalled();
    const duplicate = registry.acquireExternal('workspace', ['images/a.png', 'images/a.png', 'images/b.png']);
    expect(source.readExternal).toHaveBeenCalledWith(['images/a.png', 'images/b.png']);
    expect(source.acquireExternal).toHaveBeenCalledWith(['images/a.png', 'images/b.png']);
    duplicate.release();
    expect(source.buffers()).toEqual(['keep.md']);
  });

  it('rejects an invalid workspace identifier without creating an unreachable write lease', () => {
    const registry = new WorkspaceRewindRegistry();
    for (const workspaceId of ['', '../workspace', 'workspace/other', 'workspace other', 'workspace\0', 'a'.repeat(129)]) {
      expect(() => registry.acquireExternal(workspaceId, ['images/new.png'])).toThrow();
      expect(registry.active(workspaceId)).toBe(false);
    }
    const longestId = 'w'.repeat(128);
    const boundary = registry.acquireExternal(longestId, ['images/new.png']);
    expect(registry.active(longestId)).toBe(true);
    boundary.release();
    expect(registry.active(longestId)).toBe(false);
  });
});
