import { describe, expect, it } from 'vitest';
import { createRedactor, type RedactionFragment } from '../server/agent/redact';

const MASK = '[redacted]';
const known = 'fixture-private-credential-1234567890';
const genericTokens = [
  `sk-${'aB_0-'.repeat(8)}`,
  `ghp_${'aB09'.repeat(9)}`,
  `gho_${'aB09'.repeat(9)}`,
  `ghu_${'aB09'.repeat(9)}`,
  `ghs_${'aB09'.repeat(9)}`,
  `ghr_${'aB09'.repeat(9)}`,
  `ghx_${'aB09'.repeat(9)}`,
  `github_pat_${'aB_09'.repeat(8)}`,
  `hf_${'aB09'.repeat(9)}`,
];

describe('full-value secret redaction', () => {
  it('masks repeated known values, ignores short values, and deduplicates secrets', () => {
    const redact = createRedactor([known, known, '', 'short', '1234567']);
    expect(redact.text(`Before ${known}; after ${known}. short 1234567.`)).toBe(`Before ${MASK}; after ${MASK}. short 1234567.`);
  });

  it.each(genericTokens)('masks recognizable provider tokens without a known credential: %s', token => {
    expect(createRedactor([]).text(`Bearer ${token}; next.`)).toBe(`Bearer ${MASK}; next.`);
  });

  it('preserves benign text, short token examples, and prefixes inside ordinary identifiers', () => {
    const text = 'shell github hf sk-Example ghp_example github_pat_example hf_example prefixhf_123456789012345678901234';
    expect(createRedactor([]).text(text)).toBe(text);
  });

  it('handles secrets containing regular-expression metacharacters, Unicode, quotes, and newlines', () => {
    const unusual = 'example[secret].*🙂"\nsecond-line';
    expect(createRedactor([unusual]).text(`A:${unusual}:B`)).toBe(`A:${MASK}:B`);
  });

  it('masks the union of overlapping and prefix-sharing known secrets', () => {
    const redact = createRedactor(['abcdefgh', 'efghijklmnop', 'abcdefghijklmnop-more']);
    expect(redact.text('!abcdefghijklmnop!')).toBe(`!${MASK}!`);
    expect(redact.text('!abcdefghijklmnop-more!')).toBe(`!${MASK}!`);
    expect(redact.text('!abcdefgh-other!')).toBe(`!${MASK}-other!`);
  });
});

describe('sanitized redaction source positions', () => {
  it('reports safe output at original source offsets without exposing a held secret prefix', () => {
    const fragments: RedactionFragment[] = [];
    const stream = createRedactor([known]).stream(fragment => fragments.push(fragment));
    const first = stream.push(`Before ${known.slice(0, 9)}`);
    expect(first).toBe('Before ');
    expect(fragments).toEqual([{ text: 'Before ', sourceStart: 0, sourceEnd: 7, redacted: false }]);
    const second = stream.push(`${known.slice(9)}; after.`) + stream.finish();
    expect(fragments.map(fragment => fragment.text).join('')).toBe(first + second);
    expect(fragments[1]).toEqual({ text: MASK, sourceStart: 7, sourceEnd: 7 + known.length, redacted: true });
    expect(fragments[2]).toEqual({ text: '; after.', sourceStart: 7 + known.length, sourceEnd: 15 + known.length, redacted: false });
    expect(JSON.stringify(fragments)).not.toContain(known.slice(0, 9));
  });

  it('counts suppressed token bodies and safely released trailing prefixes without restarting the stream', () => {
    const fragments: RedactionFragment[] = [];
    const stream = createRedactor([]).stream(fragment => fragments.push(fragment));
    const token = `hf_${'a'.repeat(20)}`;
    expect(stream.push(token)).toBe(MASK);
    expect(stream.push('a'.repeat(100))).toBe('');
    expect(stream.push('; gh')).toBe('; ');
    expect(stream.finish()).toBe('gh');
    expect(fragments.map(fragment => fragment.text).join('')).toBe(`${MASK}; gh`);
    expect(fragments.at(-2)).toEqual({ text: '; ', sourceStart: token.length + 100, sourceEnd: token.length + 102, redacted: false });
    expect(fragments.at(-1)).toEqual({ text: 'gh', sourceStart: token.length + 102, sourceEnd: token.length + 104, redacted: false });
  });
});

