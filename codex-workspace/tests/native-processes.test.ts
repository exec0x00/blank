import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HttpError } from '../server/errors';
import { NativeProcessesService } from '../server/codex-cli/features/processes-service';
import { NativeProcessOutput, NATIVE_PROCESS_OUTPUT_BYTES } from '../server/codex-cli/features/processes-output';
import { nativeProcessArgv, nativeShellCommandMatches, quoteNativeProcessArgument, validateNativeProcessCommand } from '../server/codex-cli/features/processes-policy';
import { workspaceIsBusy } from '../server/worktrees/activity';
import { FIRST_THREAD, SECOND_THREAD, pendingValue, processFixture, resourceSnapshot } from './native-processes-fixture';

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(disposals.splice(0).map(dispose => dispose())); });
async function fixture() {
  const fixture = await processFixture();
  const service = new NativeProcessesService(fixture.deps, { observeResources: async () => resourceSnapshot(),
    prepareArgv: async (_ctx, _cwd, command) => ['/usr/bin/env', '-i', '/bin/sh', '-c', command] });
  disposals.push(async () => { fixture.bridge.close(); await service.dispose(); await fixture.close(); });
  return { ...fixture, service };
}
const delta = (text: string) => Buffer.from(text).toString('base64');
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

describe('native process command authority', () => {
  it.each(['docker ps', '/usr/bin/podman ps', 'do"ck"er ps', 'd\\ocker ps', 'do\\\ncker ps',
    'rclone --config x mount remote: path', 'cloudflared --no-autoupdate tunnel --url http://localhost:3000',
    'qemu-system-riscv64 --version', 'mount -t tmpfs tmpfs target', 'xmrig --help',
    'HTTPS_PROXY=http://elsewhere curl https://example.com', 'echo x > /etc/codex/requirements.toml',
    'curl https://alvin3y10-api.hf.space/api/models'])('refuses an obvious forbidden local command: %s', command => {
    expect(() => validateNativeProcessCommand(command)).toThrowError(expect.objectContaining({ code: 'NATIVE_PROCESS_HOST_POLICY' }));
  });

  it.each(['npm test', 'npx playwright test', 'chromium --headless --screenshot https://example.com',
    'ssh -L 9000:localhost:9000 requested-host', 'npx localtunnel --port 3000', 'cloudflared --version', "printf '%s\\n' hello | wc -l"])(
    'permits ordinary host work and allowed tunnels: %s', command => { expect(validateNativeProcessCommand(command)).toBe(command); });

  it('clears inherited native/MCP values before starting the explicit user command', async () => {
    const { ctx } = await fixture();
    await fs.mkdir(ctx.config.homeDir, { recursive: true });
    const command = "printf '%s|%s|%s' \"${NATIVE_FIXTURE_SECRET-unset}\" \"$HOME\" \"$GIT_CONFIG_VALUE_0\"";
    const argv = await nativeProcessArgv(ctx, path.join(ctx.config.workspacesDir, 'one'), command);
    const result = await promisify(execFile)(argv[0], argv.slice(1), { env: { NATIVE_FIXTURE_SECRET: 'fixture-value-must-not-arrive' }, maxBuffer: 4096 });
    expect(result.stdout).toBe(`unset|${ctx.config.homeDir}|${path.join(ctx.config.workspacesDir, 'one')}`);
    expect(argv.at(-1)).toBe(command);
  });

  it('matches actual native shell display quoting without evaluating substitutions or accepting another command', () => {
    for (const command of ['printf hello', "printf '%s' 'one two'", 'printf "$HOME"; printf `date`', 'printf one\nprintf two']) {
      expect(nativeShellCommandMatches(`/bin/sh -lc ${quoteNativeProcessArgument(command)}`, command)).toBe(true);
    }
    expect(nativeShellCommandMatches('/bin/sh -lc "printf hello"', 'printf hello')).toBe(true);
    expect(nativeShellCommandMatches('/bin/sh -lc "printf other"', 'printf hello')).toBe(false);
    expect(nativeShellCommandMatches('/bin/sh -lc echo; printf hello', 'printf hello')).toBe(false);
  });
});

