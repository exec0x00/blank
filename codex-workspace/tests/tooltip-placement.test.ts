import { describe, expect, it } from 'vitest';
import { placeTooltip, tooltipText, TOOLTIP_TEXT_LIMIT } from '../client/tooltip-placement';

describe('tooltip text and viewport placement', () => {
  it('bounds text without splitting a surrogate pair and preserves text instead of interpreting markup', () => {
    expect(tooltipText(' \u0000<script>alert(1)</script>\npath/to/file.ts\u0007 ')).toBe('<script>alert(1)</script>\npath/to/file.ts');
    const clipped = tooltipText(`${'a'.repeat(TOOLTIP_TEXT_LIMIT - 2)}🙂tail`);
    expect(clipped.length).toBeLessThanOrEqual(TOOLTIP_TEXT_LIMIT);
    expect(clipped.endsWith('…')).toBe(true);
    expect(clipped).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(tooltipText(null)).toBe('');
  });

  it('flips a top-edge hint below its trigger while keeping a left-edge label inside the screen', () => {
    const position = placeTooltip({ left: 1, top: 2, width: 30, height: 30 }, { width: 280, height: 44 }, { left: 0, top: 0, width: 390, height: 844 });
    expect(position.side).toBe('bottom');
    expect(position.left).toBe(8);
    expect(position.top).toBeGreaterThanOrEqual(32);
    expect(position.left + 280).toBeLessThanOrEqual(382);
  });

  it('places bottom-edge hints above and respects a visual viewport moved by zoom or the keyboard', () => {
    const position = placeTooltip({ left: 385, top: 415, width: 30, height: 30 }, { width: 240, height: 70 }, { left: 40, top: 100, width: 390, height: 350 }, 'bottom');
    expect(position.side).toBe('top');
    expect(position.left).toBeGreaterThanOrEqual(48);
    expect(position.left + 240).toBeLessThanOrEqual(422);
    expect(position.top).toBeGreaterThanOrEqual(108);
    expect(position.top + 70).toBeLessThan(415);
  });

  it('flips a rail hint away from the right edge', () => {
    const position = placeTooltip({ left: 350, top: 100, width: 32, height: 32 }, { width: 160, height: 38 }, { left: 0, top: 0, width: 390, height: 844 }, 'right');
    expect(position.side).toBe('left');
    expect(position.left + 160).toBeLessThan(350);
  });

  it('bounds oversized content even when no side has enough room', () => {
    const viewport = { left: 25, top: 35, width: 190, height: 120 };
    const position = placeTooltip({ left: 100, top: 85, width: 20, height: 20 }, { width: 1000, height: 1000 }, viewport);
    expect(position.maxWidth).toBe(174);
    expect(position.maxHeight).toBe(104);
    expect(position.left).toBeGreaterThanOrEqual(viewport.left);
    expect(position.left + position.maxWidth).toBeLessThanOrEqual(viewport.left + viewport.width);
    expect(position.top).toBeGreaterThanOrEqual(viewport.top);
    expect(position.top + position.maxHeight).toBeLessThanOrEqual(viewport.top + viewport.height);
  });
});
