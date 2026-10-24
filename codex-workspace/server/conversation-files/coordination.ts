import path from 'node:path';
import { realpathSync } from 'node:fs';
import { HttpError } from '../errors';
import { WORKSPACE_ID } from './validation';

export interface ConversationFileParticipant {
  /** Synchronous admission fence. Never wait for a live workspace or acquire its removal gate. */
  fence(workspaceId: string): void;
  drain(workspaceId: string): Promise<void>;
  forget?(workspaceId: string): void;
}

const participants = new Map<string, Set<ConversationFileParticipant>>();
const deleted = new Map<string, Set<string>>();
const storageTails = new Map<string, Promise<void>>();
const stateTails = new Map<string, Promise<void>>();
const deletionTails = new Map<string, Promise<void>>();

export function conversationFileScope(stateDir: string): string {
  let current = path.resolve(stateDir);
  const suffix: string[] = [];
  for (let count = 0; count < 64; count++) {
    try { return path.join(realpathSync.native(current), ...suffix); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || current === path.parse(current).root) {
        throw new HttpError(409, 'File attachment state storage is not a safe directory.', 'UNSAFE_FILE_ATTACHMENT_STORAGE');
      }
      suffix.unshift(path.basename(current)); current = path.dirname(current);
    }
  }
  throw new HttpError(409, 'File attachment state storage is not a safe directory.', 'UNSAFE_FILE_ATTACHMENT_STORAGE');
}
export function conversationWorkspaceDeleted(): HttpError {
  return new HttpError(410, 'This workspace was permanently deleted. Its file attachments cannot be used or recreated.', 'FILE_ATTACHMENT_WORKSPACE_DELETED');
}
function validId(workspaceId: string): void {
  if (typeof workspaceId !== 'string' || !WORKSPACE_ID.test(workspaceId)) throw new HttpError(400, 'Choose a valid workspace.', 'INVALID_FILE_ATTACHMENT_WORKSPACE');
}
export function conversationWorkspaceIsFenced(scope: string, workspaceId: string): boolean {
  return deleted.get(scope)?.has(workspaceId) ?? false;
}
export function assertConversationWorkspaceUnfenced(scope: string, workspaceId: string): void {
  validId(workspaceId);
  if (conversationWorkspaceIsFenced(scope, workspaceId)) throw conversationWorkspaceDeleted();
}

/** A durable fence is written before deleting bytes; this immediate barrier also closes races with live callbacks. */
export function fenceConversationWorkspace(scope: string, workspaceId: string): void {
  validId(workspaceId);
  let ids = deleted.get(scope);
  if (!ids) { ids = new Set(); deleted.set(scope, ids); }
  ids.add(workspaceId);
  for (const participant of participants.get(scope) ?? []) participant.fence(workspaceId);
}

export function registerConversationFileParticipant(scope: string, participant: ConversationFileParticipant): () => void {
  let group = participants.get(scope);
  if (!group) { group = new Set(); participants.set(scope, group); }
  group.add(participant);
  for (const workspaceId of deleted.get(scope) ?? []) participant.fence(workspaceId);
  return () => { group!.delete(participant); if (!group!.size && participants.get(scope) === group) participants.delete(scope); };
}

export async function drainConversationWorkspace(scope: string, workspaceId: string): Promise<void> {
  validId(workspaceId);
  const live = [...(participants.get(scope) ?? [])];
  // All admission paths check the shared fence, so a drained operation cannot
  // add another owned operation after this barrier.
  await Promise.all(live.map(participant => participant.drain(workspaceId)));
  for (const participant of live) participant.forget?.(workspaceId);
}

function serialized<T>(tails: Map<string, Promise<void>>, key: string, operation: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  const tail = current.then(() => undefined, () => undefined);
  tails.set(key, tail);
  void tail.finally(() => { if (tails.get(key) === tail) tails.delete(key); });
  return current;
}

/** State-root scope also coordinates separate service instances in the same process. */
export function withConversationStorageOperation<T>(scope: string, workspaceHash: string, operation: () => Promise<T>): Promise<T> {
  return serialized(storageTails, `${scope}\0${workspaceHash}`, operation);
}
export function withConversationStateMutation<T>(scope: string, operation: () => Promise<T>): Promise<T> {
  return serialized(stateTails, scope, operation);
}
export function withConversationWorkspaceDeletion<T>(scope: string, workspaceId: string, operation: () => Promise<T>): Promise<T> {
  validId(workspaceId);
  return serialized(deletionTails, `${scope}\0${workspaceId}`, operation);
}
