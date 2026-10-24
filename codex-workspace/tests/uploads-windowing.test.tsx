import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import UploadProgress from '../client/components/UploadProgress';
import type { WorkspaceUploadProgress } from '../client/uploads';

const queued = (index: number): WorkspaceUploadProgress => ({
  id: `fixture-batch:${index}`, index, fileName: `file-${index}.txt`, path: `folder/file-${index}.txt`,
  size: 100, stage: 'queued', bytesUploaded: 0, bytesImported: 0,
});

describe('upload progress windowing', () => {
  it('retains the ordinary native list for the complete 50-file picker limit', () => {
    const files = Object.freeze(Array.from({ length: 50 }, (_, index) => Object.freeze(queued(index))));
    const html = renderToStaticMarkup(<UploadProgress files={files} onCancel={() => undefined} />);
    expect(html.match(/<li\b/g)).toHaveLength(50);
    expect(html).toContain('50 active');
    expect(html).toContain('Upload file-49.txt');
    expect(html).not.toContain('measured-window-row');
    expect(html).not.toContain('Show active upload');
  });

  it('mounts a bounded first window while counting every immutable planned file', () => {
    const files = Object.freeze(Array.from({ length: 1000 }, (_, index) => Object.freeze({
      ...queued(index),
      ...(index < 500 ? { stage: 'ready' as const, bytesUploaded: 100, bytesImported: 100 } : {}),
      ...(index === 500 ? { stage: 'importing' as const, bytesUploaded: 100, bytesImported: 25 } : {}),
    })));
    const html = renderToStaticMarkup(<UploadProgress files={files} onCancel={() => undefined} />);
    const mounted = html.match(/role="listitem"/g) ?? [];
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(25);
    expect(html).toContain('500 of 1000 saved · 499 waiting · 1 in progress');
    expect(html).toContain('aria-setsize="1000"');
    expect(html).toContain('aria-posinset="1"');
    expect(html).toContain('aria-label="Cancel uploads"');
    expect(html).not.toContain('file-999.txt');
    expect(files).toHaveLength(1000);
    expect(files[500].bytesImported).toBe(25);
    expect(files.every(Object.isFrozen)).toBe(true);
  });

  it('reports offscreen failures and uncertain saves without counting them as saved', () => {
    const files = Object.freeze(Array.from({ length: 1000 }, (_, index) => Object.freeze({
      ...queued(index), stage: index < 997 ? 'ready' as const : index === 997 ? 'failed' as const : index === 998 ? 'unconfirmed' as const : 'cancelled' as const,
    })));
    const html = renderToStaticMarkup(<UploadProgress files={files} onDismiss={() => undefined} />);
    expect(html).toContain('997 of 1000 saved · 1 failed · 1 not confirmed · 1 cancelled');
    expect(html).toContain('aria-label="Show upload problem"');
    expect(html).toContain('aria-label="Dismiss uploads"');
    expect(html).not.toContain('aria-label="Cancel uploads"');
    expect(html).not.toContain('1000 of 1000 saved');
    expect((html.match(/role="listitem"/g) ?? []).length).toBeLessThan(25);
  });
});
