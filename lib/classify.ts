import type { Classification, ReferenceEntry, Sex } from '@/lib/types';
import { resolveBounds } from '@/lib/reference';

const NUMERIC = /^[+]?\d+(\.\d+)?$/;

export function parseValue(raw: string | null): number | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!NUMERIC.test(s)) return null; // comparators, ranges, words → null (handled by guard)
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function classify(valueNum: number | null, entry: ReferenceEntry, sex: Sex): Classification {
  if (valueNum === null) return 'unclassified';

  if (entry.criticalLow !== null && valueNum < entry.criticalLow) return 'critical';
  if (entry.criticalHigh !== null && valueNum > entry.criticalHigh) return 'critical';

  const { low, high } = resolveBounds(entry, sex);
  if (low !== null && valueNum < low) return 'low';
  if (high !== null && valueNum > high) return 'high';
  return 'normal';
}
