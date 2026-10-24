/** A named current-turn action. It never writes conversation defaults. */
export type NativeTurnSummaryPreference = 'auto' | 'concise' | 'detailed' | 'none';
export type NativeTurnApprovalsReviewer = 'user' | 'auto_review' | 'guardian_subagent';

export interface NativeTurnModelChoice {
  id: string;
  model: string;
  displayName: string;
  provider?: 'bridge';
  reasoningEfforts: string[];
  serviceTiers: Array<{ id: string; name: string }>;
}

export interface NativeCurrentTurnSettings {
  scope: 'current-turn';
  threadId: string;
  activeTurnId: string | null;
  generation: string;
  /** Readiness for an explicit request; a native acceptance is still required. */
  canRequest: boolean;
  unavailableReason: string | null;
  /** Thread defaults are not current-turn telemetry. No getter reports these values. */
  currentValuesReadable: false;
  models: NativeTurnModelChoice[];
}

export interface NativeCurrentTurnSettingsUpdate {
  expectedTurnId: string;
  expectedGeneration: string;
  model?: string;
  effort?: string;
  summary?: NativeTurnSummaryPreference;
  serviceTier?: string | null;
  approvalsReviewer?: NativeTurnApprovalsReviewer;
}

export interface NativeCurrentTurnSettingsResult {
  scope: 'current-turn';
  threadId: string;
  turnId: string;
  /** The exact status acknowledged by native Codex. */
  status: 'applied' | 'targetUnavailable';
}
