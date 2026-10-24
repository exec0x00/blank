import type { NativeMemoryPipelineStatus } from '../shared/types';

const now = '2026-09-20T10:00:00.000Z';
export function pipelineFixture(overrides: Partial<NativeMemoryPipelineStatus> = {}): NativeMemoryPipelineStatus {
  return { startup: { running: 0, closing: false, reports: [], issues: [] },
    consolidation: { jobs: [], total: 0, truncated: false, issues: [] }, active: { total: 0, items: [] }, issues: [], ...overrides };
}
export function pipelineStartup(workspaceId = 'workspace-one', overrides: Partial<NativeMemoryPipelineStatus['startup']['reports'][number]> = {}): NativeMemoryPipelineStatus['startup']['reports'][number] {
  return { threadId: `thr_${'1'.repeat(32)}`, workspaceId, scope: { kind: 'workspace', workspaceId }, status: 'completed', startedAt: now, completedAt: now,
    directoryEntries: 3, metadataExamined: 3, metadataReads: 3, candidates: 2, sourcesRead: 2, sourceBytes: 120,
    turnsExamined: 2, admitted: 2, alreadyAdmitted: 0, skipped: 0, missingModelMetadata: 0, unsupportedModelOptions: 0,
    hasMore: false, issues: [], ...overrides };
}
export function pipelineJob(index = 0, workspaceId = 'workspace-one', overrides: Partial<NativeMemoryPipelineStatus['consolidation']['jobs'][number]> = {}): NativeMemoryPipelineStatus['consolidation']['jobs'][number] {
  return { id: `mjob_${index.toString(16).padStart(64, '0')}`, workspaceId, scope: { kind: 'workspace', workspaceId }, sourceWorkspaces: [workspaceId], rootThreadId: `thr_${'2'.repeat(32)}`,
    model: 'gpt-5.6-sol', reasoningEffort: 'high', status: 'completed', createdAt: now, startedAt: now, completedAt: now,
    charged: true, fingerprint: 'a'.repeat(64), memoryIds: [`mem_${'3'.repeat(32)}`], artifactPaths: ['memory_summary.md'], ...overrides };
}
