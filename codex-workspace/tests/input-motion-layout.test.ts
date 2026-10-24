import { describe, expect, it } from 'vitest';
import { MAX_CARET_TEXT, clipCaret, layoutInputCaret, type CaretLayoutOptions } from '../client/input-motion-layout';

const defaults: Omit<CaretLayoutOptions, 'text' | 'position'> = {
  width: 100, multiline: false, wrap: false, tabSize: 4, align: 'start',
  measure: text => [...text].length * 10,
};
const layout = (text: string, position: number, overrides: Partial<CaretLayoutOptions> = {}) => layoutInputCaret({ ...defaults, text, position, ...overrides });

describe('native input decorative caret geometry', () => {
  it('uses actual proportional font advances without changing the text or caret offset', () => {
    const text = 'will';
    const measure = (value: string) => [...value].reduce((width, character) => width + (character === 'w' ? 16 : 4), 0);
    expect(layout(text, 2, { measure })).toEqual({ x: 20, line: 0 });
    expect(text).toBe('will');
  });

  it('aligns centered and right aligned inputs but leaves overflowing values scrollable', () => {
    expect(layout('abcd', 2, { align: 'center' })).toEqual({ x: 50, line: 0 });
    expect(layout('abcd', 2, { align: 'end' })).toEqual({ x: 80, line: 0 });
    expect(layout('abcdefghijkl', 12, { align: 'center' })).toEqual({ x: 120, line: 0 });
  });

  it('keeps a caret before a newline on that line and advances an empty final line', () => {
    expect(layout('first\nsecond\n', 5, { multiline: true, wrap: true })).toEqual({ x: 50, line: 0 });
    expect(layout('first\nsecond\n', 6, { multiline: true, wrap: true })).toEqual({ x: 0, line: 1 });
    expect(layout('first\nsecond\n', 13, { multiline: true, wrap: true })).toEqual({ x: 0, line: 2 });
  });

  it('wraps a whole word using the suffix after the selection, not just the prefix', () => {
    expect(layout('abc defgh', 5, { multiline: true, wrap: true, width: 60 })).toEqual({ x: 10, line: 1 });
    expect(layout('abc defgh', 3, { multiline: true, wrap: true, width: 60 })).toEqual({ x: 30, line: 0 });
  });

  it('wraps long words, preserves explicit paragraphs and respects wrap=off', () => {
    expect(layout('abcdefghij\nxy', 12, { multiline: true, wrap: true, width: 30 })).toEqual({ x: 10, line: 4 });
    expect(layout('abcdefghij\nxy', 8, { multiline: true, wrap: false, width: 30 })).toEqual({ x: 80, line: 0 });
  });

  it('does not split emoji or combining characters across wrapped lines', () => {
    const measure = (text: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length * 10;
    expect(layout('a👩‍💻éz', 'a👩‍💻'.length, { multiline: true, wrap: true, width: 20, measure })).toBeNull();
    expect(layout('a👩‍💻éz', 'a👩‍💻é'.length, { multiline: true, wrap: true, width: 20, measure })).toEqual({ x: 10, line: 1 });
  });

  it('preserves native upstream/downstream affinity at an ambiguous soft-wrap boundary', () => {
    expect(layout('abcdefgh', 4, { multiline: true, wrap: true, width: 40 })).toBeNull();
    expect(layout('abcd\nefgh', 4, { multiline: true, wrap: true, width: 40 })).toEqual({ x: 40, line: 0 });
  });

  it('advances real tab stops and keeps normal whitespace rather than trimming input', () => {
    expect(layout('a\tb', 2, { multiline: true, wrap: false })).toEqual({ x: 40, line: 0 });
    expect(layout('  a ', 4)).toEqual({ x: 40, line: 0 });
  });

  it('falls back without guessing bidirectional caret affinity or scanning oversized drafts', () => {
    expect(layout('English שלום', 8)).toBeNull();
    let measured = false;
    expect(layout('x'.repeat(MAX_CARET_TEXT + 1), 1, { measure: () => { measured = true; return 0; } })).toBeNull();
    expect(measured).toBe(false);
  });

  it('stops wrapped measurement on budget exhaustion while leaving the native field usable', () => {
    let checks = 0;
    expect(layout('long '.repeat(100), 200, { multiline: true, wrap: true, canContinue: () => ++checks < 3 })).toBeNull();
    expect(checks).toBe(3);
  });

  it('clips scrolled carets to the field and hides completely offscreen positions', () => {
    expect(clipCaret(40, -5, 20, 100, 60)).toEqual({ x: 40, y: 0, width: 1, height: 15 });
    expect(clipCaret(40, 55, 20, 100, 60)).toEqual({ x: 40, y: 55, width: 1, height: 5 });
    expect(clipCaret(100, 0, 20, 100, 60)).toEqual({ x: 99, y: 0, width: 1, height: 20 });
    expect(clipCaret(100, 0, 20, 100, 60, 2)).toEqual({ x: 98, y: 0, width: 2, height: 20 });
    expect(clipCaret(40, 0, 20, 100, 60, 0)).toBeNull();
    expect(clipCaret(40, -20, 20, 100, 60)).toBeNull();
    expect(clipCaret(110, 0, 20, 100, 60)).toBeNull();
    expect(clipCaret(Number.NaN, 0, 20, 100, 60)).toBeNull();
  });
});
