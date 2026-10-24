import { useEffect, useId, useState } from 'react';
import { ArrowUpRight, Check, Circle, CircleDot, ListChecks } from 'lucide-react';
import { RequestDialog } from './RequestDialog';
import { planProgress, type PlanStep } from './plan-presentation';
import type { ToolRow } from './tool-presentation';
import './plan-card.css';

const labels = { completed: 'Completed', in_progress: 'In progress', pending: 'Pending' } as const;
function Steps({ steps }: { steps: readonly PlanStep[] }) {
  return <ol className="native-plan-steps" aria-label="Plan steps">{steps.map((step, index) => <li key={index} className={'is-' + step.status}>
    <span className="native-plan-step-icon" aria-hidden="true">{step.status === 'completed' ? <Check size={15} /> : step.status === 'in_progress' ? <CircleDot size={15} /> : <Circle size={15} />}</span>
    <div><span className="native-plan-step-title">{step.title}</span><small>{labels[step.status]}{step.truncated ? ' · Step text is truncated' : ''}</small></div>
  </li>)}</ol>;
}

/** Progress follows reported native step status. It does not schedule work. */
export function PlanCard({ rows, omitted, explanation, locked = false }: {
  rows: readonly ToolRow[]; omitted?: number; explanation?: string; locked?: boolean;
}) {
  const id = useId(), [open, setOpen] = useState(false);
  const progress = planProgress(rows, omitted);
  useEffect(() => { if (locked) setOpen(false); }, [locked]);
  useEffect(() => {
    const close = () => setOpen(false);
    window.addEventListener('codex:session-locked', close); window.addEventListener('codex:session-expired', close);
    return () => { window.removeEventListener('codex:session-locked', close); window.removeEventListener('codex:session-expired', close); };
  }, []);
  const meter = <div className="native-plan-progress"><span>{progress.label}</span>
    {!!progress.total && <progress value={progress.completed} max={progress.total} aria-label={progress.omitted ? 'Shown plan steps completed' : 'Plan steps completed'} />}
  </div>;
  return <>
    <section className="native-plan" aria-label="Plan progress">
      <div className="native-plan-heading"><span><ListChecks size={16} aria-hidden="true" />Plan</span>
        <button type="button" disabled={locked} onClick={() => { if (document.body.dataset.workspaceLocked !== 'true') setOpen(true); }} aria-haspopup="dialog">Open plan<ArrowUpRight size={14} aria-hidden="true" /></button>
      </div>
      {meter}<Steps steps={progress.steps} />
      {!!progress.omitted && <p className="native-plan-omitted">{progress.omitted} more {progress.omitted === 1 ? 'step is' : 'steps are'} outside this preview.</p>}
      {!progress.steps.length && <p className="native-plan-omitted">No step status has been reported.</p>}
    </section>
    {open && !locked && <RequestDialog open onClose={() => setOpen(false)} title="Plan" titleId={id} description="Steps and progress reported by Codex." className="native-plan-dialog">
      <div className="native-request-body">{explanation && <p className="native-plan-explanation">{explanation}</p>}{meter}<Steps steps={progress.steps} />
        {!!progress.omitted && <p className="native-plan-omitted">{progress.omitted} more {progress.omitted === 1 ? 'step is' : 'steps are'} outside this preview.</p>}
      </div><div className="modal-footer native-request-footer"><button type="button" className="button ghost" onClick={() => setOpen(false)}>Close</button></div>
    </RequestDialog>}
  </>;
}
