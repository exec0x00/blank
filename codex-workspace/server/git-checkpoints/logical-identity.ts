import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Workspace } from '../../shared/types';
import type { AppConfig } from '../config';
import { HttpError } from '../errors';
import { CheckpointDirectory, readRegular, sameIdentity, writeExclusive } from './filesystem';
import { canonicalJson, checkedId } from './store';
import type { GitCheckpointGeneration } from './types';
export { sameCheckpointRepository, sameLiveCheckpointRepository } from './identity-contract';

export const REPOSITORY_GENERATION_MARKER = '.codex-workspace-repository-v1.json';
export const CHECKOUT_GENERATION_MARKER = '.codex-workspace-checkout-v1.json';
const MAX_MARKER_BYTES = 16 * 1024;
const MAX_LIVE_BINDINGS = 8_192;
const MAX_LIVE_HANDLES = 512;
const HASH = /^[a-f0-9]{64}$/;
const GENERATION = /^(?:repository|checkout)_[a-f0-9]{32}$/;
interface ObservationScope { observedIn: string; references: number; closed: boolean; bindings: Map<string, CheckpointDirectory[]> }
const scopes = new Map<string, ObservationScope>();
let liveHandles = 0;
const markerQueues = new Map<string, Promise<void>>();

interface RepositoryMarker {
  version: 1; kind: 'git-checkpoint-repository-generation'; generation: string; primaryCheckout: string;
  workspaceId: string; workspaceCreatedAt: string; root: string; commonDirectory: string;
}
interface CheckoutMarker {
  version: 1; kind: 'git-checkpoint-checkout-generation'; generation: string; repositoryGeneration: string;
  workspaceId: string; workspaceCreatedAt: string; root: string; gitDirectory: string; commonDirectory: string;
  repositoryWorkspaceId: string; repositoryWorkspaceCreatedAt: string; worktreeId: string;
}
interface SignedMarker { value: RepositoryMarker | CheckoutMarker; authentication: string }
export interface RegisteredRepositoryDirectories {
  root: CheckpointDirectory; git: CheckpointDirectory; common: CheckpointDirectory;
  workspace: Workspace; repositoryWorkspace: Workspace;
}

function unavailable(): never {
  throw new HttpError(409, 'The durable Git repository identity is missing or failed verification. Earlier file checkpoints cannot be applied to a replacement repository.', 'CHECKPOINT_GENERATION_UNAVAILABLE');
}
function replaced(): never {
  throw new HttpError(409, 'A Git repository or checkout directory was replaced during this server session. File checkpoints were left unchanged.', 'CHECKPOINT_LIVE_REPOSITORY_CHANGED');
}
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}
async function markerLocked<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = markerQueues.get(key) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  const tail = current.then(() => undefined, () => undefined);
  markerQueues.set(key, tail);
  try { return await current; }
  finally { if (markerQueues.get(key) === tail) markerQueues.delete(key); }
}

/** Stable identity is stored inside the repository so reinitializing .git does
 * not silently inherit history from an unrelated repository at the same path.
 * Only these fixed owned markers are written; Git HEAD/index/config/refs remain untouched. */