describe('streaming secret redaction', () => {
  it('never releases a known-secret prefix at any split point', () => {
    const redact = createRedactor([known]);
    for (let offset = 1; offset < known.length; offset++) {
      const stream = redact.stream();
      const first = stream.push(`Before ${known.slice(0, offset)}`);
      expect(first, `split at ${offset}`).toBe('Before ');
      expect(first + stream.push(`${known.slice(offset)}; done.`) + stream.finish()).toBe(`Before ${MASK}; done.`);
    }
  });

  it.each(genericTokens)('masks a generic token split at every offset: %s', token => {
    const redact = createRedactor([]);
    for (let offset = 1; offset < token.length; offset++) {
      const stream = redact.stream();
      const first = stream.push(`Before ${token.slice(0, offset)}`);
      expect(first === 'Before ' || first === `Before ${MASK}`, `split at ${offset}`).toBe(true);
      expect(first + stream.push(`${token.slice(offset)}; done.`) + stream.finish()).toBe(`Before ${MASK}; done.`);
    }
  });

  it('masks multiple known and generic tokens when every chunk contains one character', () => {
    const redact = createRedactor([known, 'second-fixture-secret']);
    const raw = `Begin ${known}, ${genericTokens.join('; ')} and second-fixture-secret. End.`;
    const stream = redact.stream();
    let rendered = '';
    for (const character of raw) rendered += stream.push(character);
    rendered += stream.finish();
    expect(rendered).toBe(`Begin ${MASK}, ${genericTokens.map(() => MASK).join('; ')} and ${MASK}. End.`);
    expect(rendered).toBe(redact.text(raw));
  });

  it('keeps word-boundary context across chunks', () => {
    const token = genericTokens[1];
    const stream = createRedactor([]).stream();
    expect(stream.push('prefix')).toBe('prefix');
    expect(stream.push(token.slice(0, 4)) + stream.push(token.slice(4)) + stream.finish()).toBe(token);
  });

  it('streams ordinary text promptly and only delays a possible matching suffix', () => {
    const redact = createRedactor([known]);
    const stream = redact.stream();
    expect(stream.push('Ordinary text.')).toBe('Ordinary text.');
    expect(stream.push(' Next fi')).toBe(' Next ');
    expect(stream.push('eld.')).toBe('field.');
    expect(stream.finish()).toBe('');
  });

  it('flushes unmatched benign trailing prefixes on finish and refuses further chunks', () => {
    const stream = createRedactor([known]).stream();
    expect(stream.push('Example gh')).toBe('Example ');
    expect(stream.finish()).toBe('gh');
    expect(stream.finish()).toBe('');
    expect(() => stream.push('p_another-chunk')).toThrow('already finished');
  });

  it('handles independent simultaneous streams without sharing pending state', () => {
    const redact = createRedactor([known]);
    const first = redact.stream();
    const second = redact.stream();
    expect(first.push(known.slice(0, 8))).toBe('');
    expect(second.push('Nothing private.')).toBe('Nothing private.');
    expect(second.finish()).toBe('');
    expect(first.push(known.slice(8)) + first.finish()).toBe(MASK);
  });

  it('masks overlapping known secrets identically at every split', () => {
    const redact = createRedactor(['abcdefgh', 'efghijklmnop', 'abcdefghijklmnop-more']);
    for (const raw of ['!abcdefghijklmnop!', '!abcdefghijklmnop-more!', '!abcdefgh-other!']) {
      for (let offset = 0; offset <= raw.length; offset++) {
        const stream = redact.stream();
        expect(stream.push(raw.slice(0, offset)) + stream.push(raw.slice(offset)) + stream.finish()).toBe(redact.text(raw));
      }
    }
  });

  it('suppresses arbitrarily long confirmed token bodies without delaying later ordinary text', () => {
    const stream = createRedactor([]).stream();
    expect(stream.push(`Bearer hf_${'a'.repeat(20)}`)).toBe(`Bearer ${MASK}`);
    for (let index = 0; index < 100; index++) expect(stream.push('a'.repeat(4096))).toBe('');
    expect(stream.push('; complete.')).toBe('; complete.');
    expect(stream.finish()).toBe('');
  });

  it('handles a complete secret followed by another longer secret sharing that prefix', () => {
    const redact = createRedactor(['12345678', '12345678-more-secret']);
    const stream = redact.stream();
    expect(stream.push('12345678')).toBe(MASK);
    expect(stream.push('-more')).toBe('');
    expect(stream.push('-secret;')).toBe(';');
    expect(stream.finish()).toBe('');
  });

  it('handles empty input and Unicode chunks split between surrogate code units', () => {
    const secret = '🙂unicode-fixture-secret';
    const redact = createRedactor([secret]);
    const stream = redact.stream();
    expect(stream.push('')).toBe('');
    let output = '';
    for (let index = 0; index < secret.length; index++) output += stream.push(secret[index]);
    expect(output + stream.finish()).toBe(MASK);
    expect(redact.text('')).toBe('');
  });
});
