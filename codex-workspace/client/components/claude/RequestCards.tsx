import { useState } from 'react';
import { Check, ClipboardList, LoaderCircle, MessageCircleQuestion, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import type { ClaudePermissionMode, ClaudePermissionRequest } from '../../../shared/claude';
import { MarkdownMessage } from '../chat/MarkdownMessage';
import { relativePath } from './ToolCard';

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
  if (request.tool === 'Bash') return <pre className="claude-request-code">{str(input.command)}</pre>;
  if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Read'].includes(request.tool)) {
    const file = relativePath(str(input.file_path || input.notebook_path), root);
    const body = request.tool === 'Write' ? str(input.content) : request.tool === 'Edit' ? `- ${str(input.old_string).split('\n').join('\n- ')}\n+ ${str(input.new_string).split('\n').join('\n+ ')}` : '';
    return <><p className="claude-request-path">{file}</p>{body && <pre className="claude-request-code">{body.length > 4000 ? body.slice(0, 4000) + '\n…' : body}</pre>}</>;
  }
  if (request.tool === 'WebFetch') return <p className="claude-request-path">{str(input.url)}</p>;
  return <pre className="claude-request-code">{JSON.stringify(input, null, 2)}</pre>;
}

export function PermissionCard({ request, workspacePath, onAnswer }: Props) {
  const { busy, answer } = useAnswer(onAnswer);
  const [feedback, setFeedback] = useState('');
  const [denying, setDenying] = useState(false);
  return <section className="claude-request is-permission" aria-label={`Permission request for ${request.tool}`}>
    <header><ShieldAlert size={16} /><div><strong>{request.title || `Allow Claude to use ${request.tool}?`}</strong>
      {(request.description || request.decisionReason) && <small>{request.description || request.decisionReason}</small>}</div></header>
    {preview(request, workspacePath)}
    {request.blockedPath && <p className="claude-request-note">Outside the workspace: <code>{request.blockedPath}</code></p>}
    {denying && <textarea className="input" rows={2} autoFocus placeholder="Tell Claude what to do instead (optional)" value={feedback} onChange={event => setFeedback(event.target.value)} />}
    <div className="claude-request-actions">
      {denying ? <>
        <button type="button" className="button ghost" onClick={() => setDenying(false)} disabled={!!busy}>Back</button>
        <button type="button" className="button" disabled={!!busy} onClick={() => void answer('stop', { decision: 'stop', message: feedback })}>{busy === 'stop' && <LoaderCircle size={14} className="chat-spin" />}Deny and stop</button>
        <button type="button" className="button primary" disabled={!!busy} onClick={() => void answer('deny', { decision: 'deny', message: feedback })}>{busy === 'deny' && <LoaderCircle size={14} className="chat-spin" />}Deny and continue</button>
      </> : <>
        <button type="button" className="button ghost" disabled={!!busy} onClick={() => setDenying(true)}><X size={14} />Deny</button>
        {request.canAlwaysAllow && <button type="button" className="button" disabled={!!busy} title={request.alwaysAllowLabel} onClick={() => void answer('always', { decision: 'allow-always' })}>{busy === 'always' ? <LoaderCircle size={14} className="chat-spin" /> : <ShieldCheck size={14} />}<span className="text-ellipsis">{request.alwaysAllowLabel || 'Always allow'}</span></button>}
        <button type="button" className="button primary" autoFocus disabled={!!busy} onClick={() => void answer('allow', { decision: 'allow' })}>{busy === 'allow' ? <LoaderCircle size={14} className="chat-spin" /> : <Check size={14} />}Allow once</button>
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
  return <section className="claude-request is-question" aria-label="Claude has a question">
    <header><MessageCircleQuestion size={16} /><div><strong>Claude has {questions.length === 1 ? 'a question' : `${questions.length} questions`}</strong><small>Your answer is sent straight back to Claude.</small></div></header>
    {questions.map((question, index) => <fieldset key={index} className="claude-question">
      <legend>{question.header && <span className="claude-question-chip">{question.header}</span>}{question.question}</legend>
      <div className="claude-question-options">{(question.options ?? []).map(option => {
        const active = (selected[index] ?? []).includes(option.label);
        return <button type="button" key={option.label} className={active ? 'is-selected' : ''} aria-pressed={active} onClick={() => toggle(index, option.label, question.multiSelect)}>
          <span className={question.multiSelect ? 'claude-check' : 'claude-radio'}>{active && <Check size={11} />}</span><span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span></button>;
      })}</div>
      <input className="input" placeholder="Other answer…" value={other[index] ?? ''} onChange={event => { const text = event.target.value; setOther(current => ({ ...current, [index]: text })); if (!question.multiSelect && text) setSelected(current => ({ ...current, [index]: [] })); }} />
    </fieldset>)}
    <div className="claude-request-actions">
      <button type="button" className="button ghost" disabled={!!busy} onClick={() => void answer('skip', { decision: 'deny', message: 'The user chose not to answer. Continue with your best judgment.' })}>Skip</button>
      <button type="button" className="button primary" disabled={!!busy || !complete} onClick={() => void answer('send', { decision: 'allow', answers: Object.fromEntries(questions.map((question, index) => [question.question, value(index).join(', ')])) })}>{busy === 'send' && <LoaderCircle size={14} className="chat-spin" />}Send answer</button>
    </div>
  </section>;
}

export function PlanCard({ request, workspacePath, onAnswer, onNotify, onOpenFile }: Props) {
  const { busy, answer } = useAnswer(onAnswer);
  const [feedback, setFeedback] = useState('');
  const [revising, setRevising] = useState(false);
  return <section className="claude-request is-plan" aria-label="Plan ready for review">
    <header><ClipboardList size={16} /><div><strong>Claude's plan is ready</strong><small>Approve it to start working, or ask for changes.</small></div></header>
    <div className="claude-plan-body"><MarkdownMessage content={str(request.input.plan) || '(No plan text was provided.)'} workspacePath={workspacePath} onNotify={onNotify} onOpenFile={onOpenFile} /></div>
    {revising && <textarea className="input" rows={3} autoFocus placeholder="What should change in the plan?" value={feedback} onChange={event => setFeedback(event.target.value)} />}
    <div className="claude-request-actions">
      {revising ? <>
        <button type="button" className="button ghost" disabled={!!busy} onClick={() => setRevising(false)}>Back</button>
        <button type="button" className="button primary" disabled={!!busy || !feedback.trim()} onClick={() => void answer('revise', { decision: 'deny', message: feedback })}>{busy === 'revise' && <LoaderCircle size={14} className="chat-spin" />}Send feedback</button>
      </> : <>
        <button type="button" className="button ghost" disabled={!!busy} onClick={() => setRevising(true)}>Keep planning</button>
        <button type="button" className="button" disabled={!!busy} onClick={() => void answer('default', { decision: 'allow', mode: 'default' })}>{busy === 'default' && <LoaderCircle size={14} className="chat-spin" />}Approve, ask before edits</button>
        <button type="button" className="button primary" autoFocus disabled={!!busy} onClick={() => void answer('accept', { decision: 'allow', mode: 'acceptEdits' })}>{busy === 'accept' ? <LoaderCircle size={14} className="chat-spin" /> : <Check size={14} />}Approve and auto-accept edits</button>
      </>}
    </div>
  </section>;
}

export function RequestCard(props: Props) {
  return props.request.kind === 'question' ? <QuestionCard {...props} /> : props.request.kind === 'plan' ? <PlanCard {...props} /> : <PermissionCard {...props} />;
}
