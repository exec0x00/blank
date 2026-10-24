import { describe, expect, it } from 'vitest';
import { GitBranchScanner, GitStatusScanner, parseGitListQuery } from '../server/git-listing';

const scope = 'repository:working';

function files(output: string, input: Record<string, unknown> = {}, staged = false, chunkSize = 7) {
  const query = parseGitListQuery(input, staged ? 'repository:staged' : scope);
  const scanner = new GitStatusScanner('repository', { query, staged });
  const bytes = Buffer.from(output);
  for (let offset = 0; offset < bytes.length; offset += chunkSize) scanner.write(bytes.subarray(offset, offset + chunkSize));
  return scanner.finish();
}

describe('bounded Git list scans', () => {
  it('pages mixed staged/working changes while decoding split UTF-8, rename and newline paths', () => {
    const output = '## main...origin/main [ahead 2, behind 3]\0MM shared.txt\0R  新しい\nname.txt\0old\nname.txt\0?? one.txt\0UU conflict.txt\0?? last.txt\0';
    const first = files(output, { limit: '2' }, false, 1);
    expect(first.summary).toMatchObject({ branch: 'main', ahead: 2, behind: 3, changedFileCount: 5, stagedCount: 2, changesCount: 4, conflictCount: 1 });
    expect(first.page?.files.map(file => file.path)).toEqual(['shared.txt', 'one.txt']);
    expect(first.page).toMatchObject({ offset: 0, total: 4 });
    expect(first.page?.previousCursor).toBeUndefined();
    const second = files(output, { limit: '2', cursor: first.page?.nextCursor });
    expect(second.page?.files.map(file => file.path)).toEqual(['conflict.txt', 'last.txt']);
    expect(second.page?.nextCursor).toBeUndefined();
    expect(files(output, { limit: '2', cursor: second.page?.previousCursor }).page?.files).toEqual(first.page?.files);
    const staged = files(output, { limit: '2', query: 'old' }, true, 1);
    expect(staged.page?.files).toEqual([{ path: '新しい\nname.txt', originalPath: 'old\nname.txt', staged: true, status: 'R' }]);
  });

  it('keeps only a requested page after tens of thousands of records', () => {
    const scanner = new GitStatusScanner('repository', { query: parseGitListQuery({ limit: '25' }, scope), staged: false });
    scanner.write(Buffer.from('## No commits yet on main\0'));
    for (let index = 0; index < 50_000; index++) scanner.write(Buffer.from(`?? file-${index}.txt\0`));
    const result = scanner.finish();
    expect(result.summary).toMatchObject({ branch: 'main', changedFileCount: 50_000, changesCount: 50_000, stagedCount: 0 });
    expect(result.page?.files).toHaveLength(25);
    expect(result.page?.total).toBe(50_000);
    expect(JSON.stringify(result).length).toBeLessThan(5_000);
  });

  it('rejects stale, mismatched and malformed cursors without showing incomplete pages as current', () => {
    const output = '## main\0?? a\0?? b\0?? c\0';
    const cursor = files(output, { limit: '1' }).page!.nextCursor!;
    expect(() => files(`${output}?? d\0`, { limit: '1', cursor })).toThrow(/repository changed/i);
    expect(() => files(output, { limit: '1', cursor, query: 'b' })).toThrow(/valid Git page/i);
    expect(() => files(output, { limit: '2', cursor })).toThrow(/valid Git page/i);
    expect(() => files(output, { limit: '1', cursor }, true)).toThrow(/valid Git page/i);
    expect(() => parseGitListQuery({ cursor: 'not-json' }, scope)).toThrow(/valid Git page/i);
    expect(() => parseGitListQuery({ limit: '101' }, scope)).toThrow(/valid Git page/i);
    expect(() => parseGitListQuery({ limit: ['5'] }, scope)).toThrow(/valid Git page/i);
    expect(() => parseGitListQuery({ query: 'x'.repeat(301) }, scope)).toThrow(/valid Git page/i);
  });

  it('retains requested mutation paths without retaining unrelated status entries', () => {
    const scanner = new GitStatusScanner('repository', undefined, new Set(['new.txt', 'both.txt']));
    scanner.write(Buffer.from('## main\0R  new.txt\0old.txt\0MM both.txt\0?? unrelated.txt\0'));
    const result = scanner.finish();
    expect(result.selectedFiles).toEqual([
      { path: 'new.txt', originalPath: 'old.txt', status: 'R', staged: true },
      { path: 'both.txt', status: 'M', staged: true },
      { path: 'both.txt', status: 'M', staged: false },
    ]);
    expect(result.page).toBeUndefined();
    expect(result.summary.changedFileCount).toBe(3);
  });

  it('filters and pages branch names without retaining the whole ref list', () => {
    const input = ['feature/a', 'feature/b', 'main', 'origin/HEAD', 'origin/main'].join('\n') + '\n';
    const scan = (cursor?: string) => {
      const scanner = new GitBranchScanner(parseGitListQuery({ limit: '1', query: 'feature/', ...(cursor ? { cursor } : {}) }, 'repository:branches'));
      for (const byte of Buffer.from(input)) scanner.write(Buffer.from([byte]));
      return scanner.finish();
    };
    const first = scan();
    expect(first).toMatchObject({ branches: ['feature/a'], total: 2, offset: 0 });
    const second = scan(first.nextCursor);
    expect(second).toMatchObject({ branches: ['feature/b'], total: 2, offset: 1 });
    expect(scan(second.previousCursor).branches).toEqual(first.branches);
  });

  it('bounds an unterminated entry and refuses an incomplete rename', () => {
    const scanner = new GitStatusScanner('repository');
    expect(() => scanner.write(Buffer.alloc(16 * 1024 + 1, 97))).toThrow(/too long/);
    expect(() => files('## main\0R  new.txt\0')).toThrow(/repository changed/i);
  });
});
