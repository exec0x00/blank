import { createHash } from 'node:crypto';
import path from 'node:path';
import type { AppContext } from '../context';
import { HttpError } from '../errors';
import { FILE_METADATA_KEY } from '../file-metadata';
import { captureDurableReceipt, PublicBucketVerifier } from '../file-transfers/durability';
import type { FileRewindMetadataExpectation } from './file-rewind-transaction';

interface Entry { root: 'workspaces' | 'home'; path: string; kind: string; mode: number; size: number; target?: string }
interface Manifest { version: 1; entries: Entry[] }
const unavailable = () => new HttpError(503, 'The native bucket has not confirmed the restored file metadata. Recovery copies were retained.', 'FILE_REWIND_METADATA_UNCONFIRMED');

/** Public byte receipts alone cannot prove a symlink or executable bit. Capture
 * the existing canonical metadata service, check each requested Unix state,
 * then verify that exact metadata file through the public bucket. */
export async function verifyFileRewindMetadata(ctx: AppContext, expected: readonly FileRewindMetadataExpectation[], verifier?: PublicBucketVerifier): Promise<void> {
  if (!ctx.config.requirePersistentData) return;
  if (expected.length > 5001) throw unavailable();
  await ctx.workspaces.checkpointMetadataForRecovery();
  const snapshot = await ctx.store.read<Manifest | null>(FILE_METADATA_KEY, null);
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.entries) || snapshot.entries.length > 250_000) throw unavailable();
  const entries = new Map<string, Entry>();
  for (const entry of snapshot.entries) {
    if (!entry || !['workspaces', 'home'].includes(entry.root) || typeof entry.path !== 'string' || typeof entry.mode !== 'number' || typeof entry.size !== 'number') throw unavailable();
    const key = `${entry.root}\0${entry.path}`;
    if (entries.has(key)) throw unavailable();
    entries.set(key, entry);
  }
  const keys = [...entries.keys()].sort();
  for (const item of expected) {
    const relative = path.relative(ctx.config.workspacesDir, item.absolute).split(path.sep).join('/');
    if (!relative || relative.startsWith('../') || relative === '..' || path.isAbsolute(relative) || /[\u0000-\u001f\u007f]/u.test(relative)) throw unavailable();
    const key = `workspaces\0${relative}`, entry = entries.get(key);
    if (item.kind === 'missing') {
      let low = 0, high = keys.length;
      while (low < high) { const middle = (low + high) >>> 1; if (keys[middle] < key) low = middle + 1; else high = middle; }
      if (entry || keys[low]?.startsWith(`${key}/`)) throw unavailable();
    } else if (item.kind === 'file') {
      // Bucket remounts do not preserve an implicit default Unix mode. An old
      // sparse manifest proves no mode for an omitted file, including 0644.
      if (!entry || entry.kind !== 'file' || entry.mode !== item.mode || entry.size !== item.bytes || entry.target !== undefined) throw unavailable();
    } else {
      if (!entry || entry.kind !== 'symlink' || entry.mode !== item.mode || typeof entry.target !== 'string'
        || Buffer.byteLength(entry.target) !== item.bytes || createHash('sha256').update(entry.target).digest('hex') !== item.sha256
        || item.linkTargetBase64 !== undefined && Buffer.from(entry.target).toString('base64') !== item.linkTargetBase64) throw unavailable();
    }
  }
  const receipt = await captureDurableReceipt(ctx.config, path.join(ctx.config.stateDir, `${FILE_METADATA_KEY}.json`), 128 * 1024 * 1024);
  if (receipt.sha256 !== createHash('sha256').update(`${JSON.stringify(snapshot, null, 2)}\n`).digest('hex')) throw unavailable();
  // Associate the verified ordinary bytes with the checked manifest, even if a
  // separate workspace caused the global metadata capture to advance meanwhile.
  const checked = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  const current = await ctx.store.read<Manifest | null>(FILE_METADATA_KEY, null);
  if (createHash('sha256').update(JSON.stringify(current)).digest('hex') !== checked) throw unavailable();
  await (verifier ?? new PublicBucketVerifier(ctx.config)).verify([receipt]);
}
