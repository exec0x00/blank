import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { AppContext } from '../server/context';
import type { CodexSkill, FileAttachment, ImageAttachment } from '../shared/types';
import { loadConfig } from '../server/config';
import { JsonStore, SecretStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import { defaultSettings } from '../server/settings';
import { getImageAttachments, IMAGE_ATTACHMENT_LIMITS } from '../server/agent/attachments';
import { getConversationFiles, shutdownConversationFiles, FILE_ATTACHMENT_LIMITS } from '../server/conversation-files';
import { shutdownUploads } from '../server/uploads';
import { withWorkspaceRemoval } from '../server/worktrees/activity';
import { prepareCodexInput, loadCodexAttachmentResolver, projectCodexQueuedInput, copyCodexAttachmentBindings,
  codexFileReferenceText, isCodexFileReferenceText, cleanupCodexInputs, CODEX_INPUT_LIMITS } from '../server/codex-cli/inputs';
import type { CodexNativeInputDescriptor, PreparedCodexInput } from '../server/codex-cli/inputs';
import type { NativeAttachmentContext, NativeUserInput } from '../server/codex-cli/native-types';
import type { WorkspaceArtifactCleanupRequest } from '../server/workspace-trash/service';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4bm4DAANjAVvvpjgdAAAAAElFTkSuQmCC', 'base64');
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const threadId = () => `0195a655-0f31-7000-8000-${randomUUID().slice(-12)}`;
const reference = (value: FileAttachment | ImageAttachment) => ({ id: value.id, sha256: value.sha256 });
const descriptors = (input: readonly NativeUserInput[], id: string): CodexNativeInputDescriptor[] =>
  input.map((value, inputIndex) => ({ input: value, clientUserMessageId: id, inputIndex }));
const fileReferences = (input: readonly NativeUserInput[]): Array<{ name: string; path: string; bytes: number; sha256: string }> => {
  const text = String(input.find(item => item.type === 'text')?.text ?? '');
  const match = /\n(\[\{"name":[^\n]+\])\n\[End attachment metadata\]$/.exec(text);
  return match ? JSON.parse(match[1]) : [];
};
let directory: string, ctx: AppContext, workspaceId: string;
const contexts: AppContext[] = [];
beforeEach(async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('Input preparation must not contact an external service.'); });
  vi.spyOn(https, 'request').mockImplementation(() => { throw new Error('Input preparation must not start HTTP, a provider, or the CLI.'); });
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-native-inputs-test-'));
  ctx = await context(); workspaceId = (await ctx.workspaces.list())[0].id;
});
afterEach(async () => {
  for (const value of contexts.splice(0)) {
    await getImageAttachments(value).close(); await shutdownConversationFiles(value); await shutdownUploads(value); await value.store.flush();
  }
  expect(globalThis.fetch).not.toHaveBeenCalled(); expect(https.request).not.toHaveBeenCalled();
  vi.restoreAllMocks(); await fs.rm(directory, { recursive: true, force: true });
});
async function context(): Promise<AppContext> {
  const config = loadConfig({ DATA_DIR: path.join(directory, 'data'), RUNTIME_DIR: path.join(directory, 'runtime'), NODE_ENV: 'test',
    WORKSPACE_PASSWORD: 'native-input-fixture-password', SESSION_SECRET: 'native-input-fixture-session-'.repeat(3), ENCRYPTION_KEY: 'native-input-fixture-key-'.repeat(3) });
  const store = new JsonStore(config.stateDir), workspaces = new WorkspaceService(config, store); await workspaces.initialize();
  const value: AppContext = { config, store, workspaces, events: new EventEmitter(), secrets: new SecretStore(store, config.encryptionKey),
    settings: async () => ({ ...defaultSettings }), saveSettings: async patch => ({ ...defaultSettings, ...patch }),
    providerKey: async () => { throw new Error('The native input adapter has no model credentials.'); } };
  contexts.push(value); return value;
}
async function image(name = 'Selected.png', selectedWorkspace = workspaceId): Promise<ImageAttachment> {
  return getImageAttachments(ctx).upload(selectedWorkspace, { name, bytes: png, detail: 'original' });
}
async function file(name = 'Selected.pdf', bytes = Buffer.from('%PDF-1.4\nreal selected bytes\0'), selectedWorkspace = workspaceId): Promise<FileAttachment> {
  return getConversationFiles(ctx).storage.commit({ id: `file_${randomUUID().replaceAll('-', '')}`, workspaceId: selectedWorkspace,
    name, mimeType: 'application/octet-stream', bytes: bytes.length, sha256: hash(bytes), createdAt: new Date().toISOString() }, bytes);
}
const projectionContext = (thread: string, client: string | null, inputIndex = 0): NativeAttachmentContext => ({ workspaceId,
  threadId: thread, turnId: threadId(), itemId: randomUUID(), inputIndex, clientUserMessageId: client });
