import type { ToolRow } from './tool-presentation';

export type PlanStep = ToolRow & { status: 'pending' | 'in_progress' | 'completed' };
export function planProgress(rows: readonly ToolRow[], omitted = 0) {
  const steps = rows.filter((row): row is PlanStep => row.status === 'pending' || row.status === 'in_progress' || row.status === 'completed');
  const completed = steps.filter(step => step.status === 'completed').length;
  const missing = Number.isSafeInteger(omitted) && omitted > 0 ? omitted : 0;
  return { steps, completed, total: steps.length, omitted: missing,
    label: `${completed} of ${steps.length}${missing ? ' shown' : ''} steps completed` };
}
