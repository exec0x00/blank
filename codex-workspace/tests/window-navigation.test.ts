import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bootstrap, Thread, Workspace } from '../shared/types';
import { agentAncestors, agentChildren, MAX_AGENT_ANCESTORS, verifiedAgentFamily } from '../client/components/chat/agent-navigation';
import { parseWindowLocation, resolveWindowWorkspace, windowLink, writeWindowLocation } from '../client/window-navigation';
import { connectWindowEvents, validWindowNotice } from '../client/window-events';
import { defaultSettings } from '../server/settings';

const stamp = '2026-09-23T00:00:00.000Z';
const workspace = (id: string): Workspace => ({ id, name: id, path: '/data/workspaces/' + id, createdAt: stamp, updatedAt: stamp });
const initial = workspace('saved-workspace'), linked = workspace('linked-workspace');
const bootstrap = (): Bootstrap => ({ workspaces: [initial], activeWorkspace: initial, activeWorkspaceId: initial.id,
  settings: defaultSettings, githubAccounts: [], storage: { path: '/data', persistent: true, bucket: 'public-fixture', writable: true } });
const agent = (id: string, parentThreadId?: string): Thread => ({ id, parentThreadId, workspaceId: linked.id, backend: 'codex-cli', title: id,
  status: 'idle', createdAt: stamp, updatedAt: stamp, messages: [] });
afterEach(() => vi.unstubAllGlobals());

