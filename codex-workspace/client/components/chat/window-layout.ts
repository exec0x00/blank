export type WindowAnchor = { key: string; offset: number }
  | { edge: 'after'; offset: number };
export interface WindowLayout { keys: readonly string[]; offsets: number[]; total: number; indices: Map<string, number> }
export type WindowAlignment = 'start' | 'center' | 'end' | 'nearest';

/** The resident page cache is small; rebuilding these prefix sums is bounded. */
export function windowLayout(keys: readonly string[], heights: ReadonlyMap<string, number>, estimate: (index: number) => number): WindowLayout {
  const offsets = [0];
  const indices = new Map<string, number>();
  keys.forEach((key, index) => {
    indices.set(key, index);
    const height = heights.get(key) ?? estimate(index);
    offsets.push(offsets[index] + Math.max(1, Number.isFinite(height) ? height : 80));
  });
  return { keys, offsets, total: offsets.at(-1) ?? 0, indices };
}

export function indexAt(layout: WindowLayout, offset: number): number {
  let low = 0, high = layout.keys.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (layout.offsets[mid + 1] <= offset) low = mid + 1;
    else high = mid;
  }
  return Math.min(low, Math.max(0, layout.keys.length - 1));
}

export function visibleWindow(layout: WindowLayout, top: number, height: number, overscan = 500) {
  if (!layout.keys.length) return { start: 0, end: 0 };
  return {
    start: indexAt(layout, Math.max(0, top - overscan)),
    end: Math.min(layout.keys.length, indexAt(layout, Math.max(0, top) + Math.max(1, height) + overscan) + 1),
  };
}

export function anchorAt(layout: WindowLayout, top: number): WindowAnchor | null {
  if (!layout.keys.length || !Number.isFinite(top)) return null;
  // Other content can follow this window in the same scroller. Preserve its
  // distance from the measured end; it does not belong to the final row.
  if (top >= layout.total) return { edge: 'after', offset: top - layout.total };
  const index = indexAt(layout, Math.max(0, top));
  return { key: layout.keys[index], offset: top - layout.offsets[index] };
}

export function anchorOffset(layout: WindowLayout, anchor: WindowAnchor | null): number | null {
  if (!anchor) return null;
  if ('edge' in anchor) return layout.total + anchor.offset;
  const index = layout.indices.get(anchor.key);
  if (index === undefined) return null;
  const height = layout.offsets[index + 1] - layout.offsets[index];
  return layout.offsets[index] + Math.min(anchor.offset, Math.max(0, height - 1));
}

/** Reveal one resident key using measured sizes; unknown keys require a data page first. */
export function offsetForKey(layout: WindowLayout, key: string, top: number, height: number, align: WindowAlignment = 'nearest'): number | null {
  const index = layout.indices.get(key);
  if (index === undefined || !Number.isFinite(top) || !Number.isFinite(height) || height <= 0) return null;
  const start = layout.offsets[index], end = layout.offsets[index + 1], size = end - start;
  let offset = top;
  if (align === 'start') offset = start;
  else if (align === 'end') offset = end - height;
  else if (align === 'center') offset = start + (size - height) / 2;
  else if (start < top && end < top + height) offset = size > height ? end - height : start;
  else if (end > top + height && start > top) offset = size > height ? start : end - height;
  return Math.max(0, Math.min(offset, Math.max(0, layout.total - height)));
}

/** Isolated focus/selection rows retain their DOM without retaining the intervening transcript. */
export function mountedIndices(layout: WindowLayout, start: number, end: number, pinnedKeys: ReadonlySet<string>): number[] {
  const indices = new Set<number>();
  for (let index = start; index < end; index++) indices.add(index);
  for (const key of pinnedKeys) {
    const index = layout.indices.get(key);
    if (index !== undefined) indices.add(index);
  }
  return [...indices].sort((a, b) => a - b);
}
