import { afterEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { absentCheckpointFile, affectedDirtyPaths, encodeRewindIndex, mergeRewindIndex, planFileRestore,
  sameCheckpointFile, sameCheckpointIndexEntries, type RewindTurnPair } from '../server/agent/file-rewind-plan';
import { FILE_REWIND_LIMITS } from '../server/agent/file-rewind-types';
import { sameCheckpointRepository, sameLiveCheckpointRepository } from '../server/git-checkpoints/identity-contract';
import type { GitCheckpointCurrent, GitCheckpointFile, GitCheckpointIndex, GitCheckpointIndexEntry,
  GitCheckpointManifest, GitCheckpointRepository } from '../server/git-checkpoints/types';

const execute = promisify(execFile);
const temporary: string[] = [];
const repository = (): GitCheckpointRepository => ({
  root: '/fixture/workspace', gitDirectory: '/fixture/workspace/.git', commonDirectory: '/fixture/workspace/.git',
  rootIdentity: { dev: 1, ino: 100 }, gitIdentity: { dev: 1, ino: 101 }, commonIdentity: { dev: 1, ino: 101 },
  objectFormat: 'sha1', head: '1'.repeat(40), headRef: 'refs/heads/main',
  generation: { version: 1, repository: 'repository_' + 'a'.repeat(32), checkout: 'checkout_' + 'b'.repeat(32),
    workspaceId: 'workspace-a', workspaceCreatedAt: '2026-09-20T00:00:00.000Z',
    repositoryWorkspaceId: 'workspace-a', repositoryWorkspaceCreatedAt: '2026-09-20T00:00:00.000Z', worktreeId: null },
  observedIn: 'boot_' + 'c'.repeat(32),
});
const hash = (text: string, algorithm = 'sha256') => createHash(algorithm).update(text).digest('hex');
function file(relative: string, text: string, options: Partial<GitCheckpointFile> = {}): GitCheckpointFile {
  return { path: relative, kind: 'file', mode: 0o644, bytes: Buffer.byteLength(text), sha256: hash(text),
    blob: hash(text, 'sha1'), tracked: true, ...options };
}
function entry(relative: string, text: string, options: Partial<GitCheckpointIndexEntry> = {}): GitCheckpointIndexEntry {
  return { path: relative, mode: '100644', objectId: hash(text, 'sha1'), stage: 0, assumeValid: false,
    skipWorktree: false, intentToAdd: false, blob: hash(text, 'sha1'), ...options };
}
function index(entries: GitCheckpointIndexEntry[] = [], extensions: string[] = []): GitCheckpointIndex {
  return { present: true, sha256: hash(JSON.stringify(entries)), bytes: 0, blob: null, format: 2, extensions, entries };
}
function manifest(files: GitCheckpointFile[], entries: GitCheckpointIndexEntry[] = [],
  overrides: Partial<GitCheckpointManifest> = {}): GitCheckpointManifest {
  return { version: 1, id: randomUUID(), workspaceId: 'workspace-a', threadId: 'thr_' + 'a'.repeat(32),
    turnId: 'turn-a', phase: 'before', createdAt: '2026-09-20T00:00:00.000Z', manifestHash: 'a'.repeat(64),
    repository: repository(), files, index: index(entries), commit: '2'.repeat(40), tree: '3'.repeat(40),
    contentBytes: files.reduce((sum, item) => sum + item.bytes, 0), storedBytes: 0, limitations: [], ...overrides };
}
function pair(before: GitCheckpointManifest, after: GitCheckpointManifest, manualPaths: string[] = []): RewindTurnPair {
  return { before, after: { ...after, phase: 'after' }, manualPaths };
}
function current(value: GitCheckpointManifest, overrides: Partial<GitCheckpointCurrent> = {}): GitCheckpointCurrent {
  return { repository: value.repository, files: value.files, index: value.index, token: 'f'.repeat(64), ...overrides };
}

afterEach(async () => { for (const directory of temporary.splice(0)) await fs.rm(directory, { recursive: true, force: true }); });

describe('selective rewind planning', () => {
  it('uses stable logical history after a new boot while refusing reuse of an old live observation', () => {
    const before = manifest([file('source', 'original')]), after = manifest([file('source', 'agent')]);
    const nextBoot = structuredClone(after.repository);
    nextBoot.observedIn = 'boot_' + 'd'.repeat(32);
    nextBoot.rootIdentity = { dev: 2, ino: 200 }; nextBoot.gitIdentity = { dev: 2, ino: 201 }; nextBoot.commonIdentity = { dev: 2, ino: 201 };
    expect(sameCheckpointRepository(after.repository, nextBoot)).toBe(true);
    expect(sameLiveCheckpointRepository(after.repository, nextBoot)).toBe(false);
    const plan = planFileRestore([pair(before, after)], current(after, { repository: nextBoot }));
    expect(plan.rows).toEqual([{ path: 'source', action: 'update', staged: false }]);
    expect(plan.files[0].restore.sha256).toBe(before.files[0].sha256);
  });

  it('does not attach old history to a different signed repository generation after a new boot', () => {
    const before = manifest([file('source', 'original')]), after = manifest([file('source', 'agent')]);
    const replacement = structuredClone(after.repository);
    replacement.observedIn = 'boot_' + 'd'.repeat(32);
    replacement.generation.repository = 'repository_' + 'e'.repeat(32);
    expect(() => planFileRestore([pair(before, after)], current(after, { repository: replacement })))
      .toThrowError(expect.objectContaining({ code: 'FILE_REWIND_REPOSITORY_CHANGED' }));
  });

  it('preserves unrelated manual files, untracked files, and newer staging instead of planning a tree reset', () => {
    const oldSource = file('src/app.ts', 'old'), newSource = file('src/app.ts', 'agent');
    const oldStage = entry('src/app.ts', 'staged old'), newStage = entry('src/app.ts', 'staged agent');
    const before = manifest([oldSource, file('notes.txt', 'old note')], [oldStage, entry('user.ts', 'old stage')]);
    const after = manifest([newSource, file('notes.txt', 'old note')], [newStage, entry('user.ts', 'old stage')]);
    const userStage = entry('user.ts', 'new manual stage', { assumeValid: true });
    const extraStage = entry('new manual.ts', 'new manual file', { intentToAdd: true });
    const actual = current(after, { files: [newSource, file('notes.txt', 'new manual note'), file('untracked.txt', 'keep', { tracked: false })],
      index: index([newStage, userStage, extraStage]) });
    const original = structuredClone({ before, after, actual });

    const planned = planFileRestore([pair(before, after)], actual);

    expect(planned.rows).toEqual([{ path: 'src/app.ts', action: 'update', staged: true }]);
    expect(planned.files).toMatchObject([{ path: 'src/app.ts', expected: newSource, restore: oldSource }]);
    expect(mergeRewindIndex(actual.index.entries, planned.index)).toEqual([userStage, extraStage, oldStage]);
    expect({ before, after, actual }).toEqual(original);
  });

  it('walks consecutive agent deltas back to the first checkpoint, including creates and removals', () => {
    const old = file('source', 'A'), middle = file('source', 'B'), latest = file('source', 'C');
    const firstBefore = manifest([old, file('removed.txt', 'recover')]);
    const firstAfter = manifest([middle, file('created.txt', 'agent-created')]);
    const secondBefore = manifest(firstAfter.files), secondAfter = manifest([latest, file('created.txt', 'agent-created')]);
    const planned = planFileRestore([pair(firstBefore, firstAfter), pair(secondBefore, secondAfter)], current(secondAfter));

    expect(planned.rows).toEqual([
      { path: 'created.txt', action: 'delete', staged: false },
      { path: 'removed.txt', action: 'create', staged: false },
      { path: 'source', action: 'update', staged: false },
    ]);
    expect(planned.files.find(item => item.path === 'source')).toMatchObject({ expected: latest, restore: old,
      checkpoint: { id: firstBefore.id, phase: 'before' } });
    expect(planned.files.find(item => item.path === 'created.txt')?.restore).toEqual(absentCheckpointFile('created.txt'));
  });

  it('reports a manual gap between agent turns without treating it as agent-authored history', () => {
    const first = pair(manifest([file('source', 'A')]), manifest([file('source', 'B')]));
    const second = pair(manifest([file('source', 'manual between turns')]), manifest([file('source', 'C')]));
    const planned = planFileRestore([first, second], current(second.after));
    expect(planned.rows).toEqual([{ path: 'source', action: 'update', staged: false, conflict: expect.stringContaining('between agent turns') }]);
  });

  it('reports a newer working-file edit after the final checkpoint and retains its exact expected bytes', () => {
    const before = manifest([file('source', 'A')]), after = manifest([file('source', 'B')]);
    const manual = file('source', 'save this newer text');
    const planned = planFileRestore([pair(before, after)], current(after, { files: [manual] }));
    expect(planned.rows[0].conflict).toContain('after the agent turn');
    expect(planned.files[0].expected).toEqual(manual);
  });

  it.each(['*', 'src', 'src/app.ts', 'src/app.ts/child'])('refuses overlapping manual activity recorded as %s', manual => {
    const before = manifest([file('src/app.ts', 'A')]), after = manifest([file('src/app.ts', 'B')]);
    expect(planFileRestore([pair(before, after, [manual])], current(after)).rows[0].conflict).toContain('Manual');
  });

  it('does not confuse a neighbouring directory name with overlapping manual activity', () => {
    const before = manifest([file('src/app.ts', 'A')]), after = manifest([file('src/app.ts', 'B')]);
    expect(planFileRestore([pair(before, after, ['src-other'])], current(after)).rows[0].conflict).toBeUndefined();
  });

  it('drops net-zero changes and leaves newer manual content on those paths untouched', () => {
    const original = file('source', 'A'), changed = file('source', 'B'), oldIndex = entry('source', 'A'), agentIndex = entry('source', 'B');
    const first = pair(manifest([original], [oldIndex]), manifest([changed], [agentIndex]));
    const second = pair(manifest([changed], [agentIndex]), manifest([original], [oldIndex]));
    const actual = current(second.after, { files: [file('source', 'newer manual')], index: index([entry('source', 'newer manual stage')]) });
    const planned = planFileRestore([first, second], actual);
    expect(planned).toMatchObject({ rows: [], files: [], index: [], indexConflict: false });
    expect(mergeRewindIndex(actual.index.entries, planned.index)).toEqual(actual.index.entries);
  });

  it('treats permission-only and symlink-kind changes as real changes', () => {
    const before = manifest([file('run', 'same bytes', { mode: 0o600 }), file('link', '../target', { kind: 'symlink', mode: 0o777 })]);
    const after = manifest([file('run', 'same bytes', { mode: 0o755 }), file('link', '../target')]);
    const planned = planFileRestore([pair(before, after)], current(after));
    expect(planned.files).toHaveLength(2);
    expect(planned.files.find(item => item.path === 'run')?.restore.mode).toBe(0o600);
    expect(planned.files.find(item => item.path === 'link')?.restore.kind).toBe('symlink');
  });

  it('does not attribute inode churn or the checkpoint object location to a content change', () => {
    const original = file('source', 'same', { identity: { dev: 1, ino: 2, size: 4, mode: 0o644, mtimeMs: 1, ctimeMs: 1 } });
    const recaptured = { ...original, tracked: false, blob: 'b'.repeat(40), identity: { ...original.identity!, ino: 9, ctimeMs: 20 } };
    const staged = entry('source', 'same'), relocated = { ...staged, blob: 'c'.repeat(40) };
    expect(sameCheckpointFile(original, recaptured)).toBe(true);
    expect(sameCheckpointIndexEntries([staged], [relocated])).toBe(true);
    const before = manifest([original], [staged]), after = manifest([recaptured], [relocated]);
    expect(planFileRestore([pair(before, after)], current(after)).rows).toEqual([]);
  });

  it.each([
    ['root', (repo: GitCheckpointRepository) => { repo.root += '-replacement'; }],
    ['Git directory', (repo: GitCheckpointRepository) => { repo.gitDirectory += '-replacement'; }],
    ['common directory', (repo: GitCheckpointRepository) => { repo.commonDirectory += '-replacement'; }],
    ['root inode', (repo: GitCheckpointRepository) => { repo.rootIdentity.ino++; }],
    ['Git device', (repo: GitCheckpointRepository) => { repo.gitIdentity.dev++; }],
    ['common inode', (repo: GitCheckpointRepository) => { repo.commonIdentity.ino++; }],
    ['object format', (repo: GitCheckpointRepository) => { repo.objectFormat = 'sha256'; }],
    ['HEAD', (repo: GitCheckpointRepository) => { repo.head = '4'.repeat(40); }],
    ['symbolic HEAD', (repo: GitCheckpointRepository) => { repo.headRef = 'refs/heads/other'; }],
  ] as const)('refuses a changed repository %s before making a plan', (_label, mutate) => {
    const before = manifest([file('source', 'A')]), after = manifest([file('source', 'B')]);
    const actual = current(after, { repository: structuredClone(after.repository) }); mutate(actual.repository);
    expect(() => planFileRestore([pair(before, after)], actual)).toThrowError(expect.objectContaining({ code: 'FILE_REWIND_REPOSITORY_CHANGED' }));
  });

  it('also checks HEAD changes inside captured history, even when current HEAD matches the first turn', () => {
    const before = manifest([file('source', 'A')]), after = manifest([file('source', 'B')]);
    after.repository.head = '9'.repeat(40);
    expect(() => planFileRestore([pair(before, after)], current(before))).toThrowError(expect.objectContaining({ code: 'FILE_REWIND_REPOSITORY_CHANGED' }));
  });

  it('marks discontinuous staging or newer index flags as conflicts without selecting unrelated staging', () => {
    const first = pair(manifest([], [entry('source', 'A')]), manifest([], [entry('source', 'B')]));
    const second = pair(manifest([], [entry('source', 'manual gap')]), manifest([], [entry('source', 'C')]));
    expect(planFileRestore([first, second], current(second.after))).toMatchObject({ indexConflict: true,
      rows: [{ path: 'source', staged: true, conflict: expect.stringContaining('between agent turns') }] });
    const changedFlags = entry('source', 'B', { assumeValid: true });
    const actual = current(first.after, { index: index([changedFlags, entry('other', 'preserve')]) });
    const flagged = planFileRestore([first], actual);
    expect(flagged.indexConflict).toBe(true);
    expect(flagged.rows[0].conflict).toContain('after the agent turn');
    expect(flagged.index).toMatchObject([{ path: 'source', expected: [changedFlags] }]);
  });

  it.each(['REUC', 'TEST'])('preserves semantic or unknown %s index extensions by refusing selective staging restore', extension => {
    const before = manifest([], [entry('source', 'A')]), after = manifest([], [entry('source', 'B')]);
    const planned = planFileRestore([pair(before, after)], current(after, { index: index(after.index.entries, [extension]) }));
    expect(planned.indexConflict).toBe(true);
    expect(planned.rows[0].conflict).toContain('additional staging metadata');
    const fileBefore = manifest([file('source', 'A')], before.index.entries);
    const fileAfter = manifest([file('source', 'B')], before.index.entries);
    expect(planFileRestore([pair(fileBefore, fileAfter)], current(fileAfter, { index: index(before.index.entries, [extension]) })).indexConflict).toBe(false);
  });

  it('can discard only regenerable Git index caches while retaining all semantic entries', () => {
    const before = manifest([], [entry('source', 'A')]), after = manifest([], [entry('source', 'B')]);
    const planned = planFileRestore([pair(before, after)], current(after, { index: index(after.index.entries, ['TREE', 'UNTR', 'FSMN', 'EOIE', 'IEOT']) }));
    expect(planned.indexConflict).toBe(false);
    expect(planned.rows[0].conflict).toBeUndefined();
  });

  it('rejects unsupported captured paths and prevents restoring a parent file over another requested path', () => {
    const bad = pair(manifest([file('../outside', 'A')]), manifest([file('../outside', 'B')]));
    expect(() => planFileRestore([bad], current(bad.after))).toThrowError(expect.objectContaining({ code: 'FILE_REWIND_UNAVAILABLE' }));
    const before = manifest([file('parent', 'restore parent'), file('parent/child', 'restore child')]), after = manifest([]);
    expect(planFileRestore([pair(before, after)], current(after)).rows.find(row => row.path === 'parent/child')?.conflict).toContain('parent path');
  });

  it('intersects dirty buffers by path boundaries and rejects traversal or unbounded editor submissions', () => {
    expect(affectedDirtyPaths(['src/a.ts', 'src/a.ts', 'src/nested', 'src-other/a.ts', 'manual.txt'], ['src', 'removed/file'])).toEqual(['src/a.ts', 'src/nested']);
    expect(affectedDirtyPaths(['removed'], ['removed/file'])).toEqual(['removed']);
    for (const dirty of [['../outside'], ['.git/config'], Array.from({ length: 101 }, (_, i) => `file-${i}`)]) {
      expect(() => affectedDirtyPaths(dirty, [])).toThrowError(expect.objectContaining({ code: 'FILE_REWIND_DIRTY_PATHS' }));
    }
  });

  it('bounds checkpoint history and changed paths before producing a restore request', () => {
    const one = pair(manifest([]), manifest([file('created', 'x')]));
    expect(() => planFileRestore([], current(one.after))).toThrowError(expect.objectContaining({ code: 'FILE_REWIND_UNAVAILABLE' }));
    expect(() => planFileRestore(Array.from({ length: FILE_REWIND_LIMITS.turns + 1 }, () => one), current(one.after))).toThrowError(expect.objectContaining({ code: 'FILE_REWIND_UNAVAILABLE' }));
    const many = manifest(Array.from({ length: FILE_REWIND_LIMITS.files + 1 }, (_, i) => file(`created-${i}`, 'x')));
    expect(() => planFileRestore([pair(manifest([]), many)], current(many))).toThrowError(expect.objectContaining({ code: 'FILE_REWIND_LIMIT' }));
  });
});

describe('selective index encoding read by native Git', () => {
  it.each(['sha1', 'sha256'] as const)('preserves Unicode paths, merge stages, modes and intent flags in a %s repository', async objectFormat => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-rewind-index-')); temporary.push(directory);
    const root = path.join(directory, 'repository'); await fs.mkdir(root);
    const git = async (...args: string[]): Promise<Buffer> => (await execute('git', [
      '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false', ...args,
    ], { cwd: root, timeout: 15_000, maxBuffer: 2 * 1024 * 1024, encoding: 'buffer', env: {
      PATH: process.env.PATH, HOME: directory, TMPDIR: directory, GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', LC_ALL: 'C',
    } })).stdout;
    await git('init', '--quiet', '--initial-branch=main', `--object-format=${objectFormat}`);
    const object = async (text: string): Promise<string> => {
      const source = path.join(directory, `blob-${randomUUID()}`); await fs.writeFile(source, text);
      return (await git('hash-object', '--no-filters', '-w', '--', source)).toString('utf8').trim();
    };
    const a = await object('original bytes\n'), b = await object('agent bytes\n'), empty = await object('');
    const indexEntry = (relative: string, oid: string, flags: Partial<GitCheckpointIndexEntry> = {}) => entry(relative, '', { objectId: oid, blob: null, ...flags });
    const items = [
      indexEntry('文書/intent ü.txt', empty, { intentToAdd: true }),
      indexEntry('already staged α.ts', a, { assumeValid: true }),
      indexEntry('sparse/δ.md', a, { skipWorktree: true }),
      indexEntry('bin/run.sh', b, { mode: '100755' }),
      indexEntry('current-link', a, { mode: '120000' }),
      indexEntry('merge café.ts', b, { stage: 3 }),
      indexEntry('merge café.ts', a, { stage: 1 }),
      indexEntry('merge café.ts', b, { stage: 2 }),
    ];
    await fs.mkdir(path.join(root, '文書')); await fs.writeFile(path.join(root, '文書/intent ü.txt'), 'unstaged intent contents');
    await fs.writeFile(path.join(root, 'manual sentinel'), 'unrelated bytes');
    const originalHead = await fs.readFile(path.join(root, '.git/HEAD'));
    await fs.writeFile(path.join(root, '.git/index'), encodeRewindIndex(items, objectFormat));

    const actual = (await git('ls-files', '--stage', '-z')).toString('utf8').split('\0').filter(Boolean);
    const expected = [...items].sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)) || left.stage - right.stage)
      .map(item => `${item.mode} ${item.objectId} ${item.stage}\t${item.path}`);
    expect(actual).toEqual(expected);
    const flags = (await git('ls-files', '-v', '-z')).toString('utf8').split('\0');
    expect(flags).toContain('h already staged α.ts');
    expect(flags).toContain('S sparse/δ.md');
    const staged = (await git('diff', '--cached', '--ita-invisible-in-index', '--name-only', '-z')).toString('utf8').split('\0');
    const withIntent = (await git('diff', '--cached', '--ita-visible-in-index', '--name-only', '-z')).toString('utf8').split('\0');
    expect(staged).not.toContain('文書/intent ü.txt');
    expect(withIntent).toContain('文書/intent ü.txt');
    expect(await fs.readFile(path.join(root, '.git/HEAD'))).toEqual(originalHead);
    expect(await fs.readFile(path.join(root, 'manual sentinel'), 'utf8')).toBe('unrelated bytes');
    expect(await fs.readFile(path.join(root, '文書/intent ü.txt'), 'utf8')).toBe('unstaged intent contents');
  }, 45_000);

  it('uses version 2 for plain entries and refuses duplicate stages or unsafe object/path combinations', () => {
    const plain = entry('source', 'x'), encoded = encodeRewindIndex([plain], 'sha1');
    expect(encoded.readUInt32BE(4)).toBe(2);
    expect(() => encodeRewindIndex([plain, { ...plain }], 'sha1')).toThrowError(expect.objectContaining({ code: 'FILE_REWIND_INDEX_INVALID' }));
    for (const invalid of [{ ...plain, path: '.git/config' }, { ...plain, objectId: 'f'.repeat(64) }, { ...plain, path: 'bad\nname' }]) {
      expect(() => encodeRewindIndex([invalid], 'sha1')).toThrowError(expect.objectContaining({ code: 'FILE_REWIND_INDEX_INVALID' }));
    }
  });
});