describe('workspace and agent window links', () => {
  it('round-trips a child selection and an explicit empty draft under the workspace path', () => {
    const selection = { workspaceId: linked.id, threadId: 'native-child', view: 'agent' as const };
    expect(windowLink(selection)).toBe('/work?workspace=linked-workspace&thread=native-child&view=agent');
    expect(windowLink(selection, '/')).toBe('/work?workspace=linked-workspace&thread=native-child&view=agent');
    expect(windowLink(selection, '/work/')).toBe('/work/?workspace=linked-workspace&thread=native-child&view=agent');
    expect(windowLink(selection, '/workspace/')).toBe('/workspace/?workspace=linked-workspace&thread=native-child&view=agent');
    expect(parseWindowLocation(new URL(windowLink(selection), 'https://same-origin.test').search)).toEqual(selection);
    expect(windowLink({ workspaceId: linked.id, threadId: null, view: 'editor' })).toBe('/work?workspace=linked-workspace&thread=%24new&view=editor');
    expect(parseWindowLocation('?workspace=linked-workspace&thread=%24new&view=editor')).toEqual({ workspaceId: linked.id, threadId: null, view: 'editor' });
    expect(parseWindowLocation('?workspace=linked-workspace')).toEqual({ workspaceId: linked.id });
  });

  it('keeps focused windows and history navigation on /work while retaining the current fragment', () => {
    const selection = { workspaceId: linked.id, threadId: 'native-child', view: 'agent' as const };
    const location = { pathname: '/', search: '?old=selection', hash: '#conversation' };
    const history = { pushState: vi.fn(), replaceState: vi.fn() }, dispatchEvent = vi.fn();
    vi.stubGlobal('window', { location, history, dispatchEvent });
    const href = '/work?workspace=linked-workspace&thread=native-child&view=agent';
    expect(windowLink(selection)).toBe(href);
    writeWindowLocation(selection);
    expect(history.pushState).toHaveBeenCalledWith(null, '', href + '#conversation');
    expect(dispatchEvent).toHaveBeenCalledOnce();
    writeWindowLocation({ ...selection, view: 'editor' }, true);
    expect(history.replaceState).toHaveBeenCalledWith(null, '', href.replace('view=agent', 'view=editor') + '#conversation');
    Object.assign(location, { pathname: '/work', search: href.slice('/work'.length) });
    writeWindowLocation(selection);
    expect(history.pushState).toHaveBeenCalledOnce();
    expect(dispatchEvent).toHaveBeenCalledTimes(2);
  });

  it('rejects ambiguous, malformed and unscoped identities without accepting foreign navigation targets', () => {
    for (const query of ['?workspace=../private', '?workspace=%2Froot', '?workspace=', '?workspace=a&workspace=b', '?thread=child',
      '?workspace=a&thread=child&thread=other', '?workspace=a&thread=%00', '?workspace=a&view=terminal', '?workspace=a&view=agent&view=editor',
      '?workspace=' + 'a'.repeat(129)]) expect(parseWindowLocation(query)).toEqual({ error: expect.any(String) });
    for (const pathname of ['https://foreign.test/', '//foreign.test/', '/\\foreign.test/', '/?token=secret', '/#secret']) {
      expect(() => windowLink({ workspaceId: linked.id, threadId: 'child', view: 'agent' }, pathname)).toThrow();
    }
    expect(() => windowLink({ workspaceId: linked.id, threadId: '../other' })).toThrow();
  });

  it('resolves an off-page workspace by authenticated GET and leaves the saved default untouched', async () => {
    const fetch = vi.fn(async () => Response.json(linked)); vi.stubGlobal('fetch', fetch);
    const result = await resolveWindowWorkspace(bootstrap(), { workspaceId: linked.id, threadId: 'child', view: 'agent' });
    expect(result.boot.activeWorkspaceId).toBe(linked.id);
    expect(result.boot.activeWorkspace).toEqual(linked);
    expect(result.boot.workspaces).toEqual([initial]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]).toEqual(['/api/workspaces/linked-workspace', expect.objectContaining({ credentials: 'same-origin' })]);
    expect(bootstrap().activeWorkspaceId).toBe(initial.id);
  });

  it('does not silently open the saved workspace when a link is invalid, missing or returned for another identity', async () => {
    const fetch = vi.fn(async () => Response.json({ error: 'Missing', code: 'WORKSPACE_NOT_FOUND' }, { status: 404 })); vi.stubGlobal('fetch', fetch);
    const malformed = await resolveWindowWorkspace(bootstrap(), parseWindowLocation('?workspace=../private'));
    expect(malformed.boot.activeWorkspaceId).toBeNull(); expect(malformed.error).toBeTruthy(); expect(fetch).not.toHaveBeenCalled();
    const missing = await resolveWindowWorkspace(bootstrap(), { workspaceId: linked.id });
    expect(missing.boot.activeWorkspaceId).toBeNull(); expect(missing.error).toContain('no longer available');
    fetch.mockImplementation(async () => Response.json(initial));
    await expect(resolveWindowWorkspace(bootstrap(), { workspaceId: linked.id })).rejects.toThrow('did not match');
    fetch.mockImplementation(async () => Response.json({ error: 'Temporary failure' }, { status: 503 }));
    await expect(resolveWindowWorkspace(bootstrap(), { workspaceId: linked.id })).rejects.toMatchObject({ status: 503 });
  });
});

