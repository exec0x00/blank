import path from 'node:path';
import { HttpError } from '../errors';
import { MAX_PAGE_BYTES, MAX_SEARCH_QUERY_BYTES } from './limits';

export function filePagePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || Buffer.byteLength(value) > 4096
    || /[\\\u0000-\u001f\u007f]/.test(value) || path.posix.isAbsolute(value) || /^[a-z]:/i.test(value)
    || value.split('/').some(part => part === '..' || part.startsWith('.codex-write-'))) {
    throw new HttpError(400, 'Choose a relative file path inside this workspace.', 'INVALID_PATH');
  }
  const normalized = path.posix.normalize(value).replace(/\/$/, '');
  if (!normalized || normalized === '.' || normalized.split('/').length > 96) {
    throw new HttpError(400, 'Choose a file inside this workspace.', 'INVALID_PATH');
  }
  return normalized;
}

export function filePageVersion(value: unknown, required = false): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new HttpError(400, 'A valid file version is required. Reopen the file.', 'INVALID_FILE_VERSION');
  }
  return value;
}

export function filePageOffset(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value === 'string' && /^\d{1,16}$/.test(value)) value = Number(value);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new HttpError(400, 'The byte offset must be a nonnegative safe integer.', 'INVALID_FILE_OFFSET');
  }
  return value;
}

export function searchQuery(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > MAX_SEARCH_QUERY_BYTES || Buffer.byteLength(value) > MAX_SEARCH_QUERY_BYTES
    || value.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)) {
    throw new HttpError(400, 'Search for 1–4096 bytes of valid UTF-8 text.', 'INVALID_SEARCH');
  }
  return value;
}

export function caseSensitivity(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== 'boolean') throw new HttpError(400, 'caseSensitive must be a boolean.', 'INVALID_SEARCH');
  return value;
}

export function rangeContent(value: unknown): Buffer {
  if (typeof value !== 'string') throw new HttpError(400, 'The edited page must contain text.', 'INVALID_FILE_CONTENT');
  if (value.length > MAX_PAGE_BYTES || Buffer.byteLength(value) > MAX_PAGE_BYTES) {
    throw new HttpError(413, 'An edited page must contain no more than 256 KiB of text.', 'FILE_PAGE_TOO_LARGE');
  }
  if (value.includes('\0') || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)) {
    throw new HttpError(415, 'The edited page must contain valid UTF-8 text without binary bytes.', 'BINARY_FILE');
  }
  return Buffer.from(value, 'utf8');
}

export function conflict(message = 'This file changed outside the editor. Keep your edits and reload the current file before saving.'): never {
  throw new HttpError(409, message, 'VERSION_CONFLICT');
}

export function textBytes(bytes: Buffer): string {
  if (bytes.includes(0)) throw new HttpError(415, 'This part of the file contains binary bytes. Download the file to preserve its contents.', 'BINARY_FILE');
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new HttpError(415, 'This part of the file is not valid UTF-8. Download the file to preserve its encoding.', 'BINARY_FILE'); }
}

export function languageFor(filePath: string): string {
  const name = path.posix.basename(filePath).toLowerCase();
  if (name === 'dockerfile' || name.startsWith('dockerfile.')) return 'dockerfile';
  if (name === 'makefile') return 'makefile';
  if (name === '.gitignore' || name.startsWith('.env')) return 'ini';
  const languages: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    json: 'json', jsonc: 'json', ipynb: 'json', md: 'markdown', mdx: 'markdown', py: 'python', pyi: 'python', rs: 'rust', go: 'go', java: 'java',
    kt: 'kotlin', kts: 'kotlin', cs: 'csharp', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', swift: 'swift', rb: 'ruby', php: 'php',
    html: 'html', htm: 'html', vue: 'html', svelte: 'html', css: 'css', scss: 'scss', less: 'less', xml: 'xml', svg: 'xml', yaml: 'yaml',
    yml: 'yaml', sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', sql: 'sql', toml: 'ini', ini: 'ini', conf: 'ini', env: 'ini',
    r: 'r', dart: 'dart', lua: 'lua', graphql: 'graphql', gql: 'graphql', bat: 'bat', ps1: 'powershell',
  };
  return languages[name.split('.').pop() ?? ''] ?? 'plaintext';
}
