/** Bounded website projections of official Codex discovery responses.
 * `nativeConfirmed` is present only after that request succeeded. */
export interface NativeDiscoveryRead {
  nativeConfirmed: true;
  observedAt: string;
}

export interface NativeDiscoveryPage<T> extends NativeDiscoveryRead {
  data: T[];
  nextCursor: string | null;
}

export interface NativeDiscoveryOverview {
  generation: string | null;
  runtimeState: string;
  runtimeVersion: string | null;
  extraSkillRoots: string[];
  exclusions: Array<{ id: string; label: string; reason: string }>;
}

export interface NativeDiagnosticsView extends NativeDiscoveryRead {
  process: { id: number; residentMemoryBytes: number | null; physicalFootprintBytes: number | null };
  gauges: Array<{ name: string; value: number }>;
}

export interface NativeProviderCapabilitiesView extends NativeDiscoveryRead {
  namespaceTools: boolean;
  imageGeneration: boolean;
  webSearch: boolean;
}

export interface NativeLifecycleHook {
  id: string;
  event: string;
  handlerType: 'command' | 'mcpTool' | 'prompt' | 'agent';
  source: string;
  sourcePath: string | null;
  enabled: boolean;
  managed: boolean;
  trust: string;
  timeoutSeconds: number | null;
  statusMessage: string | null;
}

export interface NativeHooksView extends NativeDiscoveryPage<NativeLifecycleHook> {
  warningCount: number;
  errorCount: number;
}

export interface NativePermissionProfile {
  id: string;
  description: string | null;
  allowed: boolean;
}

export interface NativeCollaborationMode {
  name: string;
  mode: 'plan' | 'default' | null;
  model: string | null;
  reasoningEffort: string | null;
}

export interface NativeFeatureFlag {
  name: string;
  label: string;
  description: string | null;
  stage: 'beta' | 'underDevelopment' | 'stable' | 'deprecated' | 'removed';
  enabled: boolean;
  defaultEnabled: boolean;
  canToggle: boolean;
  blockedReason: string | null;
}

export interface NativeFeatureChange extends NativeDiscoveryRead {
  name: string;
  requestedEnabled: boolean;
  effectiveEnabled: boolean;
  acknowledged: true;
  runtimeOnly: true;
  message: string;
}

export interface NativeSkillRootsView {
  nativeConfirmed: boolean;
  observedAt: string | null;
  paths: string[];
  runtimeOnly: true;
}

export type NativeImportSource = 'claude' | 'cursor';
export type NativeImportItemType = 'AGENTS_MD' | 'CONFIG' | 'SKILLS' | 'PLUGINS' | 'MCP_SERVER_CONFIG'
  | 'SUBAGENTS' | 'HOOKS' | 'COMMANDS' | 'MEMORY' | 'SESSIONS';
export type NativeManualImportType = 'AGENTS_MD' | 'SKILLS' | 'COMMANDS';

export interface NativeImportPreviewItem {
  id: string;
  itemType: NativeImportItemType;
  label: string;
  description: string;
  sourcePaths: string[];
  destinationPaths: string[];
  count: number | null;
  allowed: boolean;
  blockedReason: string | null;
}

export interface NativeImportPreview extends NativeDiscoveryRead {
  previewId: string;
  expiresAt: string;
  source: NativeImportSource;
  items: NativeImportPreviewItem[];
  excludedCount: number;
  note: string;
}

export interface NativeImportResult {
  itemType: NativeImportItemType;
  label: string;
  successes: number;
  failures: number;
  sourcePaths: string[];
  destinationPaths: string[];
  messages: string[];
}

export interface NativeImportOperation {
  operationId: string;
  importId: string | null;
  status: 'running' | 'completed' | 'unknown';
  results: NativeImportResult[];
  startedAt: string;
  updatedAt: string;
  message: string;
}

export interface NativeImportHistoryRow {
  importId: string;
  source: string;
  completedAt: string | null;
  userReported: boolean;
  results: NativeImportResult[];
}

export interface NativeFeedbackPreview {
  previewId: string;
  expiresAt: string;
  files: Array<{ path: string; bytes: number }>;
  includeLogs: false;
  destination: 'OpenAI feedback service';
}

export interface NativeFeedbackReceipt extends NativeDiscoveryRead {
  sent: true;
  reference: string;
}
