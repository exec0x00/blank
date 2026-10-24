import type { WorkspaceFilePage } from '../../../shared/types';
import { textByteLength } from './large-file-documents';

export function lineStarts(content: string): number[] {
  const starts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\r') { if (content[index + 1] === '\n') index += 1; starts.push(index + 1); }
    else if (content[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

/** Monaco positions use UTF-16; file positions use UTF-8 bytes. */
export function byteOffsetAt(content: string, starts: readonly number[], line: number, column: number): number {
  const start = starts[Math.max(0, Math.min(starts.length - 1, line - 1))] ?? 0;
  const end = starts[line] ?? content.length;
  return textByteLength(content.slice(0, Math.min(end, start + Math.max(0, column - 1))));
}

export function positionAtByte(content: string, bytes: number): { lineNumber: number; column: number } {
  let read = 0; let offset = 0;
  for (const character of content) {
    const size = textByteLength(character);
    if (read + size > bytes) break;
    read += size; offset += character.length;
  }
  const starts = lineStarts(content);
  let index = 0;
  while (index + 1 < starts.length && starts[index + 1] <= offset) index += 1;
  return { lineNumber: index + 1, column: offset - starts[index] + 1 };
}

export function pagePositionLabel(page: WorkspaceFilePage, content: string, line: number, column: number, unsaved: boolean): string {
  const bom = page.byteStart === 0 && content.startsWith('\uFEFF') ? 3 : 0;
  const visible = bom ? content.slice(1) : content;
  const starts = lineStarts(visible);
  const byte = page.byteStart + bom + byteOffsetAt(visible, starts, line, column);
  const prefix = `${unsaved ? 'Edited byte' : 'Byte'} ${byte.toLocaleString()}`;
  if (!unsaved && page.endsMidLine && content.endsWith('\r') && line === starts.length) return `${prefix} · Line break continues on next page`;
  if (page.startLine === null) return `${prefix} · Page Ln ${line.toLocaleString()}, Col ${column.toLocaleString()}`;
  const global = page.startLine + line - 1;
  const continued = line === 1 && page.startsMidLine;
  return `${prefix} · Ln ${global.toLocaleString()}, ${continued ? 'page col' : 'Col'} ${column.toLocaleString()}`;
}

export function pageRangeLabel(page: WorkspaceFilePage): string {
  const bytes = `Saved bytes ${page.byteStart.toLocaleString()}–${page.byteEnd.toLocaleString()} of ${page.size.toLocaleString()}`;
  if (page.startLine === null || page.endLine === null) return `${bytes} · Global lines unknown`;
  return `${bytes} · Lines ${page.startLine.toLocaleString()}–${page.endLine.toLocaleString()}${page.totalLines === null ? '' : ` of ${page.totalLines.toLocaleString()}`}`;
}
