import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GeneratedImageMetadata, ToolActivity } from '../shared/types';
import { ActivityCard } from '../client/components/chat/ActivityCard';
import { GeneratedImageCard, generatedImageAltText, generatedImageDestination, validGeneratedImage, validateGeneratedImageSave, type GeneratedImageScope } from '../client/components/chat/GeneratedImageCard';
import { formatToolActivity } from '../client/components/chat/tool-presentation';

const image: GeneratedImageMetadata = {
  id: `img_${'a'.repeat(64)}`, sha256: 'b'.repeat(64), workspaceId: 'workspace-a', threadId: 'thread-owner', messageId: 'message-original', runId: 'run-image', itemId: 'ig_provider_item',
  state: 'completed', mimeType: 'image/png', bytes: 2048, width: 1024, height: 1024, createdAt: '2026-09-20T12:00:00.000Z',
  previewUrl: `/api/workspaces/workspace-a/generated-images/img_${'a'.repeat(64)}/content?sha256=${'b'.repeat(64)}`, revisedPrompt: 'A white ceramic cup on a dark table.',
};
const scope: GeneratedImageScope = { workspaceId: image.workspaceId, threadId: 'thread-explicit-fork', locked: false, executionBlocked: false };
const activity = (name = 'generate_image', overrides: Partial<ToolActivity> = {}): ToolActivity => ({ id: 'image-tool', name, input: JSON.stringify({ prompt: 'Draw a cup.' }),
  output: JSON.stringify({ status: 'completed', image: { id: image.id, sha256: image.sha256, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType }, notice: 'The generated image is saved.' }),
  generatedImage: image, status: 'completed', startedAt: image.createdAt, ...overrides });
const receipt = (path = 'images/cup.png') => ({ image, path, version: image.sha256, entry: { path, name: path.split('/').at(-1), kind: 'file', size: image.bytes, isSymlink: false } });

describe('generated image browser boundary', () => {
  it('accepts completed immutable metadata only in its workspace, including an explicit fork carrying the original owner', () => {
    expect(validGeneratedImage(image, 'workspace-a')).toBe(true);
    expect(validGeneratedImage(image, 'workspace-b')).toBe(false);
    const html = renderToStaticMarkup(<GeneratedImageCard image={image} scope={scope} onNotify={() => undefined} />);
    expect(html).toContain('<img');
    expect(html).toContain(image.previewUrl);
    expect(html).toContain('Download');
    expect(html).toContain('Save to workspace');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('Codex');
    expect(html).not.toContain('base64');
    expect(html).not.toContain(image.threadId);
  });

  it('rejects foreign/data/relative preview URLs, malformed identity, unsupported or unbounded image records before creating an image element', () => {
    const changes: Record<string, unknown>[] = [
      { previewUrl: 'https://outside.example/image.png' }, { previewUrl: '//outside.example/image.png' }, { previewUrl: 'data:image/png;base64,ABCD' },
      { previewUrl: `${image.previewUrl}&url=https://outside.example/` }, { previewUrl: image.previewUrl.replace(image.sha256, 'c'.repeat(64)) },
      { state: 'generating' }, { id: '../other' }, { sha256: 'not-a-digest' }, { threadId: 'owner/other' }, { itemId: 'invalid\nitem' },
      { mimeType: 'image/svg+xml' }, { bytes: 0 }, { bytes: 8 * 1024 * 1024 + 1 }, { width: 0 }, { height: 16_385 }, { width: 16_000, height: 16_000 },
      { createdAt: 'not-a-date' }, { revisedPrompt: '\0hidden' }, { revisedPrompt: '☕'.repeat(12_000) },
    ];
    for (const changed of changes) {
      const candidate = { ...image, ...changed } as GeneratedImageMetadata;
      expect(validGeneratedImage(candidate, image.workspaceId)).toBe(false);
      const html = renderToStaticMarkup(<GeneratedImageCard image={candidate} scope={scope} onNotify={() => undefined} />);
      expect(html).not.toContain('<img');
      expect(html).not.toContain('<button');
      expect(html).toContain('could not be verified');
    }
  });

  it('hides locked content, refuses absent scope and leaves save disabled until the selected view explicitly permits site writes', () => {
    expect(renderToStaticMarkup(<GeneratedImageCard image={image} scope={{ ...scope, locked: true }} onNotify={() => undefined} />)).toBe('');
    expect(renderToStaticMarkup(<GeneratedImageCard image={image} onNotify={() => undefined} />)).not.toContain('<img');
    const unknown = renderToStaticMarkup(<GeneratedImageCard image={image} scope={{ ...scope, executionBlocked: undefined }} onNotify={() => undefined} />);
    expect(unknown).toContain('<img');
    expect(unknown).toContain('disabled=""');
    expect(unknown).toContain('Wait for the conversation and workspace to be ready');
  });

  it('uses bounded escaped public prompt alt text and never injects the prompt as markup', () => {
    expect(generatedImageAltText()).toBe('Generated image');
    expect(generatedImageAltText('  A\nwhite\t cup\u202e  ')).toBe('A white cup');
    expect(generatedImageAltText('x'.repeat(2000))).toHaveLength(280);
    const html = renderToStaticMarkup(<GeneratedImageCard image={{ ...image, revisedPrompt: '<script>window.bad=true</script><img src="https://outside.example/">' }} scope={scope} onNotify={() => undefined} />);
    expect(html).toContain('alt="&lt;script&gt;');
    expect(html).not.toContain('<script');
    expect(html.match(/<img /g)).toHaveLength(1);
  });
});