describe('native process output bounds and ordering', () => {
  it('joins split UTF-8 bytes independently and retains observed stdout/stderr ordering', () => {
    const output = new NativeProcessOutput(), emoji = Buffer.from('🙂');
    output.append('stdout', emoji.subarray(0, 2).toString('base64'), false);
    output.append('stderr', delta('warning\n'), false);
    output.append('stdout', Buffer.concat([emoji.subarray(2), Buffer.from('done\n')]).toString('base64'), false);
    output.finish();
    expect(output.page(0).chunks).toEqual([
      { sequence: 1, stream: 'stderr', text: 'warning\n' }, { sequence: 2, stream: 'stdout', text: '🙂done\n' },
    ]);
    output.append('stdout', delta('late'), false);
    expect(output.sequence).toBe(2);
  });

  it('bounds bytes, chunk count and pages, reporting discarded output and stale cursors', () => {
    const output = new NativeProcessOutput();
    for (let index = 0; index < 160; index++) output.append('stdout', delta('x'.repeat(4096)), false);
    let after = 0, bytes = 0, truncated = false;
    for (let page = 0; page < 20; page++) {
      const current = output.page(after); truncated ||= current.truncatedBefore;
      const pageBytes = current.chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.text), 0);
      expect(pageBytes).toBeLessThanOrEqual(64 * 1024); bytes += pageBytes; after = current.nextSequence;
      if (!current.hasMore) break;
    }
    expect(truncated).toBe(true); expect(bytes).toBeLessThanOrEqual(NATIVE_PROCESS_OUTPUT_BYTES);
    expect(after).toBe(output.sequence);
    expect(() => output.page(after + 1)).toThrowError(expect.objectContaining({ code: 'NATIVE_PROCESS_CURSOR_STALE' }));
    const tiny = new NativeProcessOutput();
    for (let index = 0; index < 900; index++) tiny.append('stderr', delta('a'), false);
    expect(tiny.page(0).oldestSequence).toBe(389);
  });

  it('rejects malformed or oversized native chunks without allocating an unbounded decode', () => {
    const output = new NativeProcessOutput();
    expect(() => output.append('stdout', '!not-base64', false)).toThrow();
    expect(() => output.append('stdout', 'A'.repeat(400_000), false)).toThrow();
    output.append('stdout', '', true);
    expect(output.limited).toBe(true); expect(output.sequence).toBe(0);
  });
});

