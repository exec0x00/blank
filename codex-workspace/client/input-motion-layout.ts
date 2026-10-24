/** Bounded geometry for a decorative caret. No input text is copied into the DOM. */
export const MAX_CARET_TEXT = 32_768;
/** Spring stiffness and damping ratio for caret travel (critically damped). */
export const CARET_SPRING_STIFFNESS = 1250;
export const CARET_SPRING_DAMPING = 1;
/** The caret stays solid this long after it moves, then starts to blink. */
export const CARET_IDLE_MS = 520;
export const CARET_BLINK_DELAY_MS = 520;
export const CARET_BLINK_CYCLE_MS = 1150;

export interface CaretLayoutOptions {
  text: string;
  position: number;
  width: number;
  multiline: boolean;
  wrap: boolean;
  tabSize: number;
  align: string;
  measure(text: string): number;
  /** A busy or unusually large field retains its native caret. */
  canContinue?: () => boolean;
}

export interface CaretLayout { x: number; line: number }

const bidi = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff\u202a-\u202e\u2066-\u2069]/u;
const cjk = /[\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\uff01-\uff60]/u;
const breakAfter = /[\s\-/\u200b]$/u;
const closingPunctuation = /^[,.;:!?\)\]\}\u3001\u3002\u3009\u300b\u300d\u300f]/u;

function aligned(x: number, lineWidth: number, width: number, align: string): number {
  const room = Math.max(0, width - lineWidth);
  return x + (align === 'center' ? room / 2 : align === 'right' || align === 'end' ? room : 0);
}

/**
 * Canvas handles shaping and proportional fonts. Native editing still owns the
 * value, selection, undo, composition and scrolling. Directional/vertical text
 * and work above the measurement budget keep the browser's own accurate caret.
 */
export function layoutInputCaret(options: CaretLayoutOptions): CaretLayout | null {
  const { text, multiline, wrap, measure, width, align } = options;
  if (text.length > MAX_CARET_TEXT || width <= 0 || !Number.isFinite(width) || bidi.test(text)) return null;
  if (!Number.isInteger(options.position) || options.position < 0 || options.position > text.length) return null;
  const position = options.position;
  const tabWidth = Math.max(1, options.tabSize) * Math.max(1, measure(' '));
  const lineWidth = (line: string) => {
    if (!line.includes('\t')) return measure(line);
    let x = 0;
    const parts = line.split('\t');
    for (let index = 0; index < parts.length; index++) {
      x += measure(parts[index]);
      if (index < parts.length - 1) x = (Math.floor(x / tabWidth) + 1) * tabWidth;
    }
    return x;
  };
  if (!multiline) return { x: aligned(lineWidth(text.slice(0, position)), lineWidth(text), width, align), line: 0 };

  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  let paragraphStart = 0;
  let line = 0;
  while (paragraphStart <= text.length) {
    if (options.canContinue?.() === false) return null;
    const newline = text.indexOf('\n', paragraphStart);
    const paragraphEnd = newline === -1 ? text.length : newline;
    const paragraph = text.slice(paragraphStart, paragraphEnd);
    const inParagraph = position <= paragraphEnd;
    if (!wrap || lineWidth(paragraph) <= width || !paragraph.length) {
      if (inParagraph) return { x: aligned(lineWidth(text.slice(paragraphStart, position)), lineWidth(paragraph), width, align), line };
      line += 1;
    } else {
      // Grapheme boundaries preserve surrogate pairs, combining accents and emoji.
      const ends: number[] = [0];
      if (segmenter) {
        for (const segment of segmenter.segment(paragraph)) ends.push(segment.index + segment.segment.length);
      } else {
        let offset = 0;
        for (const character of paragraph) { offset += character.length; ends.push(offset); }
      }
      let first = 0;
      while (first < ends.length - 1) {
        if (options.canContinue?.() === false) return null;
        let lower = first + 1;
        let upper = ends.length - 1;
        let last = first + 1;
        while (lower <= upper) {
          if (options.canContinue?.() === false) return null;
          const middle = Math.floor((lower + upper) / 2);
          if (lineWidth(paragraph.slice(ends[first], ends[middle])) <= width) { last = middle; lower = middle + 1; }
          else upper = middle - 1;
        }
        if (last < ends.length - 1) {
          // Prefer normal word boundaries, then break an overlong word. Hanging
          // spaces belong to the preceding visual line under pre-wrap.
          while (last < ends.length - 1 && /^[ \t]$/u.test(paragraph.slice(ends[last], ends[last + 1]))) last += 1;
          for (let candidate = last; candidate > first; candidate--) {
            const before = paragraph.slice(ends[candidate - 1], ends[candidate]);
            const after = paragraph.slice(ends[candidate], ends[candidate + 1]);
            if (breakAfter.test(before) || (cjk.test(before) || cjk.test(after)) && !closingPunctuation.test(after)) { last = candidate; break; }
          }
        }
        const start = ends[first];
        const end = ends[last];
        const localPosition = position - paragraphStart;
        // A native selection offset cannot tell whether End/click navigation
        // chose the previous row's end or the next row's beginning. Preserve
        // the browser's caret affinity at that one ambiguous boundary.
        if (inParagraph && localPosition === end && end < paragraph.length) return null;
        if (inParagraph && (localPosition < end || end === paragraph.length)) {
          const row = paragraph.slice(start, end);
          return { x: aligned(lineWidth(paragraph.slice(start, localPosition)), lineWidth(row), width, align), line };
        }
        line += 1;
        first = last;
      }
    }
    if (newline === -1) break;
    paragraphStart = paragraphEnd + 1;
  }
  return null;
}

export interface CaretClip { x: number; y: number; width: number; height: number }

/** Offscreen/selected carets stay native instead of drawing over other controls. */
export function clipCaret(x: number, y: number, height: number, width: number, viewportHeight: number, strokeWidth = 1): CaretClip | null {
  if (![x, y, height, width, viewportHeight, strokeWidth].every(Number.isFinite) || width <= 0 || viewportHeight <= 0 || height <= 0 || strokeWidth <= 0) return null;
  if (x < -1 || x > width + 1 || y + height <= 0 || y >= viewportHeight) return null;
  const top = Math.max(0, y);
  const stroke = Math.min(strokeWidth, width);
  return { x: Math.min(Math.max(0, x), width - stroke), y: top, width: stroke, height: Math.min(viewportHeight, y + height) - top };
}
