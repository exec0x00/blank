import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ClaudeGoal, ClaudeTodo } from '../../../../shared/claude';
import { Check, Chevron, Close, Pause, Play, Target } from './icons';
import { useCustomScroll } from './useCustomScroll';

export type TrayState = 'working' | 'done' | 'stopped';
interface Props {
  show: boolean; state: TrayState; label: string; startedAt?: string; endedAt?: number;
  goal?: ClaudeGoal | null; todos?: ClaudeTodo[] | null; collapseKey: number;
  onPause: () => void; onResume: () => void; onClearGoal: () => void; onDismiss: () => void;
}

const clock = (seconds: number) => seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;

/** Live status attached to the top of the composer; the details open only on click. */
export function StatusTray({ show, state, label, startedAt, endedAt, goal, todos, collapseKey, onPause, onResume, onClearGoal, onDismiss }: Props) {
  const [collapsed, setCollapsed] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const pad = useRef<HTMLDivElement>(null);
  const goalText = useRef<HTMLDivElement>(null);
  useCustomScroll(pad, { right: 4, inset: 6 });
  useCustomScroll(goalText, { right: 2, inset: 0 }, [goal?.condition]);
  useEffect(() => setCollapsed(true), [collapseKey]);
  useEffect(() => {
    if (state !== 'working') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state]);
  const started = startedAt ? new Date(startedAt).getTime() : now;
  const seconds = Math.max(state === 'working' ? 0 : 1, Math.round(((state === 'working' ? now : endedAt ?? now) - started) / 1000));
  const steps = todos?.length ? todos : null;
  const done = steps?.filter(step => step.status === 'completed').length ?? 0;
  const goalLabel = state === 'stopped' ? 'Goal paused' : state === 'done' ? 'Goal' : 'Pursuing goal';
  const toggle = () => setCollapsed(value => !value);

  return <div className={`qc-tray${show ? ' show' : ''}${collapsed ? ' collapsed' : ''}`} data-s={state} aria-live="polite">
    <div className="qc-tray-in"><div className="qc-tray-card">
      <div className="qc-tray-head" role="button" tabIndex={0} aria-expanded={!collapsed} onClick={event => { if (!(event.target as Element).closest('.qc-t-x')) toggle(); }}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); } }}>
        <span className="qc-t-status"><span className="qc-t-label" key={label}>{label}</span></span>
        <span className="qc-t-space" />
        {goal && <span className="qc-t-goaltag"><Target /><span>{goalLabel}</span></span>}
        {steps && <span className="qc-t-prog"><span className="qc-t-bar"><i style={{ '--pr': done / steps.length } as CSSProperties} /></span><span>{done}/{steps.length}</span></span>}
        <span className="qc-t-time">{clock(seconds)}</span>
        <Chevron />
        {state !== 'working' && <button type="button" className="qc-t-x" aria-label="Dismiss" onClick={event => { event.stopPropagation(); onDismiss(); }}><Close size={11} /></button>}
      </div>
      <div className="qc-tray-body"><div className="qc-tray-body-in"><div className="qc-tray-pad" ref={pad}>
        {goal && <div className="qc-goal">
          <div className="qc-goal-h"><Target />Goal<span className="qc-g-acts">
            {state === 'working' ? <button type="button" className="qc-g-btn" onClick={onPause}><Pause />Pause</button>
              : <>{state === 'stopped' && <button type="button" className="qc-g-btn pri" onClick={onResume}><Play />Resume</button>}
                <button type="button" className="qc-g-btn" onClick={onClearGoal}><Close size={11} />Clear goal</button></>}
          </span></div>
          <div className="qc-goal-t" ref={goalText}>{goal.condition}</div>
        </div>}
        {steps && <ol className="qc-steps">{steps.map((step, index) => <li key={index} className={`qc-step${step.status === 'completed' ? ' done' : step.status === 'in_progress' ? (state === 'working' ? ' active' : ' halt') : ''}`}>
          <span className="qc-si"><i className="qc-s-p" /><i className="qc-s-a" /><span className="qc-s-d"><Check className="" /></span></span>
          <span>{step.status === 'in_progress' && step.activeForm ? step.activeForm : step.content}</span></li>)}</ol>}
      </div></div></div>
    </div></div>
  </div>;
}
