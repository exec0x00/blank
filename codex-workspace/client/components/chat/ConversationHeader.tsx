import type { ReactNode } from 'react';
import { ChevronDown, MessageSquare } from 'lucide-react';
import './conversation-navigation.css';

interface ConversationHeaderProps {
  title: string;
  detail: string;
  historyOpen: boolean;
  disabled?: boolean;
  onBrowse: () => void;
  children: ReactNode;
}

export function ConversationHeader({ title, detail, historyOpen, disabled, onBrowse, children }: ConversationHeaderProps) {
  return <header className="chat-header conversation-header">
    <button type="button" className={'chat-thread-picker conversation-header-picker' + (historyOpen ? ' is-open' : '')}
      aria-label="Conversation history" aria-description={title} aria-haspopup="dialog" aria-expanded={historyOpen}
      data-tooltip={`Conversation history · ${title}`} disabled={disabled} onClick={onBrowse}>
      <span className="chat-header-mark" aria-hidden="true"><MessageSquare size={17} /></span>
      <span className="chat-header-context"><strong className="text-ellipsis" dir="auto">{title}</strong><span className="text-ellipsis">{detail}</span></span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    <div className="chat-header-actions conversation-header-actions">{children}</div>
  </header>;
}
