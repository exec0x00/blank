import { AlertCircle, GitFork, LoaderCircle, MoreHorizontal, RotateCcw } from 'lucide-react';
import Modal from '../Modal';
import { DropdownMenu } from '../ui/Dropdown';

export function TurnActions({ label, disabled = false, canRevert = false, onFork, onRevert }: {
  label: string; disabled?: boolean; canRevert?: boolean; onFork: () => void; onRevert: () => void;
}) {
  return <DropdownMenu align="end" aria-label={'Actions for ' + label}
    trigger={<button type="button" className="chat-turn-actions" aria-label={'Actions for ' + label} title="Turn actions" disabled={disabled}><MoreHorizontal size={16} /></button>}
    items={[
      { id: 'fork', label: 'Fork from here', description: 'Continue this native conversation in a new thread.', icon: <GitFork size={14} />, onSelect: onFork, disabled },
      { id: 'revert', label: 'Revert conversation from here', description: 'Remove this turn and later conversation history.', icon: <RotateCcw size={14} />, onSelect: onRevert, disabled: disabled || !canRevert },
    ]} />;
}

export function RevertDialog({ open, busy, error, onClose, onConfirm }: {
  open: boolean; busy: boolean; error: string | null; onClose: () => void; onConfirm: () => void;
}) {
  return <Modal open={open} onClose={onClose} title="Revert conversation" titleId="native-revert-title">
    <div className="chat-control-dialog-body">
      <p>Remove the selected turn and all later turns from this conversation.</p>
      <p>Workspace files, Git history and terminal commands stay as they are. Your current unsent draft is preserved.</p>
      {error && <p className="chat-control-dialog-error" role="alert"><AlertCircle size={14} />{error}</p>}
    </div>
    <div className="modal-footer"><button type="button" className="button ghost" disabled={busy} onClick={onClose}>Cancel</button>
      <button type="button" className="button primary" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle size={14} className="chat-spin" /> : <RotateCcw size={14} />}Revert conversation</button>
    </div>
  </Modal>;
}
