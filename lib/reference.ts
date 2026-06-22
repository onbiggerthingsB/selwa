import type { Bound, ReferenceEntry, Sex } from '@/lib/types';
import { REFERENCE_LABS } from '@/data/reference-labs';

function normName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s　]+/g, '') // collapse ASCII + ideographic spaces
    .replace(/[：:．.,()（）[\]【】]/g, '');
}

const INDEX: Map<string, ReferenceEntry> = (() => {
  const m = new Map<string, ReferenceEntry>();
  for (const e of REFERENCE_LABS) {
    for (const token of [e.key, e.nameEn, e.nameZh, ...e.aliases]) {
      m.set(normName(token), e);
    }
  }
  return m;
})();

export function findEntry(rawName: string): ReferenceEntry | null {
  return INDEX.get(normName(rawName)) ?? null;
}

export function normalizeUnit(u: string): string {
  return u
    .trim()
    .replace(/µ|μ/g, 'u') // micro sign variants → u
    .replace(/×/g, 'x')
    .replace(/\s+/g, '')
    .toLowerCase();
}

export function unitMatches(extractedUnit: string | null, entry: ReferenceEntry): boolean {
  if (!extractedUnit) return false;
  const u = normalizeUnit(extractedUnit);
  return entry.allowedUnits.some((a) => normalizeUnit(a) === u);
}

export interface ResolvedBounds {
  low: number | null;
  high: number | null;
  usedUnion: boolean; // true when sex was unknown and a sex-specific band was widened
}

function scalarFromBound(b: Bound, which: 'low' | 'high', sex: Sex): number {
  if (typeof b === 'number') return b;
  if (sex === 'male') return b.male;
  if (sex === 'female') return b.female;
  return which === 'low' ? Math.min(b.male, b.female) : Math.max(b.male, b.female);
}

export function resolveBounds(entry: ReferenceEntry, sex: Sex, age?: number): ResolvedBounds {
  const bands = entry.ageBands;
  if (bands && bands.length > 0) {
    if (age !== undefined) {
      const band = bands.find((b) => age >= b.ageMin && age <= b.ageMax);
      if (band) {
        const split = typeof band.refLow === 'object' || typeof band.refHigh === 'object';
        return {
          low: band.refLow === null ? null : scalarFromBound(band.refLow, 'low', sex),
          high: band.refHigh === null ? null : scalarFromBound(band.refHigh, 'high', sex),
          usedUnion: split && sex === 'unknown',
        };
      }
    }
    // No age (or no matching band): widen across ALL bands and sexes, flag union.
    // refLow/refHigh may be null on one-sided bands; drop those before min/max.
    const lows = bands
      .flatMap((b) => (b.refLow === null ? [] : [scalarFromBound(b.refLow, 'low', 'female'), scalarFromBound(b.refLow, 'low', 'male')]));
    const highs = bands
      .flatMap((b) => (b.refHigh === null ? [] : [scalarFromBound(b.refHigh, 'high', 'female'), scalarFromBound(b.refHigh, 'high', 'male')]));
    return {
      low: lows.length ? Math.min(...lows) : null,
      high: highs.length ? Math.max(...highs) : null,
      usedUnion: true,
    };
  }

  // No age bands: original v0 behaviour (sex split or scalar).
  const isSplit = (b: ReferenceEntry['refLow']) => b !== null && typeof b === 'object';
  const split = isSplit(entry.refLow) || isSplit(entry.refHigh);
  return {
    low: entry.refLow === null ? null : scalarFromBound(entry.refLow, 'low', sex),
    high: entry.refHigh === null ? null : scalarFromBound(entry.refHigh, 'high', sex),
    usedUnion: split && sex === 'unknown',
  };
}
