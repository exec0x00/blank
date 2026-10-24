import type { EventEmitter } from 'node:events';
import type { AppConfig } from './config';
import type { JsonStore, SecretStore } from './store';
import type { WorkspaceService } from './workspaces';
import type { AppSettings } from '../shared/types';

export interface AppContext {
  config: AppConfig;
  store: JsonStore;
  secrets: SecretStore;
  workspaces: WorkspaceService;
  events: EventEmitter;
  settings(): Promise<AppSettings>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  providerKey(): Promise<string | undefined>;
}
