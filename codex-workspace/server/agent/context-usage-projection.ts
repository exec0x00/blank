import type { ProviderTokenUsage, ThreadTokenUsage } from '../../shared/types';

export const CONTEXT_USAGE_TOKEN_FIELDS = ['inputTokens', 'outputTokens', 'totalTokens',
  'cachedInputTokens', 'cacheWriteInputTokens', 'reasoningOutputTokens'] as const;

export const isUsageCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const isUsageObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export const isUsageDate = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 20 && value.length <= 40 && Number.isFinite(Date.parse(value));

/** Never copy protocol payloads or arbitrary properties into public metadata. */
export function copyProviderUsage(value: unknown): ProviderTokenUsage | undefined {
  if (!isUsageObject(value) || !isUsageCount(value.requests)) return;
  const result: ProviderTokenUsage = { requests: value.requests };
  for (const key of CONTEXT_USAGE_TOKEN_FIELDS) {
    if (value[key] === undefined) continue;
    if (!isUsageCount(value[key]) || value.requests === 0 && value[key] !== 0) return;
    result[key] = value[key];
  }
  return result;
}

/** The former last-response counters remain private legacy state if present.
 * Public usage is always scoped to its owning conversation. */
export function publicThreadUsage(value: unknown): ThreadTokenUsage | undefined {
  if (!isUsageObject(value) || !isUsageDate(value.trackingStartedAt) || typeof value.incomplete !== 'boolean') return;
  const total = copyProviderUsage(value.total);
  if (!total) return;
  return { total, trackingStartedAt: value.trackingStartedAt, incomplete: value.incomplete };
}

export function emptyProviderUsage(): ProviderTokenUsage {
  return { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0,
    cachedInputTokens: 0, cacheWriteInputTokens: 0, reasoningOutputTokens: 0 };
}
