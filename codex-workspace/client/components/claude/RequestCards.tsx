import { useState } from 'react';
import { Check, ClipboardList, LoaderCircle, MessageCircleQuestion, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import type { ClaudePermissionMode, ClaudePermissionRequest } from '../../../shared/claude';
import { MarkdownMessage } from '../chat/MarkdownMessage';
import { relativePath } from './agent/steps';

type Notify = (message: string, kind?: 'error' | 'success' | 'info') => void;
export interface RequestAnswer { decision: 'allow' | 'allow-always' | 'deny' | 'stop'; message?: string; answers?: Record<string, string>; mode?: ClaudePermissionMode }
interface Props { request: ClaudePermissionRequest; workspacePath: string; onAnswer: (answer: RequestAnswer) => Promise<void>; onNotify: Notify; onOpenFile?: (path: string) => void }

const str = (value: unknown) => typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value, null, 2);

function useAnswer(onAnswer: Props['onAnswer']) {
  const [busy, setBusy] = useState<string | null>(null);
  const answer = async (key: string, value: RequestAnswer) => {
    if (busy) return;
    setBusy(key);
    try { await onAnswer(value); } finally { setBusy(null); }
  };
  return { busy, answer };
}

function preview(request: ClaudePermissionRequest, root: string) {
  const input = request.input;
  if (request.tool === 'Bash') return <pre className="ag-req-code">{str(input.command)}</pre>;
  if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Read'].includes(request.tool)) {
    const file = relativePath(str(input.file_path || input.notebook_path), root);
    const body = request.tool === 'Write' ? str(input.content) : request.tool === 'Edit' ? `- ${str(input.old_string).split('\n').join('\n- ')}\n+ ${str(input.new_string).split('\n').join('\n+ ')}` : '';
    return <><p className="ag-req-path">{file}</p>{body && <pre className="ag-req-code">{body.length > 4000 ? body.slice(0, 4000) + '\n…' : body}</pre>}</>;
  }
  if (request.tool === 'WebFetch') return <p className="ag-req-path">{str(input.url)}</p>;
  return <pre className="ag-req-code">{JSON.stringify(input, null, 2)}</pre>;
}

export function PermissionCard({ request, workspacePath, onAnswer }: Props) {
  const { busy, answer } = useAnswer(onAnswer);
  const [feedback, setFeedback] = useState('');
  const [denying, setDenying] = useState(false);
  return <section className="ag-req" aria-label={`Permission request for ${request.tool}`}>
    <header className="ag-req-h"><ShieldAlert size={15} strokeWidth={1.75} /><div><strong>{request.title || `Allow Claude to use ${request.tool}?`}</strong>
      {(request.description || request.decisionReason) && <small>{request.description || request.decisionReason}</small>}</div></header>
    {preview(request, workspacePath)}
    {request.blockedPath && <p className="ag-req-note">Outside the workspace: <code>{request.blockedPath}</code></p>}
    {denying && <textarea className="ag-input" rows={2} autoFocus placeholder="Tell Claude what to do instead (optional)" value={feedback} onChange={event => setFeedback(event.target.value)} />}
    <div className="ag-req-acts">
      {denying ? <>
        <button type="button" className="ag-btn ghost" onClick={() => setDenying(false)} disabled={!!busy}>Back</button>
        <button type="button" className="ag-btn" disabled={!!busy} onClick={() => void answer('stop', { decision: 'stop', message: feedback })}>{busy === 'stop' && <LoaderCircle size={14} className="ag-spin" />}Deny and stop</button>
        <button type="button" className="ag-btn primary" disabled={!!busy} onClick={() => void answer('deny', { decision: 'deny', message: feedback })}>{busy === 'deny' && <LoaderCircle size={14} className="ag-spin" />}Deny and continue</button>
      </> : <>
        <button type="button" className="ag-btn ghost" disabled={!!busy} onClick={() => setDenying(true)}><X size={14} />Deny</button>
        {request.canAlwaysAllow && <button type="button" className="ag-btn" disabled={!!busy} title={request.alwaysAllowLabel} onClick={() => void answer('always', { decision: 'allow-always' })}>{busy === 'always' ? <LoaderCircle size={14} className="ag-spin" /> : <ShieldCheck size={14} />}<span className="text-ellipsis">{request.alwaysAllowLabel || 'Always allow'}</span></button>}
        <button type="button" className="ag-btn primary" autoFocus disabled={!!busy} onClick={() => void answer('allow', { decision: 'allow' })}>{busy === 'allow' ? <LoaderCircle size={14} className="ag-spin" /> : <Check size={14} />}Allow once</button>
      </>}
    </div>
  </section>;
}