describe('verified native agent navigation', () => {
  it('walks a deep-linked child to its root and keeps usage and inline requests scoped to its own descendants', async () => {
    const root = agent('root'), child = agent('child', 'root'), sibling = agent('sibling', 'root'), grandchild = agent('grandchild', 'child');
    const read = vi.fn(async (id: string) => id === 'child' ? child : root);
    grandchild.rootThreadId = 'untrusted-root-hint';
    const ancestors = await agentAncestors(grandchild, linked.id, read);
    expect(read.mock.calls.map(([id]) => id)).toEqual(['child', 'root']);
    const family = verifiedAgentFamily(ancestors, [sibling, child, grandchild], linked.id);
    expect(family.root.id).toBe('root');
    expect(agentChildren(family, 'child').map(thread => thread.id)).toEqual(['grandchild']);
    expect(agentChildren(family, 'root').map(thread => thread.id).sort()).toEqual(['child', 'grandchild', 'sibling']);
    expect(agentChildren(family, 'grandchild')).toEqual([]);
  });

  it('retains a verified archived selection even if the active descendant list omits it', async () => {
    const root = agent('root'), child = { ...agent('child', 'root'), archivedAt: stamp };
    const ancestors = await agentAncestors(child, linked.id, async () => root);
    expect(verifiedAgentFamily(ancestors, [], linked.id).agents).toEqual([child]);
  });

  it('rejects another workspace, unrelated agents, duplicate IDs, cycles and excessive ancestry', async () => {
    const root = agent('root'), child = agent('child', 'root');
    await expect(agentAncestors(child, linked.id, async () => ({ ...root, workspaceId: initial.id }))).rejects.toThrow('did not match');
    await expect(agentAncestors(child, linked.id, async () => ({ ...root, id: 'substituted' }))).rejects.toThrow('did not match');
    await expect(agentAncestors(child, linked.id, async () => agent('root', 'child'))).rejects.toThrow('hierarchy');
    const read = vi.fn(async (id: string) => agent(id, 'ancestor-' + (Number(id.split('-')[1]) + 1)));
    await expect(agentAncestors(agent('selected', 'ancestor-1'), linked.id, read)).rejects.toThrow('hierarchy');
    expect(read).toHaveBeenCalledTimes(MAX_AGENT_ANCESTORS);
    for (const incoming of [[child, child], [{ ...child, workspaceId: initial.id }], [agent('unrelated', 'foreign')], [agent('a', 'b'), agent('b', 'a')], [root]]) {
      expect(() => verifiedAgentFamily([root], incoming, linked.id)).toThrow();
    }
  });
});

describe('cross-window invalidation messages', () => {
  it('accepts only minimal scoped notices and never selection, prompt or credential fields', () => {
    expect(validWindowNotice({ version: 1, type: 'thread', workspaceId: linked.id, threadId: 'child' })).toBe(true);
    for (const notice of [{ version: 1, type: 'thread', threadId: 'child' }, { version: 1, type: 'workspace', workspaceId: '../other' },
      { version: 1, type: 'thread', workspaceId: linked.id, threadId: 'child', prompt: 'unsent' },
      { version: 1, type: 'runtime', token: 'secret' }, { version: 1, type: 'selection', workspaceId: linked.id }]) expect(validWindowNotice(notice)).toBe(false);
  });

  it('relays real invalidations and session expiry once without echoing received messages', () => {
    const target = new EventTarget(), received: Event[] = [], posted: unknown[] = [];
    let channel!: FakeChannel;
    class FakeChannel {
      onmessage: ((event: MessageEvent) => void) | null = null;
      closed = false;
      constructor() { channel = this; }
      postMessage(value: unknown) { posted.push(value); }
      close() { this.closed = true; }
    }
    vi.stubGlobal('window', target); vi.stubGlobal('document', { body: { dataset: { workspaceLocked: 'false' } } }); vi.stubGlobal('BroadcastChannel', FakeChannel);
    target.addEventListener('codex:workspace-changed', event => received.push(event));
    const expired = vi.fn(); target.addEventListener('codex:session-expired', expired);
    const disconnect = connectWindowEvents();
    target.dispatchEvent(new CustomEvent('codex:workspace-changed', { detail: { workspaceId: linked.id, path: 'private-unpublished-file.ts' } }));
    expect(posted).toEqual([{ version: 1, type: 'workspace', workspaceId: linked.id }]);
    channel.onmessage?.({ data: posted[0] } as MessageEvent);
    expect(received).toHaveLength(2); expect(posted).toHaveLength(1);
    channel.onmessage?.({ data: { version: 1, type: 'locked' } } as MessageEvent);
    expect(expired).toHaveBeenCalledOnce(); expect(posted).toHaveLength(1);
    target.dispatchEvent(new Event('codex:session-lock-requested'));
    expect(posted).toEqual([{ version: 1, type: 'workspace', workspaceId: linked.id }, { version: 1, type: 'locked' }]);
    disconnect(); expect(channel.closed).toBe(true);
    target.dispatchEvent(new Event('codex:session-ended')); expect(posted).toHaveLength(2);
  });
});