describe('native process lifecycle', () => {
  it('returns command ownership before its deferred exit, orders output, and holds leases until final response', async () => {
    const { service, bridge, ctx } = await fixture();
    const task = await service.start('one', { kind: 'command', command: 'printf hello' });
    const start = bridge.calls.find(call => call.method === 'command/exec')!;
    expect(task.state).toBe('starting'); expect(start.params.cwd).toBe(path.join(ctx.config.workspacesDir, 'one'));
    expect(start.params.command).toEqual(['/usr/bin/env', '-i', '/bin/sh', '-c', 'printf hello']);
    expect(start.params.sandboxPolicy).toEqual({ type: 'dangerFullAccess' });
    expect(bridge.leases.size).toBe(1); expect(workspaceIsBusy(ctx.config.workspacesDir, 'one')).toBe(true);
    bridge.emit('command/exec/outputDelta', { processId: start.params.processId, stream: 'stdout', deltaBase64: delta('hello'), capReached: false });
    bridge.emit('command/exec/outputDelta', { processId: start.params.processId, stream: 'stderr', deltaBase64: delta('warning'), capReached: false });
    bridge.commands.get(String(start.params.processId))!.resolve({ exitCode: 3, stdout: '', stderr: '' }); await tick();
    const output = await service.output('one', task.id, 0);
    expect(output.chunks.map(chunk => chunk.text)).toEqual(['hello', 'warning']); expect(output.session.exitCode).toBe(3);
    expect(output.session.state).toBe('exited'); expect(bridge.leases.size).toBe(0); expect(workspaceIsBusy(ctx.config.workspacesDir, 'one')).toBe(false);
    bridge.emit('command/exec/outputDelta', { processId: start.params.processId, stream: 'stdout', deltaBase64: delta('late'), capReached: false });
    expect((await service.output('one', task.id, 0)).latestSequence).toBe(2);
  });

  it('accepts process output and exit that arrive before the spawn acknowledgement', async () => {
    const { service, bridge } = await fixture(), acknowledgement = pendingValue<unknown>();
    bridge.handlers.set('process/spawn', params => {
      bridge.emit('process/outputDelta', { processHandle: params.processHandle, stream: 'stdout', deltaBase64: delta('quick'), capReached: false });
      bridge.exit(String(params.processHandle), 0); return acknowledgement.promise;
    });
    const task = await service.start('one', { kind: 'process', command: 'printf quick' });
    expect((await service.output('one', task.id, 0)).session.state).toBe('exited'); expect(bridge.leases.size).toBe(0);
    acknowledgement.resolve({}); await tick();
    expect((await service.output('one', task.id, 0)).session.state).toBe('exited');
  });

  it('refuses another workspace, old generation, pipe resize and PTY stream-close', async () => {
    const { service, bridge } = await fixture();
    const task = await service.start('one', { kind: 'process', command: 'cat' });
    await expect(service.output('two', task.id, 0)).rejects.toMatchObject({ status: 404 });
    await expect(service.stop('two', task.id, task.generation)).rejects.toMatchObject({ status: 404 });
    await expect(service.write('one', task.id, 'old-generation', 'input', false)).rejects.toMatchObject({ code: 'NATIVE_PROCESS_STALE' });
    await expect(service.resize('one', task.id, task.generation, 24, 80)).rejects.toMatchObject({ code: 'NATIVE_PROCESS_NOT_PTY' });
    const pty = await service.start('one', { kind: 'command', command: 'cat', tty: true });
    await expect(service.write('one', pty.id, pty.generation, '', true)).rejects.toMatchObject({ code: 'NATIVE_PROCESS_PTY_EOF' });
    expect(bridge.calls.filter(call => ['process/kill', 'process/writeStdin', 'process/resizePty', 'command/exec/write'].includes(call.method))).toHaveLength(0);
  });

  it('serializes bounded stdin, preserves control bytes, and never reopens stdin after close', async () => {
    const { service, bridge } = await fixture(), firstWrite = pendingValue<unknown>();
    const task = await service.start('one', { kind: 'process', command: 'cat' });
    let writes = 0;
    bridge.handlers.set('process/writeStdin', () => ++writes === 1 ? firstWrite.promise : {});
    const first = service.write('one', task.id, task.generation, 'hello\n', false);
    const second = service.write('one', task.id, task.generation, 'world\n', true); await tick();
    expect(writes).toBe(1); firstWrite.resolve({}); await first; await second;
    const calls = bridge.calls.filter(call => call.method === 'process/writeStdin');
    expect(calls.map(call => Buffer.from(String(call.params.deltaBase64), 'base64').toString())).toEqual(['hello\n', 'world\n']);
    await expect(service.write('one', task.id, task.generation, 'again\n', false)).rejects.toMatchObject({ code: 'NATIVE_PROCESS_INPUT_CLOSED' });
    const pty = await service.start('one', { kind: 'process', command: 'cat', tty: true });
    await service.write('one', pty.id, pty.generation, '\u0003\u0004', false);
    const control = bridge.calls.at(-1)!;
    expect(Buffer.from(String(control.params.deltaBase64), 'base64')).toEqual(Buffer.from([3, 4]));
    await service.resize('one', pty.id, pty.generation, 31, 120);
    expect(bridge.calls.at(-1)).toMatchObject({ method: 'process/resizePty', params: { size: { rows: 31, cols: 120 } } });
  });

  it('limits queued writes and blocks a forbidden command assembled across writes', async () => {
    const { service, bridge } = await fixture();
    const task = await service.start('one', { kind: 'process', command: 'cat' });
    await service.write('one', task.id, task.generation, 'doc', false);
    await expect(service.write('one', task.id, task.generation, 'ker ps\n', false)).rejects.toMatchObject({ code: 'NATIVE_PROCESS_HOST_POLICY' });
    const gate = pendingValue<unknown>(); bridge.handlers.set('process/writeStdin', () => gate.promise);
    const accepted = Array.from({ length: 8 }, () => service.write('one', task.id, task.generation, '\n', false)); await tick();
    await expect(service.write('one', task.id, task.generation, '\n', false)).rejects.toMatchObject({ code: 'NATIVE_PROCESS_INPUT_BUSY' });
    gate.resolve({}); await Promise.all(accepted);
  });

  it('retries cancellation that races registration and retains the lease after kill acknowledgement', async () => {
    const { service, bridge } = await fixture(), spawned = pendingValue<unknown>();
    bridge.handlers.set('process/spawn', () => spawned.promise);
    bridge.handlers.set('process/kill', () => { throw Object.assign(new HttpError(400, 'Handle not registered yet.', 'CODEX_RPC_REJECTED'), { nativeCode: -32602 }); });
    const task = await service.start('one', { kind: 'process', command: 'cat' });
    await service.stop('one', task.id, task.generation);
    expect((await service.output('one', task.id, 0)).session.state).toBe('stopping'); expect(bridge.leases.size).toBe(1);
    bridge.handlers.set('process/kill', () => ({})); spawned.resolve({}); await tick();
    expect(bridge.calls.filter(call => call.method === 'process/kill')).toHaveLength(2);
    expect(bridge.leases.size).toBe(1);
    expect((await service.output('one', task.id, 0)).session.error).toBeNull();
    bridge.exit(String(bridge.calls.find(call => call.method === 'process/spawn')!.params.processHandle), -1);
    expect((await service.output('one', task.id, 0)).session.state).toBe('exited'); expect(bridge.leases.size).toBe(0);
  });

  it('records unavailable native methods as failures and cancels an unknown launch outcome', async () => {
    const { service, bridge } = await fixture();
    bridge.handlers.set('process/spawn', () => { throw Object.assign(new HttpError(501, 'Native method unavailable.', 'CODEX_RPC_REJECTED'), { nativeCode: -32601 }); });
    const rejected = await service.start('one', { kind: 'process', command: 'cat' }); await tick();
    expect((await service.output('one', rejected.id, 0)).session).toMatchObject({ state: 'failed', error: 'Native method unavailable.' });
    expect(bridge.leases.size).toBe(0);
    bridge.handlers.set('process/spawn', () => { throw Object.assign(new HttpError(504, 'Native acknowledgement timed out.', 'CODEX_TIMEOUT'), { outcomeUnknown: true }); });
    const uncertain = await service.start('one', { kind: 'process', command: 'cat' }); await tick();
    expect((await service.output('one', uncertain.id, 0)).session.state).toBe('stopping'); expect(bridge.leases.size).toBe(1);
    expect(bridge.calls.some(call => call.method === 'process/kill')).toBe(true);
  });

  it('fences late output and replies after reconnect and never replays a command', async () => {
    const { service, bridge } = await fixture();
    const task = await service.start('one', { kind: 'command', command: 'printf hello' });
    const call = bridge.calls.find(value => value.method === 'command/exec')!;
    bridge.close(); bridge.current = 'native-process-fixture-two';
    bridge.emit('command/exec/outputDelta', { processId: call.params.processId, stream: 'stdout', deltaBase64: delta('wrong'), capReached: false }, task.generation);
    const result = await service.output('one', task.id, 0);
    expect(result.session.state).toBe('disconnected'); expect(result.chunks).toEqual([]); expect(result.session.exitCode).toBeNull();
    await expect(service.stop('one', task.id, task.generation)).rejects.toMatchObject({ code: 'NATIVE_PROCESS_STALE' });
    expect(bridge.calls.filter(value => value.method === 'command/exec')).toHaveLength(1);
  });

  it('retains ownership when a command reports an error after producing output', async () => {
    const { service, bridge } = await fixture();
    const task = await service.start('one', { kind: 'command', command: 'printf started; sleep 1' });
    const nativeId = String(bridge.calls.find(call => call.method === 'command/exec')!.params.processId);
    bridge.emit('command/exec/outputDelta', { processId: nativeId, stream: 'stdout', deltaBase64: delta('started'), capReached: false });
    bridge.commands.get(nativeId)!.reject(Object.assign(new HttpError(409, 'Native execution could not finish reporting.', 'CODEX_RPC_REJECTED'), { nativeCode: -32603 }));
    await tick();
    const current = await service.output('one', task.id, 0);
    expect(current.session.state).toBe('stopping'); expect(current.chunks[0].text).toBe('started'); expect(bridge.leases.size).toBe(1);
    expect(bridge.calls.at(-1)).toMatchObject({ method: 'command/exec/terminate', params: { processId: nativeId } });
  });

  it('reserves launch slots and activity synchronously, rejects pressure, and cancels before dispatch', async () => {
    const { deps, bridge, ctx } = await fixture(), gate = pendingValue<ReturnType<typeof resourceSnapshot>>();
    const service = new NativeProcessesService(deps, { observeResources: () => gate.promise, prepareArgv: async () => [] });
    disposals.push(() => service.dispose());
    const requests = Array.from({ length: 4 }, () => service.start('one', { kind: 'process', command: 'true' }));
    await expect(service.start('one', { kind: 'process', command: 'true' })).rejects.toMatchObject({ code: 'NATIVE_PROCESS_LIMIT' });
    expect(bridge.leases.size).toBe(4); expect(workspaceIsBusy(ctx.config.workspacesDir, 'one')).toBe(true);
    gate.resolve(resourceSnapshot(2_000_000_000)); const outcomes = await Promise.allSettled(requests);
    expect(outcomes.every(value => value.status === 'rejected')).toBe(true); expect(bridge.leases.size).toBe(0); expect(bridge.calls).toEqual([]);
    const controller = new AbortController(); controller.abort();
    await expect(service.start('one', { kind: 'process', command: 'true' }, controller.signal)).rejects.toMatchObject({ code: 'NATIVE_PROCESS_CANCELLED' });
    expect(bridge.leases.size).toBe(0);
  });

  it('bounds retained sessions, refuses forgetting live work, and cleans up its listeners after shutdown', async () => {
    const { service, bridge } = await fixture();
    for (let index = 0; index < 30; index++) {
      const task = await service.start('one', { kind: 'process', command: `printf ${index}` });
      const handle = [...bridge.calls].reverse().find(call => call.method === 'process/spawn')!.params.processHandle;
      if (index === 0) await expect(service.forget('one', task.id)).rejects.toMatchObject({ code: 'NATIVE_PROCESS_ACTIVE' });
      bridge.exit(String(handle));
    }
    expect((await service.list('one')).sessions).toHaveLength(24);
    const task = await service.start('one', { kind: 'process', command: 'cat' });
    await service.dispose(); expect(bridge.calls.at(-1)?.method).toBe('process/kill'); expect(bridge.leases.size).toBe(1);
    bridge.close(); expect(bridge.leases.size).toBe(0);
    expect((await service.list('one')).sessions).toEqual([]);
    await expect(service.start('one', { kind: 'process', command: 'true' })).rejects.toMatchObject({ code: 'NATIVE_PROCESS_CLOSING' });
    expect(task.id).toBeTruthy();
  });
});

