import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Bot, Check, CircleHelp, CirclePause, ExternalLink, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import type { Thread, ToolActivity, Workspace } from '../../../shared/types';
import type { CodexApproval, CodexApprovalDecision, CodexQuestionRequest } from '../../../shared/codex-cli';
import { api, json } from '../../api';
import { windowLink } from '../../window-navigation';
import { ActivityCard } from './ActivityCard';
import type { GeneratedImageScope } from './GeneratedImageCard';
import { ApprovalCard, approvalAnswerBody } from './ApprovalCard';
import { QuestionCard, type QuestionAnswers } from './QuestionCard';
import type { OpenChange } from '../editor/change-review';
import PageNavigation from '../ui/PageNavigation';
import './inline-agents.css';

type Notify = (message: string, kind?: 'error' | 'success' | 'info') => void;
type OpenFile = (path: string, location?: { line: number; column?: number }) => void;

/** Tool presentation contains no browser-owned child scheduler or lifecycle calls. */
export function AgentToolActivity({ activity, workspace, onNotify, onOpenFile, onOpenChange, generatedImageScope }: {
  activity: ToolActivity; workspace: Workspace; onNotify: Notify; onOpenFile?: OpenFile; onOpenChange?: OpenChange; generatedImageScope?: GeneratedImageScope;
}) {
  return <ActivityCard activity={activity} workspacePath={workspace.path} onNotify={onNotify} onOpenFile={onOpenFile} onOpenChange={onOpenChange} generatedImageScope={generatedImageScope} />;
}

function NativeChild({ thread, workspace, locked, disabled, onRefresh, onCheck, onSelectAgent }: {
  thread: Thread; workspace: Workspace; locked: boolean; disabled: boolean; onRefresh: () => Promise<void>; onCheck?: () => Promise<void>;
  onSelectAgent?: (threadId: string) => void;
}) {
  const [pending, setPending] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const latest = useRef({ thread, locked, disabled }); latest.current = { thread, locked, disabled };
  useEffect(() => {
    if (locked) { request.current?.abort(); request.current = null; setPending(null); setError(null); }
    return () => { request.current?.abort(); request.current = null; };
  }, [thread.id, locked]);
  async function respond(kind: 'approval' | 'answer', id: string, body: unknown) {
    const selected = latest.current.thread;
    if (request.current || latest.current.locked || latest.current.disabled || selected.backend !== 'codex-cli' || selected.readOnly
      || selected.workspaceId !== workspace.id || document.body.dataset.workspaceLocked === 'true'
      || !(kind === 'approval' ? selected.native?.approvals : selected.native?.questions)?.some(item => item.id === id && item.threadId === selected.id)) return;
    const controller = new AbortController(); request.current = controller; setPending(id); setError(null);
    const sensitive = kind === 'answer' && selected.native?.questions.some(question => question.id === id && question.questions.some(item => item.isSecret));
    try {
      await api('/threads/' + encodeURIComponent(selected.id) + '/' + kind, { ...json('POST', body), signal: controller.signal });
      if (controller.signal.aborted || latest.current.thread.id !== selected.id || latest.current.locked) return;
      window.dispatchEvent(new CustomEvent('codex:thread-changed', { detail: { workspaceId: workspace.id, threadId: selected.id } }));
      await onRefresh();
    } catch (failure) {
      if (!controller.signal.aborted && latest.current.thread.id === selected.id) {
        const message = sensitive ? 'The answer could not be confirmed. Refresh the request before entering a secret again.'
          : failure instanceof Error ? failure.message : 'The native response could not be confirmed.';
        setError(message); throw sensitive ? new Error(message) : failure;
      }
    } finally { if (request.current === controller) { request.current = null; setPending(null); } }
  }
  function approve(approval: CodexApproval, decision: CodexApprovalDecision) {
    const body = approvalAnswerBody(approval, decision);
    if (body) return respond('approval', approval.id, body);
  }
  function answer(question: CodexQuestionRequest, answers: QuestionAnswers) {
    return respond('answer', question.id, { requestId: question.id, answers });
  }
  const approvals = thread.native?.approvals.filter(item => item.threadId === thread.id) ?? [];
  const questions = thread.native?.questions.filter(item => item.threadId === thread.id) ?? [];
  const attention = approvals.length + questions.length;
  const active = thread.status === 'running' || thread.status === 'compacting';
  const completed = thread.status === 'idle' && thread.turns?.at(-1)?.status === 'completed';
  const status = approvals.length ? 'Needs approval' : questions.length ? 'Needs your answer'
    : completed ? 'Completed' : ({ idle: 'Ready', running: 'Working', compacting: 'Organizing context',
      awaiting_approval: 'Needs approval', awaiting_input: 'Needs your answer', error: 'Failed', interrupted: 'Stopped' } as const)[thread.status];
  const StatusIcon = approvals.length || thread.status === 'awaiting_approval' ? ShieldCheck
    : questions.length || thread.status === 'awaiting_input' ? CircleHelp : thread.status === 'error' ? AlertCircle
      : thread.status === 'interrupted' ? CirclePause : active ? LoaderCircle : completed ? Check : Bot;
  return <article className={`native-child${attention || thread.status === 'error' ? ' needs-attention' : ''}`} aria-label={'Subagent ' + thread.title}>
    <div className="native-child-heading"><span className="native-child-icon"><StatusIcon size={15} aria-hidden="true" className={active && !attention ? 'chat-spin' : undefined} /></span><div className="native-child-identity">{onSelectAgent
      ? <button type="button" className="native-child-select" data-tooltip={thread.title} aria-label={'Switch to agent ' + thread.title} disabled={locked} onClick={() => onSelectAgent(thread.id)}>{thread.title}</button>
      : <strong className="text-ellipsis" data-tooltip={thread.title}>{thread.title}</strong>}<span className="native-child-status"><span>{status}</span>{thread.agentRole && <span className="text-ellipsis" data-tooltip={thread.agentRole}> · {thread.agentRole}</span>}</span></div>
      {!locked && <a className="icon-button native-child-window" href={windowLink({ workspaceId: workspace.id, threadId: thread.id, view: 'agent' })}
        target="_blank" rel="noopener noreferrer" aria-label={'Open agent ' + thread.title + ' in new window'} title="Open agent in new window"><ExternalLink size={14} /></a>}
    </div>
    {thread.error && <p className="native-child-error" role="alert">{thread.error}</p>}
    {error && <p className="chat-control-dialog-error" role="alert"><AlertCircle size={13} />{error}</p>}
    {!!attention && <div className="native-child-requests">{approvals.map(approval => <ApprovalCard key={approval.id} approval={approval} locked={locked} busy={disabled || !!pending} onAnswer={decision => approve(approval, decision)} onRefresh={onCheck ?? onRefresh} />)}
      {questions.map(question => <QuestionCard key={question.id} request={question} locked={locked} busy={disabled || !!pending} onAnswer={answers => answer(question, answers)} onRefresh={onCheck ?? onRefresh} />)}</div>}
  </article>;
}

