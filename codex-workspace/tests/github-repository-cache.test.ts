import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GithubRepo } from '../shared/types';
import { GithubRepositoryCache, type GithubProviderPage } from '../server/github-repository-cache';

const repository = (id: number, description = ''): GithubRepo => ({ id, name: `project-${id}`, fullName: `fixture/project-${id}`,
  description, private: true, defaultBranch: 'main', updatedAt: '2026-09-20T00:00:00Z', url: `https://github.com/fixture/project-${id}` });
const page = (id: number): GithubProviderPage => ({ repositories: [repository(id)], hasNext: true });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

afterEach(() => vi.restoreAllMocks());

describe('bounded GitHub provider page cache', () => {
  it('coalesces one pending provider page while keeping accounts and connection revisions isolated', async () => {
    const cache = new GithubRepositoryCache();
    const held = deferred<GithubProviderPage>();
    const load = vi.fn(() => held.promise);
    const first = cache.read('gh_1', 'version-one', 1, load);
    const same = cache.read('gh_1', 'version-one', 1, load);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    held.resolve(page(1));
    expect(await first).toEqual(page(1));
    expect(await same).toEqual(page(1));
    expect(await cache.read('gh_1', 'version-two', 1, async () => page(2))).toEqual(page(2));
    expect(await cache.read('gh_2', 'version-one', 1, async () => page(3))).toEqual(page(3));
    expect(await cache.read('gh_1', 'version-one', 1, load)).toEqual(page(1));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('evicts old provider pages instead of retaining an entire account repository inventory', async () => {
    const cache = new GithubRepositoryCache();
    const load = vi.fn(async () => page(1));
    for (let number = 1; number <= 65; number++) await cache.read('gh_1', 'version-one', number, load);
    expect(load).toHaveBeenCalledTimes(65);
    await cache.read('gh_1', 'version-one', 65, load);
    expect(load).toHaveBeenCalledTimes(65);
    await cache.read('gh_1', 'version-one', 1, load);
    expect(load).toHaveBeenCalledTimes(66);
  });

  it('also evicts by public metadata bytes before the page-count bound', async () => {
    const cache = new GithubRepositoryCache();
    const large: GithubProviderPage = { repositories: Array.from({ length: 30 }, (_, index) => repository(index, '界'.repeat(2048))), hasNext: true };
    const load = vi.fn(async () => large);
    for (let number = 1; number <= 60; number++) await cache.read('gh_1', 'version-one', number, load);
    expect(load).toHaveBeenCalledTimes(60);
    await cache.read('gh_1', 'version-one', 1, load);
    expect(load).toHaveBeenCalledTimes(61);
  });

  it('expires a page after two minutes without extending its lifetime on reads', async () => {
    let now = 10;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const cache = new GithubRepositoryCache();
    const load = vi.fn(async () => page(1));
    await cache.read('gh_1', 'version-one', 1, load);
    now += 119_999;
    await cache.read('gh_1', 'version-one', 1, load);
    expect(load).toHaveBeenCalledTimes(1);
    now++;
    await cache.read('gh_1', 'version-one', 1, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not let an invalidated in-flight fill repopulate a newer connection', async () => {
    const cache = new GithubRepositoryCache();
    const held = deferred<GithubProviderPage>();
    const old = cache.read('gh_1', 'version-one', 1, () => held.promise);
    cache.invalidate('gh_1');
    expect(await cache.read('gh_1', 'version-one', 1, async () => page(2))).toEqual(page(2));
    held.resolve(page(1));
    await old;
    const unused = vi.fn(async () => page(3));
    expect(await cache.read('gh_1', 'version-one', 1, unused)).toEqual(page(2));
    expect(unused).not.toHaveBeenCalled();
  });

  it('bounds active provider fills even when pending entries are invalidated', async () => {
    const cache = new GithubRepositoryCache();
    const held = deferred<GithubProviderPage>();
    const pending = Array.from({ length: 8 }, (_, index) => cache.read(`gh_${index + 1}`, 'version-one', 1, () => held.promise));
    for (let index = 1; index <= 8; index++) cache.invalidate(`gh_${index}`);
    const rejected = vi.fn(async () => page(9));
    await expect(cache.read('gh_9', 'version-one', 1, rejected)).rejects.toMatchObject({ status: 429, code: 'GITHUB_LIST_BUSY' });
    expect(rejected).not.toHaveBeenCalled();
    held.resolve(page(1));
    await Promise.all(pending);
    expect(await cache.read('gh_9', 'version-one', 1, rejected)).toEqual(page(9));
  });

  it('does not cache failures or accept oversized provider pages', async () => {
    const cache = new GithubRepositoryCache();
    await expect(cache.read('gh_1', 'version-one', 1, async () => { throw new Error('fixture failure'); })).rejects.toThrow('fixture failure');
    await expect(cache.read('gh_1', 'version-one', 1, async () => ({ repositories: Array.from({ length: 31 }, (_, index) => repository(index)), hasNext: false }))).rejects.toMatchObject({ code: 'GITHUB_RESPONSE' });
    await expect(cache.read('gh_1', 'version-one', 1, async () => ({ repositories: [repository(1, 'x'.repeat(256 * 1024))], hasNext: false }))).rejects.toMatchObject({ code: 'GITHUB_RESPONSE' });
    expect(await cache.read('gh_1', 'version-one', 1, async () => page(2))).toEqual(page(2));
  });
});
