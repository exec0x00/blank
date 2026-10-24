import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppContext } from '../server/context';
import { loadConfig } from '../server/config';
import { JsonStore } from '../server/store';
import { WorkspaceService } from '../server/workspaces';
import { VIEW_IMAGE_LIMITS, inspectImageBytes, viewImageTool, viewWorkspaceImage } from '../server/agent/image';

// Real 1×1 raster fixtures, independently encoded with Pillow. No image decoder
// or fixture generator is needed by the application or test runner.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4bm4DAANjAVvvpjgdAAAAAElFTkSuQmCC', 'base64');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDLooorxz9OP//Z', 'base64');
const gif = Buffer.from('R0lGODdhAQABAIEAAOc3PAAAAAAAAAAAACwAAAAAAQABAAAIBAABBAQAOw==', 'base64');
const webp = Buffer.from('UklGRjoAAABXRUJQVlA4IC4AAACQAQCdASoBAAEAAUAmJaACdLoAA5gA/urUf/cdgbrxb/97Bf+9AP+9AP6+AAAA', 'base64');
const animatedGif = Buffer.from('R0lGODlhAQABAIEAAOc3PAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQABQAAACwAAAAAAQABAAAIBAABBAQAIfkEAQUAAQAsAAAAAAEAAQCBKissAAAAAAAAAAAACAQAAQQEADs=', 'base64');