describe('generated image save confirmations', () => {
  it('keeps the exact workspace-relative filename and enforces the saved image format', () => {
    expect(generatedImageDestination('images/白い cup.png', image)).toBe('images/白い cup.png');
    expect(generatedImageDestination('photo.jpeg', { ...image, mimeType: 'image/jpeg' })).toBe('photo.jpeg');
    for (const path of ['', '../cup.png', 'images/../cup.png', '/cup.png', 'images//cup.png', './cup.png', 'images\\cup.png', 'https://site/cup.png', 'cup\0.png', 'cup.jpg', 'cup.svg', `${'x'.repeat(256)}.png`]) {
      expect(() => generatedImageDestination(path, image), path).toThrow();
    }
  });

  it('requires an exact image and destination receipt instead of trusting an HTTP success or a foreign path', () => {
    expect(() => validateGeneratedImageSave(receipt(), image, 'images/cup.png')).not.toThrow();
    const changes: Record<string, unknown>[] = [
      { path: 'elsewhere/cup.png' }, { version: 'c'.repeat(64) }, { image: { ...image, workspaceId: 'workspace-b' } },
      { image: { ...image, messageId: 'another-message' } }, { image: { ...image, sha256: 'c'.repeat(64) } }, { image: { ...image, width: 2048 } },
      { entry: { ...receipt().entry, path: 'wrong.png' } }, { entry: { ...receipt().entry, kind: 'directory' } },
      { entry: { ...receipt().entry, size: 10 } }, { entry: { ...receipt().entry, isSymlink: true } },
    ];
    for (const changed of changes) expect(() => validateGeneratedImageSave({ ...receipt(), ...changed }, image, 'images/cup.png')).toThrow();
  });
});