interface Question { question: string; header?: string; multiSelect?: boolean; options?: { label: string; description?: string }[] }
export function QuestionCard({ request, onAnswer }: Props) {
  const { busy, answer } = useAnswer(onAnswer);
  const questions = ((request.input.questions as Question[] | undefined) ?? []).slice(0, 6);
  const [selected, setSelected] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const value = (index: number) => [...(selected[index] ?? []), ...(other[index]?.trim() ? [other[index].trim()] : [])];
  const complete = questions.every((_, index) => value(index).length > 0);
  const toggle = (index: number, label: string, multi?: boolean) => setSelected(current => {
    const values = current[index] ?? [];
    return { ...current, [index]: multi ? values.includes(label) ? values.filter(item => item !== label) : [...values, label] : [label] };
  });
  return <section className="ag-req" aria-label="Claude has a question">
    <header className="ag-req-h"><MessageCircleQuestion size={15} strokeWidth={1.75} /><div><strong>Claude has {questions.length === 1 ? 'a question' : `${questions.length} questions`}</strong></div></header>
    {questions.map((question, index) => <fieldset key={index} className="ag-q">
      <legend>{question.header && <span className="ag-tag">{question.header}</span>}{question.question}</legend>
      <div className="ag-q-opts">{(question.options ?? []).map(option => {
        const active = (selected[index] ?? []).includes(option.label);
        return <button type="button" key={option.label} className={`ag-q-opt${active ? ' sel' : ''}`} aria-pressed={active} onClick={() => toggle(index, option.label, question.multiSelect)}>
          <span className={question.multiSelect ? 'ag-check' : 'ag-radio'}>{active && <Check size={11} />}</span><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span></button>;
      })}</div>
      <input className="ag-input" placeholder="Other answer…" value={other[index] ?? ''} onChange={event => { const text = event.target.value; setOther(current => ({ ...current, [index]: text })); if (!question.multiSelect && text) setSelected(current => ({ ...current, [index]: [] })); }} />
    </fieldset>)}
    <div className="ag-req-acts">
      <button type="button" className="ag-btn ghost" disabled={!!busy} onClick={() => void answer('skip', { decision: 'deny', message: 'The user chose not to answer. Continue with your best judgment.' })}>Skip</button>
      <button type="button" className="ag-btn primary" disabled={!!busy || !complete} onClick={() => void answer('send', { decision: 'allow', answers: Object.fromEntries(questions.map((question, index) => [question.question, value(index).join(', ')])) })}>{busy === 'send' && <LoaderCircle size={14} className="ag-spin" />}Send answer</button>
    </div>
  </section>;
}

export function PlanCard({ request, workspacePath, onAnswer, onNotify, onOpenFile }: Props) {
  const { busy, answer } = useAnswer(onAnswer);
  const [feedback, setFeedback] = useState('');
  const [revising, setRevising] = useState(false);
  return <section className="ag-req" aria-label="Plan ready for review">
    <header className="ag-req-h"><ClipboardList size={15} strokeWidth={1.75} /><div><strong>Plan ready for review</strong></div></header>
    <div className="ag-req-plan ag-md ag-md-sm"><MarkdownMessage content={str(request.input.plan) || '(No plan text was provided.)'} workspacePath={workspacePath} onNotify={onNotify} onOpenFile={onOpenFile} /></div>
    {revising && <textarea className="ag-input" rows={3} autoFocus placeholder="What should change in the plan?" value={feedback} onChange={event => setFeedback(event.target.value)} />}
    <div className="ag-req-acts">
      {revising ? <>
        <button type="button" className="ag-btn ghost" disabled={!!busy} onClick={() => setRevising(false)}>Back</button>
        <button type="button" className="ag-btn primary" disabled={!!busy || !feedback.trim()} onClick={() => void answer('revise', { decision: 'deny', message: feedback })}>{busy === 'revise' && <LoaderCircle size={14} className="ag-spin" />}Send feedback</button>
      </> : <>
        <button type="button" className="ag-btn ghost" disabled={!!busy} onClick={() => setRevising(true)}>Keep planning</button>
        <button type="button" className="ag-btn" disabled={!!busy} onClick={() => void answer('default', { decision: 'allow', mode: 'default' })}>{busy === 'default' && <LoaderCircle size={14} className="ag-spin" />}Approve, ask before edits</button>
        <button type="button" className="ag-btn primary" autoFocus disabled={!!busy} onClick={() => void answer('accept', { decision: 'allow', mode: 'acceptEdits' })}>{busy === 'accept' ? <LoaderCircle size={14} className="ag-spin" /> : <Check size={14} />}Approve and auto-accept edits</button>
      </>}
    </div>
  </section>;
}

export function RequestCard(props: Props) {
  return props.request.kind === 'question' ? <QuestionCard {...props} /> : props.request.kind === 'plan' ? <PlanCard {...props} /> : <PermissionCard {...props} />;
}
