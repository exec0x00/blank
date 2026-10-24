import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerModels } from '../server/codex-cli/provider-models';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('test Space catalog', () => {
  it('maps authenticated service IDs into bridge profiles', async () => {
    vi.stubEnv('PASSWORD', 'test-key');
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.headers).toEqual({ Authorization: 'Bearer test-key' });
      return { ok: true, json: async () => ({ data: [{ id: 'claude-sonnet-5-5' }, { id: 'claude-haiku-5-5' }] }) };
    });
    vi.stubGlobal('fetch', fetcher);
    const result = await providerModels();
    expect(result.models).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(result.catalog[0]).toMatchObject({ provider: 'bridge', contextWindow: 100_000, isDefault: true });
    expect(fetcher.mock.calls[0][0]).toBe('https://alvin3y12-test.hf.space/api/models');
  });
  it('rejects malformed service catalogs', async () => {
    vi.stubEnv('PASSWORD', 'test-key');
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ data: [{ id: 'gpt-not-supported' }] }) }));
    await expect(providerModels()).rejects.toMatchObject({ status: 502 });
  });
});
