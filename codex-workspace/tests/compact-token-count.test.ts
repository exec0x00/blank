import { describe, expect, it } from 'vitest';
import { compactTokenCount, exactTokenCount, tokenCount } from '../client/components/chat/compact-number';

// Pure numeric formatting retained unchanged from the archived context UI tests.
// Retired context-estimation, registry-capacity and context-details behavior is
// intentionally not restored by this formatter-only test.
describe('compact context counts', () => {
  it.each([
    [0, '0'], [7, '7'], [999, '999'], [1_000, '1K'], [3_000, '3K'], [3_100, '3.1K'], [3_124, '3.12K'],
    [9_995, '10K'], [99_950, '100K'], [999_499, '999K'], [999_500, '1M'], [1_410_000, '1.41M'],
    [12_345_678, '12.3M'], [999_500_000, '1B'], [999_500_000_000, '1T'], [Number.MAX_SAFE_INTEGER, '9.01Q'],
  ])('formats %s as %s without a fourth significant digit', (value, expected) => {
    expect(compactTokenCount(value)).toBe(expected);
  });

  it('does not turn unknown, fractional, negative or unsafe telemetry into zero', () => {
    for (const value of [undefined, null, NaN, Infinity, -Infinity, -1, 1.1, '3000', {}, Number.MAX_SAFE_INTEGER + 1]) {
      expect(tokenCount(value)).toBeUndefined();
      expect(compactTokenCount(value)).toBe('—');
      expect(exactTokenCount(value)).toBe('Not reported');
    }
    expect(compactTokenCount(undefined, 'Unknown')).toBe('Unknown');
    expect(exactTokenCount(1_410_321, undefined, 'en-US')).toBe('1,410,321');
  });

});
