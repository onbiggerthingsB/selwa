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

export function classify(valueNum: number | null, entry: ReferenceEntry, sex: Sex, age?: number): Classification {
  if (valueNum === null) return 'unclassified';

  if (entry.criticalLow !== null && valueNum < entry.criticalLow) return 'critical';
  if (entry.criticalHigh !== null && valueNum > entry.criticalHigh) return 'critical';

  const { low, high } = resolveBounds(entry, sex, age);
  if (low !== null && valueNum < low) return 'low';
  if (high !== null && valueNum > high) return 'high';
  return 'normal';
}

// Classify a value on the low/normal/high scale against ARBITRARY bounds (no
// critical band, no entry). Used by R11 flip-gating to check whether our band and
// the report's own printed range would give a DIFFERENT call for the same value.
export function classifyAgainstBounds(
  v: number,
  low: number | null,
  high: number | null,
): 'low' | 'normal' | 'high' {
  if (low !== null && v < low) return 'low';
  if (high !== null && v > high) return 'high';
  return 'normal';
}