export class CheckpointRepositoryIdentity {
  private readonly signingKey: Buffer;
  private readonly scopeKey: string;
  private readonly scope: ObservationScope;
  private closed = false;
  private closing?: Promise<void>;
  private readonly observations = new Set<Promise<GitCheckpointGeneration>>();
  constructor(private readonly config: Pick<AppConfig, 'stateDir' | 'encryptionKey'>) {
    this.signingKey = createHmac('sha256', config.encryptionKey).update('codex-workspace/git-checkpoint-generation/v1').digest();
    this.scopeKey = `${config.stateDir}\0${this.signingKey.toString('hex')}`;
    let scope = scopes.get(this.scopeKey);
    if (!scope) {
      scope = { observedIn: `boot_${randomUUID().replaceAll('-', '')}`, references: 0, closed: false, bindings: new Map() };
      scopes.set(this.scopeKey, scope);
    }
    scope.references++; this.scope = scope;
  }
  get observedIn(): string { return this.scope.observedIn; }
  private open(): void { if (this.closed || this.scope.closed) throw new HttpError(503, 'The checkpoint service has closed. Retry with a fresh workspace session.', 'CHECKPOINT_CLOSED'); }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = (async () => {
      // A pending bind may have reserved descriptors that are not published in
      // scope.bindings yet. It sees closed, disposes them, then this drain ends.
      await Promise.allSettled([...this.observations]);
      if (--this.scope.references > 0) return;
      this.scope.closed = true;
      if (scopes.get(this.scopeKey) === this.scope) scopes.delete(this.scopeKey);
      const leases = [...this.scope.bindings.values()].flat(); this.scope.bindings.clear();
      await Promise.allSettled(leases.map(directory => directory.close()));
      liveHandles -= leases.length;
    })();
    return this.closing;
  }
  private sign(value: RepositoryMarker | CheckoutMarker): SignedMarker {
    return { value, authentication: createHmac('sha256', this.signingKey).update(canonicalJson(value)).digest('hex') };
  }
  private decode(bytes: Buffer): RepositoryMarker | CheckoutMarker {
    let signed: SignedMarker;
    try { signed = JSON.parse(bytes.toString('utf8')); }
    catch { unavailable(); }
    if (!signed || typeof signed !== 'object' || !signed.value || typeof signed.value !== 'object'
      || typeof signed.authentication !== 'string' || !HASH.test(signed.authentication)) unavailable();
    const expected = this.sign(signed.value).authentication;
    if (!timingSafeEqual(Buffer.from(signed.authentication, 'hex'), Buffer.from(expected, 'hex'))) unavailable();
    const value = signed.value;
    if (value.version !== 1 || !GENERATION.test(value.generation ?? '') || !timestamp(value.workspaceCreatedAt)) unavailable();
    checkedId(value.workspaceId);
    return value;
  }
  private async marker<T extends RepositoryMarker | CheckoutMarker>(directory: CheckpointDirectory, filename: string,
    expected: Omit<T, 'generation' | 'primaryCheckout'>, create: boolean): Promise<T> {
    return markerLocked(`${directory.absolute}/${filename}`, async () => {
      let bytes = await readRegular(directory, filename, MAX_MARKER_BYTES);
      if (!bytes) {
        if (!create) unavailable();
        const record = { ...expected, generation: `${expected.kind === 'git-checkpoint-repository-generation' ? 'repository' : 'checkout'}_${randomUUID().replaceAll('-', '')}`,
          ...(expected.kind === 'git-checkpoint-repository-generation' ? { primaryCheckout: `checkout_${randomUUID().replaceAll('-', '')}` } : {}) } as T;
        const encoded = Buffer.from(canonicalJson(this.sign(record)));
        try { await writeExclusive(directory, filename, encoded); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        bytes = await readRegular(directory, filename, MAX_MARKER_BYTES);
        if (!bytes) unavailable();
      }
      const value = this.decode(bytes);
      const { generation: _generation, primaryCheckout: _checkout, ...binding } = value as RepositoryMarker;
      if (canonicalJson(binding) !== canonicalJson(expected)) unavailable();
      if (value.kind === 'git-checkpoint-repository-generation'
        && (!/^repository_[a-f0-9]{32}$/.test(value.generation) || !/^checkout_[a-f0-9]{32}$/.test(value.primaryCheckout ?? ''))) unavailable();
      if (value.kind === 'git-checkpoint-checkout-generation' && !/^checkout_[a-f0-9]{32}$/.test(value.generation)) unavailable();
      return value as T;
    });
  }
  private async bind(key: string, directories: CheckpointDirectory[]): Promise<void> {
    await markerLocked(`${this.scopeKey}\0binding\0${key}`, async () => {
      this.open();
      const previous = this.scope.bindings.get(key);
      if (previous) {
        if (previous.length !== directories.length) replaced();
        for (let index = 0; index < previous.length; index++) {
          try { await previous[index].check(); } catch { replaced(); }
          if (!sameIdentity(previous[index].initial, directories[index].initial)) replaced();
        }
        this.open(); return;
      }
      if (this.scope.bindings.size >= MAX_LIVE_BINDINGS || liveHandles + directories.length > MAX_LIVE_HANDLES) {
        throw new HttpError(503, 'This server session has reached its bounded repository-identity budget. Existing checkpoints were preserved.', 'CHECKPOINT_IDENTITY_LIMIT');
      }
      liveHandles += directories.length;
      const leases: CheckpointDirectory[] = [];
      try {
        for (const directory of directories) {
          await directory.check();
          // The proc descriptor is already pinned; /.'s final component is an
          // actual directory, so O_NOFOLLOW still rejects a substituted leaf.
          const lease = await CheckpointDirectory.open(directory.absolute, `${directory.access}/.`);
          leases.push(lease);
          if (!sameIdentity(lease.initial, directory.initial)) replaced();
        }
        this.open(); this.scope.bindings.set(key, leases);
      } catch (error) {
        await Promise.allSettled(leases.map(directory => directory.close())); liveHandles -= directories.length;
        throw error;
      }
    });
  }
  observe(directories: RegisteredRepositoryDirectories, create = false): Promise<GitCheckpointGeneration> {
    this.open();
    const observation = this.observeNow(directories, create);
    this.observations.add(observation);
    void observation.then(() => this.observations.delete(observation), () => this.observations.delete(observation));
    return observation;
  }
  private async observeNow(directories: RegisteredRepositoryDirectories, create: boolean): Promise<GitCheckpointGeneration> {
    this.open();
    const { workspace, repositoryWorkspace, root, git, common } = directories;
    checkedId(workspace.id); checkedId(repositoryWorkspace.id);
    if (!timestamp(workspace.createdAt) || !timestamp(repositoryWorkspace.createdAt)) unavailable();
    await root.check(); await git.check(); await common.check();
    const repository = await this.marker<RepositoryMarker>(common, REPOSITORY_GENERATION_MARKER, {
      version: 1, kind: 'git-checkpoint-repository-generation', workspaceId: repositoryWorkspace.id,
      workspaceCreatedAt: repositoryWorkspace.createdAt, root: repositoryWorkspace.path, commonDirectory: common.absolute,
    }, create);
    await this.bind(`repository\0${repository.generation}\0${common.absolute}`, [common]);
    let checkout = repository.primaryCheckout;
    if (workspace.worktree) {
      const current = await this.marker<CheckoutMarker>(git, CHECKOUT_GENERATION_MARKER, {
        version: 1, kind: 'git-checkpoint-checkout-generation', repositoryGeneration: repository.generation,
        workspaceId: workspace.id, workspaceCreatedAt: workspace.createdAt, root: root.absolute, gitDirectory: git.absolute,
        commonDirectory: common.absolute, repositoryWorkspaceId: repositoryWorkspace.id,
        repositoryWorkspaceCreatedAt: repositoryWorkspace.createdAt, worktreeId: workspace.worktree.id,
      }, create);
      checkout = current.generation;
    } else if (workspace.id !== repositoryWorkspace.id || workspace.path !== repositoryWorkspace.path || git.absolute !== common.absolute) unavailable();
    await this.bind(`checkout\0${checkout}\0${root.absolute}\0${git.absolute}`, [root, git]);
    await root.check(); await git.check(); await common.check();
    this.open();
    return { version: 1, repository: repository.generation, checkout, workspaceId: workspace.id,
      workspaceCreatedAt: workspace.createdAt, repositoryWorkspaceId: repositoryWorkspace.id,
      repositoryWorkspaceCreatedAt: repositoryWorkspace.createdAt, worktreeId: workspace.worktree?.id ?? null };
  }
}