describe('thread shell and native background ownership', () => {
  it('prepares an unloaded thread only for an explicit shell action and fences generation changes during readiness', async () => {
    const { service, deps, bridge } = await fixture();
    deps.prepareThreadForAction = vi.fn(async (workspaceId, threadId, generation) => {
      expect(workspaceId).toBe('one'); expect(threadId).toBe(FIRST_THREAD); expect(generation).toBe(bridge.current);
      expect(bridge.leases.size).toBe(1);
    });
    await service.background('one', FIRST_THREAD);
    expect(deps.prepareThreadForAction).not.toHaveBeenCalled();
    await service.shell('one', FIRST_THREAD, bridge.current!, 'printf hi', 1000);
    expect(deps.prepareThreadForAction).toHaveBeenCalledTimes(1);
    bridge.emit('item/completed', { threadId: FIRST_THREAD, item: { type: 'commandExecution', source: 'userShell', id: 'first', command: "/bin/sh -lc 'printf hi'" } });
    deps.prepareThreadForAction = vi.fn(async () => { bridge.close(); bridge.current = 'new-readiness-generation'; });
    await expect(service.shell('one', FIRST_THREAD, bridge.current!, 'printf second', 1000)).rejects.toMatchObject({ code: 'NATIVE_PROCESS_STALE' });
    expect(bridge.calls.filter(call => call.method === 'thread/shellCommand')).toHaveLength(1);
    expect(bridge.leases.size).toBe(0);
  });

  it('runs only an authorized thread shell and releases on its exact user-shell item, not unrelated turn completion', async () => {
    const { service, bridge, ctx } = await fixture();
    await expect(service.shell('one', SECOND_THREAD, bridge.current!, 'printf hi', 5000)).rejects.toMatchObject({ code: 'CODEX_THREAD_SCOPE' });
    const response = await service.shell('one', FIRST_THREAD, bridge.current!, 'printf hi', 5000);
    expect(response).toMatchObject({ accepted: true, threadId: FIRST_THREAD }); expect(bridge.leases.size).toBe(1);
    bridge.emit('turn/completed', { threadId: FIRST_THREAD, turn: { id: 'unrelated' } }); expect(bridge.leases.size).toBe(1);
    bridge.emit('item/completed', { threadId: FIRST_THREAD, item: { type: 'commandExecution', source: 'agent', id: 'wrong', command: 'printf hi' } });
    expect(workspaceIsBusy(ctx.config.workspacesDir, 'one')).toBe(true);
    bridge.emit('item/started', { threadId: FIRST_THREAD, item: { type: 'commandExecution', source: 'userShell', id: 'exact', command: "/bin/sh -lc 'printf hi'" } });
    bridge.emit('item/completed', { threadId: FIRST_THREAD, item: { type: 'commandExecution', source: 'userShell', id: 'exact', command: "/bin/sh -lc 'printf hi'" } });
    expect(bridge.leases.size).toBe(0); expect(workspaceIsBusy(ctx.config.workspacesDir, 'one')).toBe(false);
  });

  it('normalizes native bigint memory and validates the exact background item before termination', async () => {
    const { service, bridge } = await fixture();
    const item = { itemId: 'item-one', processId: '42', command: 'python3 -m http.server', cwd: '/owned', osPid: 123, cpuPercent: 0.5, rssKb: 42n };
    bridge.handlers.set('thread/backgroundTerminals/list', params => params.cursor ? { data: [item], nextCursor: null } : { data: [], nextCursor: 'next-page' });
    expect((await service.background('one', FIRST_THREAD, 'next-page')).data[0].rssKb).toBe('42');
    await expect(service.terminateBackground('one', FIRST_THREAD, bridge.current!, '42', 'wrong-item')).rejects.toMatchObject({ code: 'NATIVE_BACKGROUND_STALE' });
    expect(bridge.calls.some(call => call.method === 'thread/backgroundTerminals/terminate')).toBe(false);
    expect(await service.terminateBackground('one', FIRST_THREAD, bridge.current!, '42', 'item-one')).toEqual({ terminated: true });
    expect(bridge.calls.at(-1)).toMatchObject({ method: 'thread/backgroundTerminals/terminate', params: { threadId: FIRST_THREAD, processId: '42' } });
    await service.terminateBackground('one', FIRST_THREAD, bridge.current!, '42', 'item-one', 'far-owned-page');
    expect(bridge.calls.at(-2)).toMatchObject({ method: 'thread/backgroundTerminals/list', params: { threadId: FIRST_THREAD, cursor: 'far-owned-page' } });
    await expect(service.cleanBackground('two', FIRST_THREAD, bridge.current!)).rejects.toMatchObject({ code: 'CODEX_THREAD_SCOPE' });
    await expect(service.cleanBackground('one', FIRST_THREAD, 'old')).rejects.toMatchObject({ code: 'NATIVE_PROCESS_STALE' });
    await service.cleanBackground('one', FIRST_THREAD, bridge.current!);
    expect(bridge.calls.at(-1)).toMatchObject({ method: 'thread/backgroundTerminals/clean', params: { threadId: FIRST_THREAD } });
  });

  it('surfaces real unsupported background errors and rejects malformed oversized pages', async () => {
    const { service, bridge } = await fixture();
    bridge.unsupported.add('thread/backgroundTerminals/list');
    await expect(service.background('one', FIRST_THREAD)).rejects.toMatchObject({ code: 'CODEX_UNSUPPORTED' });
    bridge.unsupported.clear(); bridge.handlers.set('thread/backgroundTerminals/list', () => ({ data: Array.from({ length: 31 }, () => ({})), nextCursor: null }));
    await expect(service.background('one', FIRST_THREAD)).rejects.toMatchObject({ code: 'NATIVE_PROCESS_PROTOCOL' });
  });
});
