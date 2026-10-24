import path from 'node:path';
import type { GitCheckpointGeneration, GitCheckpointIdentity, GitCheckpointRepository } from './types';

const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const timestamp = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const fields = (value: Record<string, unknown>, names: readonly string[]): boolean => Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const absolute = (value: unknown): value is string => typeof value === 'string' && value.length > 1 && value.length <= 4096
  && path.posix.isAbsolute(value) && path.posix.normalize(value) === value && !/[\u0000-\u001f\u007f]/.test(value);
const physical = (value: unknown): value is GitCheckpointIdentity => record(value) && fields(value, ['dev', 'ino'])
  && typeof value.dev === 'number' && Number.isInteger(value.dev) && value.dev >= 0
  && typeof value.ino === 'number' && Number.isInteger(value.ino) && value.ino >= 0;

function generation(value: unknown): value is GitCheckpointGeneration {
  if (!record(value) || !fields(value, ['version', 'repository', 'checkout', 'workspaceId', 'workspaceCreatedAt', 'repositoryWorkspaceId', 'repositoryWorkspaceCreatedAt', 'worktreeId'])) return false;
  return value.version === 1 && typeof value.repository === 'string' && /^repository_[a-f0-9]{32}$/.test(value.repository)
    && typeof value.checkout === 'string' && /^checkout_[a-f0-9]{32}$/.test(value.checkout)
    && typeof value.workspaceId === 'string' && ID.test(value.workspaceId)
    && typeof value.repositoryWorkspaceId === 'string' && ID.test(value.repositoryWorkspaceId)
    && timestamp(value.workspaceCreatedAt) && timestamp(value.repositoryWorkspaceCreatedAt)
    && (value.worktreeId === null || typeof value.worktreeId === 'string' && ID.test(value.worktreeId));
}

/** A signed manifest still crosses an untyped persistence boundary. Legacy or
 * malformed observations must not acquire the current identity retrospectively. */
export function isGitCheckpointRepository(value: unknown): value is GitCheckpointRepository {
  if (!record(value) || !fields(value, ['root', 'gitDirectory', 'commonDirectory', 'rootIdentity', 'gitIdentity', 'commonIdentity', 'generation', 'observedIn', 'objectFormat', 'head', 'headRef'])
    || !absolute(value.root) || !absolute(value.gitDirectory) || !absolute(value.commonDirectory)
    || !physical(value.rootIdentity) || !physical(value.gitIdentity) || !physical(value.commonIdentity)
    || !generation(value.generation) || typeof value.observedIn !== 'string' || !/^boot_[a-f0-9]{32}$/.test(value.observedIn)
    || value.objectFormat !== 'sha1' && value.objectFormat !== 'sha256') return false;
  const oid = value.objectFormat === 'sha1' ? /^[a-f0-9]{40}$/ : /^[a-f0-9]{64}$/;
  return (value.head === null || typeof value.head === 'string' && oid.test(value.head))
    && (value.headRef === null || typeof value.headRef === 'string' && value.headRef.length <= 4096
      && value.headRef.startsWith('refs/') && !/[\u0000-\u0020\u007f]/.test(value.headRef));
}

/** Historical continuity survives reconstruction; physical identities bind one observation epoch. */
export function sameCheckpointRepository(left: GitCheckpointRepository, right: GitCheckpointRepository): boolean {
  if (!isGitCheckpointRepository(left) || !isGitCheckpointRepository(right)
    || ['root', 'gitDirectory', 'commonDirectory', 'objectFormat', 'head', 'headRef'].some(key => left[key as keyof GitCheckpointRepository] !== right[key as keyof GitCheckpointRepository])
    || Object.keys(left.generation).some(key => left.generation[key as keyof GitCheckpointGeneration] !== right.generation[key as keyof GitCheckpointGeneration])) return false;
  return left.observedIn !== right.observedIn || ['rootIdentity', 'gitIdentity', 'commonIdentity'].every(key => {
    const first = left[key as 'rootIdentity'], second = right[key as 'rootIdentity'];
    return first.dev === second.dev && first.ino === second.ino;
  });
}

/** Current preview/commit evidence must never be reused across observation epochs. */
export function sameLiveCheckpointRepository(left: GitCheckpointRepository, right: GitCheckpointRepository): boolean {
  return left?.observedIn === right?.observedIn && sameCheckpointRepository(left, right);
}
