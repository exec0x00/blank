const OVERSCAN = 6;
export const TREE_WINDOW_THRESHOLD = 160;

/** Prefix offsets support variable status-row heights without scanning every row on scroll. */
export function treeWindowIndices(offsets: readonly number[], top: number, height: number, pinned: readonly number[] = []): number[] {
  const count = Math.max(0, offsets.length - 1);
  if (count <= TREE_WINDOW_THRESHOLD) return Array.from({ length: count }, (_, index) => index);
  const locate = (offset: number) => {
    let low = 0; let high = count;
    while (low < high) { const middle = Math.floor((low + high) / 2); if (offsets[middle + 1] < offset) low = middle + 1; else high = middle; }
    return Math.min(count - 1, low);
  };
  const first = Math.max(0, locate(Math.max(0, top)) - OVERSCAN);
  const last = Math.min(count - 1, locate(Math.max(0, top) + Math.max(0, height)) + OVERSCAN);
  const indices = new Set(Array.from({ length: last - first + 1 }, (_, index) => index + first));
  for (const index of pinned) if (index >= 0 && index < count) indices.add(index);
  return [...indices].sort((left, right) => left - right);
}
