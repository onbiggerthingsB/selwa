import type { ReferenceEntry, Sex } from '@/lib/types';
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

export function resolveBounds(entry: ReferenceEntry, sex: Sex): ResolvedBounds {
  const isSplit = (b: ReferenceEntry['refLow']) => b !== null && typeof b === 'object';
  const split = isSplit(entry.refLow) || isSplit(entry.refHigh);

  const pick = (b: ReferenceEntry['refLow'], which: 'lowUnion' | 'highUnion'): number | null => {
    if (b === null) return null;
    if (typeof b === 'number') return b;
    if (sex === 'male') return b.male;
    if (sex === 'female') return b.female;
    // unknown → widen: lowest low, highest high
    return which === 'lowUnion' ? Math.min(b.male, b.female) : Math.max(b.male, b.female);
  };

  return {
    low: pick(entry.refLow, 'lowUnion'),
    high: pick(entry.refHigh, 'highUnion'),
    usedUnion: split && sex === 'unknown',
  };
}
