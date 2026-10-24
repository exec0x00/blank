import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { NativeFeatureFlag, NativeFeedbackPreview, NativeImportPreview } from '../shared/native-discovery';
import { NativeDiscoveryPanel, NativeFeatureRow, NativeFeedbackReview, NativeImportReview } from '../client/components/native/NativeDiscoveryPanel';

const imports: NativeImportPreview = {
  nativeConfirmed: true, observedAt: '2026-09-30T10:00:00Z', source: 'claude', previewId: 'private-preview-handle', expiresAt: '2026-09-30T10:10:00Z', excludedCount: 1,
  note: 'Review the paths before importing.',
  items: [
    { id: 'instructions', itemType: 'AGENTS_MD', label: 'Project instructions', description: 'Use existing instructions in Codex.', sourcePaths: ['CLAUDE.md'], destinationPaths: ['AGENTS.md'], count: 1, allowed: true, blockedReason: null },
    { id: 'configuration', itemType: 'CONFIG', label: 'Tool configuration', description: 'Settings from the source tool.', sourcePaths: ['.claude/settings.json'], destinationPaths: ['.codex/config.toml'], count: 1, allowed: false, blockedReason: 'Provider routing is managed by this host.' },
  ],
};
const feedback: NativeFeedbackPreview = {
  previewId: 'private-feedback-handle', expiresAt: '2026-09-30T10:10:00Z', destination: 'OpenAI feedback service', includeLogs: false,
  files: [{ path: 'notes/reproduction.md', bytes: 1234 }],
};
const feature: NativeFeatureFlag = { name: 'example', label: 'Example feature', description: 'Available for this runtime.', enabled: true, defaultEnabled: false, stage: 'beta', canToggle: true, blockedReason: null };
const noop = () => undefined;
const renderImport = (selected: string[] = [], expired = false, busy = false) => renderToStaticMarkup(<NativeImportReview preview={imports} selected={selected} expired={expired} busy={busy} onSelect={noop} onImport={noop} />);
const renderFeedback = (consent = false, expired = false, busy = false) => renderToStaticMarkup(<NativeFeedbackReview preview={feedback} classification="bug" reason={'Description <script>inert</script>'} threadReference={false} consent={consent} expired={expired} busy={busy} onConsent={noop} onSend={noop} />);

describe('native discovery review gates', () => {
  it('starts an import with no selections and clearly shows both paths and the blocked reason', () => {
    const html = renderImport();
    expect(html).toContain('0 categories selected');
    expect(html).toContain('CLAUDE.md'); expect(html).toContain('AGENTS.md');
    expect(html).toContain('Provider routing is managed by this host.');
    expect(html).not.toContain('checked=""');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Import selected content/);
    expect(html).not.toContain('private-preview-handle');
  });

  it('does not count or check a blocked category even if its ID is supplied in the selection', () => {
    const html = renderImport(['configuration']);
    expect(html).toContain('0 categories selected');
    expect(html).not.toContain('checked=""');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Import selected content/);
    const allowed = renderImport(['instructions', 'configuration']);
    expect(allowed).toContain('1 category selected');
    expect(allowed.match(/checked=""/g)).toHaveLength(1);
    expect(allowed).not.toMatch(/<button[^>]*disabled=""[^>]*>Import selected content/);
  });

  it('blocks expired and in-flight imports while retaining their reviewable destinations', () => {
    const expired = renderImport(['instructions'], true);
    expect(expired).toContain('This preview has expired.');
    expect(expired).toMatch(/<button[^>]*disabled=""[^>]*>Import selected content/);
    expect(expired).toContain('AGENTS.md');
    expect(renderImport(['instructions'], false, true)).toMatch(/<button[^>]*disabled=""[^>]*>Starting import/);
  });

  it('requires explicit consent before feedback can be sent and exposes exact file sizes and destination', () => {
    const html = renderFeedback();
    expect(html).toContain('OpenAI feedback service');
    expect(html).toContain('notes/reproduction.md'); expect(html).toContain('1,234 bytes');
    expect(html).toContain('Built-in logs'); expect(html).toContain('Not included');
    expect(html).not.toContain('checked=""');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Send feedback to OpenAI/);
    expect(html).not.toContain('private-feedback-handle');
    expect(html).toContain('&lt;script&gt;inert&lt;/script&gt;'); expect(html).not.toContain('<script>');
    expect(renderFeedback(true)).not.toMatch(/<button[^>]*disabled=""[^>]*>Send feedback to OpenAI/);
  });

  it('keeps sending blocked after consent if the preview has expired or a send is pending', () => {
    expect(renderFeedback(true, true)).toMatch(/<button[^>]*disabled=""[^>]*>Send feedback to OpenAI/);
    expect(renderFeedback(true, false, true)).toMatch(/<button[^>]*disabled=""[^>]*>Sending feedback/);
  });
});

describe('native discovery presentation', () => {
  it('renders a real labelled switch only for flags the server permits changing', () => {
    const editable = renderToStaticMarkup(<NativeFeatureRow feature={feature} busy={false} onToggle={noop} />);
    expect(editable).toContain('role="switch"'); expect(editable).toContain('aria-checked="true"');
    expect(editable).toContain('aria-labelledby='); expect(editable).toContain('Beta · Default off');
    const readonly = renderToStaticMarkup(<NativeFeatureRow feature={{ ...feature, canToggle: false, blockedReason: 'Managed by the host.' }} busy={false} onToggle={noop} />);
    expect(readonly).not.toContain('role="switch"'); expect(readonly).toContain('Managed by the host.');
    expect(readonly).toContain('>On</span>');
    expect(renderToStaticMarkup(<NativeFeatureRow feature={feature} busy onToggle={noop} />)).toContain('disabled=""');
  });

  it('starts with collapsed sections and no fabricated capability results or migration forms', () => {
    const html = renderToStaticMarkup(<NativeDiscoveryPanel workspaceId="workspace-a" threadId="thread-a" />);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(7);
    expect(html).toContain('Loading Runtime overview');
    expect(html).not.toContain('Reported available');
    expect(html).not.toContain('Import selected content');
    expect(html).not.toContain('Send feedback to OpenAI');
    expect(html).not.toContain('API key');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('<pre');
  });
});
