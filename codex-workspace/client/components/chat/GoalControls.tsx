import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, Check, LoaderCircle, MoreHorizontal, Pause, Play, Target, Trash2 } from 'lucide-react';
import type { CodexGoal } from '../../../shared/codex-cli';
import type { ThreadStatus } from '../../../shared/types';
import { api, json } from '../../api';
import Modal from '../Modal';
import { DropdownMenu } from '../ui/Dropdown';
import './goals.css';

export type GoalChangeBaseline = CodexGoal | null | undefined;
export interface GoalControlsProps {
  threadId: string | null; goal: CodexGoal | null | undefined; ensureThread: () => Promise<string>;
  onGoalChange: (goal: CodexGoal | null, threadId: string, baseline?: GoalChangeBaseline) => void;
  createOpen: boolean; onCreateOpenChange: (open: boolean) => void; disabled?: boolean; threadStatus?: ThreadStatus;
}
const labels: Record<CodexGoal['status'], string> = { active: 'Active', paused: 'Paused', blocked: 'Blocked', usageLimited: 'Usage limit', budgetLimited: 'Token budget reached', complete: 'Completed' };
const format = (value: number) => Number.isFinite(value) ? value.toLocaleString() : 'Not reported';
function parsedBudget(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const amount = Number(value);
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(amount) || amount <= 0) throw new Error('Enter a positive whole-number token budget.');
  return amount;
}
function validGoal(goal: CodexGoal | null, threadId: string): boolean {
  return goal === null || !!goal && goal.threadId === threadId && typeof goal.objective === 'string'
    && Object.hasOwn(labels, goal.status) && (goal.tokenBudget === null || Number.isSafeInteger(goal.tokenBudget) && goal.tokenBudget >= 0)
    && Number.isFinite(goal.tokensUsed) && goal.tokensUsed >= 0 && Number.isFinite(goal.updatedAt);
}
type Action = 'create' | 'pause' | 'resume' | 'clear' | 'edit';
type Dialog = 'details' | 'resume' | 'edit' | 'clear' | null;
export function GoalControls({ threadId, goal, ensureThread, onGoalChange, createOpen, onCreateOpenChange, disabled = false, threadStatus }: GoalControlsProps) {
  const uid = useId();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [objective, setObjective] = useState('');
  const [budget, setBudget] = useState('');
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const operation = useRef<{ action: Action; threadId: string | null; controller: AbortController } | null>(null);
  const alive = useRef(true), previousThread = useRef(threadId);
  const latest = useRef({ threadId, goal, disabled, ensureThread, onGoalChange, onCreateOpenChange });
  latest.current = { threadId, goal, disabled, ensureThread, onGoalChange, onCreateOpenChange };
  useEffect(() => { alive.current = true; return () => { alive.current = false; operation.current?.controller.abort(); }; }, []);
  useEffect(() => {
    const previous = previousThread.current; previousThread.current = threadId;
    if (previous === threadId || operation.current?.action === 'create' && previous === null) return;
    operation.current?.controller.abort(); operation.current = null;
    setPending(null); setDialog(null); setObjective(''); setBudget(''); setError(null); setNotice('');
    latest.current.onCreateOpenChange(false);
  }, [threadId]);
  useEffect(() => {
    if (!disabled) return;
    if (document.body.dataset.workspaceLocked === 'true') { operation.current?.controller.abort(); setDialog(null); onCreateOpenChange(false); }
  }, [disabled, onCreateOpenChange]);
  const active = ['running', 'awaiting_approval', 'awaiting_input', 'compacting'].includes(threadStatus ?? 'idle');
  function close() { if (!pending) { setDialog(null); setError(null); setBudget(''); onCreateOpenChange(false); } }
  async function mutate(action: Action, changes: Record<string, unknown> = {}) {
    if (operation.current || latest.current.disabled || document.body.dataset.workspaceLocked === 'true') return;
    const captured = { action, threadId: latest.current.threadId, controller: new AbortController() };
    const baseline = latest.current.goal;
    operation.current = captured; setPending(action); setError(null); setNotice('');
    try {
      const id = captured.threadId ?? await latest.current.ensureThread();
      captured.threadId = id;
      if (!alive.current || captured.controller.signal.aborted || document.body.dataset.workspaceLocked === 'true'
        || latest.current.threadId !== null && latest.current.threadId !== id) return;
      const route = '/threads/' + encodeURIComponent(id) + '/goal';
      const response = await api<{ goal?: CodexGoal | null; cleared?: boolean }>(route,
        { ...json(action === 'clear' ? 'DELETE' : action === 'create' ? 'POST' : 'PATCH', action === 'clear' ? undefined : changes), signal: captured.controller.signal });
      if (!alive.current || captured.controller.signal.aborted || latest.current.threadId !== id) return;
      if (action === 'clear' && response?.cleared !== true) {
        // A negative/unknown mutation acknowledgment is not a cleared goal.
        // A separate read may update presentation, but never replays the clear.
        const refreshed = await api<{ goal: CodexGoal | null }>(route, { signal: captured.controller.signal });
        if (!alive.current || captured.controller.signal.aborted || latest.current.threadId !== id) return;
        if (!Object.hasOwn(refreshed, 'goal') || !validGoal(refreshed.goal, id)) throw new Error('The current goal could not be read. Refresh this conversation before trying again.');
        latest.current.onGoalChange(refreshed.goal, id, baseline);
        setError('Codex did not confirm clearing the goal. Its current state has been refreshed.');
        return;
      }
      const updated = action === 'clear' ? null : response?.goal;
      if (updated === undefined || !validGoal(updated, id) || action !== 'clear' && !updated) {
        throw new Error('The goal update was not confirmed. Refresh the conversation before trying again.');
      }
      latest.current.onGoalChange(updated, id, baseline);
      setNotice(updated ? 'Goal ' + labels[updated.status].toLowerCase() + '.' : 'The captured goal was cleared.');
      setDialog(null); latest.current.onCreateOpenChange(false); setObjective(''); setBudget('');
    } catch (failure) {
      if (alive.current && !captured.controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'The goal request could not be confirmed.');
    } finally { if (operation.current === captured) { operation.current = null; if (alive.current) setPending(null); } }
  }
  function create(event: FormEvent) {
    event.preventDefault();
    try {
      const text = objective.trim(); if (!text || Array.from(text).length > 4000) throw new Error('Enter an objective of up to 4,000 characters.');
      const tokenBudget = parsedBudget(budget);
      void mutate('create', { objective: text, status: 'active', ...(tokenBudget === undefined ? {} : { tokenBudget }) });
    } catch (failure) { setError((failure as Error).message); }
  }
  function resume(event: FormEvent) {
    event.preventDefault();
    try {
      const tokenBudget = parsedBudget(budget);
      // Empty/null does not clear a native budget. Omission keeps it unchanged.
      void mutate('resume', { status: 'active', ...(tokenBudget === undefined ? {} : { tokenBudget }) });
    } catch (failure) { setError((failure as Error).message); }
  }
  function edit(event: FormEvent) {
    event.preventDefault();
    try {
      const text = objective.trim(); if (!text || Array.from(text).length > 4000) throw new Error('Enter an objective of up to 4,000 characters.');
      const tokenBudget = parsedBudget(budget);
      void mutate('edit', { objective: text, ...(tokenBudget === undefined ? {} : { tokenBudget }) });
    } catch (failure) { setError((failure as Error).message); }
  }
  const busy = disabled || !!pending;
  return <>
    {goal && <section className="goal-controls goal-strip" aria-label="Conversation goal">
      <button type="button" className="goal-summary" aria-label="View goal details" onClick={() => { setDialog('details'); setError(null); }} disabled={disabled}>
        <Target size={16} /><span className="goal-summary-copy"><strong className="goal-summary-objective">{goal.objective}</strong><small>{labels[goal.status]} · {format(goal.tokensUsed)}{goal.tokenBudget === null ? '' : ' / ' + format(goal.tokenBudget)} tokens</small></span>
      </button>
      <div className="goal-strip-actions">{goal.status === 'active' ? <button type="button" className="button ghost" disabled={busy} onClick={() => void mutate('pause', { status: 'paused' })}><Pause size={13} />Pause</button>
        : goal.status !== 'complete' && <button type="button" className="button ghost" disabled={busy || active} onClick={() => { setDialog('resume'); setBudget(''); setError(null); }}><Play size={13} />Resume</button>}
        <DropdownMenu align="end" aria-label="Goal actions" trigger={<button type="button" className="icon-button" aria-label="Goal actions" disabled={busy}><MoreHorizontal size={16} /></button>}
          items={[{ id: 'details', label: 'Goal details', onSelect: () => setDialog('details') },
            { id: 'edit', label: 'Edit goal', onSelect: () => { setObjective(goal.objective); setBudget(''); setError(null); setDialog('edit'); }, disabled: busy },
            { id: 'clear', label: 'Clear goal', icon: <Trash2 size={13} />, onSelect: () => { setError(null); setDialog('clear'); }, disabled: busy }]} />
      </div>
    </section>}
    {notice && <p className="chat-sr-only" role="status">{notice}</p>}
    {error && !createOpen && !dialog && <p className="chat-control-dialog-error" role="alert"><AlertCircle size={14} />{error}</p>}
    <Modal open={createOpen} onClose={close} title="Create goal" titleId={uid + '-create'} description="An active goal lets Codex continue working across turns." className="goal-dialog">
      <form onSubmit={create}><div className="chat-control-dialog-body">
        <label className="field"><span>Objective</span><textarea className="input" aria-label="Objective" rows={4} maxLength={4000} value={objective} onChange={event => setObjective(event.target.value)} disabled={busy} /></label>
        <label className="field"><span>Token budget (optional)</span><input className="input" inputMode="numeric" aria-label="Token budget" value={budget} onChange={event => setBudget(event.target.value)} disabled={busy} /></label>
        <p>Creating an active goal can start Codex work in this conversation.</p>
        {error && <p role="alert" className="chat-control-dialog-error">{error}</p>}
      </div><div className="modal-footer"><button type="button" className="button ghost" disabled={!!pending} onClick={close}>Cancel</button>
        <button type="submit" className="button primary" disabled={busy || active || !objective.trim()}>{pending ? <LoaderCircle size={14} className="chat-spin" /> : <Target size={14} />}Create goal</button></div></form>
    </Modal>
    <Modal open={!!dialog} onClose={close} title={dialog === 'clear' ? 'Clear goal?' : dialog === 'resume' ? 'Resume goal' : dialog === 'edit' ? 'Edit goal' : 'Goal details'} titleId={uid + '-details'} className="goal-dialog">
      {dialog === 'edit' ? <form onSubmit={edit}><div className="chat-control-dialog-body">
        <label className="field"><span>Objective</span><textarea className="input" aria-label="Objective" rows={4} maxLength={4000} value={objective} onChange={event => setObjective(event.target.value)} disabled={busy} /></label>
        <label className="field"><span>New token budget (optional)</span><input className="input" inputMode="numeric" aria-label="New token budget" value={budget} onChange={event => setBudget(event.target.value)} disabled={busy} /></label>
        <p>Leave the budget blank to keep it unchanged. Updating an active goal can continue Codex work.</p>
        {error && <p role="alert" className="chat-control-dialog-error">{error}</p>}
      </div><div className="modal-footer"><button type="button" className="button ghost" disabled={!!pending} onClick={close}>Cancel</button><button type="submit" className="button primary" disabled={busy || !objective.trim()}>Save goal</button></div></form>
        : dialog === 'resume' ? <form onSubmit={resume}><div className="chat-control-dialog-body"><p>{goal?.objective}</p>
        <label className="field"><span>New token budget (optional)</span><input className="input" inputMode="numeric" aria-label="New token budget" value={budget} onChange={event => setBudget(event.target.value)} disabled={busy} /></label>
        <p>Leave this blank to keep the current budget. Resuming can start native Codex work.</p>
        {error && <p role="alert" className="chat-control-dialog-error">{error}</p>}
      </div><div className="modal-footer"><button type="button" className="button ghost" disabled={!!pending} onClick={close}>Cancel</button><button type="submit" className="button primary" disabled={busy || active}><Play size={14} />Resume goal</button></div></form>
        : <><div className="chat-control-dialog-body"><p>{goal?.objective}</p>
          {dialog === 'details' && goal && <dl className="goal-details"><div><dt>Status</dt><dd>{labels[goal.status]}</dd></div><div><dt>Tokens used</dt><dd>{format(goal.tokensUsed)}</dd></div><div><dt>Token budget</dt><dd>{goal.tokenBudget === null ? 'No token budget' : format(goal.tokenBudget)}</dd></div><div><dt>Time used</dt><dd>{format(goal.timeUsedSeconds)} seconds</dd></div></dl>}
          {dialog === 'clear' && <p>Clear the saved goal from this conversation.</p>}
          {error && <p role="alert" className="chat-control-dialog-error">{error}</p>}
        </div><div className="modal-footer"><button type="button" className="button ghost" disabled={!!pending} onClick={close}>{dialog === 'clear' ? 'Cancel' : 'Close'}</button>
          {dialog === 'clear' && <button type="button" className="button primary" disabled={busy} onClick={() => void mutate('clear')}>{pending ? <LoaderCircle size={14} className="chat-spin" /> : <Check size={14} />}Clear goal</button>}
        </div></>}
    </Modal>
  </>;
}
