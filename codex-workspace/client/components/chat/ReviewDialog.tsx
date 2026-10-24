import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { CircleAlert, FileDiff, GitBranch, GitCommitHorizontal, LoaderCircle, MessageSquareText, RefreshCw, SearchCheck } from 'lucide-react';
import type { GitStatus, ReviewTarget, Workspace } from '../../../shared/types';
import { api } from '../../api';
import Modal from '../Modal';
import { SelectMenu, type SelectOption } from '../ui/Dropdown';
import { errorMessage } from './state';
import './review.css';

export interface ReviewDialogProps {
  open: boolean;
  onClose: () => void;
  workspace: Workspace;
  onSubmit: (target: ReviewTarget) => Promise<void>;
  busy?: boolean;
  error?: string | null;
}

const MANUAL_BRANCH = ':manual';
const targets: readonly SelectOption<ReviewTarget['type']>[] = [
  { value: 'uncommittedChanges', label: 'Uncommitted changes', description: 'Staged, unstaged, and untracked files', icon: <FileDiff size={16} /> },
  { value: 'baseBranch', label: 'Base branch', description: 'Changes since a shared ancestor', icon: <GitBranch size={16} /> },
  { value: 'commit', label: 'Commit', description: 'Changes introduced by one commit', icon: <GitCommitHorizontal size={16} /> },
  { value: 'custom', label: 'Custom instructions', description: 'Review current changes with a specific focus', icon: <MessageSquareText size={16} /> },
];