export function InlineAgentRequests({ rootThreadId, nativeThreads, workspace, locked = false, disabled = false, loading = false, error, onRefreshAgents, onCheckAgents, onSelectAgent }: {
  rootThreadId: string | null; nativeThreads: readonly Thread[]; workspace: Workspace; locked?: boolean; disabled?: boolean;
  loading?: boolean; error?: string | null; onRefreshAgents: () => Promise<void>; onCheckAgents?: () => Promise<void>; onNotify: Notify; onOpenFile?: OpenFile; onSelectAgent?: (threadId: string) => void;
}) {
  const [page, setPage] = useState({ rootThreadId, offset: 0 });
  const threads = nativeThreads.filter(thread => thread.backend === 'codex-cli' && thread.workspaceId === workspace.id && thread.id !== rootThreadId);
  const last = Math.max(0, Math.ceil(threads.length / 8) - 1) * 8;
  const offset = page.rootThreadId === rootThreadId ? Math.min(page.offset, last) : 0;
  if (locked || !rootThreadId || !threads.length && !error) return null;
  return <section className="native-children" aria-label="Native subagent activity">
    <div className="native-children-heading"><Bot size={14} aria-hidden="true" /><strong>Agents</strong><span className="native-children-count">{threads.length}</span>
      <button type="button" className="icon-button" disabled={loading} onClick={() => void onRefreshAgents()} aria-label="Refresh subagent activity" title="Refresh agent activity">
        {loading ? <LoaderCircle size={14} className="chat-spin" /> : <RefreshCw size={14} />}
      </button></div>
    {error && <p role="alert" className="chat-control-dialog-error">{error}</p>}
    {threads.slice(offset, offset + 8).map(thread => <NativeChild key={rootThreadId + ':' + thread.id} thread={thread} workspace={workspace} locked={locked}
      disabled={disabled || !!thread.readOnly} onRefresh={onRefreshAgents} onCheck={onCheckAgents} onSelectAgent={onSelectAgent} />)}
    <PageNavigation label="Native subagents" offset={offset} count={Math.min(8, threads.length - offset)} total={threads.length} hasPrevious={offset > 0} hasNext={offset < last}
      onPrevious={() => setPage({ rootThreadId, offset: Math.max(0, offset - 8) })} onNext={() => setPage({ rootThreadId, offset: Math.min(last, offset + 8) })} />
  </section>;
}
