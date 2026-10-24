import type { ClaudePreferences } from './claude';
import type { ModelRequestSnapshot } from './legacy-types';
import type { CodexThreadState, CodexNativeView } from './codex-cli';
export interface Thread { backend?: 'claude-code' | 'codex-cli' | 'legacy'; readOnly?: boolean; native?: CodexThreadState; nativeView?: CodexNativeView }
export interface ThreadSummary { backend?: 'claude-code' | 'codex-cli' | 'legacy'; readOnly?: boolean }
export interface ChatMessage { clientUserMessageId?: string; nativePhase?: 'commentary' | 'final_answer' }
import type { ReasoningSummaryLevel, ModelVerbosity } from './legacy-types';
import type { GeneratedImageMetadata } from './legacy-types';
export type { GeneratedImageMetadata, GeneratedImageReference } from './legacy-types';
export type { GeneratedImageSave } from './legacy-types';
export type { NativeMemoryPipelineStatus, NativeMemoryPipelineActivity, NativeMemoryPipelineStatusInput } from './legacy-types';
export type { NativeMemoryArtifactKind, NativeMemoryArtifactDescriptor, NativeMemoryArtifactPage, NativeMemoryArtifactContent } from './legacy-types';
export type { ModelProfile, ModelProfileFields, ModelProfilePage, ModelRegistrySnapshot, ModelSpecification, ManagedReasoningEffort, ReasoningSummaryLevel, ModelVerbosity } from './legacy-types';
export type { ModelRequestOptions, ModelRequestSnapshot } from './legacy-types';
export type { ThreadContextDetails, ThreadContextUsageRow, ThreadContextUsageTotals, ThreadContextDetailsInput } from './legacy-types';
export type { InputSubmission, InputDelivery, InputQueueState, InputHoldReason } from './legacy-types';
export type { ModelProbeRequest, ModelProbeConfiguration, ModelProbeOutcome, ModelProbeCategory, ModelProbeResult, ModelProbeHistory } from './legacy-types';
export type { FileRewindPreviewInput, FileRewindSelection, ThreadRewindOptions, FileRewindPreviewRow, FileRewindPreview, ThreadRewindComplete, ThreadRewindRecoveryRequired, ThreadRewindPending, ThreadRewindResult, ThreadRewindRecoveryStatus, FileRewindRecoveryRow, FileRewindRecoveryReview, WorkspaceRewindRecovery, FileRewindRecoveryQuery, FileRewindKeepCurrentInput, FileRewindKeepCurrentResult } from './legacy-types';
export type { FileRewindRecoveryRead } from './legacy-types';

