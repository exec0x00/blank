import { describe, expect, it } from 'vitest';
import { nativeApprovalView } from '../server/codex-cli/approvals';
import { applyNativeNotification, projectNativeThread } from '../server/codex-cli/projection';

const threadId = '01990000-0000-7000-8000-000000000001', turnId = '01990000-0000-7000-8000-000000000002';
const base = { threadId, turnId, itemId: 'native-item', startedAtMs: 1780000000000 };
const stamp = '2026-09-30T00:00:00.000Z';
const identity = (value: string) => value;

describe('complete native approval offers', () => {
  it('keeps full commands, stdin identity and every permission scope through public projection', () => {
    const command = 'printf ' + 'x'.repeat(15_990);
    const projected = nativeApprovalView('item/commandExecution/requestApproval', { ...base, kind: 'writeStdin', command,
      cwd: '/workspace', environmentId: null, additionalPermissions: { network: { enabled: true }, fileSystem: {
        read: ['/workspace/one'], write: ['/workspace/two'], entries: [{ path: { type: 'glob_pattern', pattern: '/workspace/**/*.log' }, access: 'read' }], globScanMaxDepth: 2,
      } } }, 'native-request-test', stamp, identity);
    const view = projectNativeThread({ id: threadId, createdAt: 1, updatedAt: 1, status: { type: 'idle' } }, [], 'workspace');
    const updated = applyNativeNotification(view, 'thread/status/changed', { threadId, status: { type: 'idle' } }, {
      nativeState: { ...view.native!, approvals: [projected.approval] }, observedAt: stamp,
    });
    const approval = updated.native!.approvals[0];
    expect(approval.command).toBe(command); expect(approval.commandKind).toBe('writeStdin');
    expect(approval.detailSections).toEqual(expect.arrayContaining([
      { title: 'Read access', items: ['/workspace/one'] }, { title: 'Write access', items: ['/workspace/two'] },
      { title: 'Filesystem rules', items: ['Read: Pattern: /workspace/**/*.log'] },
    ]));
    expect(approval.command).not.toContain('[truncated]');
  });

  it('binds exact native amendment objects to independent opaque offers for each callback', () => {
    const decision = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['git', '-C', '/workspace', 'status'] } };
    const request = { ...base, command: 'git -C /workspace status', availableDecisions: [decision, 'decline', 'cancel'] };
    const first = nativeApprovalView('item/commandExecution/requestApproval', request, 'request-one', stamp, identity);
    const second = nativeApprovalView('item/commandExecution/requestApproval', request, 'request-two', stamp, identity);
    const key = first.approval.decisions.find(value => value.startsWith('native-decision-'))!;
    expect(key).toMatch(/^native-decision-[a-f0-9-]{36}$/);
    expect(first.responses.get(key)).toEqual({ decision }); expect(second.responses.has(key)).toBe(false);
    expect(first.approval.decisions).not.toContain('accept');
    expect(first.approval.detailSections!.flatMap(section => section.items)).toContain('3. "/workspace"');
    expect(JSON.stringify(first.approval)).not.toContain('execpolicy_amendment');
  });

  it('offers explicit strict command review while granting only the requested permission subset', () => {
    const value = nativeApprovalView('item/permissions/requestApproval', { ...base, cwd: '/workspace',
      permissions: { network: { enabled: true }, fileSystem: null } }, 'request-one', stamp, identity);
    const key = value.approval.decisionOptions!.find(offer => offer.label === 'Allow with command review')!.id;
    expect(value.responses.get(key)).toEqual({ permissions: { network: { enabled: true } }, scope: 'turn', strictAutoReview: true });
    expect(value.responses.get('decline')).toEqual({ permissions: {}, scope: 'turn' });
    expect(value.approval.description).not.toContain('{');
  });

  it('does not approve redacted, missing, unknown or oversized authority', () => {
    const value = nativeApprovalView('item/commandExecution/requestApproval', { ...base, command: 'secret command' }, 'request-one', stamp,
      text => text.replace('secret', '[redacted]'));
    expect(value.approval.decisions).toEqual(['decline', 'cancel']);
    expect(value.responses.has('accept')).toBe(false);
    expect(() => nativeApprovalView('item/commandExecution/requestApproval', { ...base, command: 'x'.repeat(16_001) }, 'request', stamp, identity)).toThrow();
    expect(() => nativeApprovalView('item/permissions/requestApproval', { ...base, cwd: '/workspace',
      permissions: { network: { enabled: true, allowEveryHost: true } } }, 'request', stamp, identity)).toThrow();
    expect(nativeApprovalView('item/commandExecution/requestApproval', base, 'request', stamp, identity).approval.decisions).toEqual(['decline', 'cancel']);
  });
});