describe('native Codex view_image', () => {
  let directory: string;
  let workspaceId: string;
  let workspacePath: string;
  let ctx: AppContext;

  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), 'codex-agent-image-'));
    const config = loadConfig({ DATA_DIR: directory, WORKSPACE_PASSWORD: 'image-test-only', SESSION_SECRET: 's'.repeat(64), ENCRYPTION_KEY: 'k'.repeat(64) });
    const store = new JsonStore(config.stateDir);
    const workspaces = new WorkspaceService(config, store);
    await workspaces.initialize();
    const workspace = await workspaces.create({ name: 'Image tests' });
    workspaceId = workspace.id;
    workspacePath = workspace.path;
    ctx = { config, store, workspaces, events: new EventEmitter() } as AppContext;
  });
  afterEach(async () => { vi.restoreAllMocks(); await fs.rm(directory, { recursive: true, force: true }); });

  it.each([
    ['png', png, 'image/png'], ['jpeg', jpeg, 'image/jpeg'], ['gif', gif, 'image/gif'], ['webp', webp, 'image/webp'],
  ] as const)('delivers actual %s bytes in multimodal Responses output without emitting image logs', async (extension, bytes, mimeType) => {
    await fs.writeFile(join(workspacePath, `sample.${extension}`), bytes);
    const emit = vi.spyOn(ctx.events, 'emit');
    const result = await viewWorkspaceImage(ctx, workspaceId, `sample.${extension}`);
    expect(result.metadata).toEqual({ path: `sample.${extension}`, width: 1, height: 1, bytes: bytes.length, mimeType, detail: 'high' });
    const wire = JSON.parse(JSON.stringify({ type: 'function_call_output', call_id: 'call_image', output: result.output }));
    expect(wire.output[0]).toEqual({ type: 'input_text', text: result.logOutput });
    expect(wire.output[1]).toEqual({ type: 'input_image', image_url: `data:${mimeType};base64,${bytes.toString('base64')}`, detail: 'high' });
    expect(Buffer.from(wire.output[1].image_url.split(',')[1], 'base64')).toEqual(bytes);
    expect(JSON.stringify({ metadata: result.metadata, logOutput: result.logOutput })).not.toContain('base64');
    expect(result.logOutput).not.toContain(bytes.toString('base64'));
    expect(emit).not.toHaveBeenCalled();
  });

  it('identifies content independently of the extension, accepts absolute workspace paths, and preserves original bytes', async () => {
    const absolute = join(workspacePath, 'image.without-extension');
    await fs.writeFile(absolute, png);
    const result = await viewWorkspaceImage(ctx, workspaceId, absolute, { detail: 'original' });
    expect(result.metadata).toMatchObject({ path: 'image.without-extension', mimeType: 'image/png', detail: 'original' });
    expect(result.output[1]).toEqual({ type: 'input_image', image_url: `data:image/png;base64,${png.toString('base64')}`, detail: 'original' });
  });

  it('reuses the same bounded validator for images restored directly from conversation history', () => {
    expect(inspectImageBytes(png)).toEqual({ mimeType: 'image/png', width: 1, height: 1 });
    expect(() => inspectImageBytes(Buffer.alloc(0))).toThrowError(expect.objectContaining({ code: 'INVALID_IMAGE' }));
    expect(() => inspectImageBytes(Buffer.from('<svg/>'))).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_IMAGE' }));
    expect(() => inspectImageBytes(Buffer.alloc(VIEW_IMAGE_LIMITS.maxBytes + 1))).toThrowError(expect.objectContaining({ code: 'IMAGE_TOO_LARGE' }));
  });

  it('exposes a strict upstream-compatible path/detail schema and accepts null default detail', async () => {
    expect(viewImageTool).toMatchObject({ type: 'function', name: 'view_image', strict: true,
      parameters: { required: ['path', 'detail'], additionalProperties: false, properties: { detail: { enum: ['high', 'original', null] } } } });
    await fs.writeFile(join(workspacePath, 'sample.png'), png);
    expect((await viewWorkspaceImage(ctx, workspaceId, 'sample.png', { detail: null })).metadata.detail).toBe('high');
  });

  it('rejects files over the limit before allocating their contents and supports a smaller per-call bound', async () => {
    await fs.writeFile(join(workspacePath, 'sample.png'), png);
    await expect(viewWorkspaceImage(ctx, workspaceId, 'sample.png', { maxBytes: png.length - 1 })).rejects.toMatchObject({ status: 413, code: 'IMAGE_TOO_LARGE' });
    expect((await viewWorkspaceImage(ctx, workspaceId, 'sample.png', { maxBytes: png.length })).metadata.bytes).toBe(png.length);
    const handle = await fs.open(join(workspacePath, 'oversized.png'), 'w');
    await handle.truncate(VIEW_IMAGE_LIMITS.maxBytes + 1);
    await handle.close();
    await expect(viewWorkspaceImage(ctx, workspaceId, 'oversized.png')).rejects.toMatchObject({ status: 413, code: 'IMAGE_TOO_LARGE' });
    await expect(viewWorkspaceImage(ctx, workspaceId, 'sample.png', { maxBytes: VIEW_IMAGE_LIMITS.maxBytes + 1 })).rejects.toMatchObject({ code: 'INVALID_IMAGE_OPTIONS' });
  });

  it('rejects oversized dimensions before accepting compressed payloads', async () => {
    const wide = Buffer.from(png);
    wide.writeUInt32BE(VIEW_IMAGE_LIMITS.maxDimension + 1, 16);
    await fs.writeFile(join(workspacePath, 'wide.png'), wide);
    await expect(viewWorkspaceImage(ctx, workspaceId, 'wide.png')).rejects.toMatchObject({ status: 413, code: 'IMAGE_DIMENSIONS_EXCEEDED' });
    const large = Buffer.from(png);
    large.writeUInt32BE(10_000, 16);
    large.writeUInt32BE(10_000, 20);
    await fs.writeFile(join(workspacePath, 'large.png'), large);
    await expect(viewWorkspaceImage(ctx, workspaceId, 'large.png')).rejects.toMatchObject({ code: 'IMAGE_DIMENSIONS_EXCEEDED' });
  });

  it.each([
    ['script.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>bad()</script></svg>'), 'UNSUPPORTED_IMAGE'],
    ['empty.png', Buffer.alloc(0), 'INVALID_IMAGE'],
    ['truncated.png', png.subarray(0, png.length - 1), 'INVALID_IMAGE'],
    ['truncated.jpg', jpeg.subarray(0, jpeg.length - 2), 'INVALID_IMAGE'],
    ['truncated.gif', gif.subarray(0, gif.length - 1), 'INVALID_IMAGE'],
    ['truncated.webp', webp.subarray(0, webp.length - 1), 'INVALID_IMAGE'],
    ['animated.gif', animatedGif, 'ANIMATED_IMAGE'],
  ] as const)('rejects invalid or unsupported %s without returning any content', async (name, bytes, code) => {
    await fs.writeFile(join(workspacePath, name), bytes);
    await expect(viewWorkspaceImage(ctx, workspaceId, name)).rejects.toMatchObject({ status: 415, code });
  });

  it('rejects corrupt PNG chunks instead of trusting the extension and dimensions', async () => {
    const corrupt = Buffer.from(png);
    corrupt[45] ^= 1;
    await fs.writeFile(join(workspacePath, 'corrupt.png'), corrupt);
    await expect(viewWorkspaceImage(ctx, workspaceId, 'corrupt.png')).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
  });

  it('matches the complete format signature rather than masking high bits in ASCII bytes', async () => {
    const misleading = Buffer.from(gif);
    for (let index = 0; index < 6; index++) misleading[index] |= 0x80;
    await fs.writeFile(join(workspacePath, 'misleading.gif'), misleading);
    await expect(viewWorkspaceImage(ctx, workspaceId, 'misleading.gif')).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE' });
  });

  it('allows internal symbolic links while rejecting traversal, external files, and external directory links', async () => {
    await fs.mkdir(join(workspacePath, 'images'));
    await fs.writeFile(join(workspacePath, 'images', 'safe.png'), png);
    await fs.symlink('images/safe.png', join(workspacePath, 'internal.png'));
    expect((await viewWorkspaceImage(ctx, workspaceId, 'internal.png')).metadata.mimeType).toBe('image/png');
    await fs.mkdir(join(directory, 'private'));
    await fs.writeFile(join(directory, 'private', 'outside.png'), png);
    await fs.symlink(join(directory, 'private', 'outside.png'), join(workspacePath, 'outside.png'));
    await fs.symlink(join(directory, 'private'), join(workspacePath, 'linked-folder'));
    for (const name of ['outside.png', 'linked-folder/outside.png', join(directory, 'private', 'outside.png')]) {
      await expect(viewWorkspaceImage(ctx, workspaceId, name)).rejects.toMatchObject({ status: 403, code: 'UNSAFE_PATH' });
    }
    await expect(viewWorkspaceImage(ctx, workspaceId, '../private/outside.png')).rejects.toMatchObject({ code: 'INVALID_PATH' });
    await expect(viewWorkspaceImage(ctx, workspaceId, 'images')).rejects.toMatchObject({ code: 'NOT_A_FILE' });
    await expect(viewWorkspaceImage(ctx, workspaceId, 'missing.png')).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
  });

  it('rejects a parent directory replaced with an external symlink between resolution and open', async () => {
    await fs.mkdir(join(workspacePath, 'images'));
    await fs.mkdir(join(directory, 'external'));
    await fs.writeFile(join(workspacePath, 'images', 'safe.png'), png);
    await fs.writeFile(join(directory, 'external', 'safe.png'), png);
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementationOnce(async (file, flags, mode) => {
      await fs.rename(join(workspacePath, 'images'), join(workspacePath, 'original-images'));
      await fs.symlink(join(directory, 'external'), join(workspacePath, 'images'));
      return open(file, flags, mode);
    });
    await expect(viewWorkspaceImage(ctx, workspaceId, 'images/safe.png')).rejects.toMatchObject({ status: 403, code: 'UNSAFE_PATH' });
  });

  it('checks cancellation before resolving paths or reading an image', async () => {
    const abort = new AbortController();
    const reason = new Error('Image inspection cancelled');
    abort.abort(reason);
    const resolve = vi.spyOn(ctx.workspaces, 'resolvePath');
    await expect(viewWorkspaceImage(ctx, workspaceId, 'sample.png', { signal: abort.signal })).rejects.toBe(reason);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('cancels during a read and closes the open file without emitting partial image data', async () => {
    await fs.writeFile(join(workspacePath, 'sample.png'), png);
    const abort = new AbortController();
    const reason = new Error('Cancelled while reading image');
    const open = fs.open.bind(fs);
    let opened: Awaited<ReturnType<typeof fs.open>> | undefined;
    vi.spyOn(fs, 'open').mockImplementationOnce(async (file, flags, mode) => {
      opened = await open(file, flags, mode);
      const read = opened.read.bind(opened);
      vi.spyOn(opened, 'read').mockImplementationOnce((...args: Parameters<typeof read>) => {
        abort.abort(reason);
        return read(...args);
      });
      return opened;
    });
    await expect(viewWorkspaceImage(ctx, workspaceId, 'sample.png', { signal: abort.signal })).rejects.toBe(reason);
    expect(opened?.fd).toBe(-1);
  });
});
