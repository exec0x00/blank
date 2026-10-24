import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, FilePenLine, LoaderCircle, RefreshCw, ShieldCheck, Terminal, X } from 'lucide-react';
import type { CodexApproval, CodexApprovalDecision } from '../../../shared/codex-cli';
import { RequestDialog, RequestError, RequestSummary } from './RequestDialog';
import { requestErrorMessage } from './request-presentation';

export interface ApprovalAnswerBody { approvalId: string; decision: CodexApprovalDecision }
const labels = {
  accept: 'Allow once', acceptForSession: 'Allow for this session', decline: 'Decline', cancel: 'Cancel',
} as const;
type BaseDecision = keyof typeof labels;
export interface ApprovalDecisionOption { id: CodexApprovalDecision; label: string; description: string }
const baseDecision = (value: CodexApprovalDecision): value is BaseDecision => Object.hasOwn(labels, value);
function offeredDescription(approval: CodexApproval, decision: CodexApprovalDecision): ApprovalDecisionOption | undefined {
  const offered = approval.decisionOptions?.filter(option => option.id === decision);
  if (offered?.length !== 1 || !offered[0].label.trim() || !offered[0].description.trim()) return undefined;
  return offered[0];
}

export function approvalDecisionDescription(approval: CodexApproval, decision: CodexApprovalDecision): string {
  const offered = offeredDescription(approval, decision);
  if (offered) return offered.description;
  if (!baseDecision(decision)) return 'This decision is not available for the current request.';
  if (approval.kind === 'permissions') return decision === 'accept' ? 'Grant the requested permissions for this turn.'
    : decision === 'acceptForSession' ? 'Grant the requested permissions for this session.' : 'Keep the requested permissions ungranted.';
  return decision === 'accept' ? approval.kind === 'fileChange' ? 'Apply the requested file changes once.' : approval.commandKind === 'writeStdin' ? 'Send the requested terminal input once.' : 'Run the requested command once.'
    : decision === 'acceptForSession' ? 'Approve the requested action for this session.'
      : decision === 'decline' ? 'Skip this action and let Codex continue.' : 'Stop the current turn without approving this action.';
}

/** Opaque amendment offers need their matching human-readable scope. */
export function approvalDecisionOptions(approval: CodexApproval): ApprovalDecisionOption[] {
  if (!Array.isArray(approval.decisions)) return [];
  return [...new Set(approval.decisions)].flatMap(decision => {
    const offered = offeredDescription(approval, decision);
    if (baseDecision(decision)) return [{ id: decision, label: offered?.label ?? labels[decision], description: approvalDecisionDescription(approval, decision) }];
    return /^native-decision-[a-f0-9-]{36}$/.test(decision) && offered ? [offered] : [];
  });
}

/** Only a decision offered by the current native request may be sent. */
export function approvalAnswerBody(approval: CodexApproval, decision: CodexApprovalDecision): ApprovalAnswerBody | null {
  return approval.id && approvalDecisionOptions(approval).some(option => option.id === decision)
    ? { approvalId: approval.id, decision } : null;
}

