import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { CodexRpcClient, type CodexRpcOptions, type NativeNotification, type NativeServerRequest } from '../server/codex-cli/rpc';

// Actual child stdio/JSONL, never a model/provider or replacement agent loop.
const secret = 'SYNTHETIC_RPC_PRIVATE_ANSWER_NOT_A_CREDENTIAL';
const clients: CodexRpcClient[] = [];
let directory: string;

interface FixtureOptions {
  initialize?: 'reject' | 'hang' | 'slow'; ignoreEof?: boolean; ignoreTerm?: boolean;
  nativeError?: { method: string; code: number; message: string };
}
interface Closed { expected: boolean; code: number | null; signal: string | null; message: string; generation: string; cleanupComplete: boolean; forced: boolean }

async function fixture(configuration: FixtureOptions = {}, overrides: Partial<CodexRpcOptions> = {}) {
  const root = await fs.mkdtemp(path.join(directory, 'connection-'));
  const script = path.join(root, 'fixture.cjs'), received = path.join(root, 'received.jsonl');
  await fs.writeFile(script, `
const fs=require('node:fs'),readline=require('node:readline'),{spawn}=require('node:child_process');
const configuration=${JSON.stringify(configuration)},received=${JSON.stringify(received)},secret=${JSON.stringify(secret)};
const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
let initialized=false;
setInterval(()=>{},1000);
if(configuration.ignoreTerm) process.on('SIGTERM',()=>{});
const input=readline.createInterface({input:process.stdin});
input.on('close',()=>{if(!configuration.ignoreEof)process.exit(0)});
input.on('line',line=>{
 let value;try{value=JSON.parse(line)}catch{process.exit(80)}
 fs.appendFileSync(received,JSON.stringify(value)+'\\n');
 if(value.method==='initialize'){
  if(configuration.initialize==='hang')return;
  const result=()=>configuration.initialize==='reject'?send({id:value.id,error:{code:-32602,message:secret}}):send({id:value.id,result:{fixture:true}});
  if(configuration.initialize==='slow')setTimeout(result,80);else result();return;
 }
 if(value.method==='initialized'){initialized=true;return;}
 if(!value.method){send({method:'fixture/callbackReply',params:{id:value.id,type:typeof value.id,hasResult:Object.hasOwn(value,'result'),errorCode:value.error?.code??null}});return;}
 if(!initialized){send({id:value.id,error:{code:-32600,message:'fixture received work before initialized'}});return;}
 const p=value.params||{};
 if(value.method===configuration.nativeError?.method){send({id:value.id,error:{code:configuration.nativeError.code,message:configuration.nativeError.message,data:{privateAnswer:secret}}});return;}
 if(value.method==='fixture/echo'){send({id:value.id,result:p});return;}
 if(value.method==='fixture/delay'){
  setTimeout(()=>{send({id:value.id,result:{delayed:true}});send({method:'fixture/lateReplySent',params:{id:value.id}})},p.ms);return;
 }
 if(value.method==='fixture/error'){send({id:value.id,error:{code:-32602,message:secret,data:{privateAnswer:secret}}});return;}
 if(value.method==='fixture/batch'){
  const frames=Buffer.from(JSON.stringify({method:'fixture/first',params:{text:'Euro € and emoji 😀'}})+'\\n'+JSON.stringify({id:value.id,result:{text:'漢字 € 😀'}})+'\\n'+JSON.stringify({method:'fixture/last',params:{order:2}})+'\\n');
  const split=frames.indexOf(Buffer.from('€'))+1;
  process.stdout.write(frames.subarray(0,split));setTimeout(()=>process.stdout.write(frames.subarray(split)),15);return;
 }
 if(value.method==='fixture/callbacks'){
  for(const id of [0,'0',''])send({id,method:'item/tool/requestUserInput',params:{threadId:'thread_fixture',itemId:'same-inner-item',approvalId:'wrong-inner-approval'}});
  send({id:value.id,result:{issued:3}});return;
 }
 if(value.method==='fixture/resolve'){
  send({id:21,method:'item/commandExecution/requestApproval',params:{threadId:'thread_fixture',itemId:'inner',approvalId:'not-outer'}});
  send({method:'serverRequest/resolved',params:{threadId:'thread_fixture',requestId:21}});send({id:value.id,result:{resolved:true}});return;
 }
 if(value.method==='fixture/duplicate-callback'){
  const callback={id:41,method:'item/fileChange/requestApproval',params:{threadId:'thread_fixture'}};send(callback);send(callback);return;
 }
 if(value.method==='fixture/many-callbacks'){
  for(let i=0;i<4;i++)send({id:i+100,method:'item/tool/requestUserInput',params:{threadId:'thread_fixture'}});return;
 }
 if(value.method==='fixture/oversize'){process.stdout.write('x'.repeat(p.bytes));return;}
 if(value.method==='fixture/stderr'){process.stderr.write(secret.repeat(3000));return;}
 if(value.method==='fixture/pause-input'){send({id:value.id,result:{paused:true}});process.stdin.pause();return;}
 if(value.method==='fixture/invalid'){
  if(p.kind==='syntax')process.stdout.write('{not json}\\n');
  if(p.kind==='array')send([]);
  if(p.kind==='mixed')send({id:value.id,result:'ambiguous',error:{code:-32603,message:secret}});
  if(p.kind==='null-id')send({id:null,result:'wrong id'});
  if(p.kind==='empty-method')send({method:'',params:{}});
  if(p.kind==='unsafe-id')process.stdout.write('{"id":9007199254740993,"method":"fixture/callback","params":{}}\\n');
  if(p.kind==='utf8')process.stdout.write(Buffer.concat([Buffer.from('{"id":'+JSON.stringify(value.id)+',"result":"'),Buffer.from([0xc3,0x28]),Buffer.from('"}\\n')]));
  if(p.kind==='truncated')process.stdout.end('{"id":'+JSON.stringify(value.id)+',"result":');
  return;
 }
 if(value.method==='fixture/exit'){process.stderr.write(secret+'\\n',()=>process.exit(7));return;}
 if(value.method==='fixture/orphan'){
  const descendant=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000);process.send('armed')"],
   {stdio:['ignore',p.inherit?'inherit':'ignore',p.inherit?'inherit':'ignore','ipc'],env:{PATH:process.env.PATH}});
  descendant.once('message',()=>{process.stdout.write(JSON.stringify({id:value.id,result:{descendantPid:descendant.pid}})+'\\n',()=>setTimeout(()=>process.exit(0),15))});
  return;
 }
 send({id:value.id,error:{code:-32601,message:'fixture method not found'}});
});
`, { mode: 0o600 });
  const client = new CodexRpcClient({ executable: process.execPath, args: [script], cwd: root,
    env: { PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(path.delimiter), LANG: 'C.UTF-8' },
    requestTimeoutMs: 2000, initializationTimeoutMs: 2000, shutdownGraceMs: 40, shutdownKillMs: 150, shutdownTimeoutMs: 3000, ...overrides });
  clients.push(client);
  const notifications: NativeNotification[] = [], closed: Closed[] = [];
  client.on('notification', value => notifications.push(value)); client.on('closed', value => closed.push(value));
  async function records(): Promise<Array<Record<string, unknown>>> {
    const text = await fs.readFile(received, 'utf8').catch(() => '');
    return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  }
  return { root, client, notifications, closed, records };
}

