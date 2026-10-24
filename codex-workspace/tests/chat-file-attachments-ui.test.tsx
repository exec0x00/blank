import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FileAttachment, FileAttachmentInspection, ToolActivity } from '../shared/types';
import { isPhotoAttachment } from '../client/components/chat/ChatAttachmentInput';
import { ComposerFileCard, FileInspectionContent, MessageFileAttachments, validateFileInspection } from '../client/components/chat/FileAttachments';
import type { ComposerFileAttachment } from '../client/components/chat/useFileAttachments';
import { formatToolActivity } from '../client/components/chat/tool-presentation';

const attachment: FileAttachment = { id: `file_${'a'.repeat(32)}`, workspaceId: 'workspace-a', name: 'report.txt', mimeType: 'text/plain', bytes: 100, sha256: 'b'.repeat(64), createdAt: '2026-09-20T00:00:00.000Z' };
const item: ComposerFileAttachment = { key: 'draft-file', name: attachment.name, mimeType: attachment.mimeType, bytes: attachment.bytes, stage: 'uploading', bytesUploaded: 38, bytesImported: 0 };
const page: FileAttachmentInspection = { attachment, format: 'utf8', offset: 0, bytesRead: 100, totalBytes: 100, truncated: false, content: 'File text' };
const render = (value = item) => renderToStaticMarkup(<ComposerFileCard item={value} onCancel={() => undefined} onRemove={() => undefined} onRetry={() => undefined} />);

describe('chat attachment presentation', () => {
  it('shows the filename, type, size, measured progress and accessible per-file cancellation', () => {
    const html = render();
    expect(html).toContain('report.txt'); expect(html).toContain('Text · 100 B');
    expect(html).toContain('aria-valuenow="38"'); expect(html).toContain('aria-valuetext="38 B of 100 B"');
    expect(html).toContain('aria-label="Cancel upload of report.txt"'); expect(html).not.toContain('>Ready<');
  });

  it('distinguishes server verification from completed transfer and keeps failures blocking', () => {
    const verifying = render({ ...item, stage: 'importing', bytesUploaded: 100, bytesImported: 12 });
    expect(verifying).toContain('Verifying file'); expect(verifying).toContain('aria-valuenow="12"'); expect(verifying).not.toContain('>Ready<');
    const failed = render({ ...item, stage: 'unconfirmed', error: 'Could not confirm the upload.' });
    expect(failed).toContain('role="alert"'); expect(failed).toContain('Check upload of report.txt'); expect(failed).not.toContain('role="progressbar"');
  });

  it('renders saved file cards with explicit inspect and download actions, without URLs or protocol data', () => {
    const html = renderToStaticMarkup(<MessageFileAttachments workspaceId="workspace-a" attachments={[attachment]} />);
    expect(html).toContain('aria-label="Attached files"'); expect(html).toContain('Inspect attached file report.txt'); expect(html).toContain('Download file report.txt');
    expect(html).not.toContain(attachment.sha256); expect(html).not.toContain('/content'); expect(html).not.toContain('<iframe');
    expect(renderToStaticMarkup(<MessageFileAttachments workspaceId="workspace-a" attachments={[attachment]} locked />)).toBe('');
    const wrongWorkspace = renderToStaticMarkup(<MessageFileAttachments workspaceId="workspace-b" attachments={[attachment]} />);
    expect(wrongWorkspace).toContain('Unavailable'); expect(wrongWorkspace.match(/disabled=""/g)).toHaveLength(2);
  });

  it('presents file text as escaped text and does not embed executable HTML or remote resources', () => {
    const html = renderToStaticMarkup(<FileInspectionContent inspection={{ ...page, content: '<script>window.executed = true</script>\n<img src="https://outside.test/pixel">\n{"actual":"file content"}' }} />);
    expect(html).toContain('&lt;script&gt;'); expect(html).toContain('file content'); expect(html).not.toContain('<script'); expect(html).not.toContain('<img');
    const binary = renderToStaticMarkup(<FileInspectionContent inspection={{ ...page, format: 'binary', content: undefined, notice: 'This PDF has not been parsed.', hex: '25 50 44 46' }} />);
    expect(binary).toContain('This PDF has not been parsed.'); expect(binary).toContain('<details>'); expect(binary).not.toContain('<details open');
    expect(binary).not.toContain('<embed'); expect(binary).not.toContain('<iframe');
  });

  it('bounds and validates inspection identity before rendering returned text', () => {
    expect(validateFileInspection(page, attachment, 0)).toBe(page);
    for (const changed of [{ attachment: { ...attachment, sha256: 'c'.repeat(64) } }, { content: 'x'.repeat(16 * 1024 + 1) }, { offset: 5 }, { totalBytes: 99 }, { nextOffset: -1 }]) {
      expect(() => validateFileInspection({ ...page, ...changed }, attachment, 0)).toThrow();
    }
  });

  it('keeps supported photos in the existing image workflow and treats other files as files', () => {
    expect(isPhotoAttachment({ name: 'photo.jpg', type: 'image/jpeg' })).toBe(true);
    expect(isPhotoAttachment({ name: 'PHOTO.PNG', type: '' })).toBe(true);
    for (const file of [{ name: 'figure.svg', type: 'image/svg+xml' }, { name: 'report.pdf', type: 'application/pdf' }, { name: 'readme.md', type: 'text/markdown' }, { name: 'download.png', type: 'text/html' }]) expect(isPhotoAttachment(file)).toBe(false);
  });
});

