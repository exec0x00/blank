/** Owned-fixture fresh-process proof; never used by the app or deployment. */
import fs from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { loadConfig } from '../../server/config';
import { JsonStore, SecretStore } from '../../server/store';
import { WorkspaceService } from '../../server/workspaces';
import { GitCheckpointService, type GitCheckpointReference } from '../../server/git-checkpoints';
import type { AppContext } from '../../server/context';
import type { AppSettings } from '../../shared/types';

const input = JSON.parse(await fs.readFile(process.argv[2], 'utf8')) as {
  dataDir: string; runtimeDir: string; references: GitCheckpointReference[]; captureAfter?: GitCheckpointReference;
};
if (!Array.isArray(input.references) || !input.references.length || input.references.length > 4) throw new Error('Invalid restart fixture.');
const config = loadConfig({ DATA_DIR: input.dataDir, RUNTIME_DIR: input.runtimeDir, WORKSPACE_PASSWORD: 'checkpoint-test-password',
  SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'e'.repeat(64) });
const store = new JsonStore(config.stateDir);
const settings: AppSettings = { model: 'fixture', reasoningEffort: 'high', autoApprove: false, theme: 'dark', fontSize: 13,
  wordWrap: true, provider: 'openai', apiKeyConfigured: false };
const ctx: AppContext = { config, store, secrets: new SecretStore(store, config.encryptionKey), workspaces: new WorkspaceService(config, store),
  events: new EventEmitter(), settings: async () => settings, saveSettings: async patch => Object.assign(settings, patch), providerKey: async () => undefined };
const service = new GitCheckpointService(ctx);
const observations = [];
for (const reference of input.references) {
  const saved = await service.read(reference);
  const current = await service.inspectCurrent(saved);
  const repository = await service.assertRepository(saved);
  const file = saved.files.find(entry => entry.blob);
  const content = file?.blob ? (await service.readBlob(saved, file.blob)).toString('base64') : null;
  observations.push({ id: saved.id, repository, current, capturedFile: file?.path ?? null, content });
}
let after = null;
if (input.captureAfter) {
  const result = await service.capture({ workspaceId: input.captureAfter.workspaceId, threadId: input.captureAfter.threadId,
    turnId: input.captureAfter.turnId, phase: 'after' });
  if (result.status !== 'ready') throw new Error(`${result.code}: ${result.reason}`);
  after = await service.read(result.checkpoint);
}
await store.flush();
await service.close();
process.stdout.write(JSON.stringify({ observations, after }));
