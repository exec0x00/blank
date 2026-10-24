import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../errors';
import { conflict } from './validation';
import type { FileSource } from './source';

interface BoundToken { format: 1; binding: string; version: string }
export interface PageCursor extends BoundToken { kind: 'page'; offset: number; line: number | null }
export interface RangeToken extends BoundToken { kind: 'range'; byteStart: number; byteEnd: number; line: number | null; sha256: string }
export interface SearchCursor extends BoundToken { kind: 'search'; offset: number; line: number; queryHash: string }
type Token = PageCursor | RangeToken | SearchCursor;
const safeOffset = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const safeLine = (value: unknown): value is number => safeOffset(value) && value >= 1;
const hex = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function invalid(): never { throw new HttpError(400, 'This file cursor is invalid. Reopen the file.', 'INVALID_FILE_CURSOR'); }

export class FilePageTokens {
  constructor(private readonly secret: string) {}

  sign<T extends Token>(token: T): string {
    const body = Buffer.from(JSON.stringify(token)).toString('base64url');
    return `${body}.${this.mac(body).toString('base64url')}`;
  }

  private mac(body: string): Buffer { return createHmac('sha256', this.secret).update(`file-pages-v1\0${body}`).digest(); }

  read<K extends Token['kind']>(value: unknown, kind: K): Extract<Token, { kind: K }> {
    if (typeof value !== 'string' || value.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) invalid();
    const [body, signature] = value.split('.');
    const actual = Buffer.from(signature!, 'base64url');
    const expected = this.mac(body!);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) invalid();
    let token: Token;
    try { token = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')) as Token; }
    catch { return invalid(); }
    if (!token || typeof token !== 'object' || token.format !== 1 || token.kind !== kind || !hex(token.binding) || !hex(token.version)) invalid();
    if (token.kind === 'page' && (!safeOffset(token.offset) || token.line !== null && !safeLine(token.line))) invalid();
    if (token.kind === 'range' && (!safeOffset(token.byteStart) || !safeOffset(token.byteEnd) || token.byteEnd < token.byteStart
      || token.line !== null && !safeLine(token.line) || !hex(token.sha256))) invalid();
    if (token.kind === 'search' && (!safeOffset(token.offset) || !safeLine(token.line) || !hex(token.queryHash))) invalid();
    return token as Extract<Token, { kind: K }>;
  }

  check(token: BoundToken, source: FileSource): void {
    if (token.binding !== source.binding || token.version !== source.version) conflict('The file or its path changed. Keep your edits and reopen the current file.');
  }
}
