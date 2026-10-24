/** Shared shapes for the Claude Code conversation bridge. */

/** `ultracode` is Claude Code's standing workflow orchestration mode, not a reasoning level. */
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultracode';
export type ClaudePermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'dontAsk' | 'bypassPermissions';
export type ClaudeSettingSource = 'user' | 'project' | 'local';

export const CLAUDE_EFFORTS: readonly ClaudeEffort[] = ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'];
export const CLAUDE_PERMISSION_MODES: readonly { value: ClaudePermissionMode; label: string; description: string }[] = [
  { value: 'default', label: 'Ask permissions', description: 'Ask before edits and commands' },
  { value: 'acceptEdits', label: 'Accept edits', description: 'Edit files freely, ask before commands' },
  { value: 'plan', label: 'Plan mode', description: 'Explore and plan without making changes' },
  { value: 'auto', label: 'Auto mode', description: 'Claude decides which actions are safe to run' },
  { value: 'dontAsk', label: "Don't ask", description: 'Deny anything that is not pre-approved' },
  { value: 'bypassPermissions', label: 'Bypass permissions', description: 'Run every tool without asking' },
];
export const isEffort = (value: unknown): value is ClaudeEffort => typeof value === 'string' && (CLAUDE_EFFORTS as readonly string[]).includes(value);
export const isPermissionMode = (value: unknown): value is ClaudePermissionMode => typeof value === 'string' && CLAUDE_PERMISSION_MODES.some(mode => mode.value === value);

export interface ClaudePreferences {
  model: string;
  effort: ClaudeEffort | null;
  thinking: boolean;
  permissionMode: ClaudePermissionMode;
  maxTurns: number | null;
  maxBudgetUsd: number | null;
  fallbackModel: string | null;
  appendSystemPrompt: string;
  outputStyle: string | null;
  additionalDirectories: string[];
  allowedTools: string[];
  disallowedTools: string[];
  settingSources: ClaudeSettingSource[];
  mcpServers: Record<string, Record<string, unknown>>;
  fileCheckpointing: boolean;
}

export interface ClaudeAttachment { id: string; name: string; mediaType: string; size: number; kind: 'image' | 'pdf' | 'text' }

export interface ClaudeTodo { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }

export type ClaudeEntry =
  | { kind: 'user'; id: string; at: string; text: string; attachments?: ClaudeAttachment[]; uuid?: string; command?: boolean; /** Sent while Claude was working; it joined that turn. */ steered?: boolean }
  | { kind: 'assistant'; id: string; at: string; text: string; uuid?: string; parentToolUseId?: string | null; streaming?: boolean }
  | { kind: 'thinking'; id: string; at: string; text: string; parentToolUseId?: string | null; streaming?: boolean; redacted?: boolean }
  | { kind: 'tool'; id: string; at: string; name: string; input: Record<string, unknown>; status: 'pending' | 'awaiting' | 'running' | 'success' | 'error' | 'denied';
    result?: string; resultTruncated?: boolean; parentToolUseId?: string | null; finishedAt?: string; elapsedSeconds?: number; progress?: string; uuid?: string;
    /** Images the tool returned, such as a screenshot Claude read. */
    images?: ClaudeAttachment[] }
  | { kind: 'system'; id: string; at: string; text: string; level: 'info' | 'warning' | 'error' }
  | { kind: 'turn'; id: string; at: string; durationMs: number; costUsd: number; numTurns: number; inputTokens: number; outputTokens: number; ok: boolean; stopReason?: string | null };

export interface ClaudeUsage { contextTokens: number; contextWindow: number | null; totalCostUsd: number; inputTokens: number; outputTokens: number }
export interface ClaudeQueuedMessage { id: string; text: string; attachments?: ClaudeAttachment[]; at: string }

export interface ClaudeConversation {
  version: 2;
  id: string; workspaceId: string; title: string; titleSet?: boolean;
  model: string; effort: ClaudeEffort | null; thinking: boolean; permissionMode: ClaudePermissionMode;
  sessionId?: string; resumeAt?: string;
  createdAt: string; updatedAt: string;
  entries: ClaudeEntry[];
  error?: string; pinned?: boolean; archivedAt?: string | null;
  todos?: ClaudeTodo[]; usage?: ClaudeUsage; queue?: ClaudeQueuedMessage[];
  forkedFrom?: { id: string; title: string } | null; importedFrom?: 'claude-code' | null;
  /** The condition set with /goal; Claude keeps working until it is met. */
  goal?: ClaudeGoal | null;
}
export interface ClaudeGoal { condition: string; iterations: number; lastReason?: string; setAt: string }

export interface ClaudeConversationSummary {
  id: string; workspaceId: string; title: string; model: string; createdAt: string; updatedAt: string; error?: string;
  pinned?: boolean; archivedAt?: string | null; running: boolean; awaiting?: boolean; preview: string; messageCount: number;
  permissionMode: ClaudePermissionMode; forkedFrom?: { id: string; title: string } | null;
}

export type ClaudeLiveStatus = 'idle' | 'starting' | 'requesting' | 'responding' | 'thinking' | 'tool' | 'awaiting' | 'compacting' | 'retrying' | 'stopping';

export interface ClaudePermissionRequest {
  id: string; conversationId: string; toolUseId?: string; tool: string; input: Record<string, unknown>;
  kind: 'tool' | 'question' | 'plan';
  title?: string; description?: string; decisionReason?: string; blockedPath?: string;
  canAlwaysAllow: boolean; alwaysAllowLabel?: string; agentId?: string;
}

export interface ClaudeLiveState { running: boolean; status: ClaudeLiveStatus; detail?: string; startedAt?: string }

export type ClaudeStreamEvent =
  | { type: 'snapshot'; conversation: ClaudeConversation; live: ClaudeLiveState; permissions: ClaudePermissionRequest[] }
  | { type: 'entry'; entry: ClaudeEntry }
  | { type: 'remove'; id: string }
  | { type: 'delta'; id: string; text: string }
  | { type: 'live'; live: ClaudeLiveState }
  | { type: 'meta'; patch: Partial<Pick<ClaudeConversation, 'title' | 'model' | 'effort' | 'thinking' | 'permissionMode' | 'todos' | 'usage' | 'queue' | 'sessionId' | 'error' | 'pinned' | 'archivedAt' | 'updatedAt' | 'goal'>> }
  | { type: 'permission'; request: ClaudePermissionRequest }
  | { type: 'permission_resolved'; id: string }
  | { type: 'done'; error?: string };

export interface ClaudeCommand { name: string; description: string; argumentHint?: string; builtin?: boolean }
export interface ClaudeAgentInfo { name: string; description: string; model?: string }
export interface ClaudeModelOption { id: string; label: string; description?: string; tag?: string; efforts?: ClaudeEffort[]; supportsThinking?: boolean }
export interface ClaudeMcpStatus { name: string; status: string; error?: string; tools?: number; scope?: string }
export interface ClaudeCapabilities {
  commands: ClaudeCommand[]; agents: ClaudeAgentInfo[]; outputStyles: string[]; outputStyle?: string;
  mcpServers: ClaudeMcpStatus[]; version?: string; tools?: string[]; skills?: string[]; loadedAt: string; error?: string;
}
export type ClaudeSkillScope = 'project' | 'user';
export interface ClaudeSkill { name: string; scope: ClaudeSkillScope; description: string; path: string; content?: string }
export interface ClaudeNativeSession { sessionId: string; title: string; firstPrompt?: string; lastModified: string; gitBranch?: string; size?: number }
