/** Public presentation contracts for the official Codex app-server.
 * These are UI data, never an alternative agent runtime or model protocol. */
export interface CodexCapabilities {
  conversations: boolean;
  pagination: boolean;
  queue: boolean;
  goals: boolean;
  skills: boolean;
  plan: boolean;
  review: boolean;
  historyRevert: boolean;
  /** Present only when the running native callback and site handler exist. */
  mcpRequests?: boolean;
}

export interface CodexRuntimeStatus {
  backend: 'codex-cli';
  state: 'installing' | 'starting' | 'ready' | 'updating' | 'error' | 'stopped';
  version: string | null;
  installedVersion: string | null;
  startedAt: string | null;
  updatedAt: string;
  canUpdate: boolean;
  updateBlockedReason: string | null;
  error: string | null;
  activeTurns: number;
  capabilities: CodexCapabilities;
}

/** Public identity provenance for native views. A materialized legacy turn
 * uses reconstructed item ids which cannot be unioned with live event ids. */
export interface CodexNativeView {
  /** Opaque producer/connection epoch, never a filesystem or native store id. */
  epoch: string;
  /** Monotonic view observation within this epoch. */
  revision: number;
  historyMode: 'legacy' | 'paginated' | 'unknown';
  /** At most 256 represented turns. Missing turns are outside this payload's
   * coverage; a partial page never declares them deleted or replaced. */
  turns: Array<{
    turnId: string;
    identity: 'native' | 'legacy';
    /** Changes when this turn's identity space/snapshot is replaced. */
    revision: number;
    /** Complete only when this payload contains the entire public turn. */
    coverage: 'partial' | 'complete';
  }>;
}

export interface CodexModel {
  provider?: 'bridge';
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
  defaultReasoningEffort: string;
  inputModalities: string[];
  isDefault: boolean;
  /** Actual capacity from the installed native catalog, without provider discovery. */
  contextWindow?: number | null;
  maximumContextWindow?: number | null;
  effectiveContextWindowPercent?: number | null;
  contextWindowSource?: 'native-bundled' | 'native' | 'bridge';
  /** Published API capacity may exceed the native catalog's available capacity. */
  officialMaximumContextWindow?: number | null;
  contextSpecificationUrl?: string;
  serviceTiers?: Array<{ id: string; name: string; description: string }>;
  defaultServiceTier?: string | null;
}
export interface CodexModelCatalog { backend: 'codex-cli'; catalog: CodexModel[]; models: string[]; connected: boolean }

export type CodexConfigValue = string | number | boolean | null | CodexConfigValue[] | { [key: string]: CodexConfigValue };
export interface CodexConfigEdit { keyPath: string; value: CodexConfigValue }
export interface CodexModelContext {
  model: string;
  maximum: number | null;
  officialMaximum: number | null;
  configured: number | null;
  effective: number | null;
  autoCompactTokenLimit: number | null;
  defaultAutoCompactTokenLimit: number | null;
  source: 'native-bundled' | 'native' | 'bridge' | 'user' | 'unknown';
  specificationUrl?: string;
}
export interface CodexNativeSettings {
  backend: 'codex-cli';
  config: Record<string, CodexConfigValue>;
  userConfig: Record<string, CodexConfigValue>;
  version: string;
  /** Official configuration schema snapshot; native Codex also validates every write. */
  schema: Record<string, unknown>;
  schemaSource: { url: string; retrievedAt: string; sha256: string; runtimeVersion: string | null };
  editableKeys: string[];
  lockedKeys: Array<{ key: string; reason: string }>;
  maxConcurrentAgentsKey: string;
  documentationUrl: string;
  models: CodexModel[];
  modelContext: CodexModelContext;
  mcpEnvironment: Array<{ name: string }>;
  restartRequired: boolean;
  settings: import('./types').AppSettings;
}
export interface CodexNativeSettingsPatch {
  expectedVersion: string;
  edits: CodexConfigEdit[];
  preferences?: Partial<import('./types').AppSettings>;
  /** Write-only secrets. Native TOML stores only official environment references. */
  mcpEnvironment?: Array<{ name: string; value: string | null }>;
}
export interface CodexMcpStatus {
  servers: Array<{ name: string; authStatus: string; toolCount: number; resourceCount: number; resourceTemplateCount: number; connectionStatus: string | null; error: string | null }>;
  checkedAt: string;
  nextCursor: string | null;
  restartRequired: boolean;
}

export type CodexApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel' | `native-decision-${string}`;
export interface CodexApproval {
  /** Connection-scoped web identifier; the server retains the actual RPC id. */
  id: string;
  threadId: string;
  turnId: string;
  itemId: string;
  kind: 'command' | 'fileChange' | 'permissions';
  title: string;
  description: string;
  command?: string;
  cwd?: string;
  decisions: CodexApprovalDecision[];
  /** Opaque offers are bound to this exact callback and connection. The
   * corresponding native amendment object remains server-only. */
  decisionOptions?: Array<{ id: CodexApprovalDecision; label: string; description: string }>;
  commandKind?: 'command' | 'writeStdin';
  /** Complete bounded action scopes, already redacted and formatted. */
  detailSections?: Array<{ title: string; items: string[] }>;
  createdAt: string;
}
export interface CodexQuestionRequest {
  id: string;
  threadId: string;
  turnId: string;
  itemId: string;
  isBlocking: boolean;
  questions: Array<{ id: string; header: string; question: string; isOther: boolean; isSecret: boolean;
    options: Array<{ label: string; description: string }> | null }>;
}
export interface CodexQueueEntry {
  id: string;
  clientUserMessageId: string;
  prompt: string;
  attachmentNames: string[];
}
export interface CodexGoal {
  threadId: string;
  objective: string;
  status: 'active' | 'paused' | 'blocked' | 'usageLimited' | 'budgetLimited' | 'complete';
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}
export interface CodexTokenBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}
export interface CodexTokenUsage {
  total: CodexTokenBreakdown;
  /** Most recent native context measurement; reportedAt is its observation time and later activity may change it. */
  contextTokens: number | null;
  modelContextWindow: number | null;
  reportedAt: string;
}
export interface CodexThreadState {
  /** Observed native loaded state; omitted only by older presentation fixtures. */
  loaded?: boolean;
  model: string | null;
  reasoningEffort: string | null;
  activeTurnId: string | null;
  /** Last explicit tier accepted for this conversation's submitted work. */
  requestedServiceTier?: string;
  approvals: CodexApproval[];
  questions: CodexQuestionRequest[];
  queue: CodexQueueEntry[];
  queueCursor: string | null;
  goal: CodexGoal | null;
  tokenUsage: CodexTokenUsage | null;
  diff: string | null;
  capabilities: CodexCapabilities;
}
export interface CodexSkill {
  name: string;
  description: string;
  path: string;
  enabled: boolean;
  scope: string;
}
export interface CodexSkillList { skills: CodexSkill[]; errors: Array<{ path: string; message: string }> }