export interface Workspace { id: string; name: string; path: string; createdAt: string; updatedAt: string; githubAccountId?: string; source?: { kind: 'github'; fullName: string }; worktree?: WorkspaceWorktree }
export interface WorkspacePage { workspaces: Workspace[]; nextCursor: string | null; previousCursor: string | null; offset: number; total?: number; revision?: string; selected?: Workspace }
export interface FileEntry { name: string; path: string; kind: 'file' | 'directory'; size?: number; modifiedAt?: string; isSymlink?: boolean }
export type { DirectoryPage } from './legacy-types';
export interface FileContent { path: string; content: string; version: string; language: string; size: number }
export type { WorkspaceFileInfo, WorkspaceFilePage, WorkspaceFileSearchResult, WorkspaceFileSearchMatch, WorkspaceFileRecovery } from './legacy-types';
export interface FileTrashStatus { issue: string | null }
export type { FileTrashPage } from './legacy-types';
export interface SearchMatch { path: string; line: number; column: number; text: string }
export interface GitFile { path: string; status: string; staged: boolean; originalPath?: string }
export interface GitStatus { isRepository: boolean; branch: string; ahead: number; behind: number; files: GitFile[]; remote?: string; branches: string[] }
export type { GitStatusSummary, GitFilePage, GitBranchPage } from './legacy-types';
export interface GitDiff { path: string; patch: string; original: string; modified: string; binary?: boolean }
export interface GithubAccount { id: string; login: string; name: string; avatarUrl: string; createdAt: string }
export interface GithubRepo { id: number; name: string; fullName: string; description: string; private: boolean; defaultBranch: string; updatedAt: string; url: string }
export type { GithubAccountPage, GithubRepoPage } from './legacy-types';
export type { GithubImportRecovery } from './legacy-types';
export interface AppSettings { model: string; reasoningEffort: string|null; reasoningSummary?: ReasoningSummaryLevel|'none'|null; verbosity?: ModelVerbosity|null; maxOutputTokens?: number|null; webSearchMode?: 'disabled'|'cached'|'indexed'|'live'; fastMode?: boolean; serviceTier?: string|null; maxConcurrentAgents?: number|null; modelContextWindow?: number|null; autoCompactTokenLimit?: number|null; nativeConfigVersion?: string; autoApprove: boolean; theme: 'dark'; fontSize: number; wordWrap: boolean; provider: 'openai' | 'anthropic'; apiKeyConfigured: boolean; chatgptConnected?: boolean; authMethod?: 'api-key'|'chatgpt'; agentConfigured?: boolean; claude?: ClaudePreferences }
export type PermissionMode = 'ask' | 'full-access';
export type ThreadStatus = 'idle'|'running'|'awaiting_approval'|'awaiting_input'|'compacting'|'error'|'interrupted';
export interface UserInputOption { label: string; description: string }
export interface UserInputQuestion { id: string; header: string; question: string; options: UserInputOption[]; isOther: true }
export interface PendingQuestionRequest { id: string; threadId: string; callId: string; createdAt: string; questions: UserInputQuestion[] }
export type UserInputRequest = PendingQuestionRequest;
export interface UserInputResponse { answers: Record<string, { answers: string[] }> }
export interface ToolActivity { id: string; name: string; input: string; output?: string; inputTruncated?: boolean; outputTruncated?: boolean; inputChars?: number; outputChars?: number; generatedImage?: GeneratedImageMetadata; status: 'running'|'completed'|'error'|'awaiting_approval'|'awaiting_input'; startedAt: string; completedAt?: string }
export interface ReasoningSummarySegment { id: string; summaryIndex: number; text: string; status: 'streaming'|'complete'; truncated?: boolean }
/** Persisted public presentation order; sequence numbers are never reused. */
export interface ConversationTimeline { version: 1; revision: number; nextSequence: number; entries: ConversationTimelineEntry[] }
export type ConversationTimelineEntry = { id: string; sequence: number; revision: number; messageId: string; textTruncated?: boolean; textChars?: number; legacyOrder?: boolean } & (
  | { kind: 'message' }
  | { kind: 'legacy' }
  | { kind: 'text'; text: string; startOffset: number; revised?: boolean }
  | { kind: 'reasoning'; summaryId: string; text: string; status: 'streaming'|'complete'; truncated?: boolean; revised?: boolean }
  | { kind: 'activity'; activityId: string }
);
export interface ChatMessage { id: string; role: 'user'|'assistant'|'system'; content: string; contentTruncated?: boolean; contentChars?: number; ordinal?: number; createdAt: string; activities?: ToolActivity[]; turnId?: string; attachments?: ImageAttachment[]; fileAttachments?: FileAttachment[]; review?: ReviewResult; reviewId?: string; reasoningSummary?: ReasoningSummarySegment[]; citations?: WebCitation[]; citationsTruncated?: boolean; citationsCount?: number }
export interface QueuedThreadInput { id: string; prompt: string; promptTruncated?: boolean; promptChars?: number; createdAt: string; attachments?: ImageAttachment[]; fileAttachments?: FileAttachment[]; delivery?: 'steer'|'next_turn'; state?: 'pending'|'delivering'|'held'; cancellable?: boolean; holdReason?: 'restart'|'turn_stopped'|'turn_failed'|'admission_failed'|'storage_error'|'history_changed'|'budget_limited'; model?: string; acceptedAt?: string }
export interface ThreadTurn { id: string; userMessageId: string; startedAt: string; completedAt?: string; status: 'running'|'completed'|'interrupted'|'error'; messageIds: string[]; ordinal?: number; firstSequence?: number; lastSequence?: number; purpose?: 'conversation'|'review'|'goal'; model?: string; reasoningEffort?: AppSettings['reasoningEffort']; modelRequest?: ModelRequestSnapshot; /** Server-authored exclusion for genuine memory directives, including withheld or denied ones. */ memoryCaptureExcluded?: true }
/** Bounded public presentation metadata; saved and model-facing history remains complete. */
export interface ConversationHistoryWindow {
  version: 1;
  epoch: string;
  revision: number;
  totalMessages: number;
  oldestSequence: number | null;
  newestSequence: number | null;
  latestSequence: number;
  olderCursor: string | null;
  newerCursor: string | null;
  hasOlder: boolean;
  hasNewer: boolean;
}
export interface ConversationHistoryDetail {
  threadId: string;
  epoch: string;
  revision: number;
  version: string;
  text: string;
  totalChars: number;
  offset: number;
  previousOffset: number | null;
  nextOffset: number | null;
  presentation?: ConversationHistoryDetailPresentation;
}
export interface ConversationHistoryDetailPresentation {
  label: string;
  kind: 'text' | 'code' | 'path';
  language?: 'shell' | 'diff';
  path?: string;
  partId: string;
  parts: Array<{ id: string; label: string }>;
  notices?: string[];
}
export type ThreadHistoryDetailPage = ConversationHistoryDetail;
/** Token fields are copied from provider usage. Missing values remain unknown. */
export interface ProviderTokenUsage { requests: number; inputTokens?: number; outputTokens?: number; totalTokens?: number; cachedInputTokens?: number; cacheWriteInputTokens?: number; reasoningOutputTokens?: number }
export interface ThreadTokenUsage { total: ProviderTokenUsage; last?: ProviderTokenUsage; trackingStartedAt: string; incomplete: boolean }
/** Approximate input accounting; deliberately separate from exact reported usage. */
export interface ContextUsage {
  estimatedChars: number;
  estimatedTokens: number;
  wireBytes: number;
  images: number;
  imageBytes: number;
  modelContextWindow: number|null;
  contextTokens?: number;
  tokenSource?: 'provider'|'provider+estimate'|'estimate';
  effectiveContextWindow?: number|null;
  safetyReserveTokens?: number|null;
  autoCompactThreshold?: number;
  autoCompactTokenLimit?: number|null;
  overheadEstimatedTokens?: number;
  contextModel?: string;
  modelProfileId?: string;
  modelProfileRevision?: number;
  contextWindowSource?: 'official'|'user'|'unknown';
  contextSpecification?: { url: string; verifiedAt: string };
  updatedAt: string;
}
export interface ThreadCompaction { id: string; status: 'running'|'completed'|'error'|'cancelled'; trigger?: 'auto'|'manual'; reason?: 'threshold'|'request-capacity'|'wire-limit'|'image-limit'|'item-limit'|'manual'; strategy?: 'semantic'; startedAt: string; completedAt?: string; summary?: string; error?: string; before?: ContextUsage; after?: ContextUsage }
export interface ThreadReview { id: string; target: ReviewTarget; label: string; status: 'running'|'completed'|'invalid'|'error'|'cancelled'; startedAt: string; completedAt?: string; messageId?: string; result?: ReviewResult; error?: string; snapshot?: { createdAt: string; fingerprint: string; head: string|null; base: string|null; commit: string|null } }
export interface Thread { id: string; workspaceId: string; title: string; createdAt: string; updatedAt: string; status: ThreadStatus; messages: ChatMessage[]; timeline?: ConversationTimeline; history?: ConversationHistoryWindow; queuedInput?: QueuedThreadInput[]; error?: string; mode?: 'agent'|'plan'; pendingApproval?: ApprovalRequest; pendingQuestion?: PendingQuestionRequest; permissionMode?: PermissionMode; titleSource?: 'placeholder'|'prompt'|'generated'|'manual'; titleRevision?: number; parentThreadId?: string; rootThreadId?: string; taskName?: string; agentRole?: string; agents?: AgentRecord[]; archivedAt?: string; forkedFrom?: { threadId: string; turnId?: string }; turns?: ThreadTurn[]; compaction?: ThreadCompaction; usage?: ThreadTokenUsage; contextUsage?: ContextUsage; goal?: ThreadGoal|null; review?: ThreadReview }
export interface ThreadSummary { id: string; workspaceId: string; title: string; createdAt: string; updatedAt: string; status: ThreadStatus; parentThreadId?: string; rootThreadId?: string; taskName?: string; agentRole?: string; archivedAt?: string; forkedFrom?: { threadId: string; turnId?: string } }
export interface ThreadListPage { items: ThreadSummary[]; olderCursor: string | null; newerCursor: string | null; hasOlder: boolean; hasNewer: boolean; selected?: ThreadSummary }
export interface NativeMemoryApprovalPreview {
  mutation: NativeMemoryNoteMutation;
  targets?: Array<{ id: string; revision: number; scope: NativeMemoryScope; kind: NativeMemoryKind; text: string }>;
}
export interface ApprovalRequest {
  id: string;
  threadId: string;
  tool: string;
  description: string;
  command?: string;
  kind?: 'memory';
  memory?: {
    action: NativeMemoryNoteMutation['action'];
    mutationSha256: string;
    /** Live authenticated presentation only. Never save this in a thread or journal. */
    preview?: NativeMemoryApprovalPreview;
  };
}
export interface ChangeRecord { id: string; workspaceId: string; threadId: string; path: string; original: string|null; modified: string|null; status: 'pending'|'kept'|'undone'; createdAt: string }
export type { ChangeSideMetadata, ChangeSummary, ChangeReviewSummary, ChangePage, ChangeTextPage, ChangeDetailPage, ChangeResolveSelection, ChangeResolveResult, ChangeInvalidation } from './legacy-types';
export interface AgentRecord { id: string; parentThreadId: string; rootThreadId: string; workspaceId: string; taskName: string; path: string; role: string; depth: number; status: 'idle'|'starting'|'running'|'waiting'|'awaiting_approval'|'awaiting_input'|'compacting'|'completed'|'interrupted'|'error'|'closed'; model: string; reasoningEffort: AppSettings['reasoningEffort']; mode: 'agent'|'plan'; autoApprove: boolean; permissionMode?: PermissionMode; waitingFor?: string[]; createdAt: string; updatedAt: string; runId?: string; finalMessage?: string; finalMessageTruncated?: boolean; error?: string; closedAt?: string; capabilities?: {shellTool:boolean;plugins:boolean}; roleDescription?: string; roleSource?: AgentRoleSource; roleDefinitionVersion?: string; nickname?: string }
export interface AgentEvent { type: 'snapshot'|'message'|'delta'|'reasoning_summary'|'activity'|'timeline'|'status'|'approval'|'question'|'agent_change'|'changes'|'compaction'|'usage'|'goal'|'review'|'error'|'done'; threadId: string; historyEpoch?: string; historyRevision?: number; historyCursor?: string; [key: string]: unknown }
export interface TerminalSession { id: string; workspaceId: string; title: string; createdAt: string; pid: number; exited?: boolean }
export type { TerminalReplayState } from './terminal-replay';
export interface StorageStatus { path: string; persistent: boolean; bucket: string; writable: boolean }
export interface Bootstrap { workspaces: Workspace[]; activeWorkspaceId: string|null; activeWorkspace?: Workspace|null; workspacePage?: Omit<WorkspacePage, 'workspaces'|'selected'>; settings: AppSettings; githubAccounts: GithubAccount[]; githubAccountPage?: Omit<GithubAccountPage, 'accounts'|'selected'>; storage: StorageStatus; uiState?: UiState }

