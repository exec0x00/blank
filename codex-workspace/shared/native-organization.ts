/** Bounded presentation of native Codex organization. These records retain
 * native identities; they do not create site projects or thread history. */
export interface NativeProject {
  id: string;
  name: string;
  roots: Array<{ path: string }>;
  metadata: Record<string, string | undefined>;
  position: number;
  createdAt: number;
  updatedAt: number;
  recencyAt: number | null;
}

export interface NativeWorkspaceProject {
  project: NativeProject;
  /** Display/input paths relative to the selected, authorized workspace. */
  workspaceRoots: string[];
  revision: string;
}

export interface NativeProjectPage {
  data: NativeWorkspaceProject[];
  nextCursor: string | null;
  /** Native projects on this page whose roots belong to a different scope. */
  filteredCount: number;
}

export interface NativeThreadSection {
  id: string;
  name: string;
  appearance: { icon: string | null; color: string | null } | null;
}

export interface NativeThreadSectionPage {
  data: NativeThreadSection[];
  nextCursor: string | null;
  scope: 'all-native-workspaces';
}

export interface NativeThreadOrganization {
  threadId: string;
  projectId: string | null;
  section: NativeThreadSection | null;
  gitInfo: { sha: string | null; branch: string | null; originUrl: string | null } | null;
  daybreakEnabled: boolean | null;
  /** The protocol can set a memory mode but does not return it on thread/read. */
  memoryModeReadable: false;
  revision: string;
}

export interface NativeMemoryStatus {
  v2ConsolidatedThreads: number;
  v2Ready: boolean;
  minConsolidatedThreads: number;
  scope: 'all-native-workspaces';
  activeTurns: number;
}

export interface NativeOrganizationQueueEntry {
  id: string;
  clientUserMessageId: string;
  prompt: string;
  attachmentNames: string[];
  revision: string;
  editable: boolean;
  editUnavailableReason?: string;
}

export interface NativeOrganizationQueuePage {
  items: NativeOrganizationQueueEntry[];
  /** Original native page cursor; edits retain it to recheck this bounded window. */
  cursor: string | null;
  nextCursor: string | null;
  /** A server revision for this exact, complete native queue, when bounded. */
  revision: string | null;
}

export interface NativeQueuePromptUpdate {
  prompt: string;
  expectedRevision: string;
  cursor?: string;
}

export interface NativeQueueReorder {
  queuedSubmissionIds: string[];
  expectedRevision: string;
}
