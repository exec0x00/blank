/** UTF-8 byte boundaries are used throughout; JavaScript string offsets never identify a save range. */
export function utf8Boundary(bytes: Buffer, index: number): number {
  let boundary = Math.min(index, bytes.length);
  for (let count = 0; boundary > 0 && boundary < bytes.length && (bytes[boundary]! & 0xc0) === 0x80 && count < 3; count++) boundary--;
  return boundary;
}

export function lineBoundary(bytes: Buffer, index: number): boolean {
  if (index <= 0) return false;
  return bytes[index - 1] === 10 || bytes[index - 1] === 13 && bytes[index] !== 10;
}

export function noSplitBoundary(bytes: Buffer, index: number): number {
  let boundary = utf8Boundary(bytes, index);
  if (boundary > 0 && bytes[boundary - 1] === 13 && bytes[boundary] === 10) boundary--;
  return boundary;
}

/** Count completed LF, CRLF, and CR breaks, not an unfinished half of CRLF. */
export function lineBreaks(bytes: Buffer, start = 0, end = bytes.length): number {
  let count = 0;
  for (let index = start; index < end; index++) {
    if (bytes[index] === 13) {
      if (bytes[index + 1] === 10) { if (index + 1 < end) count++; index++; }
      else count++;
    } else if (bytes[index] === 10) count++;
  }
  return count;
}

export function nextCodePoint(bytes: Buffer, index: number): number {
  let next = index + 1;
  while (next < bytes.length && (bytes[next]! & 0xc0) === 0x80) next++;
  if (next > 0 && bytes[next - 1] === 13 && bytes[next] === 10) next++;
  return next;
}
