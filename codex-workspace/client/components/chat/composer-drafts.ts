import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';

interface ComposerDrafts {
  drafts: Record<string, string>;
  skillDrafts: Record<string, string[]>;
}
interface WorkspaceDrafts {
  snapshot: ComposerDrafts;
  listeners: Set<() => void>;
}

// ChatPanel remounts when switching workspaces. Unsent text and selected skills
// belong to the original workspace/thread, just like unsent file attachments.
// Keep them only in this page's memory, never localStorage or model history.
const workspaces = new Map<string, WorkspaceDrafts>();

function workspaceDrafts(workspaceId: string): WorkspaceDrafts {
  let value = workspaces.get(workspaceId);
  if (!value) {
    value = { snapshot: { drafts: {}, skillDrafts: {} }, listeners: new Set() };
    workspaces.set(workspaceId, value);
  }
  return value;
}

function publish(workspaceId: string, value: WorkspaceDrafts, snapshot: ComposerDrafts): void {
  value.snapshot = snapshot;
  for (const listener of value.listeners) listener();
  if (workspaces.get(workspaceId) === value && !value.listeners.size && !Object.keys(snapshot.drafts).length && !Object.keys(snapshot.skillDrafts).length) {
    workspaces.delete(workspaceId);
  }
}

/** Scope every update, including a late send receipt, to its original workspace. */
export function useComposerDrafts(workspaceId: string): ComposerDrafts & {
  setDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  setSkillDrafts: Dispatch<SetStateAction<Record<string, string[]>>>;
} {
  const subscribe = useCallback((listener: () => void) => {
    const value = workspaceDrafts(workspaceId);
    value.listeners.add(listener);
    return () => {
      value.listeners.delete(listener);
      if (workspaces.get(workspaceId) === value && !value.listeners.size && !Object.keys(value.snapshot.drafts).length && !Object.keys(value.snapshot.skillDrafts).length) {
        workspaces.delete(workspaceId);
      }
    };
  }, [workspaceId]);
  const read = useCallback(() => workspaceDrafts(workspaceId).snapshot, [workspaceId]);
  const snapshot = useSyncExternalStore(subscribe, read, read);
  const setDrafts = useCallback<Dispatch<SetStateAction<Record<string, string>>>>(action => {
    const value = workspaceDrafts(workspaceId);
    const next = typeof action === 'function' ? action(value.snapshot.drafts) : action;
    if (next === value.snapshot.drafts) return;
    publish(workspaceId, value, { ...value.snapshot,
      drafts: Object.fromEntries(Object.entries(next).filter(([, text]) => text.length > 0)) });
  }, [workspaceId]);
  const setSkillDrafts = useCallback<Dispatch<SetStateAction<Record<string, string[]>>>>(action => {
    const value = workspaceDrafts(workspaceId);
    const next = typeof action === 'function' ? action(value.snapshot.skillDrafts) : action;
    if (next === value.snapshot.skillDrafts) return;
    publish(workspaceId, value, { ...value.snapshot,
      skillDrafts: Object.fromEntries(Object.entries(next).filter(([, selected]) => selected.length > 0)) });
  }, [workspaceId]);
  return { ...snapshot, setDrafts, setSkillDrafts };
}