export type { ExtensionsCatalog, SkillSummary, SkillDocument, SkillResource, ResourceDocument, ExtensionSource, ExtensionScope, NpmExtensionSource, NpmSourceProvenance, PluginSummary, PluginMutationResult, SkillMutationResult, MarketplaceSummary, MarketplaceEntry, ExtensionPageInfo, ExtensionDiscoveryPage, SkillCatalogPage, PluginCatalogPage, MarketplacePageGroup, MarketplaceCatalogPage } from './legacy-types';
export type { DownloadJob, DownloadJobState, DownloadServiceStatus, DownloadIssue, DownloadSourceIdentity } from './legacy-types';
export type { UploadJob, UploadJobState, UploadIssue, UploadCapability, UploadServiceStatus } from './legacy-types';
export type { WorkspaceTrashEntry, WorkspaceDeleteResult, WorkspaceTrashDeleteResult, WorkspaceDeletionPlan, WorkspaceDeletionStatus, WorkspaceTrashPage, WorkspaceDeletionPage } from './legacy-types';
export type { BrowserSessionView, BrowserObservation, BrowserAction, BrowserElement, BrowserTabView } from './legacy-types';
export type { FileTransferStatus, FileTransferPage } from './legacy-types';
export type { FileAttachment, FileAttachmentReference, FileAttachmentUploadJob, FileAttachmentInspection, FileAttachmentUploadStatus } from './legacy-types';
import type { ImageAttachment } from './legacy-types';
import type { GithubAccountPage } from './legacy-types';
import type { FileAttachment } from './legacy-types';
import type { ThreadGoal } from './legacy-types';
import type { ReviewTarget, ReviewResult } from './legacy-types';
import type { AgentRoleSource } from './legacy-types';
import type { NativeMemoryKind, NativeMemoryNoteMutation, NativeMemoryScope } from './legacy-types';
import type { WorkspaceWorktree } from './legacy-types';
import type { WebCitation } from './legacy-types';
export type { WebCitation, WebSearchMode } from './legacy-types';
export type { ImageAttachment, AttachmentReference } from './legacy-types';
export type { ThreadGoal, GoalStatus } from './legacy-types';
export type { ReviewTarget, ReviewFinding, ReviewResult, ReviewSourceContent, ReviewFileRead } from './legacy-types';
export type { WorkspaceWorktree, CreateWorktreeInput, ManagedWorktree, CreatedWorktree, ManagedWorktreePage } from './legacy-types';
export type { NativeMemorySettings, NativeMemoryKind, NativeMemoryScope, NativeMemoryHumanOrigin, NativeMemoryOrigin, NativeMemoryNoteMutation, NativeMemoryNoteOperation, NativeMemoryNoteMutationResult, NativeMemoryEvidence, NativeMemorySource, NativeMemoryRecord, NativeMemoryJobStatus, NativeMemoryJob, NativeMemoryList, NativeMemoryJobList } from './legacy-types';

