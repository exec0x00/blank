import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.doUnmock('node:fs'); vi.doUnmock('node:module'); vi.resetModules(); });

async function artifactExists(exists: boolean) {
  vi.doMock('node:fs', async importOriginal => ({ ...await importOriginal<typeof import('node:fs')>(), existsSync: () => exists }));
}

it.skipIf(process.platform !== 'linux')('fails visibly before any operation if a deployment has no native artifact', async () => {
  await artifactExists(false);
  const native = await import('../server/native-atomic-rename');
  expect(native.atomicRenameAvailability()).toEqual({ available: false, reason: 'binding_missing' });
  await expect(native.renameNoReplace(10, 'candidate', 11, 'published')).rejects.toMatchObject({
    code: 'ERR_ATOMIC_RENAME_UNAVAILABLE', atomicRenameUnavailable: true, reason: 'binding_missing',
  });
});

it.skipIf(process.platform !== 'linux')('rejects a wrong interface instead of silently falling through to another artifact', async () => {
  await artifactExists(true);
  const require = vi.fn(() => ({ interfaceVersion: 2, renameNoReplace: vi.fn() }));
  vi.doMock('node:module', () => ({ createRequire: () => require }));
  const native = await import('../server/native-atomic-rename');
  expect(native.atomicRenameAvailability()).toEqual({ available: false, reason: 'binding_invalid' });
  await expect(native.renameNoReplace(10, 'candidate', 11, 'published')).rejects.toMatchObject({ code: 'ERR_ATOMIC_RENAME_UNAVAILABLE', reason: 'binding_invalid' });
  expect(require).toHaveBeenCalledTimes(1);
});

it.skipIf(process.platform !== 'linux')('keeps native loader diagnostics out of its public unavailable error', async () => {
  await artifactExists(true);
  vi.doMock('node:module', () => ({ createRequire: () => () => { throw new Error('/private/build/location: wrong ELF class'); } }));
  const native = await import('../server/native-atomic-rename');
  const failure = await native.renameNoReplace(10, 'candidate', 11, 'published').catch(error => error as Error);
  expect(failure).toMatchObject({ code: 'ERR_ATOMIC_RENAME_UNAVAILABLE', reason: 'binding_invalid' });
  expect(String(failure)).not.toContain('/private/build/location');
  expect(String(failure)).not.toContain('ELF');
});

it.skipIf(process.platform !== 'linux').each([
  { errno: -38, code: 'ENOSYS', unavailable: true },
  { errno: -95, code: 'ENOTSUP', unavailable: true },
  { errno: -5, code: 'EIO', unavailable: undefined },
  { errno: -22, code: 'EINVAL', unavailable: undefined },
])('preserves $code without retrying or inventing filesystem capability', async ({ errno, code, unavailable }) => {
  await artifactExists(true);
  const execute = vi.fn(async () => { throw Object.assign(new Error('Native operation failed.'), { errno, syscall: 'renameat2' }); });
  vi.doMock('node:module', () => ({ createRequire: () => () => ({ interfaceVersion: 1, renameNoReplace: execute }) }));
  const native = await import('../server/native-atomic-rename');
  // A loadable addon is not a claim that this particular filesystem supports it.
  expect(native.atomicRenameAvailability()).toEqual({ available: true });
  const failure = await native.renameNoReplace(10, 'candidate', 11, 'published').catch(error => error as NodeJS.ErrnoException & { atomicRenameUnavailable?: true });
  expect(failure).toMatchObject({ errno, code, syscall: 'renameat2' });
  expect(failure && failure.atomicRenameUnavailable).toBe(unavailable);
  expect(execute).toHaveBeenCalledExactlyOnceWith(10, 'candidate', 11, 'published');
});
