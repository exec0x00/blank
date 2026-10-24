import type { ComponentProps, ReactNode } from 'react';
import { AlertCircle, ArrowUpRight, LoaderCircle, RefreshCw } from 'lucide-react';
import Modal from '../Modal';
import './request-interactions.css';

/** Native requests share the app's focus trap, Escape handling and lock gate. */
export function RequestDialog({ className = '', ...props }: ComponentProps<typeof Modal>) {
  return <Modal {...props} className={'native-request-dialog ' + className} />;
}

export function RequestSummary({ icon, title, titleId, description, status, action, onOpen, pending = false }: {
  icon: ReactNode; title: string; titleId: string; description?: string; status: string;
  action: string; onOpen: () => void; pending?: boolean;
}) {
  return <div className="native-request-summary">
    <span className="native-request-icon" aria-hidden="true">{icon}</span>
    <div className="native-request-copy"><strong id={titleId}>{title}</strong>
      {description && <p>{description}</p>}
      <span className="native-request-status" role="status">{pending && <LoaderCircle size={13} className="chat-spin" aria-hidden="true" />}{status}</span>
    </div>
    <button type="button" className="button native-request-open" onClick={onOpen} aria-haspopup="dialog">{action}<ArrowUpRight size={14} aria-hidden="true" /></button>
  </div>;
}

export function RequestError({ message, onRefresh, refreshing = false }: {
  message: string; onRefresh?: () => void; refreshing?: boolean;
}) {
  return <div className="native-request-error" role="alert"><AlertCircle size={16} aria-hidden="true" /><p>{message}</p>
    {onRefresh && <button type="button" className="button ghost" disabled={refreshing} onClick={onRefresh}>
      {refreshing ? <LoaderCircle size={14} className="chat-spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}Check request
    </button>}
  </div>;
}