describe('native attachment tool presentation', () => {
  const activity = (name: string, output: unknown, input: unknown = { id: attachment.id, sha256: attachment.sha256 }, status: ToolActivity['status'] = 'completed'): ToolActivity => ({
    id: 'attachment-tool', name, input: JSON.stringify(input), ...(output === undefined ? {} : { output: JSON.stringify(output) }), status, startedAt: attachment.createdAt,
  });

  it('lists real attachment metadata without IDs, digests or false editor navigation', () => {
    const view = formatToolActivity(activity('list_file_attachments', { attachments: [attachment], total: 2, offset: 0, nextOffset: 1, notice: 'Read a file to inspect its contents.' }, { offset: 0, limit: 1 }));
    expect(view.label).toBe('Listed attachments'); expect(view.summary).toBe('1 of 2 attachments');
    const files = view.sections.find(section => section.type === 'rows');
    expect(files).toMatchObject({ rows: [{ title: 'report.txt', badge: '100 B', detail: 'text/plain' }] });
    if (files?.type === 'rows') expect(files.rows[0].path).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain(attachment.id); expect(JSON.stringify(view)).not.toContain(attachment.sha256);
  });

  it('keeps real text and code inspectable while omitting transport fields', () => {
    const text = '{"actual":"file contents","count":3}';
    const view = formatToolActivity(activity('read_file_attachment', { ...page, content: text }, { id: attachment.id, sha256: attachment.sha256, offset: 0, max_bytes: 16384 }));
    expect(view.label).toBe('Read attachment'); expect(view.preview).toBe('report.txt');
    expect(view.summary).toBe('Bytes 1–100 of 100');
    expect(view.sections.find(section => section.type === 'code')).toMatchObject({ title: 'Attachment text', text });
    expect(JSON.stringify(view)).not.toContain('max_bytes'); expect(JSON.stringify(view)).not.toContain(attachment.sha256);
  });

  it('states that binary contents were not parsed without dumping hex or a JSON envelope', () => {
    const view = formatToolActivity(activity('read_file_attachment', { ...page, format: 'binary', content: undefined, hex: '2550444600BINARYBYTES', notice: 'PDF text has not been extracted.' }));
    expect(view.label).toBe('Inspected attachment'); expect(view.sections.filter(section => section.type === 'code')).toEqual([]);
    expect(JSON.stringify(view)).toContain('Document contents have not been parsed');
    expect(JSON.stringify(view)).toContain('PDF text has not been extracted');
    expect(JSON.stringify(view)).not.toContain('BINARYBYTES'); expect(JSON.stringify(view)).not.toContain('sha256');
  });

  it('shows the copied destination and an explicit unavailable Undo without claiming review actions', () => {
    const view = formatToolActivity(activity('copy_file_attachment', { attachment, path: 'incoming/report.txt', entry: { path: 'incoming/report.txt', kind: 'file' }, version: attachment.sha256,
      review: { undoAvailable: false, changeIds: [], notice: 'The copy exceeds the review limit. Undo is not available.' }, warnings: ['The original attachment remains saved.'] }, { id: attachment.id, sha256: attachment.sha256, path: 'incoming/report.txt' }));
    expect(view.label).toBe('Copied attachment'); expect(view.summary).toBe('Copied to workspace');
    expect(view.sections.find(section => section.type === 'rows')).toMatchObject({ rows: [{ path: 'incoming/report.txt', badge: 'Copied' }] });
    expect(view.notices).toContainEqual({ kind: 'warning', text: 'The copy exceeds the review limit. Undo is not available.' });
    expect(JSON.stringify(view)).not.toContain('Available in change review'); expect(JSON.stringify(view)).not.toContain(attachment.sha256);
    const pending = formatToolActivity(activity('copy_file_attachment', undefined, { id: attachment.id, sha256: attachment.sha256, path: 'incoming/report.txt' }, 'awaiting_approval'));
    expect(pending.label).toBe('Copy attachment'); expect(pending.summary).toBe('');
    const proposed = pending.sections.find(section => section.type === 'rows');
    if (proposed?.type === 'rows') { expect(proposed.rows[0].path).toBeUndefined(); expect(proposed.rows[0].badge).toBe('Proposed'); }
  });
});
