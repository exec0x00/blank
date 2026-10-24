const units = ['', 'K', 'M', 'B', 'T', 'Q'] as const;

/** Token counts are nonnegative, exact integers. Missing or corrupt telemetry
 * must not become a plausible zero, a negative count, or an imprecise integer. */
export function tokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Decimal units and at most three significant digits, with rollover decided
 * after rounding: 999,500 is 1M, never 1,000K. Details retain the original count. */
export function compactTokenCount(value: unknown, unknown = '—'): string {
  const count = tokenCount(value);
  if (count === undefined) return unknown;
  if (count === 0) return '0';
  const rounded = Number(count.toPrecision(3));
  let unit = 0;
  while (unit < units.length - 1 && rounded >= 1000 ** (unit + 1)) unit++;
  return `${Number((rounded / 1000 ** unit).toPrecision(3))}${units[unit]}`;
}

export function exactTokenCount(value: unknown, unknown = 'Not reported', locale?: string): string {
  const count = tokenCount(value);
  return count === undefined ? unknown : new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(count);
}
