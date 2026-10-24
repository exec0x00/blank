export type TooltipSide = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipRect { left: number; top: number; width: number; height: number }

export const TOOLTIP_TEXT_LIMIT = 1024;

/** Explicit hints are text, never markup or text extracted from a form control. */
export function tooltipText(value: string | null | undefined): string {
  const text = (value || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (text.length <= TOOLTIP_TEXT_LIMIT) return text;
  let end = TOOLTIP_TEXT_LIMIT - 1;
  if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  return `${text.slice(0, end)}…`;
}

/** Fixed coordinates account for the visual viewport, including a soft keyboard. */
export function placeTooltip(anchor: TooltipRect, size: { width: number; height: number }, viewport: TooltipRect, preferred: TooltipSide = 'top') {
  const margin = 8, gap = 7;
  const maxWidth = Math.max(0, viewport.width - margin * 2);
  const maxHeight = Math.max(0, viewport.height - margin * 2);
  const width = Math.min(size.width, maxWidth), height = Math.min(size.height, maxHeight);
  const right = anchor.left + anchor.width, bottom = anchor.top + anchor.height;
  const space: Record<TooltipSide, number> = {
    top: anchor.top - viewport.top - margin - gap,
    bottom: viewport.top + viewport.height - bottom - margin - gap,
    left: anchor.left - viewport.left - margin - gap,
    right: viewport.left + viewport.width - right - margin - gap,
  };
  const opposite: Record<TooltipSide, TooltipSide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const choices: TooltipSide[] = preferred === 'top' || preferred === 'bottom'
    ? [preferred, opposite[preferred], 'right', 'left']
    : [preferred, opposite[preferred], 'bottom', 'top'];
  const required = (side: TooltipSide) => side === 'top' || side === 'bottom' ? height : width;
  const side = choices.find(candidate => space[candidate] >= required(candidate))
    || choices.reduce((best, candidate) => space[candidate] - required(candidate) > space[best] - required(best) ? candidate : best);
  const desiredLeft = side === 'left' ? anchor.left - gap - width : side === 'right' ? right + gap : anchor.left + (anchor.width - width) / 2;
  const desiredTop = side === 'top' ? anchor.top - gap - height : side === 'bottom' ? bottom + gap : anchor.top + (anchor.height - height) / 2;
  const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(value, Math.max(minimum, maximum)));
  return {
    side,
    left: clamp(desiredLeft, viewport.left + Math.min(margin, viewport.width / 2), viewport.left + viewport.width - margin - width),
    top: clamp(desiredTop, viewport.top + Math.min(margin, viewport.height / 2), viewport.top + viewport.height - margin - height),
    maxWidth, maxHeight,
  };
}
