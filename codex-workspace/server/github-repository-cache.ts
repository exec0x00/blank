import type { GithubRepo } from '../shared/types';
import { HttpError } from './errors';

export interface GithubProviderPage { repositories: GithubRepo[]; hasNext: boolean }
interface Entry {
  accountId: string;
  expiresAt: number;
  bytes: number;
  value?: GithubProviderPage;
  reading?: Promise<GithubProviderPage>;
}

const MAX_PAGES = 64;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PAGE_BYTES = 256 * 1024;
const MAX_READS = 8;
const TTL_MS = 120_000;

/** Cache individual provider pages, never an accumulating account inventory.
 * Entries contain public metadata only; credential versions are opaque hashes.
 * In-flight fills share the same hard entry bound and separate admission cap. */
export class GithubRepositoryCache {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  private reads = 0;

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
  }

  private expire(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) if (!entry.reading && entry.expiresAt <= now) this.remove(key);
  }

  private evict(): boolean {
    for (const [key, entry] of this.entries) {
      if (entry.reading) continue;
      this.remove(key);
      return true;
    }
    return false;
  }

  invalidate(accountId: string): void {
    for (const [key, entry] of this.entries) if (entry.accountId === accountId) this.remove(key);
  }

  async read(accountId: string, credentialRevision: string, page: number, load: () => Promise<GithubProviderPage>): Promise<GithubProviderPage> {
    this.expire();
    const key = `${accountId}:${credentialRevision}:${page}`;
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key); this.entries.set(key, existing);
      if (existing.reading) return existing.reading;
      if (existing.value) return existing.value;
    }
    if (this.reads >= MAX_READS) {
      throw new HttpError(429, 'Several GitHub pages are still loading. Wait a moment, then try again.', 'GITHUB_LIST_BUSY');
    }
    while (this.entries.size >= MAX_PAGES) if (!this.evict()) {
      throw new HttpError(429, 'Several GitHub pages are still loading. Wait a moment, then try again.', 'GITHUB_LIST_BUSY');
    }
    const entry: Entry = { accountId, expiresAt: Date.now() + TTL_MS, bytes: 0 };
    this.entries.set(key, entry);
    this.reads++;
    const reading = Promise.resolve().then(load).then(value => {
      const bytes = Buffer.byteLength(JSON.stringify(value));
      if (value.repositories.length > 30 || bytes > MAX_PAGE_BYTES) {
        throw new HttpError(502, 'GitHub returned too much repository data for one page. Try again.', 'GITHUB_RESPONSE');
      }
      // Reconnecting or disconnecting an account can invalidate a pending fill.
      // Its result must never repopulate a newer connection's cache.
      if (this.entries.get(key) === entry) {
        while (this.bytes + bytes > MAX_BYTES) if (!this.evict()) break;
        entry.value = value; entry.bytes = bytes; this.bytes += bytes;
        entry.expiresAt = Date.now() + TTL_MS;
      }
      return value;
    }).catch(error => {
      if (this.entries.get(key) === entry) this.remove(key);
      throw error;
    }).finally(() => { this.reads--; entry.reading = undefined; });
    entry.reading = reading;
    return reading;
  }
}
