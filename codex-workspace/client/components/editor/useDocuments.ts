import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileContent, Workspace, WorkspaceFileInfo } from '../../../shared/types';
import { ApiError, api, json } from '../../api';
import { getUiTabs, setUiTabs } from '../../ui-state';
import { disposeWorkspaceModels, documentUri, monaco } from '../../monaco';
import { isWorkspaceRewinding, isWorkspaceWriteHeld, MAX_REWIND_DIRTY_PATHS, registerWorkspaceRewindGuard, workspaceWriteBlockedReason, type WorkspaceRewindReleaseOptions } from '../../workspace-rewind-guard';
import { evictCleanLargeRanges, LargeFileDocuments, largeEditError, movedLargeDocument, readEditorDocument, textByteLength, type LargeFileState } from './large-file-documents';

export interface OpenDocument extends FileContent {
  savedContent: string;
  saving?: boolean;
  transferring?: boolean;
  external?: FileContent;
  externalInfo?: WorkspaceFileInfo;
  largeFile?: LargeFileState;
  missing?: boolean;
}

type Notify = (message: string, kind?: 'error' | 'success' | 'info') => void;
type OpenOptions = { focus?: boolean; silent?: boolean; restoring?: boolean };

interface EditorWriteOwner {
  mutationPending?(): boolean;
  freezeWrites?(): () => void;
}

export const isDirty = (document: OpenDocument) => document.content !== document.savedContent;
export const isWithin = (path: string, parent: string) => path === parent || path.startsWith(`${parent}/`);
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

function storedTabs(workspaceId: string): { paths: string[]; active: string } {
  return getUiTabs(workspaceId);
}

