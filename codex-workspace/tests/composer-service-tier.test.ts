import { describe, expect, it, vi } from 'vitest';
import { api } from '../client/api';
import { applyCurrentTurnServiceTier, composerServiceTier } from '../client/components/chat/service-tier';
import { SERVICE_TIERS } from '../shared/service-tiers';

const threadId = '01990000-0000-7000-8000-000000000101', turnId = '01990000-0000-7000-8000-000000000201';
const snapshot = { scope: 'current-turn', threadId, activeTurnId: turnId, generation: 'generation-one', canRequest: true };
const accepted = { scope: 'current-turn', threadId, turnId, status: 'applied' };
const options = (serviceTier = 'ultrafast') => ({ workspaceId: 'owned', threadId, turnId, serviceTier,
  signal: new AbortController().signal, current: () => true });

describe('composer service tiers', () => {
  it('keeps all documented wire values distinct and retains explicit choices over global defaults', () => {
    expect(SERVICE_TIERS.map(tier => tier.id)).toEqual(['auto', 'default', 'flex', 'scale', 'priority', 'fast', 'ultrafast']);
    for (const tier of SERVICE_TIERS) {
      expect(composerServiceTier(tier.id, 'default', { serviceTier: 'priority' })).toBe(tier.id);
      expect(composerServiceTier(undefined, tier.id, { serviceTier: 'default' })).toBe(tier.id);
    }
    expect(composerServiceTier(undefined, undefined, { serviceTier: 'fast' })).toBe('fast');
    expect(composerServiceTier(undefined, undefined, { fastMode: false })).toBe('default');
    expect(composerServiceTier(undefined, undefined, { fastMode: true })).toBe('priority');
  });

  it.each(SERVICE_TIERS)('targets the observed active turn with literal $id and no settings write', async tier => {
    const transport = vi.fn().mockResolvedValueOnce(snapshot).mockResolvedValueOnce(accepted);
    await applyCurrentTurnServiceTier(options(tier.id), transport as typeof api);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[1][0]).toBe(`/workspaces/owned/codex/threads/${threadId}/current-turn-settings`);
    expect(JSON.parse(transport.mock.calls[1][1].body)).toEqual({ expectedTurnId: turnId, expectedGeneration: 'generation-one', serviceTier: tier.id });
  });

  it('refuses a changed turn or selected conversation before dispatch', async () => {
    const changedTurn = vi.fn().mockResolvedValue({ ...snapshot, activeTurnId: '01990000-0000-7000-8000-000000000202' });
    await expect(applyCurrentTurnServiceTier(options(), changedTurn as typeof api)).rejects.toThrow(/turn changed/);
    expect(changedTurn).toHaveBeenCalledTimes(1);
    let current = true;
    const changedSelection = vi.fn().mockImplementation(async () => { current = false; return snapshot; });
    await expect(applyCurrentTurnServiceTier({ ...options(), current: () => current }, changedSelection as typeof api)).rejects.toMatchObject({ name: 'AbortError' });
    expect(changedSelection).toHaveBeenCalledTimes(1);
  });

  it('keeps native rejection and target-unavailable outcomes visible without fallback', async () => {
    const failure = new Error('Ultrafast is unavailable for this model.');
    const rejected = vi.fn().mockResolvedValueOnce(snapshot).mockRejectedValueOnce(failure);
    await expect(applyCurrentTurnServiceTier(options(), rejected as typeof api)).rejects.toBe(failure);
    expect(rejected).toHaveBeenCalledTimes(2);
    const unavailable = vi.fn().mockResolvedValueOnce(snapshot).mockResolvedValueOnce({ ...accepted, status: 'targetUnavailable' });
    await expect(applyCurrentTurnServiceTier(options(), unavailable as typeof api)).rejects.toThrow(/could not update/);
    expect(unavailable).toHaveBeenCalledTimes(2);
  });
});
