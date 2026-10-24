import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import type { AppContext } from '../server/context';
import { JsonStore } from '../server/store';
import { HttpError } from '../server/errors';
import { withWorkspaceRemoval } from '../server/worktrees/activity';
import { ConversationCleanupFiles } from '../server/agent/workspace-conversation-cleanup-files';
import { markLegacyThreadDeleted } from '../server/legacy/thread-tombstone';
import { isLegacyMemoryArtifactPath, legacyMemoryScopeSchema, legacyMemoryHumanOriginSchema,
  LEGACY_MEMORY_MAX_ARTIFACTS } from '../server/legacy/memory-cleanup-metadata';
import { LEGACY_AGENT_IMAGE_SAVE_BYTES } from '../server/legacy/change-limits';

const threadId = 'thr_' + '1'.repeat(32);
const stamped = '2026-09-20T12:00:00.000Z';

describe('cleanup-only legacy metadata leaves', () => {
  let directory: string, ctx: AppContext, active: boolean;
  beforeEach(async () => {
    directory = await fs.mkdtemp('/tmp/codex-legacy-cleanup-');
    const stateDir = path.join(directory, 'state'); await fs.mkdir(stateDir);
    ctx = { config: { dataDir: directory, stateDir, workspacesDir: path.join(directory, 'workspaces') },
      store: new JsonStore(stateDir) } as AppContext;
    active = true;
  });
  afterEach(async () => { vi.restoreAllMocks(); await ctx.store.flush(); await fs.rm(directory, { recursive: true, force: true }); });
  async function withFiles<T>(work: (files: ConversationCleanupFiles) => Promise<T>): Promise<T> {
    return withWorkspaceRemoval(ctx.config.workspacesDir, 'owned-workspace', async () => {
      const files = await ConversationCleanupFiles.open(ctx, {
        workspaceId: 'owned-workspace', deletionId: randomUUID(), deletedAt: stamped, mode: 'permanent',
        assertCurrent: async () => { if (!active) throw new HttpError(409, 'Fixture generation retired.', 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED'); },
      });
      try { return await work(files); } finally { await files.close(); }
    });
  }
  it('publishes and verifies a permanent marker without rewriting summary, aggregate or canonical history', async () => {
    await ctx.store.write('thread-' + threadId, { thread: { id: threadId }, input: ['PRIVATE_OLD_HISTORY'] });
    await ctx.store.write('thread-summary-' + threadId, { title: 'Preserved until owned cleanup removes it' });
    await ctx.store.write('thread-index', [{ id: threadId, workspaceId: 'owned-workspace' }]);
    const before = new Map(await Promise.all((await fs.readdir(ctx.config.stateDir)).map(async name => [name, await fs.readFile(path.join(ctx.config.stateDir, name))] as const)));
    await withFiles(files => markLegacyThreadDeleted(files, threadId));
    const marker = await ctx.store.read<{ version: number; id: string; deletedAt: string }>('thread-deleted-' + threadId, null!);
    expect(marker).toMatchObject({ version: 1, id: threadId }); expect(Number.isFinite(Date.parse(marker.deletedAt))).toBe(true);
    for (const [name, bytes] of before) expect(await fs.readFile(path.join(ctx.config.stateDir, name))).toEqual(bytes);
  });
  it('keeps an existing valid tombstone byte-identical and refuses unknown/corrupt ownership', async () => {
    const key = 'thread-deleted-' + threadId, file = path.join(ctx.config.stateDir, key + '.json');
    await ctx.store.write(key, { version: 1, id: threadId, deletedAt: stamped });
    const before = await fs.readFile(file), identity = await fs.stat(file, { bigint: true });
    await withFiles(files => markLegacyThreadDeleted(files, threadId));
    expect(await fs.readFile(file)).toEqual(before); expect((await fs.stat(file, { bigint: true })).ino).toBe(identity.ino);
    await ctx.store.write(key, { version: 1, id: 'thr_' + '2'.repeat(32), deletedAt: stamped });
    const foreign = await fs.readFile(file);
    await expect(withFiles(files => markLegacyThreadDeleted(files, threadId))).rejects.toMatchObject({ code: 'WORKSPACE_CONVERSATION_CLEANUP_OWNERSHIP' });
    expect(await fs.readFile(file)).toEqual(foreign);
  });
  it('uses the actual store key queue and refuses a generation retired while waiting', async () => {
    let release!: () => void, reached!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { reached = resolve; });
    const blocker = ctx.store.mutateGuarded('thread-deleted-' + threadId, async () => { reached(); await held; });
    await entered;
    const pending = withFiles(files => markLegacyThreadDeleted(files, threadId));
    const result = pending.then(() => ({ completed: true }), error => ({ error }));
    active = false; release(); await blocker;
    expect(await result).toMatchObject({ error: { code: 'WORKSPACE_ARTIFACT_CLEANUP_CHANGED' } });
    expect(await ctx.store.read('thread-deleted-' + threadId, null)).toBeNull();
  });
  it('does not follow a marker symlink or allow malformed thread keys', async () => {
    const outside = path.join(directory, 'outside.json'); await fs.writeFile(outside, 'OUTSIDE_SENTINEL');
    await fs.symlink(outside, path.join(ctx.config.stateDir, 'thread-deleted-' + threadId + '.json'));
    await expect(withFiles(files => markLegacyThreadDeleted(files, threadId))).rejects.toMatchObject({ code: 'WORKSPACE_CONVERSATION_CLEANUP_UNSAFE' });
    await expect(withFiles(files => markLegacyThreadDeleted(files, '../protected-credentials'))).rejects.toMatchObject({ code: 'WORKSPACE_CONVERSATION_CLEANUP_OWNERSHIP' });
    expect(await fs.readFile(outside, 'utf8')).toBe('OUTSIDE_SENTINEL');
  });
  it('retains exact legacy scope/author shapes, path grammar and delivery bounds without runtime definitions', () => {
    expect(LEGACY_MEMORY_MAX_ARTIFACTS).toBe(86); expect(LEGACY_AGENT_IMAGE_SAVE_BYTES).toBe(2 * 1024 * 1024);
    expect(legacyMemoryScopeSchema.parse({ kind: 'workspace', workspaceId: 'owned-workspace' })).toEqual({ kind: 'workspace', workspaceId: 'owned-workspace' });
    expect(legacyMemoryScopeSchema.parse({ kind: 'owner' })).toEqual({ kind: 'owner' });
    expect(legacyMemoryScopeSchema.safeParse({ kind: 'owner', workspaceId: 'foreign' }).success).toBe(false);
    expect(legacyMemoryHumanOriginSchema.safeParse({ kind: 'conversation', workspaceId: 'owned-workspace', threadId,
      messageId: 'msg_' + '1'.repeat(32), turnId: 'turn_1', messageFingerprint: 'a'.repeat(64),
      operationId: 'operation_1', authorizedAt: stamped }).success).toBe(true);
    expect(legacyMemoryHumanOriginSchema.safeParse({ kind: 'interface', operationId: 'operation_1', authorizedAt: stamped, source: 'forged' }).success).toBe(false);
    for (const name of ['MEMORY.md', 'memory_summary.md', 'rollout_summaries/' + threadId + '.md',
      'skills/example/SKILL.md', 'skills/example/scripts/tools/check.mjs']) expect(isLegacyMemoryArtifactPath(name), name).toBe(true);
    for (const name of ['../MEMORY.md', 'MEMORYxmd', 'skills/example/../private', 'skills/example/scripts/../../../file',
      'skills/example/scripts/a/b/c/d', '/MEMORY.md']) expect(isLegacyMemoryArtifactPath(name), name).toBe(false);
  });
});

it('keeps site cleanup/delivery runtime imports outside retired execution, transport, extraction, indexing and plugin services', async () => {
  const forbidden = new Set(['server/agent/engine.ts', 'server/agent/transport.ts', 'server/agent/thread-index.ts',
    'server/agent/changes.ts', 'server/memories/extraction.ts', 'server/memories/artifact-content.ts', 'server/extensions/service.ts']);
  const roots = ['server/agent/workspace-conversation-cleanup.ts', 'server/memories/workspace-cleanup.ts',
    'server/generated-images/delivery.ts', 'server/project-extensions-cleanup.ts'];
  const seen = new Set<string>(), queue = [...roots];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    expect(forbidden.has(file), file).toBe(false); seen.add(file);
    const text = await fs.readFile(file, 'utf8'), source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const imports: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause, bindings = clause?.namedBindings;
        const onlyTypes = clause?.isTypeOnly || bindings && ts.isNamedImports(bindings) && !clause?.name
          && bindings.elements.length > 0 && bindings.elements.every(element => element.isTypeOnly);
        if (!onlyTypes) imports.push(node.moduleSpecifier.text);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
        imports.push(node.moduleSpecifier.text);
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        imports.push(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    for (const name of imports.filter(name => name.startsWith('.'))) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), name));
      for (const candidate of [base, base + '.ts', base + '.tsx', base + '/index.ts']) {
        if (await fs.stat(candidate).then(info => info.isFile(), () => false)) { queue.push(candidate); break; }
      }
    }
  }
  expect(roots.every(root => seen.has(root))).toBe(true);
});