/** The parent starts the run and closes the dialog after the server accepts it. */
export function ReviewDialog({ open, onClose, workspace, onSubmit, busy = false, error }: ReviewDialogProps) {
  const uid = useId();
  const [type, setType] = useState<ReviewTarget['type']>('uncommittedChanges');
  const [branch, setBranch] = useState('');
  const [manualBranch, setManualBranch] = useState(false);
  const [sha, setSha] = useState('');
  const [instructions, setInstructions] = useState('');
  const [repository, setRepository] = useState<{ workspaceId: string; status: GitStatus } | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const status = repository?.workspaceId === workspace.id ? repository.status : null;
  const pending = busy || submitting;
  const changes = status ? new Set(status.files.map(file => file.path)).size : undefined;
  const currentChanges = type === 'uncommittedChanges' || type === 'custom';
  const noChanges = currentChanges && status?.isRepository && changes === 0;
  const fieldId = `${uid}-${type === 'baseBranch' ? 'branch' : type === 'commit' ? 'sha' : 'instructions'}`;
  const errorId = `${uid}-error`;
  const branches = useMemo<readonly SelectOption<string>[]>(() => [
    ...(status?.branches ?? []).map(value => ({ value, label: value, ...(value === status?.branch ? { description: 'Current branch' } : {}), icon: <GitBranch size={15} /> })),
    { value: MANUAL_BRANCH, label: 'Enter branch name…', description: 'Use an existing local or remote-tracking branch', icon: <GitBranch size={15} /> },
  ], [status]);

  useEffect(() => {
    setType('uncommittedChanges');
    setBranch('');
    setManualBranch(false);
    setSha('');
    setInstructions('');
    setFieldError(null);
    setSubmitError(null);
  }, [workspace.id]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setStatusLoading(true);
    setStatusError(null);
    setRepository(null);
    void api<GitStatus>(`/workspaces/${encodeURIComponent(workspace.id)}/git/status`, { signal: controller.signal })
      .then(value => {
        if (controller.signal.aborted) return;
        setRepository({ workspaceId: workspace.id, status: value });
      })
      .catch(cause => { if (!controller.signal.aborted) setStatusError(errorMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setStatusLoading(false); });
    return () => controller.abort();
  }, [open, workspace.id, refresh]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => document.getElementById(`${uid}-target`)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, uid]);

  function changeType(value: ReviewTarget['type']) {
    setType(value);
    setFieldError(null);
    setSubmitError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || inFlight.current || statusLoading || status?.isRepository === false || noChanges) return;
    let target: ReviewTarget;
    let invalid: string | undefined;
    if (type === 'baseBranch') {
      const value = branch.trim();
      if (!value) invalid = 'Choose a base branch or enter its name.';
      else if (value.length > 240 || value.startsWith('-') || /[\s\x00-\x1f\x7f~^:?*\[\\]/.test(value) || value.includes('..') || value.includes('@{')) invalid = 'Enter a valid branch name, such as main or origin/main.';
      target = { type, branch: value };
    } else if (type === 'commit') {
      const value = sha.trim();
      if (!/^[a-f\d]{7,64}$/i.test(value)) invalid = 'Enter a commit SHA with 7–64 hexadecimal characters.';
      target = { type, sha: value, title: null };
    } else if (type === 'custom') {
      const value = instructions.trim();
      if (!value) invalid = 'Add instructions for what the review should focus on.';
      else if (value.length > 8000) invalid = 'Keep review instructions within 8,000 characters.';
      target = { type, instructions: value };
    } else target = { type: 'uncommittedChanges' };
    if (invalid) {
      setFieldError(invalid);
      document.getElementById(fieldId)?.focus();
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setFieldError(null);
    setSubmitError(null);
    try { await onSubmit(target); }
    catch (cause) { setSubmitError(errorMessage(cause)); }
    finally { inFlight.current = false; setSubmitting(false); }
  }

  const visibleError = fieldError || submitError || error;
  const showManualBranch = manualBranch || (!statusLoading && !status?.branches.length);

  return <Modal open={open} title="Review code" titleId={`${uid}-title`} description="Find actionable issues in your changes." onClose={onClose} className="chat-review-dialog">
    <form className="chat-review-form" onSubmit={event => void submit(event)} noValidate aria-busy={pending}>
      <div className="chat-review-form-body">
        <div className="chat-review-workspace">
          <span className="chat-review-workspace-icon" aria-hidden="true"><SearchCheck size={19} /></span>
          <div><strong title={workspace.name}>{workspace.name}</strong><span aria-live="polite">{statusLoading ? 'Reading repository…' : status ? status.isRepository ? status.branch || 'Git repository' : 'Git is not initialized' : 'Repository status unavailable'}</span></div>
          <button type="button" className="icon-button" aria-label="Refresh repository status" title="Refresh repository status" disabled={statusLoading || pending} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} className={statusLoading ? 'chat-review-spin' : undefined} /></button>
        </div>

        <div className="chat-review-field">
          <label id={`${uid}-target-label`}>Review target</label>
          <SelectMenu id={`${uid}-target`} value={type} onValueChange={changeType} options={targets} aria-labelledby={`${uid}-target-label`} className="chat-review-select" menuClassName="chat-review-menu" disabled={pending} />
        </div>

        {type === 'uncommittedChanges' && <div className="chat-review-scope" aria-live="polite">
          <FileDiff size={18} aria-hidden="true" />
          <div><strong>{changes === undefined ? 'Current workspace changes' : `${changes} changed ${changes === 1 ? 'file' : 'files'}`}</strong><p>Review staged, unstaged, and untracked files in this workspace.</p></div>
        </div>}

        {type === 'baseBranch' && <div className="chat-review-field">
          <label id={`${uid}-branch-label`} htmlFor={showManualBranch ? fieldId : undefined}>Base branch</label>
          <SelectMenu value={showManualBranch ? MANUAL_BRANCH : branch} options={branches} onValueChange={value => { setManualBranch(value === MANUAL_BRANCH); setBranch(value === MANUAL_BRANCH ? '' : value); setFieldError(null); }} aria-labelledby={`${uid}-branch-label`} aria-describedby={`${uid}-branch-help${fieldError ? ` ${errorId}` : ''}`} id={showManualBranch ? `${fieldId}-select` : fieldId} className="chat-review-select" menuClassName="chat-review-menu" disabled={pending || statusLoading} searchable searchPlaceholder="Search branches…" placeholder="Choose a base branch…" />
          {showManualBranch && <input id={fieldId} className="input chat-review-ref" aria-label="Branch name" aria-invalid={!!fieldError} aria-describedby={`${uid}-branch-help${fieldError ? ` ${errorId}` : ''}`} value={branch} onChange={event => { setManualBranch(true); setBranch(event.target.value); setFieldError(null); }} disabled={pending} maxLength={240} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="main or origin/main" />}
          <p className="chat-review-help" id={`${uid}-branch-help`}>Review changes since the common ancestor with this branch. Choose a branch already available in the workspace.</p>
        </div>}

        {type === 'commit' && <div className="chat-review-field">
          <label htmlFor={fieldId}>Commit SHA</label>
          <input id={fieldId} className="input chat-review-ref" value={sha} onChange={event => { setSha(event.target.value); setFieldError(null); }} disabled={pending} maxLength={64} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="e.g. 4f5a2b7" aria-invalid={!!fieldError} aria-describedby={`${uid}-commit-help${fieldError ? ` ${errorId}` : ''}`} />
          <p className="chat-review-help" id={`${uid}-commit-help`}>Review one existing commit. Paste its full SHA or an unambiguous abbreviation of at least 7 characters.</p>
        </div>}

        {type === 'custom' && <div className="chat-review-field">
          <label htmlFor={fieldId}>Review instructions</label>
          <textarea id={fieldId} className="input chat-review-instructions" value={instructions} onChange={event => { setInstructions(event.target.value); setFieldError(null); }} disabled={pending} rows={5} maxLength={8000} placeholder="Focus on authorization checks and missing failure paths…" aria-invalid={!!fieldError} aria-describedby={`${uid}-instructions-help${fieldError ? ` ${errorId}` : ''}`} />
          <div className="chat-review-instructions-help"><p className="chat-review-help" id={`${uid}-instructions-help`}>Apply a specific focus to the workspace’s current changes.</p><span>{instructions.length.toLocaleString()} / 8,000</span></div>
        </div>}

        {statusError && <div className="chat-review-notice" role="status"><CircleAlert size={16} aria-hidden="true" /><div><strong>Could not read repository status</strong><p>{statusError}</p><button type="button" className="button ghost" disabled={pending} onClick={() => setRefresh(value => value + 1)}>Try again</button></div></div>}
        {status?.isRepository === false && <div className="chat-review-notice" role="status"><CircleAlert size={16} aria-hidden="true" /><p>Initialize Git from Source control before reviewing this workspace.</p></div>}
        {noChanges && <div className="chat-review-notice" role="status"><CircleAlert size={16} aria-hidden="true" /><p>There are no uncommitted changes to review. Choose a base branch or commit, or refresh after editing a file.</p></div>}
        {visibleError && <div id={errorId} className="chat-review-error" role="alert"><CircleAlert size={16} aria-hidden="true" /><span>{visibleError}</span></div>}
      </div>
      <div className="modal-footer chat-review-footer">
        <button type="button" className="button ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="button primary" disabled={pending || statusLoading || status?.isRepository === false || !!noChanges}>{pending ? <LoaderCircle size={16} className="chat-review-spin" /> : <SearchCheck size={16} />}{pending ? 'Starting review…' : 'Start review'}</button>
      </div>
    </form>
  </Modal>;
}

export default ReviewDialog;
