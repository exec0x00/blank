import type { Thread, ThreadSummary } from '../../../shared/types';
import { validNavigationId } from '../../window-navigation';
import { threadSummary } from './state';

export const MAX_AGENT_ANCESTORS = 16;
export const MAX_AGENT_FAMILY = 128;
export interface AgentFamily { root: ThreadSummary; agents: Thread[] }

export function verifiedAgent(value: unknown, workspaceId: string, id?: string): value is Thread {
  if (!value || typeof value !== 'object') return false;
  const thread = value as Thread;
  return validNavigationId(thread.id) && (id === undefined || thread.id === id) && thread.workspaceId === workspaceId && thread.backend === 'codex-cli'
    && typeof thread.title === 'string' && typeof thread.status === 'string' && Array.isArray(thread.messages)
    && (thread.parentThreadId === undefined || validNavigationId(thread.parentThreadId));
}

/** Follow authenticated parent records; a root ID hint is never authority. */
export async function agentAncestors(selected: Thread, workspaceId: string, read: (id: string) => Promise<unknown>): Promise<Thread[]> {
  if (!verifiedAgent(selected, workspaceId)) throw new Error('The agent did not match this workspace.');
  const ancestors = [selected], visited = new Set([selected.id]);
  let current = selected;
  while (current.parentThreadId) {
    if (ancestors.length > MAX_AGENT_ANCESTORS || visited.has(current.parentThreadId)) throw new Error('The agent hierarchy could not be verified.');
    const parent = await read(current.parentThreadId);
    if (!verifiedAgent(parent, workspaceId, current.parentThreadId)) throw new Error('The parent agent did not match this workspace.');
    visited.add(parent.id); ancestors.push(parent); current = parent;
  }
  return ancestors;
}

export function agentDescendsFrom(thread: Pick<Thread, 'id' | 'parentThreadId'>, ancestorId: string, threads: ReadonlyMap<string, Pick<Thread, 'id' | 'parentThreadId'>>): boolean {
  const visited = new Set([thread.id]);
  let parent = thread.parentThreadId;
  for (let depth = 0; parent && depth < MAX_AGENT_ANCESTORS; depth++) {
    if (visited.has(parent)) return false;
    if (parent === ancestorId) return true;
    visited.add(parent); parent = threads.get(parent)?.parentThreadId;
  }
  return false;
}

export function verifiedAgentFamily(ancestors: Thread[], incoming: unknown, workspaceId: string): AgentFamily {
  const selected = ancestors[0], root = ancestors.at(-1);
  if (!selected || !root || root.parentThreadId || !Array.isArray(incoming) || incoming.length > MAX_AGENT_FAMILY) throw new Error('The agent list could not be read.');
  const seen = new Set<string>();
  for (const thread of incoming) {
    if (!verifiedAgent(thread, workspaceId) || !thread.parentThreadId || thread.id === root.id || seen.has(thread.id)) throw new Error('The agent list did not match this conversation.');
    seen.add(thread.id);
  }
  const family = new Map<string, Thread>(ancestors.map(thread => [thread.id, thread]));
  for (const thread of incoming as Thread[]) family.set(thread.id, thread);
  // The selected view is live; a polled summary must not replace it.
  family.set(selected.id, selected);
  const agents = [...family.values()].filter(thread => thread.id !== root.id);
  if (agents.some(thread => !agentDescendsFrom(thread, root.id, family))) throw new Error('The agent hierarchy could not be verified.');
  return { root: { ...threadSummary(root), backend: root.backend, readOnly: root.readOnly }, agents };
}

export function agentChildren(family: AgentFamily | null, selectedId: string | null): Thread[] {
  if (!family || !selectedId) return [];
  const threads = new Map<string, Pick<Thread, 'id' | 'parentThreadId'>>([[family.root.id, family.root], ...family.agents.map(thread => [thread.id, thread] as const)]);
  return family.agents.filter(thread => thread.id !== selectedId && agentDescendsFrom(thread, selectedId, threads));
}