async function binding(prepared: PreparedCodexInput) {
  const target = prepared.input.find(item => item.type === 'localImage')?.path ?? fileReferences(prepared.input)[0]?.path;
  if (typeof target !== 'string') throw new Error('Expected an actual native attachment path.');
  const filename = path.join(path.dirname(target), 'binding.json');
  return { filename, value: JSON.parse(await fs.readFile(filename, 'utf8')) };
}

describe('site uploads to official native inputs', () => {
  it('preserves user text and arbitrary client correlation without creating site history or paths', async () => {
    const id = randomUUID(), text = 'Exact user text\nwith a newline.\n';
    const prepared = await prepareCodexInput(ctx, workspaceId, threadId(), { prompt: text, clientUserMessageId: id });
    expect(prepared.input).toEqual([{ type: 'text', text, text_elements: [] }]); expect(prepared.clientUserMessageId).toBe(id);
    await prepared.acknowledge(); await prepared.hold(); await prepared.release();
    await expect(fs.stat(path.join(ctx.config.stateDir, 'codex-cli-inputs-v1'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await prepareCodexInput(ctx, workspaceId, threadId(), { prompt: 'Hello' })).clientUserMessageId).toMatch(/^[a-f0-9-]{36}$/);
    const opaque = 'browser-session:chosen-message';
    expect((await prepareCodexInput(ctx, workspaceId, threadId(), { prompt: 'Hello', clientUserMessageId: opaque })).clientUserMessageId).toBe(opaque);
  });

  it('prepares genuine image/file bytes as immutable durable native paths and factual references', async () => {
    const photo = await image(), document = await file(), thread = threadId(), client = randomUUID(), prompt = 'Please review my selected inputs.';
    const prepared = await prepareCodexInput(ctx, workspaceId, thread, { prompt, clientUserMessageId: client,
      attachments: [reference(photo)], fileAttachments: [reference(document)] });
    expect(prepared.input.map(item => item.type)).toEqual(['text', 'localImage']);
    expect(String(prepared.input[0].text)).toMatch(/^Please review my selected inputs\./);
    expect(String(prepared.input[0].text)).not.toContain('real selected bytes');
    expect(String(prepared.input[0].text)).not.toContain('read_file_attachment');
    const nativeImage = prepared.input[1];
    expect(nativeImage).toMatchObject({ type: 'localImage', detail: 'original' });
    expect(String(nativeImage.path)).not.toContain('/proc/');
    expect(await fs.readFile(String(nativeImage.path))).toEqual(png);
    const selected = fileReferences(prepared.input); expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({ name: document.name, bytes: document.bytes, sha256: document.sha256 });
    expect(hash(await fs.readFile(selected[0].path))).toBe(document.sha256);
    for (const target of [String(nativeImage.path), selected[0].path]) expect((await fs.stat(target)).mode & 0o777).toBe(0o400);
    const saved = await binding(prepared); expect(saved.value.state).toBe('prepared');
    expect(JSON.stringify(saved.value)).not.toContain(prompt); expect(JSON.stringify(saved.value)).not.toContain('data:image');
    expect(saved.value).not.toHaveProperty('input'); expect(saved.value).not.toHaveProperty('messages');
    await expect(getImageAttachments(ctx).discard(workspaceId, photo.id)).rejects.toMatchObject({ code: 'ATTACHMENT_IN_USE' });
    await expect(getConversationFiles(ctx).discard(workspaceId, reference(document))).rejects.toMatchObject({ code: 'FILE_ATTACHMENT_IN_USE' });
  });

  it('binds local and queued-inline previews to exact known refs without returning binary content or implementation paths', async () => {
    const photo = await image(), document = await file(), thread = threadId(), prompt = 'The unchanged user prefix.\n';
    const prepared = await prepareCodexInput(ctx, workspaceId, thread, { prompt, attachments: [reference(photo)], fileAttachments: [reference(document)] });
    await prepared.acknowledge();
    const native = prepared.input.map(item => item.type === 'localImage' ? { type: 'image', detail: item.detail, url: `data:image/png;base64,${png.toString('base64')}` } : item);
    const resolver = await loadCodexAttachmentResolver(ctx, workspaceId, thread, descriptors(native, prepared.clientUserMessageId));
    expect(resolver(native[0], projectionContext(thread, prepared.clientUserMessageId))).toEqual({ text: prompt, fileAttachments: [document] });
    expect(resolver(native[1], projectionContext(thread, prepared.clientUserMessageId, 1))).toEqual({ attachments: [photo] });
    const queued = projectCodexQueuedInput(native, prepared.clientUserMessageId, resolver);
    expect(queued).toEqual({ prompt, attachmentNames: [document.name, photo.name] });
    expect(JSON.stringify(queued)).not.toContain(ctx.config.stateDir); expect(JSON.stringify(queued)).not.toContain('base64');
    expect(resolver(native[1], projectionContext(thread, 'another-client', 1))).toBeUndefined();
    expect(resolver(native[1], projectionContext(thread, null, 1))).toBeUndefined();
    expect(resolver(native[1], { ...projectionContext(thread, prepared.clientUserMessageId, 1), threadId: threadId() })).toBeUndefined();
    const local = await loadCodexAttachmentResolver(ctx, workspaceId, thread, descriptors(prepared.input, prepared.clientUserMessageId));
    expect(local(prepared.input[1], projectionContext(thread, prepared.clientUserMessageId, 1))).toEqual({ attachments: [photo] });
  });

  it('keeps two selected identical photos distinct by their actual native input positions', async () => {
    const first = await image('first.png'), second = await image('second.png'), thread = threadId();
    const prepared = await prepareCodexInput(ctx, workspaceId, thread, { prompt: 'Compare.', attachments: [reference(first), reference(second)] });
    const native = prepared.input.map(item => item.type === 'localImage' ? { type: 'image', url: `data:image/png;base64,${png.toString('base64')}` } : item);
    const resolver = await loadCodexAttachmentResolver(ctx, workspaceId, thread, descriptors(native, prepared.clientUserMessageId));
    expect(resolver(native[1], projectionContext(thread, prepared.clientUserMessageId, 1))?.attachments?.[0].id).toBe(first.id);
    expect(resolver(native[2], projectionContext(thread, prepared.clientUserMessageId, 2))?.attachments?.[0].id).toBe(second.id);
    expect(projectCodexQueuedInput(native, prepared.clientUserMessageId, resolver).attachmentNames).toEqual(['first.png', 'second.png']);
  });

  it('preserves accepted and uncertain files across a fresh site context without replaying native work', async () => {
    const document = await file(), thread = threadId(), client = randomUUID();
    const prepared = await prepareCodexInput(ctx, workspaceId, thread, { prompt: 'A held request.', clientUserMessageId: client, fileAttachments: [reference(document)] });
    await prepared.hold(); await expect(prepared.release()).rejects.toMatchObject({ code: 'CODEX_INPUT_RETAINED' });
    const fresh = await context();
    const resolver = await loadCodexAttachmentResolver(fresh, workspaceId, thread, descriptors(prepared.input, client));
    expect(projectCodexQueuedInput(prepared.input, client, resolver)).toEqual({ prompt: 'A held request.', attachmentNames: [document.name] });
    await expect(prepareCodexInput(fresh, workspaceId, thread, { prompt: 'A held request.', clientUserMessageId: client, fileAttachments: [reference(document)] }))
      .rejects.toMatchObject({ code: 'CODEX_INPUT_OUTCOME_PENDING' });
    await prepared.acknowledge(); expect((await binding(prepared)).value.state).toBe('accepted');
    await prepared.hold(); expect((await binding(prepared)).value.state).toBe('accepted');
    await expect(prepared.release()).rejects.toMatchObject({ code: 'CODEX_INPUT_RETAINED' });
  });

  it('serializes duplicate preparation identities and never rewrites their selected snapshot', async () => {
    const photo = await image(), thread = threadId(), client = randomUUID();
    const draft = { prompt: 'One selected input.', attachments: [reference(photo)], clientUserMessageId: client };
    const outcomes = await Promise.allSettled([prepareCodexInput(ctx, workspaceId, thread, draft), prepareCodexInput(ctx, workspaceId, thread, draft)]);
    expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(value => value.status === 'rejected')).toMatchObject({ reason: { code: 'CODEX_INPUT_OUTCOME_PENDING' } });
    const prepared = (outcomes.find(value => value.status === 'fulfilled') as PromiseFulfilledResult<PreparedCodexInput>).value;
    expect(await fs.readFile(String(prepared.input[1].path))).toEqual(png);
    expect((await binding(prepared)).value.state).toBe('prepared');
  });

  it('releases only pre-RPC copies and leaves retained uploaded originals intact', async () => {
    const photo = await image(), document = await file(), thread = threadId();
    const prepared = await prepareCodexInput(ctx, workspaceId, thread, { prompt: '', attachments: [reference(photo)], fileAttachments: [reference(document)] });
    const paths = [String(prepared.input.find(item => item.type === 'localImage')!.path), fileReferences(prepared.input)[0].path];
    await prepared.release(); await prepared.release();
    for (const target of paths) await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await getImageAttachments(ctx).preview(workspaceId, photo.id, photo.sha256)).bytes).toEqual(png);
    expect((await getConversationFiles(ctx).storage.read(workspaceId, reference(document))).attachment).toEqual(document);
    const resolver = await loadCodexAttachmentResolver(ctx, workspaceId, thread, descriptors(prepared.input, prepared.clientUserMessageId));
    expect(resolver(prepared.input[0], projectionContext(thread, prepared.clientUserMessageId))).toBeUndefined();
  });

  it('preserves a manually changed snapshot when pre-RPC release cannot verify ownership bytes', async () => {
    const document = await file(), prepared = await prepareCodexInput(ctx, workspaceId, threadId(), { prompt: 'Prepare only.', fileAttachments: [reference(document)] });
    const target = fileReferences(prepared.input)[0].path;
    await fs.chmod(target, 0o600); await fs.writeFile(target, 'Keep this manual change.');
    await expect(prepared.release()).rejects.toMatchObject({ code: 'CODEX_INPUT_CHANGED' });
    expect(await fs.readFile(target, 'utf8')).toBe('Keep this manual change.');
    expect((await binding(prepared)).value.state).toBe('prepared');
  });

  it('does not resolve an arbitrary path, URL, unbound descriptor or copied parent context', async () => {
    const photo = await image(), thread = threadId();
    const prepared = await prepareCodexInput(ctx, workspaceId, thread, { prompt: 'Parent.', attachments: [reference(photo)] });
    const child = threadId(), fake = { type: 'localImage', path: path.join(directory, 'unselected.png') };
    await fs.writeFile(String(fake.path), png);
    const read = vi.spyOn(fs, 'open');
    const resolver = await loadCodexAttachmentResolver(ctx, workspaceId, child, [...descriptors(prepared.input, prepared.clientUserMessageId), { input: fake }]);
    expect(resolver(fake, projectionContext(child, null))).toBeUndefined();
    expect(resolver(prepared.input[1], projectionContext(child, prepared.clientUserMessageId, 1))).toBeUndefined();
    expect(read.mock.calls.some(call => String(call[0]) === fake.path)).toBe(false);
    read.mockRestore();
    const remote = { type: 'image', url: 'https://untrusted.example.test/image.png' };
    const unknown = await loadCodexAttachmentResolver(ctx, workspaceId, thread, [{ input: remote, clientUserMessageId: prepared.clientUserMessageId }]);
    expect(unknown(remote, projectionContext(thread, prepared.clientUserMessageId))).toBeUndefined();
  });

  it('authorizes only actual selected refs for an explicit native fork, including grandchildren', async () => {
    const photo = await image(), document = await file(), parent = threadId(), child = threadId(), grandchild = threadId();
    const prepared = await prepareCodexInput(ctx, workspaceId, parent, { prompt: 'Fork these selected inputs.', attachments: [reference(photo)], fileAttachments: [reference(document)] });
    await prepared.acknowledge(); const actual = descriptors(prepared.input, prepared.clientUserMessageId);
    await copyCodexAttachmentBindings(ctx, workspaceId, parent, child, actual);
    const childResolver = await loadCodexAttachmentResolver(ctx, workspaceId, child, actual);
    expect(projectCodexQueuedInput(prepared.input, prepared.clientUserMessageId, childResolver).attachmentNames).toEqual([document.name, photo.name]);
    await copyCodexAttachmentBindings(ctx, workspaceId, child, grandchild, actual);
    const grandchildResolver = await loadCodexAttachmentResolver(ctx, workspaceId, grandchild, actual);
    expect(grandchildResolver(prepared.input[1], projectionContext(grandchild, prepared.clientUserMessageId, 1))?.attachments).toEqual([photo]);
  });

  it('reads explicit-fork previews only for actual child items without writing bindings or retaining uploads', async () => {
    const photo = await image(), document = await file(), parent = threadId(), child = threadId();
    const prepared = await prepareCodexInput(ctx, workspaceId, parent, { prompt: 'Exact inherited user prefix.',
      attachments: [reference(photo)], fileAttachments: [reference(document)] });
    await prepared.acknowledge();
    const source = await binding(prepared), before = await fs.readFile(source.filename);
    const childDirectory = path.join(ctx.config.stateDir, 'codex-cli-inputs-v1', hash(workspaceId), child);
    const mkdir = vi.spyOn(fs, 'mkdir'), write = vi.spyOn(fs, 'writeFile'), rename = vi.spyOn(fs, 'rename');
    const actual = descriptors(prepared.input, prepared.clientUserMessageId);
    const resolver = await loadCodexAttachmentResolver(ctx, workspaceId, child, actual, { explicitForkFromThreadId: parent });
    expect(projectCodexQueuedInput(prepared.input, prepared.clientUserMessageId, resolver))
      .toEqual({ prompt: 'Exact inherited user prefix.', attachmentNames: [document.name, photo.name] });
    expect(resolver(prepared.input[1], projectionContext(child, prepared.clientUserMessageId, 1))?.attachments).toEqual([photo]);
    expect(resolver(prepared.input[1], projectionContext(parent, prepared.clientUserMessageId, 1))).toBeUndefined();
    expect(resolver(prepared.input[1], projectionContext(child, 'unmatched-client', 1))).toBeUndefined();
    expect(resolver({ ...prepared.input[0], text: 'A different user prefix.' + String(prepared.input[0].text) },
      projectionContext(child, prepared.clientUserMessageId))).toBeUndefined();
    const selectedOnly = await loadCodexAttachmentResolver(ctx, workspaceId, child, [actual[1]], { explicitForkFromThreadId: parent });
    expect(selectedOnly(prepared.input[0], projectionContext(child, prepared.clientUserMessageId))).toBeUndefined();
    expect(selectedOnly(prepared.input[1], projectionContext(child, prepared.clientUserMessageId, 1))?.attachments).toEqual([photo]);
    const nativeInline = { type: 'image', url: `data:image/png;base64,${png.toString('base64')}` };
    expect(selectedOnly(nativeInline, projectionContext(child, prepared.clientUserMessageId, 1))).toBeUndefined();
    const inline = await loadCodexAttachmentResolver(ctx, workspaceId, child,
      [{ input: nativeInline, clientUserMessageId: prepared.clientUserMessageId, inputIndex: 1 }], { explicitForkFromThreadId: parent });
    expect(inline(nativeInline, projectionContext(child, prepared.clientUserMessageId, 1))?.attachments).toEqual([photo]);
    expect(inline(nativeInline, projectionContext(child, prepared.clientUserMessageId, 0))).toBeUndefined();
    expect(mkdir).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); expect(rename).not.toHaveBeenCalled();
    mkdir.mockRestore(); write.mockRestore(); rename.mockRestore();
    expect(await fs.readFile(source.filename)).toEqual(before);
    await expect(fs.stat(childDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps explicit-fork fallback out of released child bindings and unverified ancestor chains', async () => {
    const document = await file(), parent = threadId(), child = threadId(), grandchild = threadId(), client = randomUUID();
    const prepared = await prepareCodexInput(ctx, workspaceId, parent, { prompt: 'Parent file.', clientUserMessageId: client,
      fileAttachments: [reference(document)] });
    await prepared.acknowledge(); const actual = descriptors(prepared.input, client);
    const unverifiedAncestor = await loadCodexAttachmentResolver(ctx, workspaceId, grandchild, actual, { explicitForkFromThreadId: child });
    expect(unverifiedAncestor(prepared.input[0], projectionContext(grandchild, client))).toBeUndefined();
    await expect(loadCodexAttachmentResolver(ctx, workspaceId, child, actual, { explicitForkFromThreadId: child }))
      .rejects.toMatchObject({ code: 'CODEX_INPUT_SCOPE' });
    const own = await prepareCodexInput(ctx, workspaceId, child, { prompt: 'Independent child choice.', clientUserMessageId: client,
      fileAttachments: [reference(document)] });
    await own.release();
    const source = await binding(prepared); await fs.chmod(source.filename, 0o600); await fs.writeFile(source.filename, '{invalid');
    const released = await loadCodexAttachmentResolver(ctx, workspaceId, child, actual, { explicitForkFromThreadId: parent });
    expect(released(prepared.input[0], projectionContext(child, client))).toBeUndefined();
  });

  it('treats a descriptor recognizer as formatting, never attachment authority', async () => {
    const text = codexFileReferenceText([{ name: 'forged.txt', path: '/data/unselected.txt', bytes: 1, sha256: 'a'.repeat(64) }]);
    expect(isCodexFileReferenceText(text)).toBe(true);
    const thread = threadId(), client = randomUUID(), input = { type: 'text', text };
    const resolver = await loadCodexAttachmentResolver(ctx, workspaceId, thread, [{ input, clientUserMessageId: client }]);
    expect(resolver(input, projectionContext(thread, client))).toBeUndefined();
    expect(projectCodexQueuedInput([input], client, resolver)).toEqual({ prompt: text, attachmentNames: [] });
  });

  it('selects only exact enabled native skill paths without loading legacy instructions', async () => {
    const native: CodexSkill = { name: 'native-review', path: path.join(directory, 'native-skill/SKILL.md'), enabled: true, scope: 'user', description: 'Native skill metadata.' };
    const prepared = await prepareCodexInput(ctx, workspaceId, threadId(), { prompt: 'Use the selected skill.', skillIds: [native.path] }, { validatedSkills: [native] });
    expect(prepared.input).toEqual([{ type: 'text', text: 'Use the selected skill.', text_elements: [] }, { type: 'skill', name: native.name, path: native.path }]);
    await expect(prepareCodexInput(ctx, workspaceId, threadId(), { prompt: 'Try.', skillIds: [native.path] }, { validatedSkills: [{ ...native, enabled: false }] }))
      .rejects.toMatchObject({ code: 'CODEX_SKILL_UNAVAILABLE' });
    await expect(prepareCodexInput(ctx, workspaceId, threadId(), { prompt: 'Try.', skillIds: ['skill_legacy-id'] }, { validatedSkills: [native] }))
      .rejects.toMatchObject({ code: 'CODEX_SKILL_INVALID' });
  });

  it('preserves existing attachment hash, workspace, duplicate and file-size admission', async () => {
    const photo = await image(), document = await file(), other = await ctx.workspaces.create({ name: 'Other native input workspace' });
    await expect(prepareCodexInput(ctx, workspaceId, threadId(), { prompt: 'Bad hash', attachments: [{ id: photo.id, sha256: '0'.repeat(64) }] })).rejects.toBeDefined();
    await expect(prepareCodexInput(ctx, other.id, threadId(), { prompt: 'Cross workspace', fileAttachments: [reference(document)] })).rejects.toBeDefined();
    await expect(prepareCodexInput(ctx, workspaceId, threadId(), { prompt: 'Duplicate', attachments: [reference(photo), reference(photo)] })).rejects.toMatchObject({ code: 'CODEX_INPUT_INVALID' });
    await expect(prepareCodexInput(ctx, workspaceId, `thr_${randomUUID().replaceAll('-', '')}`, { prompt: 'Legacy', attachments: [reference(photo)] })).rejects.toMatchObject({ code: 'CODEX_LEGACY_READ_ONLY' });
    await expect(prepareCodexInput(ctx, workspaceId, threadId(), { prompt: 'x'.repeat(CODEX_INPUT_LIMITS.promptChars + 1) })).rejects.toMatchObject({ code: 'CODEX_INPUT_INVALID' });
    await expect(getImageAttachments(ctx).discard(workspaceId, photo.id)).resolves.toEqual({ deleted: true });
    await expect(getConversationFiles(ctx).discard(workspaceId, reference(document))).resolves.toEqual({ deleted: true });
  });

  it('refuses symlinked original bytes and symlinked native storage without following them', async () => {
    const document = await file(), storage = path.join(ctx.config.stateDir, 'conversation-files-v1', hash(workspaceId), `${document.id}.file`);
    const original = await fs.readFile(storage); await fs.unlink(storage);
    const outside = path.join(directory, 'outside.file'); await fs.writeFile(outside, original); await fs.symlink(outside, storage);
    await expect(prepareCodexInput(ctx, workspaceId, threadId(), { prompt: 'Read', fileAttachments: [reference(document)] })).rejects.toBeDefined();
    expect(await fs.readFile(outside)).toEqual(original);
    await fs.unlink(storage); await fs.writeFile(storage, original, { mode: 0o400 });
    const outsideDirectory = path.join(directory, 'unowned'); await fs.mkdir(outsideDirectory);
    await fs.symlink(outsideDirectory, path.join(ctx.config.stateDir, 'codex-cli-inputs-v1'));
    await expect(prepareCodexInput(ctx, workspaceId, threadId(), { prompt: 'Read', fileAttachments: [reference(document)] })).rejects.toMatchObject({ code: 'CODEX_INPUT_STORAGE' });
    expect(await fs.readdir(outsideDirectory)).toEqual([]);
  });

  it('keeps malformed or changed durable binding state visible as a failure', async () => {
    const document = await file(), thread = threadId();
    const prepared = await prepareCodexInput(ctx, workspaceId, thread, { prompt: 'Read', fileAttachments: [reference(document)] });
    const stored = await binding(prepared); stored.value.assets[0].metadata.workspaceId = 'another-workspace';
    await fs.chmod(stored.filename, 0o600); await fs.writeFile(stored.filename, JSON.stringify(stored.value));
    await expect(loadCodexAttachmentResolver(ctx, workspaceId, thread, descriptors(prepared.input, prepared.clientUserMessageId))).rejects.toMatchObject({ code: 'CODEX_INPUT_CHANGED' });
    expect((await fs.readFile(fileReferences(prepared.input)[0].path)).includes(Buffer.from('real selected bytes'))).toBe(true);
  });

  it('holds a durable copy on a cancelled preparation and never pins an original after the stop', async () => {
    const photo = await image(), controller = new AbortController();
    const service = getImageAttachments(ctx), preview = service.preview.bind(service);
    vi.spyOn(service, 'preview').mockImplementation(async (...args) => { const value = await preview(...args); controller.abort(); return value; });
    await expect(prepareCodexInput(ctx, workspaceId, threadId(), { prompt: 'Cancel before dispatch.', attachments: [reference(photo)] }, { signal: controller.signal }))
      .rejects.toMatchObject({ code: 'CODEX_INPUT_CANCELLED' });
    await expect(service.discard(workspaceId, photo.id)).resolves.toEqual({ deleted: true });
  });

  it('never spends preparation slots when workspace removal already owns admission', async () => {
    const photo = await image();
    await withWorkspaceRemoval(ctx.config.workspacesDir, workspaceId, async () => {
      for (let index = 0; index < CODEX_INPUT_LIMITS.preparations + 1; index++) {
        await expect(prepareCodexInput(ctx, workspaceId, threadId(), { prompt: 'Pending removal.', attachments: [reference(photo)] }))
          .rejects.toMatchObject({ code: 'WORKTREE_BUSY' });
      }
    });
    const prepared = await prepareCodexInput(ctx, workspaceId, threadId(), { prompt: 'Available again.', attachments: [reference(photo)] });
    expect(prepared.input.some(input => input.type === 'localImage')).toBe(true);
  });

  it('keeps cancelled or oversized selections out of native input and leaves their originals as drafts', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(prepareCodexInput(ctx, workspaceId, threadId(), { prompt: 'Stopped.' }, { signal: controller.signal })).rejects.toMatchObject({ code: 'CODEX_INPUT_CANCELLED' });
    const bytes = Buffer.alloc(FILE_ATTACHMENT_LIMITS.maxBytes, 120), first = await file('first.bin', bytes), second = await file('second.bin', bytes), third = await file('third.bin', Buffer.from('x'));
    await expect(prepareCodexInput(ctx, workspaceId, threadId(), { prompt: 'Too much.', fileAttachments: [first, second, third].map(reference) })).rejects.toMatchObject({ code: 'FILE_ATTACHMENT_MESSAGE_TOO_LARGE' });
    for (const attachment of [first, second, third]) await expect(getConversationFiles(ctx).discard(workspaceId, reference(attachment))).resolves.toEqual({ deleted: true });
    expect(IMAGE_ATTACHMENT_LIMITS.maxMessageBytes).toBe(16 * 1024 * 1024);
    await expect(loadCodexAttachmentResolver(ctx, workspaceId, threadId(), Array.from({ length: CODEX_INPUT_LIMITS.projectionInputs + 1 }, () => ({ input: { type: 'text', text: '' } }))))
      .rejects.toMatchObject({ code: 'CODEX_INPUT_VIEW_LIMIT' });
  });

  it('purges only the exact permanently deleted workspace after native cleanup, retaining originals for their own owners', async () => {
    const selected = await file(), prepared = await prepareCodexInput(ctx, workspaceId, threadId(), { prompt: 'Accepted.', fileAttachments: [reference(selected)] });
    await prepared.acknowledge();
    const other = await ctx.workspaces.create({ name: 'Keep unrelated native inputs' }), otherFile = await file('other.txt', Buffer.from('keep'), other.id);
    const otherPrepared = await prepareCodexInput(ctx, other.id, threadId(), { prompt: 'Unrelated.', fileAttachments: [reference(otherFile)] });
    await otherPrepared.acknowledge();
    const request: WorkspaceArtifactCleanupRequest = { workspaceId, deletionId: randomUUID(), mode: 'permanent', deletedAt: new Date().toISOString(), assertCurrent: vi.fn(async () => undefined) };
    const lookup = vi.spyOn(ctx.workspaces, 'get'); lookup.mockClear();
    await withWorkspaceRemoval(ctx.config.workspacesDir, workspaceId, () => cleanupCodexInputs(ctx, request));
    expect(lookup).not.toHaveBeenCalled(); lookup.mockRestore();
    await expect(fs.stat(fileReferences(prepared.input)[0].path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(fileReferences(otherPrepared.input)[0].path, 'utf8')).toBe('keep');
    expect((await getConversationFiles(ctx).storage.read(workspaceId, reference(selected))).attachment).toEqual(selected);
    await cleanupCodexInputs(ctx, request);
    await expect(prepareCodexInput(ctx, workspaceId, threadId(), { prompt: 'Cannot resurrect.' })).rejects.toMatchObject({ code: 'CODEX_INPUT_WORKSPACE_DELETED' });
    const restarted = await context();
    await expect(prepareCodexInput(restarted, workspaceId, threadId(), { prompt: 'Still fenced after restart.' })).rejects.toMatchObject({ code: 'CODEX_INPUT_WORKSPACE_DELETED' });
    expect(request.assertCurrent).toHaveBeenCalled();
  });

  it('retains every bundle if permanent cleanup finds an uncertain native submission', async () => {
    const selected = await file(), accepted = await prepareCodexInput(ctx, workspaceId, threadId(), { prompt: 'Accepted.', fileAttachments: [reference(selected)] });
    await accepted.acknowledge();
    const uncertain = await prepareCodexInput(ctx, workspaceId, threadId(), { prompt: 'Unknown.', fileAttachments: [reference(selected)] });
    await uncertain.hold();
    await expect(cleanupCodexInputs(ctx, { workspaceId, deletionId: randomUUID(), mode: 'permanent', deletedAt: new Date().toISOString(), assertCurrent: async () => undefined }))
      .rejects.toMatchObject({ code: 'CODEX_INPUT_CLEANUP_HELD' });
    for (const prepared of [accepted, uncertain]) expect(hash(await fs.readFile(fileReferences(prepared.input)[0].path))).toBe(selected.sha256);
  });

  it('preserves unrecognized native-input files and respects a stale permanent deletion generation', async () => {
    const selected = await file(), prepared = await prepareCodexInput(ctx, workspaceId, threadId(), { prompt: 'Accepted.', fileAttachments: [reference(selected)] });
    await prepared.acknowledge();
    const folder = path.dirname(fileReferences(prepared.input)[0].path), manual = path.join(folder, 'unrecognized.txt');
    await fs.writeFile(manual, 'Preserve manual data.');
    const request: WorkspaceArtifactCleanupRequest = { workspaceId, deletionId: randomUUID(), mode: 'trash', deletedAt: new Date().toISOString(), assertCurrent: async () => undefined };
    // mode describes the original policy; this call models its eventual
    // permanent purge after retention, never an ordinary move into trash.
    await expect(cleanupCodexInputs(ctx, request)).rejects.toMatchObject({ code: 'CODEX_INPUT_CLEANUP_CHANGED' });
    expect(await fs.readFile(manual, 'utf8')).toBe('Preserve manual data.');
    expect(hash(await fs.readFile(fileReferences(prepared.input)[0].path))).toBe(selected.sha256);
    await expect(cleanupCodexInputs(ctx, { ...request, assertCurrent: async () => { throw new Error('Deletion generation changed.'); } })).rejects.toThrow('Deletion generation changed.');
  });
});
