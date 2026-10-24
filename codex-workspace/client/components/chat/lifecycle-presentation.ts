import type { ChatMessage, ToolActivity } from '../../../shared/types';

const routineTurnEvents = new Set(['turn started', 'turn over', 'turn completed', 'turn finished']);
const normalized = (value: string) => value.trim().replace(/[.!]$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_/\-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();

/** Lifecycle state belongs to the existing status controls, not transcript rows. */
export function isRoutineTurnActivity(activity: ToolActivity): boolean {
  return (activity.status === 'running' || activity.status === 'completed')
    && routineTurnEvents.has(normalized(activity.name.replace(/^(?:functions|tools)\./, '')));
}

export function isRoutineTurnMessage(message: ChatMessage): boolean {
  return message.role === 'system' && !message.contentTruncated && !message.activities?.length && !message.attachments?.length
    && !message.fileAttachments?.length && !message.citations?.length && !message.review && routineTurnEvents.has(normalized(message.content));
}
