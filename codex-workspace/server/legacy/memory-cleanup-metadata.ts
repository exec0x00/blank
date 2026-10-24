import { z } from 'zod';

/** Frozen metadata grammar for ownership of retired custom-memory files.
 * This module can validate a cleanup claim; it cannot generate/read memories,
 * initialize an agent, call a provider, or authorize a new note operation. */
const identity = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/);
const timestamp = z.string().max(40).refine(value => Number.isFinite(Date.parse(value)));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const legacyMemoryScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workspace'), workspaceId: identity }).strict(),
  z.object({ kind: z.literal('owner') }).strict(),
]);
export type LegacyMemoryScope = z.infer<typeof legacyMemoryScopeSchema>;
export const legacyMemoryHumanOriginSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('conversation'), workspaceId: identity, threadId: z.string().regex(/^thr_[a-f0-9]{32}$/),
    messageId: z.string().regex(/^msg_[a-f0-9]{32}$/), turnId: identity, messageFingerprint: hash,
    operationId: identity, authorizedAt: timestamp }).strict(),
  z.object({ kind: z.literal('interface'), operationId: identity, authorizedAt: timestamp }).strict(),
]);
export const LEGACY_MEMORY_MAX_ARTIFACTS = 86;
const SLUG = '[a-z0-9][a-z0-9-]{0,63}';
const SEGMENT = '[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}';
const artifactPath = new RegExp('^(?:memory_summary\\.md|MEMORY\\.md|rollout_summaries/thr_[a-f0-9]{32}\\.md|skills/' + SLUG
  + '/(?:SKILL\\.md|(?:templates|examples|scripts)/' + SEGMENT + '(?:/' + SEGMENT + '){0,2}))$');
export const isLegacyMemoryArtifactPath = (value: string): boolean => value.length <= 340 && artifactPath.test(value);