export type UiLayoutProfile = 'desktop'|'laptop'|'tablet'|'mobile';
export type UiView = 'agent'|'editor'|'terminal'|'git'|'github';
export interface UiLayoutPreferences { view?: UiView; sidebar?: 'expanded'|'collapsed'; split?: 'split'|'focus'; agentWidthRatio?: number; explorerWidth?: number }
export interface UiEditorPreferences { minimap?: boolean; lineNumbers?: boolean; wrap?: boolean|null }
export interface UiTabState { paths: string[]; active: string }
export interface UiWorkspacePreferences { threadId?: string|null; tabs?: UiTabState; serviceTiers?: Record<string,string> }
export interface UiState { version: 1; revision: number; layouts: Partial<Record<UiLayoutProfile,UiLayoutPreferences>>; editor: UiEditorPreferences; workspaces: Record<string,UiWorkspacePreferences>; fieldRevisions: Record<string,number> }
export type UiStateChange = {section:'layout';profile:UiLayoutProfile;key:'view';value:UiView}|{section:'layout';profile:UiLayoutProfile;key:'sidebar';value:'expanded'|'collapsed'}|{section:'layout';profile:UiLayoutProfile;key:'split';value:'split'|'focus'}|{section:'layout';profile:UiLayoutProfile;key:'agentWidthRatio'|'explorerWidth';value:number}|{section:'editor';key:'minimap'|'lineNumbers';value:boolean}|{section:'editor';key:'wrap';value:boolean|null}|{section:'workspace';workspaceId:string;key:'threadId';value:string|null}|{section:'workspace';workspaceId:string;key:'tabs';value:UiTabState}|{section:'workspace';workspaceId:string;key:'serviceTier';threadId:string|null;value:string};
export interface UiStatePatch { revision: number; changes: UiStateChange[]; migration?: boolean }

/** Portable data shapes for retained site tools and historical public summaries. */
export type { ModelItem, FunctionTool, ModelOutputSchema, ReasoningSummaryEvent } from './legacy-types';

export type { NativeItemDetailField, NativeItemDetailRequest, NativeItemDetailPart, NativeItemDetailSearching, NativeItemDetailReady, NativeItemDetailUnavailable, NativeItemDetailNotFound, NativeItemDetail } from './codex-details';