export function ApprovalCard({ approval, busy, locked = false, onAnswer, onRefresh }: {
  approval: CodexApproval; busy: boolean; locked?: boolean; onAnswer: (decision: CodexApprovalDecision) => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
}) {
  const uid = useId(), key = JSON.stringify(approval);
  const [opened, setOpened] = useState<string | null>(null), [pending, setPending] = useState<CodexApprovalDecision | null>(null);
  const [sent, setSent] = useState(false), [failure, setFailure] = useState<string | null>(null), [refreshing, setRefreshing] = useState(false);
  const [eventLocked, setEventLocked] = useState(false), blocked = locked || eventLocked;
  const scope = useRef({ key, blocked }); scope.current = { key, blocked };
  const alive = useRef(true), operation = useRef<symbol | null>(null), refreshOperation = useRef<symbol | null>(null);
  const open = opened === key && !blocked;
  const isCurrent = (captured: string) => alive.current && scope.current.key === captured && !scope.current.blocked && document.body.dataset.workspaceLocked !== 'true';
  useLayoutEffect(() => {
    operation.current = null; refreshOperation.current = null;
    setOpened(null); setPending(null); setSent(false); setFailure(null); setRefreshing(false);
  }, [key, blocked]);
  useEffect(() => {
    alive.current = true;
    const lock = () => { scope.current.blocked = true; setEventLocked(true); };
    const unlock = () => setEventLocked(false);
    window.addEventListener('codex:session-locked', lock); window.addEventListener('codex:session-expired', lock); window.addEventListener('codex:session-unlocked', unlock);
    return () => {
      alive.current = false; operation.current = null; refreshOperation.current = null;
      window.removeEventListener('codex:session-locked', lock); window.removeEventListener('codex:session-expired', lock); window.removeEventListener('codex:session-unlocked', unlock);
    };
  }, []);
  async function answer(decision: CodexApprovalDecision) {
    if (busy || operation.current || sent || refreshing || !isCurrent(key) || !approvalAnswerBody(approval, decision)) return;
    const token = Symbol('approval-answer'); operation.current = token; setPending(decision); setFailure(null);
    try { await onAnswer(decision); if (isCurrent(key) && operation.current === token) setSent(true); }
    catch (error) { if (isCurrent(key) && operation.current === token) setFailure(requestErrorMessage(error, 'Your decision could not be confirmed. Check this request before retrying.')); }
    finally { if (isCurrent(key) && operation.current === token) { operation.current = null; setPending(null); } }
  }
  async function refresh() {
    if (!onRefresh || refreshOperation.current || pending || !isCurrent(key)) return;
    const token = Symbol('approval-refresh'); refreshOperation.current = token; setRefreshing(true);
    try { await onRefresh(); }
    catch (error) { if (isCurrent(key) && refreshOperation.current === token) setFailure(requestErrorMessage(error, 'The approval request could not be refreshed.')); }
    finally { if (isCurrent(key) && refreshOperation.current === token) { refreshOperation.current = null; setRefreshing(false); } }
  }
  if (blocked) return null;
  const decisions = approvalDecisionOptions(approval);
  const kind = approval.kind === 'fileChange' ? 'File changes' : approval.kind === 'command' ? approval.commandKind === 'writeStdin' ? 'Terminal input' : 'Command' : 'Permissions';
  const Icon = approval.kind === 'command' ? Terminal : approval.kind === 'fileChange' ? FilePenLine : ShieldCheck;
  return <>
    <section className="chat-approval native-request is-approval" aria-labelledby={uid + '-summary'}>
      <RequestSummary icon={<ShieldCheck size={18} />} title={approval.title || 'Your approval is needed'} titleId={uid + '-summary'}
        description={approval.command || approval.description} status={pending ? 'Sending your decision…' : sent ? 'Decision sent · Checking request status' : kind + ' · Approval needed'}
        action={sent ? 'View response' : 'Review'} onOpen={() => { if (isCurrent(key)) setOpened(key); }} pending={!!pending} />
      {!open && failure && <RequestError message={failure} onRefresh={onRefresh ? () => void refresh() : undefined} refreshing={refreshing} />}
    </section>
    {open && <RequestDialog open onClose={() => setOpened(null)} title={approval.title || 'Review approval request'} titleId={uid + '-dialog'}
      description="Review the requested action and choose how Codex should proceed." className="native-approval-dialog">
      <div className="native-request-body">
        <span className="native-approval-kind"><Icon size={16} aria-hidden="true" />{kind}</span>
        {approval.description && <p className="native-approval-description">{approval.description}</p>}
        {approval.command && <pre className="native-approval-command" tabIndex={0} aria-label={approval.commandKind === 'writeStdin' ? 'Requested terminal input' : 'Requested command'}><code>{approval.command}</code></pre>}
        {approval.cwd && <dl className="native-approval-facts"><div><dt>Working directory</dt><dd>{approval.cwd}</dd></div></dl>}
        {!!approval.detailSections?.length && <div className="native-approval-scopes">{approval.detailSections.map((section, index) => <section key={index} aria-labelledby={uid + '-scope-' + index}>
          <h3 id={uid + '-scope-' + index}>{section.title}</h3><ul>{section.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>
        </section>)}</div>}
        {failure && <RequestError message={failure} onRefresh={onRefresh ? () => void refresh() : undefined} refreshing={refreshing} />}
        {sent ? <p className="native-request-notice" role="status"><Check size={16} aria-hidden="true" />Your decision was sent. Waiting for Codex to update this request.</p>
          : <div className="native-approval-decisions" role="group" aria-label="Approval decisions">{decisions.map((decision, index) => <button key={decision.id} type="button"
            className="native-approval-decision" aria-label={decision.label} aria-describedby={uid + '-decision-' + index} disabled={busy || !!pending || refreshing}
            onClick={() => void answer(decision.id)}>
            {pending === decision.id ? <LoaderCircle size={16} className="chat-spin" aria-hidden="true" /> : decision.id === 'accept' || decision.id === 'acceptForSession' ? <Check size={16} aria-hidden="true" /> : baseDecision(decision.id) ? <X size={16} aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />}
            <span><strong>{decision.label}</strong><small id={uid + '-decision-' + index}>{decision.description}</small></span>
          </button>)}</div>}
        {!decisions.length && <p role="status">This request has no available decision. Check its status to continue.</p>}
      </div>
      <div className="modal-footer native-request-footer"><button type="button" className="button ghost" onClick={() => setOpened(null)}>Close</button>
        {onRefresh && !failure && <button type="button" className="button ghost" disabled={refreshing || !!pending} onClick={() => void refresh()}><RefreshCw size={14} aria-hidden="true" />Check request</button>}
      </div>
    </RequestDialog>}
  </>;
}
