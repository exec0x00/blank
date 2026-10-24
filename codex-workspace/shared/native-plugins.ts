/** Public projections of the official native plugin and app APIs. */
export const NATIVE_PLUGIN_METHODS = [
  'marketplace/add', 'marketplace/remove', 'marketplace/upgrade',
  'plugin/list', 'plugin/search', 'plugin/installed', 'plugin/reconcile', 'plugin/read',
  'plugin/skill/read', 'plugin/install', 'plugin/uninstall',
  'plugin/share/save', 'plugin/share/updateTargets', 'plugin/share/list', 'plugin/share/checkout', 'plugin/share/delete',
  'app/list', 'app/read', 'app/installed',
] as const;
export type NativePluginMethod = typeof NATIVE_PLUGIN_METHODS[number];
export interface NativePluginAvailability {
  status: 'advertised' | 'working' | 'unavailable' | 'rejected';
  reason: string | null;
}
export interface NativePluginsCapabilities {
  experimental: true;
  connected: boolean;
  methods: Record<NativePluginMethod, NativePluginAvailability>;
}
export type NativePluginMarketplaceKind = 'local' | 'vertical' | 'workspace-directory' | 'shared-with-me' | 'created-by-me-remote';
export type NativePluginSearchScope = 'global' | 'workspace' | 'personal';
export type NativePluginDiscoverability = 'PRIVATE' | 'UNLISTED' | 'LISTED';
export interface NativePluginShareTarget {
  principalType: 'user' | 'group' | 'workspace';
  principalId: string;
  role: 'reader' | 'editor';
}
export interface NativePluginSharePrincipal {
  principalType: NativePluginShareTarget['principalType'];
  principalId: string;
  role: NativePluginShareTarget['role'] | 'owner';
  name: string;
}
export interface NativePluginShareContext {
  remotePluginId: string;
  remoteVersion: string | null;
  discoverability: NativePluginDiscoverability | null;
  shareUrl: string | null;
  creatorName: string | null;
  principals: NativePluginSharePrincipal[];
  canPublishToWorkspace: boolean | null;
}
export interface NativePluginSummary {
  /** Short-lived, workspace/connection-bound server reference. Never a filesystem path. */
  ref: string;
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  developerName: string | null;
  marketplaceName: string;
  marketplaceRef: string | null;
  remotePluginId: string | null;
  remoteSkillsAvailable: boolean;
  version: string | null;
  localVersion: string | null;
  installed: boolean;
  enabled: boolean;
  installPolicy: 'NOT_AVAILABLE' | 'AVAILABLE' | 'INSTALLED_BY_DEFAULT';
  authPolicy: 'ON_INSTALL' | 'ON_USE';
  availability: 'AVAILABLE' | 'DISABLED_BY_ADMIN';
  disabledReason: string | null;
  requiresInstallReview: boolean;
  sourceKind: 'local' | 'git' | 'npm' | 'remote';
  capabilities: string[];
  keywords: string[];
  sharing: NativePluginShareContext | null;
}
export interface NativePluginMarketplace {
  ref: string;
  name: string;
  displayName: string;
  local: boolean;
  pluginCount: number;
}
export interface NativePluginCatalogPage {
  data: NativePluginSummary[];
  marketplaces: NativePluginMarketplace[];
  errors: string[];
  featuredIds: string[];
  nextCursor: string | null;
  total: number;
}
export interface NativePluginSearchPage {
  data: NativePluginSummary[];
  nextCursor: string | null;
}
export interface NativePluginDetail {
  plugin: NativePluginSummary;
  description: string | null;
  skills: Array<{ name: string; description: string; enabled: boolean }>;
  onboardingSkill: string | null;
  hooks: Array<{ key: string; eventName: string }>;
  apps: Array<{ id: string; name: string; description: string | null; category: string | null }>;
  appTemplates: Array<{ id: string; name: string; description: string | null; unavailableReason: string | null }>;
  mcpServers: string[];
  scheduledTasks: Array<{ key: string; name: string; prompt: string; schedule: string }>;
  shareUrl: string | null;
}
export interface NativePluginSkillContents { name: string; contents: string | null; truncated: boolean }
export interface NativePluginInstallResult {
  authPolicy: 'ON_INSTALL' | 'ON_USE';
  appsNeedingAuth: Array<{ id: string; name: string }>;
}
export interface NativePluginReconcileResult {
  changedPlugins: Array<{ id: string; hasMcps: boolean; hasApps: boolean; hasHooks: boolean; hasSkills: boolean }>;
  failedRemotePluginIds: string[];
  failedMaterializationRemotePluginIds: string[];
}
export interface NativePluginMarketplaceUpgradeResult {
  selectedMarketplaces: string[];
  upgradedCount: number;
  errors: Array<{ marketplaceName: string; message: string }>;
}
export interface NativePluginShareListItem { plugin: NativePluginSummary; localRef: string | null }
export interface NativePluginSharePage { data: NativePluginShareListItem[]; nextCursor: string | null; total: number }
export interface NativePluginShareSaveInput {
  pluginPath?: string;
  localRef?: string;
  remotePluginId?: string;
  discoverability: NativePluginDiscoverability;
  shareTargets: NativePluginShareTarget[];
}
export interface NativePluginShareSaveResult { remotePluginId: string; shareUrl: string | null; canPublishToWorkspace: boolean | null }
export interface NativePluginShareCheckoutResult {
  remotePluginId: string;
  pluginId: string;
  pluginName: string;
  marketplaceName: string;
  remoteVersion: string | null;
  localRef: string;
  /** Present only when the native result belongs to this workspace. */
  workspacePath: string | null;
}
export interface NativeAppSummary {
  id: string;
  name: string;
  description: string | null;
  accessible: boolean;
  enabled: boolean;
  pluginDisplayNames: string[];
  developer: string | null;
  version: string | null;
  categories: string[];
}
export interface NativeAppCatalogPage { data: NativeAppSummary[]; nextCursor: string | null }
export interface NativeInstalledApp { id: string; runtimeName: string | null; enabled: boolean; callable: boolean }
export interface NativeInstalledAppPage { apps: NativeInstalledApp[]; nextCursor: string | null; total: number }
export interface NativeAppDetail {
  id: string;
  name: string;
  description: string | null;
  pluginDisplayNames: string[];
  /** Display-only catalog metadata. Runtime callability is a separate native snapshot. */
  tools: Array<{ name: string; title: string | null; description: string; enabled: boolean; disabledReason: string | null; readOnly: boolean }> | null;
}
export interface NativeAppDetails { apps: NativeAppDetail[]; missingAppIds: string[] }
