import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const OWNER_FILE = '.download-owner.json';
const KIND = 'codex-file-download-staging-v1';
interface StagingOwner { kind: string; scope: string; id: string; pid: number; processStart: string }

export const stagingScope = (stateDir: string): string => createHash('sha256').update(path.resolve(stateDir)).digest('hex');

async function processStart(pid: number): Promise<string | undefined> {
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    const value = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    return /^\d+$/.test(value ?? '') ? value : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    // An inaccessible process might still be live. Never treat that as permission to remove its files.
    return 'unknown-live-process';
  }
}

/** Only remove this workspace service's own staging directories when their owner process is gone. */
export async function cleanAbandonedDownloadStaging(stateDir: string): Promise<void> {
  const scope = stagingScope(stateDir);
  for (const entry of await fs.readdir(os.tmpdir(), { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^codex-download-[A-Za-z0-9]{6}$/.test(entry.name)) continue;
    const directory = path.join(os.tmpdir(), entry.name);
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      const before = await fs.lstat(directory);
      if (!before.isDirectory() || before.isSymbolicLink() || before.uid !== process.getuid?.()) continue;
      handle = await fs.open(path.join(directory, OWNER_FILE), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const recordStat = await handle.stat();
      if (!recordStat.isFile() || recordStat.size > 2048 || recordStat.uid !== before.uid) continue;
      const buffer = Buffer.alloc(2049);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 2048) continue;
      const record = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) as StagingOwner;
      if (record.kind !== KIND || record.scope !== scope || !Number.isSafeInteger(record.pid) || record.pid < 1
        || typeof record.processStart !== 'string' || !/^\d+$/.test(record.processStart)) continue;
      const currentProcessStart = await processStart(record.pid);
      if (currentProcessStart === 'unknown-live-process' || currentProcessStart === record.processStart) continue;
      const after = await fs.lstat(directory);
      if (!after.isDirectory() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino) continue;
      await fs.rm(directory, { recursive: true, force: true });
    } catch {
      // Unrelated, malformed, protected and concurrently removed directories are left untouched.
    } finally { await handle?.close().catch(() => undefined); }
  }
}

export async function createDownloadStaging(stateDir: string): Promise<string> {
  await cleanAbandonedDownloadStaging(stateDir);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-download-'));
  try {
    await fs.chmod(directory, 0o700);
    const started = await processStart(process.pid);
    if (!started || !/^\d+$/.test(started)) throw new Error('Cannot establish download staging ownership.');
    const owner: StagingOwner = { kind: KIND, scope: stagingScope(stateDir), id: randomUUID(), pid: process.pid, processStart: started };
    await fs.writeFile(path.join(directory, OWNER_FILE), JSON.stringify(owner), { mode: 0o600, flag: 'wx' });
    return directory;
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
