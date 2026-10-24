import type { ToolActivity } from '../../../shared/types';
import type { HistoryDetailTarget } from './HistoryDetail';
import { formatToolActivity, type ToolViewKind } from './tool-presentation';

const labels: Partial<Record<ToolViewKind, readonly [string, string]>> = {
  command: ['Command', 'Command output'], hook: ['Hook request', 'Hook output'],
  file: ['File request', 'File content'], files: ['File request', 'File list'],
  search: ['Search request', 'Search results'], web: ['Web request', 'Web results'],
  changes: ['Change request', 'Change result'], plan: ['Plan request', 'Plan result'],
  goal: ['Goal request', 'Goal result'], skill: ['Skill request', 'Skill result'],
  agent: ['Agent request', 'Agent result'], question: ['Questions', 'Answers'],
  image: ['Image request', 'Image result'], time: ['Time request', 'Time result'],
};

/** Derived event rows have no ThreadItem to read from native history. */
export function hasNativeItemIdentity(messageId: string): boolean {
  return !/^native-(?:notice|hook|review|plan):/.test(messageId);
}

/** Full inspection uses the same semantic tool classification as its preview. */
export function toolHistoryDetailTarget(base: Pick<HistoryDetailTarget, 'threadId' | 'epoch' | 'messageId'>, activity: ToolActivity, field: 'input' | 'output'): HistoryDetailTarget {
  const view = formatToolActivity(activity);
  const name = activity.name.replace(/^(?:functions|tools)\./, '');
  let label = labels[view.kind]?.[field === 'input' ? 0 : 1] ?? (field === 'input' ? 'Tool request' : 'Tool result');
  if (field === 'input') {
    if (name === 'write_file') label = 'File content';
    else if (name === 'apply_patch') label = 'Patch';
    else if (name === 'write_stdin') label = 'Command input';
  }
  return { ...base, activityId: activity.id, field, label: `Full ${label.toLowerCase()}`, toolLabel: view.label.slice(0, 180) };
}