export function useDocuments(workspace: Workspace, onNotify: Notify, writeOwner?: EditorWriteOwner) {
  const [documents, setDocuments] = useState<OpenDocument[]>([]);
  const [activePath, setActivePathState] = useState('');
  const [opening, setOpening] = useState<string[]>([]);
  const [writeHeld, setWriteHeld] = useState(() => isWorkspaceWriteHeld(workspace.id));
  const documentsRef = useRef<OpenDocument[]>([]);
  const activePathRef = useRef('');
  const workspaceRef = useRef(workspace.id);
  const notifyRef = useRef(onNotify);
  const writeOwnerRef = useRef(writeOwner);
  const requests = useRef(new Map<string, Promise<OpenDocument | undefined>>());
  const savingPaths = useRef(new Set<string>());
  const pathTransfers = useRef(new Map<symbol, readonly string[]>());
  const refreshSequence = useRef(new Map<string, number>());
  const pendingRefreshes = useRef(new Set<string>());
  const pendingRestoration = useRef(new Set<string>());
  const tabWriteIntent = useRef(false);
  const restoring = useRef(true);
  const mounted = useRef(true);
  const generation = useRef(0);
  const readGeneration = useRef(0);
  const lockedRef = useRef(window.document.body.dataset.workspaceLocked === 'true');
  const writeHold = useRef<symbol | null>(null);
  const restoreTabsRef = useRef<(() => void) | null>(null);
  workspaceRef.current = workspace.id;
  notifyRef.current = onNotify;
  writeOwnerRef.current = writeOwner;
  const base = `/workspaces/${encodeURIComponent(workspace.id)}`;

  const updateDocuments = useCallback((update: (current: OpenDocument[]) => OpenDocument[]) => {
    const next = update(documentsRef.current);
    documentsRef.current = next;
    setDocuments(next);
  }, []);

  const pathIsTransferring = useCallback((path: string) => [...pathTransfers.current.values()].some(prefixes => prefixes.some(prefix => isWithin(path, prefix))), []);

  const canMutateWorkspace = useCallback((notify = true) => {
    if (!mounted.current || workspaceRef.current !== workspace.id || lockedRef.current || window.document.body.dataset.workspaceLocked === 'true') return false;
    const blocked = workspaceWriteBlockedReason(workspace.id);
    if (blocked) {
      if (notify) notifyRef.current(`${blocked} Your unsaved editor buffers are retained.`, 'info');
      return false;
    }
    return true;
  }, [workspace.id]);

  const largeDocuments = useMemo(() => new LargeFileDocuments(workspace.id, {
    get: path => documentsRef.current.find(document => document.path === path),
    all: () => documentsRef.current,
    update: (path, apply) => updateDocuments(current => current.map(document => document.path === path ? apply(document) : document)),
    blocked: path => !canMutateWorkspace(false) || pathIsTransferring(path),
    notify: (message, kind) => notifyRef.current(message, kind),
    saving: savingPaths.current,
    changed: () => window.dispatchEvent(new CustomEvent('codex:workspace-changed', { detail: { workspaceId: workspace.id, source: 'editor' } })),
  }), [workspace.id, updateDocuments, pathIsTransferring, canMutateWorkspace]);

  /** Hold path writes/reads while a native move/copy verifies its disk contents. */
  const beginPathTransfer = useCallback((prefixes: readonly string[]) => {
    const blocked = workspaceWriteBlockedReason(workspace.id);
    if (blocked) throw new Error(blocked);
    if (!canMutateWorkspace(false)) throw new Error('Unlock the current workspace before moving files.');
    if (documentsRef.current.some(file => prefixes.some(prefix => isWithin(file.path, prefix)) && file.saving)
      || [...savingPaths.current].some(path => prefixes.some(prefix => isWithin(path, prefix)))) throw new Error('Wait for these files to finish saving before moving or copying them.');
    if (prefixes.some(prefix => [...pathTransfers.current.values()].some(paths => paths.some(path => isWithin(path, prefix) || isWithin(prefix, path))))) throw new Error('Wait for the current file operation to finish.');
    const token = Symbol('workspace-file-transfer');
    const workspaceId = workspaceRef.current;
    const epoch = generation.current;
    pathTransfers.current.set(token, [...prefixes]);
    largeDocuments.invalidate(prefixes);
    for (const path of new Set([...requests.current.keys(), ...refreshSequence.current.keys(), ...documentsRef.current.map(file => file.path)])) {
      if (!prefixes.some(prefix => isWithin(path, prefix))) continue;
      requests.current.delete(path);
      refreshSequence.current.set(path, (refreshSequence.current.get(path) || 0) + 1);
      pendingRefreshes.current.delete(path);
    }
    setOpening(current => current.filter(path => !pathIsTransferring(path)));
    updateDocuments(current => current.map(file => pathIsTransferring(file.path) ? { ...file, transferring: true } : file));
    return () => {
      // A late network result after lock/unmount/workspace switch cannot change
      // the new document session, including clearing another transfer's flags.
      if (!mounted.current || workspaceRef.current !== workspaceId || generation.current !== epoch || !pathTransfers.current.has(token)) return;
      pathTransfers.current.delete(token);
      updateDocuments(current => current.map(file => file.transferring && !pathIsTransferring(file.path) ? { ...file, transferring: false } : file));
    };
  }, [workspace.id, canMutateWorkspace, pathIsTransferring, updateDocuments, largeDocuments]);

  const setActivePath = useCallback((path: string, remember = true) => {
    if (remember && !canMutateWorkspace()) return;
    if (remember) tabWriteIntent.current = true;
    activePathRef.current = path;
    setActivePathState(path);
  }, [canMutateWorkspace]);

  const persistTabs = useCallback(() => {
    const available = new Set([...documentsRef.current.map(document => document.path), ...pendingRestoration.current]);
    const previous = getUiTabs(workspace.id).paths.filter(path => available.has(path));
    const paths = [...new Set([...previous, ...available])].slice(0, 100);
    // Keep the focused tab even when more than the bounded restore limit is open.
    if (available.has(activePathRef.current) && !paths.includes(activePathRef.current)) paths[paths.length - 1] = activePathRef.current;
    setUiTabs(workspace.id, { paths, active: paths.includes(activePathRef.current) ? activePathRef.current : paths[0] || '' });
    tabWriteIntent.current = false;
  }, [workspace.id]);

  const openDocument = useCallback(async (path: string, options: OpenOptions = {}): Promise<OpenDocument | undefined> => {
    const workId = workspace.id;
    const epoch = generation.current;
    const readEpoch = readGeneration.current;
    if (!canMutateWorkspace(!options.silent)) return undefined;
    const current = documentsRef.current.find((document) => document.path === path);
    if (options.focus !== false) setActivePath(path);
    if (current) return current;
    if (pathIsTransferring(path)) {
      if (!options.silent) notifyRef.current('Wait for this file operation to finish before opening the new path.', 'info');
      return undefined;
    }
    let request = requests.current.get(path);
    if (!request) {
      setOpening((paths) => [...new Set([...paths, path])]);
      request = readEditorDocument(base, path)
        .then((file) => {
          if (workspaceRef.current !== workId || generation.current !== epoch || readGeneration.current !== readEpoch || requests.current.get(path) !== request || !canMutateWorkspace(false)) return undefined;
          pendingRestoration.current.delete(path);
          if (!options.restoring) tabWriteIntent.current = true;
          updateDocuments((currentDocuments) => currentDocuments.some((document) => document.path === path)
            ? currentDocuments
            : [...currentDocuments, file]);
          return file;
        })
        .catch((error: unknown) => {
          if (workspaceRef.current !== workId || generation.current !== epoch || readGeneration.current !== readEpoch || requests.current.get(path) !== request || !canMutateWorkspace(false)) return undefined;
          if (error instanceof ApiError && error.status === 404) pendingRestoration.current.delete(path);
          if (!options.silent) notifyRef.current(errorMessage(error), 'error');
          if (activePathRef.current === path && (!options.restoring || !pendingRestoration.current.has(path))) setActivePath(documentsRef.current.at(-1)?.path || '', !options.restoring);
          return undefined;
        })
        .finally(() => {
          if (workspaceRef.current !== workId || generation.current !== epoch || readGeneration.current !== readEpoch || requests.current.get(path) !== request) return;
          requests.current.delete(path);
          setOpening((paths) => paths.filter((entry) => entry !== path));
        });
      requests.current.set(path, request);
    }
    const file = await request;
    if (!file || workspaceRef.current !== workId || generation.current !== epoch || readGeneration.current !== readEpoch || !canMutateWorkspace(false)) return undefined;
    return documentsRef.current.find((document) => document.path === path);
  }, [workspace.id, base, updateDocuments, setActivePath, pathIsTransferring, canMutateWorkspace]);

  // Persist tab locations only. Editing text never creates preference requests.
  const tabPathsKey = JSON.stringify(documents.map(document => document.path));
  useEffect(() => {
    if (restoring.current || !tabWriteIntent.current) return;
    persistTabs();
  }, [tabPathsKey, activePath, persistTabs]);

  useEffect(() => {
    mounted.current = true;
    generation.current += 1;
    readGeneration.current += 1;
    const epoch = generation.current;
    const workspaceId = workspace.id;
    restoring.current = true;
    requests.current.clear();
    savingPaths.current.clear();
    pathTransfers.current.clear();
    writeHold.current = null;
    setWriteHeld(isWorkspaceWriteHeld(workspaceId));
    refreshSequence.current.clear();
    pendingRefreshes.current.clear();
    updateDocuments(() => []);
    setOpening([]);
    const tabs = storedTabs(workspaceId);
    pendingRestoration.current = new Set(tabs.paths);
    tabWriteIntent.current = false;
    setActivePath(tabs.active, false);
    let inFlight = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const restoreTabs = () => {
      if (workspaceRef.current !== workspaceId || generation.current !== epoch || inFlight || !canMutateWorkspace(false)) return;
      if (!restoring.current && pendingRestoration.current.size === 0) return;
      clearTimeout(retryTimer);
      inFlight = true;
      const readEpoch = readGeneration.current;
      void Promise.all([...pendingRestoration.current].map((path) => openDocument(path, { focus: false, silent: true, restoring: true })))
        .then(() => {
          inFlight = false;
          if (workspaceRef.current !== workspaceId || generation.current !== epoch || !canMutateWorkspace(false)) return;
          if (readGeneration.current !== readEpoch) { restoreTabs(); return; }
          restoring.current = false;
          updateDocuments((current) => [...current].sort((a, b) => tabs.paths.indexOf(a.path) - tabs.paths.indexOf(b.path)));
          if (!documentsRef.current.some((document) => document.path === activePathRef.current) && !pendingRestoration.current.has(activePathRef.current)) {
            setActivePath(documentsRef.current[0]?.path || '', false);
          }
          // Loading older tabs is not a new user choice. A newer browser's saved
          // selection can only be replaced by a deliberate interaction here.
          if (tabWriteIntent.current || JSON.stringify(getUiTabs(workspaceId)) === JSON.stringify(tabs)) persistTabs();
          if (pendingRestoration.current.size) {
            if (attempts === 0) notifyRef.current('Some saved tabs could not be reopened. They will retry when the connection is available.', 'error');
            retryTimer = setTimeout(restoreTabs, Math.min(15000, 1500 * 2 ** Math.min(attempts++, 4)));
          }
        });
    };
    restoreTabsRef.current = restoreTabs;
    window.addEventListener('codex:session-unlocked', restoreTabs);
    window.addEventListener('online', restoreTabs);
    window.addEventListener('focus', restoreTabs);
    restoreTabs();
    return () => {
      clearTimeout(retryTimer);
      window.removeEventListener('codex:session-unlocked', restoreTabs);
      window.removeEventListener('online', restoreTabs);
      window.removeEventListener('focus', restoreTabs);
      mounted.current = false;
      generation.current += 1;
      readGeneration.current += 1;
      if (restoreTabsRef.current === restoreTabs) restoreTabsRef.current = null;
      largeDocuments.reset();
      window.setTimeout(() => {
        if (workspaceRef.current !== workspaceId || !mounted.current) disposeWorkspaceModels(workspaceId);
      }, 0);
    };
  }, [workspace.id, openDocument, setActivePath, updateDocuments, persistTabs, largeDocuments, canMutateWorkspace]);

  useEffect(() => {
    const locked = () => {
      lockedRef.current = true;
      readGeneration.current += 1;
      requests.current.clear();
      pendingRefreshes.current.clear();
      setOpening([]);
      largeDocuments.reset();
      pathTransfers.current.clear();
      if (!writeHold.current) updateDocuments(current => current.map(file => file.transferring ? { ...file, transferring: false } : file));
    };
    const unlocked = () => {
      lockedRef.current = false;
      restoreTabsRef.current?.();
    };
    window.addEventListener('codex:session-locked', locked);
    window.addEventListener('codex:session-expired', locked);
    window.addEventListener('codex:session-unlocked', unlocked);
    return () => {
      pathTransfers.current.clear();
      window.removeEventListener('codex:session-locked', locked);
      window.removeEventListener('codex:session-expired', locked);
      window.removeEventListener('codex:session-unlocked', unlocked);
    };
  }, [workspace.id, updateDocuments, largeDocuments]);

  useEffect(() => {
    if (!canMutateWorkspace(false)) return;
    updateDocuments(current => evictCleanLargeRanges(current, activePath));
    const current = documentsRef.current.find(document => document.path === activePath);
    if (current?.largeFile && !current.largeFile.page && !current.largeFile.loading && !current.largeFile.error && !current.missing && !current.transferring) {
      void largeDocuments.load(current.path);
    }
  }, [activePath, documents, largeDocuments, updateDocuments, canMutateWorkspace, writeHeld]);

  const updateContent = useCallback((path: string, content: string, pageToken?: string) => {
    if (!canMutateWorkspace(false) || pathIsTransferring(path)) return false;
    const source = documentsRef.current.find(document => document.path === path);
    if (!source) return false;
    if (source.largeFile && (!pageToken || source.largeFile.page?.pageToken !== pageToken)) return false;
    const preserveBom = (!source.largeFile || source.largeFile.page?.byteStart === 0) && source.savedContent.startsWith('\uFEFF');
    const next = preserveBom && !content.startsWith('\uFEFF') ? `\uFEFF${content}` : content;
    const issue = largeEditError(source, next, documentsRef.current);
    if (issue) { notifyRef.current(issue, 'error'); return false; }
    updateDocuments((current) => current.map((document) => {
      if (document.path !== path) return document;
      // Monaco edits the visible text; keep a UTF-8 BOM if the saved file has one.
      return document.content !== next ? { ...document, content: next, ...(document.largeFile ? { largeFile: { ...document.largeFile, draftBytes: textByteLength(next) } } : {}) } : document;
    }));
    return true;
  }, [updateDocuments, canMutateWorkspace, pathIsTransferring]);

  const refreshDocuments = useCallback(async (all = false) => {
    if (!canMutateWorkspace(false)) return;
    const workspaceId = workspace.id;
    const epoch = generation.current;
    const readEpoch = readGeneration.current;
    const candidates = documentsRef.current.filter((document) => all || document.path === activePathRef.current);
    await Promise.allSettled(candidates.map(async (candidate) => {
      if (pathIsTransferring(candidate.path) || savingPaths.current.has(candidate.path) || pendingRefreshes.current.has(candidate.path)) return;
      if (candidate.largeFile) { await largeDocuments.refresh(candidate.path); return; }
      pendingRefreshes.current.add(candidate.path);
      const sequence = (refreshSequence.current.get(candidate.path) || 0) + 1;
      refreshSequence.current.set(candidate.path, sequence);
      try {
        const remote = await readEditorDocument(base, candidate.path);
        if (workspaceRef.current !== workspaceId || generation.current !== epoch || readGeneration.current !== readEpoch || !canMutateWorkspace(false) || savingPaths.current.has(candidate.path) || refreshSequence.current.get(candidate.path) !== sequence) return;
        updateDocuments((current) => current.map((document) => {
          if (document.path !== candidate.path) return document;
          // A save/reload that finished during this read is newer than its response.
          if (document.version !== candidate.version) return document;
          if (remote.largeFile) return isDirty(document)
            ? { ...document, externalInfo: remote.largeFile.info, external: undefined, missing: false }
            : remote;
          if (remote.version === document.version && !document.missing && !document.external && !document.externalInfo) return document;
          if (!isDirty(document) || remote.content === document.content) return { ...remote, savedContent: remote.content };
          if (remote.content === document.savedContent) return { ...document, version: remote.version, external: undefined, externalInfo: undefined, missing: false };
          if (document.external?.version === remote.version && !document.missing) return document;
          return { ...document, external: remote, externalInfo: undefined, missing: false };
        }));
      } catch (error) {
        if (workspaceRef.current !== workspaceId || generation.current !== epoch || readGeneration.current !== readEpoch || !canMutateWorkspace(false) || refreshSequence.current.get(candidate.path) !== sequence) return;
        if (error instanceof ApiError && error.status === 404) {
          updateDocuments((current) => current.map((document) => document.path === candidate.path && !document.missing ? { ...document, missing: true, external: undefined } : document));
        }
      } finally {
        if (workspaceRef.current === workspaceId && generation.current === epoch && readGeneration.current === readEpoch && refreshSequence.current.get(candidate.path) === sequence) pendingRefreshes.current.delete(candidate.path);
      }
    }));
  }, [workspace.id, base, updateDocuments, pathIsTransferring, largeDocuments, canMutateWorkspace]);

  useEffect(() => {
    const workspaceId = workspace.id;
    const editorEpoch = generation.current;
    const readDirtyPaths = () => {
      const paths: string[] = [];
      for (const file of documentsRef.current) {
        if (!isDirty(file)) continue;
        paths.push(file.path);
        if (paths.length > MAX_REWIND_DIRTY_PATHS) {
          throw new Error(`File rewind supports at most ${MAX_REWIND_DIRTY_PATHS} unsaved editor paths. Save or close some edited files before retrying.`);
        }
      }
      return paths;
    };
    const assertReady = (joining = false, kind: 'rewind' | 'external' = 'rewind') => {
      if (!mounted.current || workspaceRef.current !== workspaceId || generation.current !== editorEpoch) throw new Error('Wait for the current workspace editor to finish opening.');
      if (!joining && (lockedRef.current || window.document.body.dataset.workspaceLocked === 'true')) throw new Error(kind === 'rewind'
        ? 'Unlock the workspace before rewinding files.' : 'Unlock the workspace before saving a file.');
      if (writeHold.current || pathTransfers.current.size || savingPaths.current.size || documentsRef.current.some(file => file.saving || file.transferring)
        || writeOwnerRef.current?.mutationPending?.()) throw new Error(kind === 'rewind'
        ? 'Wait for pending saves, uploads and file operations to finish before rewinding files.'
        : 'Wait for pending saves, uploads and file operations to finish before saving this file.');
    };
    const assertCleanDestinations = (paths: readonly string[]) => {
      const conflict = documentsRef.current.find(file => isDirty(file)
        && paths.some(path => isWithin(file.path, path) || isWithin(path, file.path)));
      if (conflict) throw new Error(`The destination conflicts with unsaved edits to ${conflict.path}. Save those edits or choose another location.`);
    };
    const acquire = (kind: 'rewind' | 'external', paths: readonly string[] = []) => {
      // Registration can join a held lease after lock/unmount. A new request
      // already passed its unlocked preflight in the same synchronous call.
      assertReady(true, kind);
      if (kind === 'external') assertCleanDestinations(paths);
      const dirtyPaths = kind === 'rewind' ? readDirtyPaths() : [];
      const token = Symbol(kind === 'rewind' ? 'workspace-file-rewind' : 'workspace-external-file-operation');
      const releaseWidgets = writeOwnerRef.current?.freezeWrites?.();
      writeHold.current = token;
      readGeneration.current += 1;
      requests.current.clear();
      pendingRefreshes.current.clear();
      largeDocuments.reset();
      setOpening([]);
      setWriteHeld(true);
      updateDocuments(current => current.map(file => ({ ...file, transferring: true })));
      return {
        dirtyPaths,
        release: (options?: WorkspaceRewindReleaseOptions) => {
          if (!mounted.current || workspaceRef.current !== workspaceId || generation.current !== editorEpoch || writeHold.current !== token) return;
          writeHold.current = null;
          readGeneration.current += 1;
          setWriteHeld(isWorkspaceWriteHeld(workspaceId));
          updateDocuments(current => current.map(file => file.transferring && !pathIsTransferring(file.path) ? { ...file, transferring: false } : file));
          releaseWidgets?.();
          if (!canMutateWorkspace(false)) return;
          if (options?.refresh) void refreshDocuments(true);
          restoreTabsRef.current?.();
        },
      };
    };
    return registerWorkspaceRewindGuard(workspaceId, {
      read: () => { assertReady(); return { dirtyPaths: readDirtyPaths() }; },
      acquire: () => acquire('rewind'),
      readExternal: paths => { assertReady(false, 'external'); assertCleanDestinations(paths); },
      acquireExternal: paths => { const lease = acquire('external', paths); return { release: lease.release }; },
    });
  }, [workspace.id, largeDocuments, updateDocuments, pathIsTransferring, canMutateWorkspace, refreshDocuments]);

  useEffect(() => { if (activePath) void refreshDocuments(); }, [activePath, refreshDocuments]);

  const saveDocument = useCallback(async (path: string, useDiskVersion = false): Promise<boolean> => {
    if (!canMutateWorkspace()) return false;
    if (pathIsTransferring(path)) { notifyRef.current('Wait for this file operation to finish before saving.', 'info'); return false; }
    const currentDocument = documentsRef.current.find((entry) => entry.path === path);
    if (!currentDocument || savingPaths.current.has(path)) return false;
    if (currentDocument.largeFile) return largeDocuments.save(path, useDiskVersion);
    if (currentDocument.externalInfo) {
      notifyRef.current('This file grew beyond the full editor limit. Save a copy of your buffer or reload it in pages before making changes.', 'error');
      return false;
    }
    if (!isDirty(currentDocument) && !currentDocument.missing && !currentDocument.external) return true;
    if (currentDocument.missing) {
      notifyRef.current('This file was removed from disk. Use “Save a copy” to keep your edits.', 'error');
      return false;
    }
    const workspaceId = workspace.id;
    const epoch = generation.current;
    const readEpoch = readGeneration.current;
    const submitted = currentDocument.content;
    savingPaths.current.add(path);
    refreshSequence.current.set(path, (refreshSequence.current.get(path) || 0) + 1);
    pendingRefreshes.current.delete(path);
    updateDocuments((current) => current.map((entry) => entry.path === path ? { ...entry, saving: true } : entry));
    try {
      const saved = await api<FileContent>(`${base}/file`, json('PUT', {
        path, content: submitted,
        expectedVersion: useDiskVersion && currentDocument.external ? currentDocument.external.version : currentDocument.version,
      }));
      if (workspaceRef.current !== workspaceId || generation.current !== epoch || readGeneration.current !== readEpoch || !canMutateWorkspace(false)) return false;
      updateDocuments((current) => current.map((entry) => entry.path === path ? {
        ...entry, version: saved.version, savedContent: saved.content, size: saved.size,
        content: entry.content === submitted ? saved.content : entry.content,
        external: undefined, missing: false, saving: false,
      } : entry));
      window.dispatchEvent(new CustomEvent('codex:workspace-changed', { detail: { workspaceId, source: 'editor' } }));
      return true;
    } catch (error) {
      if (workspaceRef.current !== workspaceId || generation.current !== epoch || readGeneration.current !== readEpoch || !canMutateWorkspace(false)) return false;
      if (error instanceof ApiError && error.status === 409) {
        // Read the conflict explicitly while normal background refreshes skip saving files.
        try {
          const remote = await readEditorDocument(base, path);
          if (workspaceRef.current === workspaceId && generation.current === epoch && readGeneration.current === readEpoch && canMutateWorkspace(false)) {
            updateDocuments((current) => current.map((entry) => entry.path === path ? remote.largeFile
              ? { ...entry, external: undefined, externalInfo: remote.largeFile.info }
              : { ...entry, external: remote, externalInfo: undefined } : entry));
          }
        } catch (readError) {
          if (workspaceRef.current === workspaceId && generation.current === epoch && readGeneration.current === readEpoch && canMutateWorkspace(false) && readError instanceof ApiError && readError.status === 404) {
            updateDocuments((current) => current.map((entry) => entry.path === path ? { ...entry, missing: true } : entry));
          }
        }
        notifyRef.current('This file changed on disk. Compare the versions before saving.', 'error');
      } else {
        if (error instanceof ApiError && error.status === 404) updateDocuments((current) => current.map((entry) => entry.path === path ? { ...entry, missing: true } : entry));
        notifyRef.current(errorMessage(error), 'error');
      }
      return false;
    } finally {
      if (workspaceRef.current === workspaceId && generation.current === epoch) {
        savingPaths.current.delete(path);
        updateDocuments((current) => current.map((entry) => entry.path === path && entry.saving ? { ...entry, saving: false } : entry));
      }
    }
  }, [workspace.id, base, updateDocuments, pathIsTransferring, largeDocuments, canMutateWorkspace]);

  const saveAll = useCallback(async () => {
    let saved = 0;
    for (const document of documentsRef.current.filter(isDirty)) {
      if (await saveDocument(document.path)) saved += 1;
    }
    if (saved) notifyRef.current(`Saved ${saved} ${saved === 1 ? 'file' : 'files'}.`, 'success');
  }, [saveDocument]);

  const reloadDocument = useCallback(async (path: string) => {
    if (!canMutateWorkspace()) return;
    if (pathIsTransferring(path)) { notifyRef.current('Wait for this file operation to finish before reloading.', 'info'); return; }
    const current = documentsRef.current.find((document) => document.path === path);
    if (current && isDirty(current) && !window.confirm(`Discard unsaved edits to ${path} and load the version on disk?`)) return;
    if (current?.largeFile) {
      await largeDocuments.load(path, { offset: current.largeFile.page?.byteStart ?? current.largeFile.target.offset }, { discard: true, fresh: true });
      return;
    }
    const workspaceId = workspace.id;
    const epoch = generation.current;
    const readEpoch = readGeneration.current;
    const sequence = (refreshSequence.current.get(path) || 0) + 1;
    refreshSequence.current.set(path, sequence);
    pendingRefreshes.current.delete(path);
    try {
      const file = await readEditorDocument(base, path);
      if (workspaceRef.current !== workspaceId || generation.current !== epoch || readGeneration.current !== readEpoch || !canMutateWorkspace(false) || refreshSequence.current.get(path) !== sequence) return;
      updateDocuments((documents) => documents.map((document) => document.path === path ? { ...file, savedContent: file.content } : document));
    } catch (error) {
      if (workspaceRef.current === workspaceId && generation.current === epoch && readGeneration.current === readEpoch && canMutateWorkspace(false)) notifyRef.current(errorMessage(error), 'error');
    }
  }, [workspace.id, base, updateDocuments, pathIsTransferring, largeDocuments, canMutateWorkspace]);

  const closeDocument = useCallback((path: string) => {
    if (!canMutateWorkspace()) return;
    const current = documentsRef.current.find((document) => document.path === path);
    if (current?.saving) return notifyRef.current('Wait for this file to finish saving.', 'info');
    if (pathIsTransferring(path)) return notifyRef.current('Wait for this file operation to finish before closing its buffer.', 'info');
    if (current && isDirty(current) && !window.confirm(`Close ${path} and discard its unsaved edits?`)) return;
    largeDocuments.invalidate([path]);
    const previous = documentsRef.current;
    tabWriteIntent.current = true;
    const index = previous.findIndex((document) => document.path === path);
    updateDocuments((documents) => documents.filter((document) => document.path !== path));
    if (activePathRef.current === path) setActivePath(documentsRef.current[Math.min(index, documentsRef.current.length - 1)]?.path || '');
    const workspaceId = workspaceRef.current;
    window.setTimeout(() => {
      if (workspaceRef.current === workspaceId && !documentsRef.current.some((document) => document.path === path)) {
        monaco.editor.getModel(monaco.Uri.parse(documentUri(workspaceId, path)))?.dispose();
      }
    }, 100);
  }, [setActivePath, updateDocuments, pathIsTransferring, largeDocuments, canMutateWorkspace]);

  const removeDocuments = useCallback((path: string) => {
    if (!canMutateWorkspace()) return;
    largeDocuments.invalidate([path]);
    tabWriteIntent.current = true;
    for (const pending of pendingRestoration.current) if (isWithin(pending, path)) pendingRestoration.current.delete(pending);
    for (const loadingPath of requests.current.keys()) if (isWithin(loadingPath, path)) requests.current.delete(loadingPath);
    setOpening((current) => current.filter((loadingPath) => !isWithin(loadingPath, path)));
    updateDocuments((current) => current.filter((document) => !isWithin(document.path, path)));
    if (isWithin(activePathRef.current, path)) setActivePath(documentsRef.current.at(-1)?.path || '');
  }, [setActivePath, updateDocuments, largeDocuments, canMutateWorkspace]);

  const renameDocuments = useCallback((path: string, newPath: string) => {
    if (!canMutateWorkspace()) return;
    largeDocuments.invalidate([path]);
    tabWriteIntent.current = true;
    for (const pending of [...pendingRestoration.current]) if (isWithin(pending, path)) { pendingRestoration.current.delete(pending); pendingRestoration.current.add(newPath + pending.slice(path.length)); }
    for (const loadingPath of requests.current.keys()) if (isWithin(loadingPath, path)) requests.current.delete(loadingPath);
    setOpening((current) => current.filter((loadingPath) => !isWithin(loadingPath, path)));
    for (const candidate of documentsRef.current) {
      if (!isWithin(candidate.path, path)) continue;
      refreshSequence.current.set(candidate.path, (refreshSequence.current.get(candidate.path) || 0) + 1);
      if (candidate.largeFile) continue;
      const targetPath = newPath + candidate.path.slice(path.length);
      const workspaceId = workspaceRef.current;
      const epoch = generation.current;
      const previousModel = monaco.editor.getModel(monaco.Uri.parse(documentUri(workspaceId, candidate.path)));
      const targetUri = monaco.Uri.parse(documentUri(workspaceId, targetPath));
      const visible = candidate.content.startsWith('\uFEFF') ? candidate.content.slice(1) : candidate.content;
      let targetModel = monaco.editor.getModel(targetUri);
      const language = previousModel?.getLanguageId() || candidate.language;
      if (!targetModel) targetModel = monaco.editor.createModel(visible, monaco.languages.getLanguages().some(item => item.id === language) ? language : 'plaintext', targetUri);
      else if (targetModel.getValue() !== visible) targetModel.setValue(visible);
      if (previousModel) {
        targetModel.updateOptions({ tabSize: previousModel.getOptions().tabSize, insertSpaces: previousModel.getOptions().insertSpaces });
        targetModel.setEOL(previousModel.getEOL() === '\r\n' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF);
        // Monaco model URIs are immutable. Keep the old model alive until both
        // normal and diff/split widgets have detached; never dispose an editor's
        // current model during React's path transition.
        window.setTimeout(() => {
          if (workspaceRef.current === workspaceId && generation.current === epoch && !previousModel.isDisposed()
            && !previousModel.isAttachedToEditor() && !documentsRef.current.some(file => file.path === candidate.path)) previousModel.dispose();
        }, 250);
      }
    }
    updateDocuments((current) => current.map((document) => isWithin(document.path, path) ? document.largeFile
      ? movedLargeDocument(document, newPath + document.path.slice(path.length)) : {
      ...document, path: newPath + document.path.slice(path.length),
      external: document.external ? { ...document.external, path: newPath + document.path.slice(path.length) } : undefined,
    } : document));
    if (isWithin(activePathRef.current, path)) setActivePath(newPath + activePathRef.current.slice(path.length));
  }, [setActivePath, updateDocuments, largeDocuments, canMutateWorkspace]);

  useEffect(() => {
    const beforeLeave = (event: BeforeUnloadEvent) => {
      if (documentsRef.current.some(isDirty) || savingPaths.current.size > 0 || isWorkspaceWriteHeld(workspace.id)) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const beforeWorkspaceChange = (event: Event) => {
      const detail = (event as CustomEvent<{ cancel: boolean }>).detail;
      if (!detail) return;
      // An ordinary external save can be cancelled by its owning view while a
      // different workspace opens. Uncertain rewinds retain the stronger fence.
      const blocked = isWorkspaceRewinding(workspace.id) ? workspaceWriteBlockedReason(workspace.id) : undefined;
      if (blocked) {
        detail.cancel = true;
        notifyRef.current(`${blocked} Your unsaved editor buffers are retained.`, 'info');
        return;
      }
      if (savingPaths.current.size > 0) {
        detail.cancel = true;
        notifyRef.current('Wait for your files to finish saving before switching workspaces.', 'info');
        return;
      }
      const dirtyCount = documentsRef.current.filter(isDirty).length;
      if (dirtyCount && !window.confirm(`This workspace has ${dirtyCount} unsaved ${dirtyCount === 1 ? 'file' : 'files'}. Switch workspaces and discard those edits?`)) detail.cancel = true;
    };
    const focus = () => {
      void refreshDocuments(true);
      const current = documentsRef.current.find(document => document.path === activePathRef.current);
      if (current?.largeFile && !current.largeFile.page && !current.largeFile.loading && !current.largeFile.error) void largeDocuments.load(current.path, undefined, { fresh: true });
    };
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string }>).detail;
      if (!detail?.workspaceId || detail.workspaceId === workspace.id) void refreshDocuments(true);
    };
    window.addEventListener('beforeunload', beforeLeave);
    window.addEventListener('codex:before-workspace-change', beforeWorkspaceChange);
    window.addEventListener('focus', focus);
    window.addEventListener('codex:session-unlocked', focus);
    window.addEventListener('codex:workspace-changed', changed);
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshDocuments(); }, 6000);
    return () => {
      window.removeEventListener('beforeunload', beforeLeave);
      window.removeEventListener('codex:before-workspace-change', beforeWorkspaceChange);
      window.removeEventListener('focus', focus);
      window.removeEventListener('codex:session-unlocked', focus);
      window.removeEventListener('codex:workspace-changed', changed);
      window.clearInterval(interval);
    };
  }, [workspace.id, refreshDocuments, largeDocuments]);

  return {
    documents, documentsRef, activePath, setActivePath, opening, openDocument,
    updateContent, saveDocument, saveAll, reloadDocument, closeDocument,
    removeDocuments, renameDocuments, refreshDocuments, beginPathTransfer, largeDocuments,
    rewinding: writeHeld && isWorkspaceRewinding(workspace.id), writeHeld, canMutateWorkspace,
  };
}
