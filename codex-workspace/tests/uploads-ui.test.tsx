import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import UploadProgress from '../client/components/UploadProgress';
import type { WorkspaceUploadProgress } from '../client/uploads';

const file: WorkspaceUploadProgress = { id: 'upload-1', index: 0, fileName: 'report.txt', path: 'notes/report.txt', size: 100, stage: 'uploading', bytesUploaded: 38, bytesImported: 0 };

describe('workspace upload progress', () => {
  it('shows measured source-byte progress and an accessible cancellation control', () => {
    const html = renderToStaticMarkup(<UploadProgress files={[file]} onCancel={() => undefined} />);
    expect(html).toContain('aria-label="File uploads"');
    expect(html).toContain('aria-valuenow="38"');
    expect(html).toContain('aria-valuetext="38 B of 100 B"');
    expect(html).toContain('aria-label="Cancel uploads"');
    expect(html).not.toContain('Saved to workspace');
  });

  it('keeps failure and uncertain save outcomes visible after transfer ends', () => {
    const html = renderToStaticMarkup(<UploadProgress files={[{ ...file, stage: 'unconfirmed', error: 'Refresh the destination folder before retrying.' }]} onDismiss={() => undefined} />);
    expect(html).toContain('Save not confirmed');
    expect(html).toContain('role="alert"');
    expect(html).toContain('0 of 1 saved');
    expect(html).toContain('aria-label="Dismiss uploads"');
    expect(html).not.toContain('role="progressbar"');
  });

  it('treats import progress separately from the completed direct transfer', () => {
    const html = renderToStaticMarkup(<UploadProgress files={[{ ...file, stage: 'importing', bytesUploaded: 100, bytesImported: 24 }]} onCancel={() => undefined} />);
    expect(html).toContain('Saving to workspace');
    expect(html).toContain('aria-valuenow="24"');
    expect(html).not.toContain('Saved to workspace');
  });
});
