import { createHash } from 'node:crypto';

/** Internal image-original cleanup only; public download snapshots have another lifecycle. */
export interface ImageAssetCleanupOptions { assertCurrent?: () => Promise<void> }
export interface ImageAssetParticipant {
  storageRoot(): Promise<string>;
  /** Fence synchronously, then resolve after this workspace's owned operations settle. */
  fence(workspaceId: string): Promise<void>;
}

const participants = new Set<ImageAssetParticipant>();
const fences = new Map<string, { ids: Set<string>; hashes: Set<string> }>();
const cleanupQueues = new Map<string, Promise<unknown>>();

export function registerImageAssetParticipant(participant: ImageAssetParticipant): () => void {
  participants.add(participant);
  return () => { participants.delete(participant); };
}

export function imageAssetWorkspaceFenced(storageRoot: string, workspaceId: string): boolean {
  return fences.get(storageRoot)?.ids.has(workspaceId) ?? false;
}

export function imageAssetWorkspaceHashFenced(storageRoot: string, workspaceHash: string): boolean {
  return fences.get(storageRoot)?.hashes.has(workspaceHash) ?? false;
}

export async function drainImageAssetCleanups(storageRoot: string): Promise<void> {
  await Promise.all([...cleanupQueues].filter(([key]) => (JSON.parse(key) as string[])[0] === storageRoot)
    .map(([, pending]) => pending.catch(() => undefined)));
}

/** Caller persists its own durable fence before awaiting drain and unlinking any leaf. */
export async function withImageAssetCleanup<T>(
  storageRoot: string, workspaceId: string, options: ImageAssetCleanupOptions,
  work: (drain: () => Promise<void>) => Promise<T>,
): Promise<T> {
  const key = JSON.stringify([storageRoot, workspaceId]);
  const before = cleanupQueues.get(key) ?? Promise.resolve();
  const operation = before.catch(() => undefined).then(async () => {
    await options.assertCurrent?.();
    const blocked = fences.get(storageRoot) ?? { ids: new Set<string>(), hashes: new Set<string>() };
    blocked.ids.add(workspaceId); blocked.hashes.add(createHash('sha256').update(workspaceId).digest('hex'));
    fences.set(storageRoot, blocked);
    const selected = new Set<ImageAssetParticipant>();
    const draining = new Set<Promise<void>>();
    const enroll = async () => {
      for (const participant of [...participants]) {
        if (selected.has(participant)) continue;
        // An unopened/unrelated service with unavailable storage cannot be
        // writing this pinned root. Open services report their pinned location.
        const location = await participant.storageRoot().catch(() => undefined);
        if (location !== storageRoot) continue;
        selected.add(participant);
        const pending = participant.fence(workspaceId);
        void pending.catch(() => undefined);
        draining.add(pending);
      }
    };
    await enroll();
    return work(async () => {
      // Include services created while the persistent fence was being written.
      // Later admissions see the shared fence and the on-disk fence themselves.
      await enroll();
      await Promise.all(draining);
      await options.assertCurrent?.();
    });
  });
  cleanupQueues.set(key, operation);
  try { return await operation; }
  finally { if (cleanupQueues.get(key) === operation) cleanupQueues.delete(key); }
}
