import { createHash } from 'node:crypto';
import type { Page, Route } from '@playwright/test';
import type { FileRewindRecoveryRead } from '../../shared/types';
import { workspaceRewindRecoveryFixture } from './workspace-rewind-recovery-fixture';

export type RecoveryFixtureSource = { kind: 'text'; text: string; mode?: number; symlink?: boolean }
  | { kind: 'binary'; bytes: Uint8Array } | { kind: 'missing' } | { kind: 'error'; status: number; message: string };
interface HeldSourceReply { started: boolean; settled: boolean; release(): void; wait: Promise<void> }

/** API transport coverage only. The production reader and modals run unchanged;
 * signed-plan/native filesystem verification has separate server tests. */
export async function rewindRecoverySourceFixture(page: Page, options: Parameters<typeof workspaceRewindRecoveryFixture>[1] = {}) {
  const recovery = await workspaceRewindRecoveryFixture(page, options);
  const sources = new Map<string, RecoveryFixtureSource>();
  const requests: Array<{ workspaceId: string; recoveryId: string; path: string; side: string; offset: number; limit: number }> = [];
  const gates: HeldSourceReply[] = [], held: HeldSourceReply[] = [];
  let corrupt: Partial<FileRewindRecoveryRead> | null = null;
  const sourceKey = (path: string, side: string) => JSON.stringify([path, side]);
  sources.set(sourceKey('src/changed.ts', 'original'), { kind: 'text', text: 'ORIGINAL_SAVED_SOURCE\n' + Array.from({ length: 3200 }, (_, index) => `saved line ${String(index).padStart(5, '0')} café 🙂\n`).join('') });
  sources.set(sourceKey('src/changed.ts', 'restored'), { kind: 'text', text: 'REQUESTED_CHECKPOINT_SOURCE\nexport const originalParser = true;\n' });
  sources.set(sourceKey('src/new.ts', 'original'), { kind: 'binary', bytes: Uint8Array.from([137, 80, 78, 71, 0, 255, 4]) });
  sources.set(sourceKey('src/new.ts', 'restored'), { kind: 'text', text: '../retained-link-target', symlink: true });
  sources.set(sourceKey('src/restored.ts', 'original'), { kind: 'missing' });
  sources.set(sourceKey('src/restored.ts', 'restored'), { kind: 'text', text: '' });

  function holdNextRead(): HeldSourceReply {
    let release!: () => void;
    const gate: HeldSourceReply = { started: false, settled: false, release: () => release(), wait: new Promise<void>(resolve => { release = resolve; }) };
    held.push(gate); gates.push(gate); return gate;
  }
  async function respond(route: Route, value: unknown, status = 200) {
    const gate = held.shift();
    if (gate) { gate.started = true; await gate.wait; }
    try { await route.fulfill({ status, json: value }); }
    catch (error) { if (!gate && !page.isClosed() && !route.request().failure()) throw error; }
    finally { if (gate) gate.settled = true; }
  }

  await page.route(/\/api\/workspaces\/[^/]+\/rewind-recovery\/[^/]+\/file(?:\?.*)?$/, async route => {
    const url = new URL(route.request().url()), match = /^\/api\/workspaces\/([^/]+)\/rewind-recovery\/([^/]+)\/file$/.exec(url.pathname)!;
    const path = url.searchParams.get('path') ?? '', side = url.searchParams.get('side') ?? 'original';
    const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 16384);
    requests.push({ workspaceId: decodeURIComponent(match[1]), recoveryId: decodeURIComponent(match[2]), path, side, offset, limit });
    if (route.request().method() !== 'GET' || decodeURIComponent(match[1]) !== recovery.identity.workspaceId || decodeURIComponent(match[2]) !== recovery.identity.recoveryId) {
      return respond(route, { error: 'This exact saved source is outside the requested recovery.' }, 404);
    }
    const source = sources.get(sourceKey(path, side));
    if (!source) return respond(route, { error: 'The retained source was not saved for this path.' }, 404);
    if (source.kind === 'error') return respond(route, { error: source.message }, source.status);
    if (source.kind === 'missing') return respond(route, { path, side: side as FileRewindRecoveryRead['side'], kind: 'missing', mode: 0, bytes: 0, sha256: null,
      binary: false, text: '', totalBytes: 0, offset: 0, nextOffset: null } satisfies FileRewindRecoveryRead);
    const bytes = source.kind === 'binary' ? Buffer.from(source.bytes) : Buffer.from(source.text, 'utf8');
    if (offset > bytes.length) return respond(route, { error: 'The requested position is beyond the saved source.' }, 416);
    let from = offset;
    while (from > 0 && (bytes[from] & 0xc0) === 0x80) from--;
    let through = Math.min(bytes.length, from + limit);
    while (through < bytes.length && through > from && (bytes[through] & 0xc0) === 0x80) through--;
    const binary = source.kind === 'binary';
    const result: FileRewindRecoveryRead = { path, side: side as FileRewindRecoveryRead['side'],
      kind: source.kind === 'text' && source.symlink ? 'symlink' : 'file', mode: source.kind === 'text' && source.symlink ? 0o777 : source.kind === 'text' ? source.mode ?? 0o644 : 0o644,
      bytes: bytes.length, totalBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), binary,
      text: binary ? null : bytes.subarray(from, through).toString('utf8'), offset: binary ? offset : from,
      nextOffset: binary || through >= bytes.length ? null : through };
    const fault = corrupt; corrupt = null;
    return respond(route, fault ? { ...result, ...fault } : result);
  });

  return { recovery, requests, holdNextRead,
    setSource: (path: string, side: FileRewindRecoveryRead['side'], source: RecoveryFixtureSource) => sources.set(sourceKey(path, side), source),
    corruptNextRead: (value: Partial<FileRewindRecoveryRead>) => { corrupt = value; },
    releaseAll: () => { gates.forEach(gate => gate.release()); recovery.releaseAll(); },
  };
}

export type RewindSourceFixture = Awaited<ReturnType<typeof rewindRecoverySourceFixture>>;
