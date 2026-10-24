import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getSystemErrorName } from 'node:util';

type Binding = {
  interfaceVersion: 1;
  renameNoReplace(fromDirFd: number, fromLeaf: string, toDirFd: number, toLeaf: string): Promise<void>;
};
export type AtomicRenameAvailability = Readonly<
  { available: true } |
  { available: false; reason: 'unsupported_platform' | 'binding_missing' | 'binding_invalid' }
>;
type Loaded = { binding: Binding; availability: AtomicRenameAvailability } | { binding?: never; availability: AtomicRenameAvailability };
let loaded: Loaded | undefined;

function load(): Loaded {
  if (loaded) return loaded;
  if (process.platform !== 'linux') return loaded = { availability: Object.freeze({ available: false, reason: 'unsupported_platform' }) };
  const require = createRequire(import.meta.url);
  // Only these repository-owned locations are allowed. The first serves the
  // bundled dist/server entry; the second serves direct TS development/tests.
  for (const relative of ['../native/atomic-rename.node', '../dist/native/atomic-rename.node']) {
    const filename = fileURLToPath(new URL(relative, import.meta.url));
    if (!existsSync(filename)) continue;
    try {
      const binding: unknown = require(filename);
      if (binding && typeof binding === 'object' && 'interfaceVersion' in binding && binding.interfaceVersion === 1
        && 'renameNoReplace' in binding && typeof binding.renameNoReplace === 'function') {
        return loaded = { binding: binding as Binding, availability: Object.freeze({ available: true }) };
      }
    } catch { /* Report availability without exposing loader paths or diagnostics. */ }
    return loaded = { availability: Object.freeze({ available: false, reason: 'binding_invalid' }) };
  }
  return loaded = { availability: Object.freeze({ available: false, reason: 'binding_missing' }) };
}

/** Addon/platform readiness only; the first real preparation rename must prove
 * support on the actual filesystem before a caller displaces existing data. */
export function atomicRenameAvailability(): AtomicRenameAvailability { return load().availability; }

export class AtomicRenameUnavailableError extends Error {
  readonly code = 'ERR_ATOMIC_RENAME_UNAVAILABLE';
  readonly atomicRenameUnavailable = true;
  constructor(readonly reason: Exclude<AtomicRenameAvailability, { available: true }>['reason']) {
    super('Atomic no-replace publication is unavailable. Build the native binding on Linux before retrying.');
    this.name = 'AtomicRenameUnavailableError';
  }
}

/** Atomically move an existing, fully prepared inode into an absent basename.
 * Directory descriptors are duplicated before this function returns; the
 * caller may then close its originals. The operation does not fsync, retry,
 * overwrite, copy, follow leaf symlinks, or promise that a reported filesystem
 * failure had no effect. Callers retain recovery bytes and verify outcomes. */
export async function renameNoReplace(fromDirFd: number, fromLeaf: string, toDirFd: number, toLeaf: string): Promise<void> {
  const current = load();
  if (!current.binding) {
    const availability = current.availability;
    throw new AtomicRenameUnavailableError(availability.available ? 'binding_invalid' : availability.reason);
  }
  try { await current.binding.renameNoReplace(fromDirFd, fromLeaf, toDirFd, toLeaf); }
  catch (error) {
    if (error instanceof Error && 'errno' in error && typeof error.errno === 'number'
      && Number.isSafeInteger(error.errno) && error.errno < 0) {
      const normalized = error as NodeJS.ErrnoException & { atomicRenameUnavailable?: true };
      normalized.code = getSystemErrorName(error.errno);
      normalized.message = `${normalized.code}: atomic no-replace ${normalized.syscall ?? 'renameat2'} failed.`;
      if (normalized.code === 'ENOSYS' || normalized.code === 'ENOTSUP' || normalized.code === 'EOPNOTSUPP') normalized.atomicRenameUnavailable = true;
    }
    throw error;
  }
}