async function processLive(pid: number): Promise<boolean> {
  try {
    const text = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    return !['Z', 'X'].includes(text.slice(text.lastIndexOf(') ') + 2).split(' ')[0]);
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-rpc-test-')); });
afterEach(async () => {
  const outcomes = await Promise.allSettled(clients.splice(0).map(client => client.close()));
  await fs.rm(directory, { recursive: true, force: true });
  expect(outcomes.filter(value => value.status === 'rejected')).toEqual([]);
});

describe('bounded native Codex stdio transport', () => {
  it.each([
    ['feedback/upload', 'sending feedback is disabled by configuration', 'CODEX_FEEDBACK_DISABLED'],
    ['experimentalFeature/list', 'thread not found: 01990000-0000-7000-8000-000000000001', 'CODEX_THREAD_NOT_LOADED'],
    ['thread/read', 'thread not found: 01990000-0000-7000-8000-000000000001', 'CODEX_RPC_REJECTED'],
  ])('classifies only exact content-free %s diagnostics', async (method, message, code) => {
    const value = await fixture({ nativeError: { method, message, code: -32600 } }); await value.client.start();
    await expect(value.client.request(method, {})).rejects.toMatchObject({ code, nativeMethod: method, nativeCode: -32600 });
  });

  it('permits an explicit one-hour command deadline without widening other native deadlines', async () => {
    const value = await fixture(); await value.client.start();
    await expect(value.client.request('command/exec', {}, 3_630_000)).rejects.toMatchObject({ code: 'CODEX_METHOD_UNAVAILABLE' });
    await expect(value.client.request('command/exec', {}, 3_630_001)).rejects.toMatchObject({ code: 'CODEX_RPC_INPUT_INVALID' });
    await expect(value.client.request('fixture/echo', {}, 600_001)).rejects.toMatchObject({ code: 'CODEX_RPC_INPUT_INVALID' });
    expect((await value.records()).filter(record => record.method === 'command/exec')).toHaveLength(1);
  });

  it('hands off the exact native request id for cancellation without waiting for the result', async () => {
    const value = await fixture(); await value.client.start();
    const tracked = await value.client.requestTracked('fixture/delay', { ms: 80 });
    expect(tracked.generation).toBe(value.client.generation);
    expect(String(tracked.id)).toContain(value.client.generation);
    await expect.poll(async () => (await value.records()).find(record => record.method === 'fixture/delay')?.id).toBe(tracked.id);
    await expect(tracked.result).resolves.toEqual({ delayed: true });
    await expect(value.client.requestTracked('initialize')).rejects.toMatchObject({ code: 'CODEX_CONNECTION_USED' });
  });

  it('requires the initialize acknowledgment before sending initialized and admitting work', async () => {
    const value = await fixture({ initialize: 'slow' });
    const starting = value.client.start();
    await expect(value.client.request('fixture/echo', {})).rejects.toMatchObject({ code: 'CODEX_UNAVAILABLE', outcomeUnknown: false });
    await starting;
    await expect(value.client.request('fixture/echo', { actual: 'stdio' })).resolves.toEqual({ actual: 'stdio' });
    const records = await value.records();
    expect(records.map(row => row.method)).toEqual(['initialize', 'initialized', 'fixture/echo']);
    expect(records[0]).toMatchObject({ params: { clientInfo: { name: 'codex_workspace' }, capabilities: {
      experimentalApi: true, requestAttestation: false, explicitGatewayOauth: true, extensions: { 'openai/form': {} },
    } } });
    expect(records[0]).not.toHaveProperty('jsonrpc');
    expect(records[1]).toEqual({ method: 'initialized' });
    expect(String(records[2].id)).toContain(value.client.generation);
    await expect(value.client.start()).rejects.toMatchObject({ code: 'CODEX_CONNECTION_USED' });
  });

  it('preserves split UTF-8 and notification/reply ordering across coalesced JSONL frames', async () => {
    const value = await fixture(); await value.client.start();
    await expect(value.client.request('fixture/batch')).resolves.toEqual({ text: '漢字 € 😀' });
    await expect.poll(() => value.notifications.map(item => item.method)).toEqual(['fixture/first', 'fixture/last']);
    expect(value.notifications[0].params.text).toBe('Euro € and emoji 😀');
  });

  it('answers exact typed outer callback IDs and never confuses item/approval identifiers', async () => {
    const value = await fixture(), callbacks: NativeServerRequest[] = [];
    value.client.on('request', request => callbacks.push(request)); await value.client.start();
    await value.client.request('fixture/callbacks');
    expect(callbacks.map(request => request.id)).toEqual([0, '0', '']);
    expect(() => value.client.respond('same-inner-item', {})).toThrowError(expect.objectContaining({ code: 'CODEX_REQUEST_STALE' }));
    for (const callback of callbacks) value.client.respond(callback.id, { answered: true });
    expect(() => value.client.respond(0, {})).toThrowError(expect.objectContaining({ code: 'CODEX_REQUEST_STALE' }));
    await expect.poll(() => value.notifications.filter(item => item.method === 'fixture/callbackReply').length).toBe(3);
    const replies = (await value.records()).filter(row => Object.hasOwn(row, 'result'));
    expect(replies.map(row => [typeof row.id, row.id])).toEqual([['number', 0], ['string', '0'], ['string', '']]);
    expect(replies.every(row => !Object.hasOwn(row, 'method'))).toBe(true);
  });

  it('clears externally resolved callbacks and explicitly rejects unsupported requests', async () => {
    const value = await fixture(); await value.client.start();
    await value.client.request('fixture/callbacks');
    await expect.poll(() => value.notifications.filter(item => item.method === 'fixture/callbackReply').length).toBe(3);
    expect(value.notifications.filter(item => item.method === 'fixture/callbackReply').every(item => item.params.errorCode === -32601)).toBe(true);
    value.client.on('request', () => undefined);
    await value.client.request('fixture/resolve');
    expect(() => value.client.respond(21, { decision: 'accept' })).toThrowError(expect.objectContaining({ code: 'CODEX_REQUEST_STALE' }));
  });

  it('reports timeout as unknown outcome, ignores late acknowledgment and never replays', async () => {
    const value = await fixture(); await value.client.start();
    await expect(value.client.request('fixture/delay', { ms: 90 }, 20)).rejects.toMatchObject({ code: 'CODEX_ACKNOWLEDGMENT_TIMEOUT', outcomeUnknown: true });
    await expect.poll(() => value.notifications.some(message => message.method === 'fixture/lateReplySent')).toBe(true);
    await expect(value.client.request('fixture/echo', { next: true })).resolves.toEqual({ next: true });
    expect((await value.records()).filter(row => row.method === 'fixture/delay')).toHaveLength(1);
    expect(value.closed).toEqual([]);
  });

  it('retains native rejection codes without reflecting secret-bearing error bodies', async () => {
    const value = await fixture(); await value.client.start();
    const failure = await value.client.request('fixture/error').catch(error => error);
    if (!(failure instanceof Error)) throw new Error('The fixture did not reject its request.');
    expect(failure).toMatchObject({ code: 'CODEX_RPC_REJECTED', nativeCode: -32602, nativeMethod: 'fixture/error', outcomeUnknown: false });
    expect(failure.message).not.toContain(secret);
    expect(JSON.stringify(failure)).not.toContain(secret);
  });

  const threadId = '12345678-1234-4234-8234-123456789abc';
  const missingRollout = `invalid paginated history lineage for ${threadId}: missing source rollout`;

  it.each([
    { method: 'thread/turns/list', field: 'thread/turns/list' },
    { method: 'thread/read', field: 'includeTurns' },
  ])('recognizes the installed CLI first-message materialization diagnostic for $method', async ({ method, field }) => {
    const message = `thread ${threadId} is not materialized yet; ${field} is unavailable before first user message`;
    const value = await fixture({ nativeError: { method, code: -32600, message } }); await value.client.start();
    await expect(value.client.request(method, { threadId })).rejects.toMatchObject({ code: 'CODEX_HISTORY_UNMATERIALIZED', outcomeUnknown: false });
    expect((await value.records()).filter(row => row.method === method)).toHaveLength(1);
    const privateValue = await fixture({ nativeError: { method, code: -32600, message: message + '\n' + secret } });
    await privateValue.client.start();
    const failure = await privateValue.client.request(method, { threadId }).catch(error => error);
    expect(failure).toMatchObject({ code: 'CODEX_RPC_REJECTED' }); expect(JSON.stringify(failure)).not.toContain(secret);
  });

  it('distinguishes an advertised but unimplemented native method without reflecting its diagnostics', async () => {
    const value = await fixture({ nativeError: { method: 'thread/items/list', code: -32601,
      message: 'thread/items/list is not supported yet ' + secret } }); await value.client.start();
    const failure = await value.client.request('thread/items/list', { threadId }).catch(error => error);
    expect(failure).toMatchObject({ status: 501, code: 'CODEX_METHOD_UNAVAILABLE', nativeCode: -32601,
      nativeMethod: 'thread/items/list', outcomeUnknown: false });
    expect(JSON.stringify(failure)).not.toContain(secret);
  });

  it.each(['thread/items/list', 'thread/turns/list'])(
    'classifies exact unmaterialized history for %s without disclosure or replay', async method => {
      const value = await fixture({ nativeError: { method, code: -32600, message: missingRollout } });
      await value.client.start();
      const failure = await value.client.request(method, { threadId }).catch(error => error);
      if (!(failure instanceof Error)) throw new Error('The fixture did not reject its request.');
      expect(failure).toMatchObject({ status: 409, code: 'CODEX_HISTORY_UNMATERIALIZED', nativeCode: -32600,
        nativeMethod: method, outcomeUnknown: false, message: 'Native Codex history is not materialized.' });
      for (const privateText of [secret, threadId, missingRollout]) {
        expect(failure.message).not.toContain(privateText);
        expect(JSON.stringify(failure)).not.toContain(privateText);
        expect(failure.stack).not.toContain(privateText);
      }
      await expect(value.client.request('fixture/echo', { stillConnected: true })).resolves.toEqual({ stillConnected: true });
      expect((await value.records()).map(row => row.method)).toEqual(['initialize', 'initialized', method, 'fixture/echo']);
      expect(value.notifications).toEqual([]); expect(value.closed).toEqual([]);
    });

  it.each([
    { name: 'another native method', method: 'thread/read', code: -32600, message: missingRollout },
    { name: 'a different native code', method: 'thread/items/list', code: -32602, message: missingRollout },
    { name: 'an unrelated rejection', method: 'thread/turns/list', code: -32600, message: secret },
    { name: 'a private prefix', method: 'thread/items/list', code: -32600, message: `${secret} ${missingRollout}` },
    { name: 'a private suffix', method: 'thread/turns/list', code: -32600, message: `${missingRollout} ${secret}` },
    { name: 'a trailing newline', method: 'thread/items/list', code: -32600, message: `${missingRollout}\n` },
    { name: 'a private thread identifier', method: 'thread/turns/list', code: -32600,
      message: `invalid paginated history lineage for ${secret}: missing source rollout` },
    { name: 'a malformed UUID', method: 'thread/items/list', code: -32600, message: missingRollout.replace('789abc', '789abz') },
    { name: 'another history diagnostic', method: 'thread/turns/list', code: -32600,
      message: missingRollout.replace('missing source rollout', 'missing source metadata') },
  ])('keeps $name generic without reflecting native history text or replaying', async ({ method, code, message }) => {
    const value = await fixture({ nativeError: { method, code, message } }); await value.client.start();
    const failure = await value.client.request(method, { threadId }).catch(error => error);
    if (!(failure instanceof Error)) throw new Error('The fixture did not reject its request.');
    expect(failure).toMatchObject({ code: 'CODEX_RPC_REJECTED', nativeCode: code, nativeMethod: method, outcomeUnknown: false });
    for (const privateText of [secret, threadId, message]) {
      expect(failure.message).not.toContain(privateText);
      expect(JSON.stringify(failure)).not.toContain(privateText);
      expect(failure.stack).not.toContain(privateText);
    }
    await expect(value.client.request('fixture/echo', { stillConnected: true })).resolves.toEqual({ stillConnected: true });
    expect((await value.records()).map(row => row.method)).toEqual(['initialize', 'initialized', method, 'fixture/echo']);
    expect(value.notifications).toEqual([]); expect(value.closed).toEqual([]);
  });

  it('rejects invalid, cyclic and oversized outbound requests before sending them', async () => {
    const value = await fixture({}, { maxFrameBytes: 1024 }); await value.client.start();
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    await expect(value.client.request('fixture/echo', cyclic)).rejects.toMatchObject({ code: 'CODEX_RPC_INPUT_INVALID', outcomeUnknown: false });
    await expect(value.client.request('', {})).rejects.toMatchObject({ code: 'CODEX_RPC_INPUT_INVALID' });
    await expect(value.client.request('fixture/echo', {}, NaN)).rejects.toMatchObject({ code: 'CODEX_RPC_INPUT_INVALID' });
    await expect(value.client.request('fixture/echo', { text: '😀'.repeat(400) })).rejects.toMatchObject({ code: 'CODEX_FRAME_LIMIT', outcomeUnknown: false });
    expect((await value.records()).filter(row => row.method === 'fixture/echo')).toEqual([]);
    await expect(value.client.request('fixture/echo', { small: true })).resolves.toEqual({ small: true });
  });

  it('enforces pending request capacity while retaining all already-dispatched requests', async () => {
    const value = await fixture({}, { maxPendingRequests: 2 }); await value.client.start();
    const first = value.client.request('fixture/delay', { ms: 80 }), second = value.client.request('fixture/delay', { ms: 80 });
    await expect(value.client.request('fixture/echo')).rejects.toMatchObject({ code: 'CODEX_REQUEST_LIMIT', outcomeUnknown: false });
    await Promise.all([first, second]);
    expect((await value.records()).filter(row => row.method === 'fixture/delay')).toHaveLength(2);
  });

  it.each(['syntax', 'array', 'mixed', 'null-id', 'empty-method', 'unsafe-id', 'utf8', 'truncated'])(
    'stops malformed %s frames without publishing protocol content or retrying', async kind => {
      const value = await fixture(); await value.client.start();
      await expect(value.client.request('fixture/invalid', { kind })).rejects.toMatchObject({ code: 'CODEX_PROTOCOL_ERROR', outcomeUnknown: true });
      await value.client.close();
      expect(value.closed).toHaveLength(1);
      expect(value.closed[0]).toMatchObject({ expected: false, cleanupComplete: true });
      expect(value.closed[0].message).not.toContain(secret);
      expect((await value.records()).filter(row => row.method === 'fixture/invalid')).toHaveLength(1);
    });

  it('bounds unterminated frame bytes and diagnostic output separately from their contents', async () => {
    const frames = await fixture({}, { maxFrameBytes: 1024 }); await frames.client.start();
    await expect(frames.client.request('fixture/oversize', { bytes: 2048 })).rejects.toMatchObject({ code: 'CODEX_PROTOCOL_ERROR' });
    await frames.client.close();
    const diagnostics = await fixture({}, { maxOutputBytesPerWindow: 1024 }); await diagnostics.client.start();
    await expect(diagnostics.client.request('fixture/stderr')).rejects.toMatchObject({ code: 'CODEX_OUTPUT_LIMIT' });
    await diagnostics.client.close();
    expect(JSON.stringify(diagnostics.closed)).not.toContain(secret);
  });

  it('bounds unanswered callbacks and refuses a duplicate pending outer identity', async () => {
    for (const method of ['fixture/many-callbacks', 'fixture/duplicate-callback']) {
      const value = await fixture({}, { maxServerRequests: 2 }); value.client.on('request', () => undefined); await value.client.start();
      await expect(value.client.request(method)).rejects.toMatchObject({ code: 'CODEX_PROTOCOL_ERROR' });
      await value.client.close();
    }
  });

  it('bounds queued writes when the actual child stops reading stdin', async () => {
    const value = await fixture({}, { maxFrameBytes: 8192, maxWriteBufferBytes: 8192 }); await value.client.start();
    await value.client.request('fixture/pause-input');
    const pending = Array.from({ length: 80 }, () => value.client.request('fixture/echo', { text: 'x'.repeat(6000) }).then(
      result => ({ result, code: '' }), error => ({ code: error.code, outcomeUnknown: error.outcomeUnknown })));
    await value.client.close();
    const results = await Promise.all(pending);
    expect(results.some(result => result.code === 'CODEX_FRAME_LIMIT')).toBe(true);
    expect(results.filter(result => result.code === 'CODEX_FRAME_LIMIT').every(result => 'outcomeUnknown' in result && result.outcomeUnknown === false)).toBe(true);
  });

  it('cleans up rejected and timed-out initialization without requiring a caller cleanup', async () => {
    const rejected = await fixture({ initialize: 'reject' });
    await expect(rejected.client.start()).rejects.toMatchObject({ code: 'CODEX_RPC_REJECTED', outcomeUnknown: false });
    expect(rejected.client.running).toBe(false); expect(rejected.closed[0].cleanupComplete).toBe(true);
    const timedOut = await fixture({ initialize: 'hang' }, { initializationTimeoutMs: 50 });
    await expect(timedOut.client.start()).rejects.toMatchObject({ code: 'CODEX_ACKNOWLEDGMENT_TIMEOUT', outcomeUnknown: true });
    expect(timedOut.client.running).toBe(false); expect(timedOut.closed[0].cleanupComplete).toBe(true);
  });

  it('distinguishes a never-spawned executable from an exited process without stderr disclosure', async () => {
    const missing = await fixture({}, { executable: path.join(directory, 'does-not-exist') });
    await expect(missing.client.start()).rejects.toMatchObject({ code: 'CODEX_START_FAILED' });
    expect(missing.client.pid).toBeUndefined();
    const exited = await fixture(); await exited.client.start(); const pid = exited.client.pid;
    await expect(exited.client.request('fixture/exit')).rejects.toMatchObject({ code: 'CODEX_PROCESS_CLOSED', outcomeUnknown: true });
    await exited.client.close(); expect(exited.client.pid).toBe(pid);
    expect(JSON.stringify(exited.closed)).not.toContain(secret);
  });

  it('contains a throwing subscriber and still settles owned shutdown', async () => {
    const value = await fixture(); await value.client.start();
    value.client.on('notification', () => { throw new Error(secret); });
    value.client.on('closed', () => { throw new Error(secret); });
    await expect(value.client.request('fixture/batch')).rejects.toMatchObject({ code: 'CODEX_EVENT_HANDLER_FAILED' });
    await expect(value.client.close()).resolves.toBeUndefined();
    expect(value.closed[0].message).not.toContain(secret);
  });

  it('escalates only its own process group and leaves an independent connection alive', async () => {
    const independent = await fixture(); await independent.client.start();
    const stubborn = await fixture({ ignoreEof: true, ignoreTerm: true }); await stubborn.client.start();
    const first = stubborn.client.close(), second = stubborn.client.close();
    expect(first).toBe(second); await first;
    expect(stubborn.closed[0]).toMatchObject({ cleanupComplete: true, forced: true });
    expect(await processLive(stubborn.client.pid!)).toBe(false);
    await expect(independent.client.request('fixture/echo', { survived: true })).resolves.toEqual({ survived: true });
  });

  it.each([true, false])('disposes a descendant after its leader exited (inherited stdio: %s)', async inherit => {
    const value = await fixture(); await value.client.start();
    const closed = once(value.client, 'closed');
    const result = await value.client.request<{ descendantPid: number }>('fixture/orphan', { inherit });
    const [detail] = await closed as [Closed];
    await value.client.close();
    expect(detail).toMatchObject({ expected: false, cleanupComplete: true, forced: true });
    expect(await processLive(result.descendantPid)).toBe(false);
    expect(value.client.running).toBe(false);
  });

  it('rejects invalid unbounded transport options before creating a process', async () => {
    const base: CodexRpcOptions = { executable: process.execPath, args: [], cwd: directory, env: {} };
    for (const patch of [{ maxFrameBytes: Infinity }, { requestTimeoutMs: 0 }, { maxPendingRequests: 1.5 },
      { maxMessagesPerWindow: NaN }, { shutdownGraceMs: 20, shutdownKillMs: 10 }]) {
      expect(() => new CodexRpcClient({ ...base, ...patch })).toThrowError(expect.objectContaining({ code: 'CODEX_RPC_OPTIONS_INVALID' }));
    }
  });
});
