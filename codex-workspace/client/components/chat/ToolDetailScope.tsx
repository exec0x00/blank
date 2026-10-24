import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { ChatMessage, Thread } from '../../../shared/types';
import type { OpenChange } from '../editor/change-review';

interface DetailScope {
  workspaceId: string;
  threadId: string;
  messageId: string;
  turnId?: string;
  backend?: Thread['backend'];
  epoch?: string;
  locked: boolean;
  visible: boolean;
  grouped?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onOpenChange?: OpenChange;
}

const Context = createContext<DetailScope | null>(null);

/** A tool keeps its canonical history identity through custom row renderers. */
export function ToolDetailScope({ thread, message, locked = false, visible = true, grouped, expanded, onExpandedChange, onOpenChange, children }: {
  thread: Thread | undefined;
  message: ChatMessage;
  locked?: boolean;
  visible?: boolean;
  grouped?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onOpenChange?: OpenChange;
  children: ReactNode;
}) {
  const value = useMemo<DetailScope | null>(() => thread ? {
    workspaceId: thread.workspaceId, threadId: thread.id, messageId: message.id,
    turnId: message.turnId, backend: thread.backend, epoch: thread.history?.epoch, locked, visible, grouped, expanded, onExpandedChange, onOpenChange,
  } : null, [thread?.workspaceId, thread?.id, thread?.backend, thread?.history?.epoch, message.id, message.turnId, locked, visible, grouped, expanded, onExpandedChange, onOpenChange]);
  return <Context.Provider key={JSON.stringify([thread?.workspaceId, thread?.id, thread?.history?.epoch, message.id])} value={value}>{children}</Context.Provider>;
}

export const useToolDetailScope = () => useContext(Context);