describe('generated image activity presentation', () => {
  it('places generation and read previews in the activity itself without a separate assistant header', () => {
    for (const name of ['generate_image', 'read_generated_image']) {
      const html = renderToStaticMarkup(<ActivityCard activity={activity(name)} generatedImageScope={scope} onNotify={() => undefined} />);
      expect(html).toContain('cw-generated-image');
      expect(html).not.toContain('chat-activity-summary');
      expect(html).not.toContain('Codex');
    }
    const unrelated = renderToStaticMarkup(<ActivityCard activity={activity('read_file')} generatedImageScope={scope} onNotify={() => undefined} />);
    expect(unrelated).not.toContain('<img');
    const failed = renderToStaticMarkup(<ActivityCard activity={activity('generate_image', { status: 'error', output: JSON.stringify({ error: 'The request stopped after the image was saved.' }) })} generatedImageScope={scope} onNotify={() => undefined} />);
    expect(failed).toContain('<img');
    expect(failed).toContain('this step ended with an error');
    expect(failed).toContain('The request stopped after the image was saved.');
  });

  it('shows truthful generating/saving/failure states without byte strings or protocol envelopes', () => {
    for (const status of ['in_progress', 'generating', 'saving']) {
      const view = formatToolActivity(activity('generate_image', { status: 'running', generatedImage: undefined, output: JSON.stringify({ status, notice: status === 'saving' ? 'Verifying the saved image…' : 'The image is being generated.', result: 'RAW_IMAGE_BYTES', encrypted_content: 'PRIVATE_REASONING' }) }));
      expect(view.label).toBe('Generating image');
      expect(view.statusLabel).toBe(status === 'saving' ? 'Saving' : 'Generating');
      expect(JSON.stringify(view)).not.toMatch(/RAW_IMAGE_BYTES|PRIVATE_REASONING|"result"|encrypted_content/);
    }
    const failed = formatToolActivity(activity('generate_image', { status: 'error', output: JSON.stringify({ error: 'Image generation was not available for this model.' }) }));
    expect(failed.statusLabel).toBe('Failed');
    expect(JSON.stringify(failed)).toContain('not available for this model');
  });

  it('shows a bounded metadata catalog without authorizing links or printing immutable IDs/digests', () => {
    const records = Array.from({ length: 100 }, () => ({ ...image, revisedPrompt: 'A cup.' }));
    const view = formatToolActivity(activity('list_generated_images', { generatedImage: undefined, input: JSON.stringify({ offset: 20, limit: 100 }), output: JSON.stringify({ images: records, offset: 20, total: 140, nextOffset: 120 }) }));
    const rows = view.sections.find(section => section.type === 'rows');
    expect(rows?.type === 'rows' && rows.rows).toHaveLength(60);
    if (rows?.type === 'rows') { expect(rows.rows[0].title).toBe('Image 21'); expect(rows.rows.every(row => !row.path && !row.url)).toBe(true); }
    expect(view.truncated).toBe(true);
    expect(JSON.stringify(view)).not.toContain(image.id);
    expect(JSON.stringify(view)).not.toContain(image.sha256);
    expect(JSON.stringify(view)).not.toContain(image.previewUrl);
  });

  it('shows native image copies as real workspace changes with their actual review outcome', () => {
    const view = formatToolActivity(activity('copy_generated_image', { generatedImage: undefined, input: JSON.stringify({ id: image.id, sha256: image.sha256, path: 'images/copied.png' }),
      output: JSON.stringify({ ...receipt('images/copied.png'), review: { undoAvailable: true, changeIds: ['change-image'], notice: 'The saved image can be reviewed.' } }) }));
    expect(view.label).toBe('Copied generated image');
    expect(view.summary).toBe('Copied to workspace');
    expect(view.sections.find(section => section.type === 'rows')).toMatchObject({ rows: [{ path: 'images/copied.png', badge: 'Copied' }] });
    expect(JSON.stringify(view)).toContain('Available in change review');
    expect(JSON.stringify(view)).not.toContain(image.id);
    const waiting = formatToolActivity(activity('copy_generated_image', { generatedImage: undefined, status: 'awaiting_approval', output: undefined, input: JSON.stringify({ path: 'images/copied.png' }) }));
    const proposed = waiting.sections.find(section => section.type === 'rows');
    if (proposed?.type === 'rows') expect(proposed.rows[0].path).toBeUndefined();
    expect(waiting.summary).toBe('');
  });
});
