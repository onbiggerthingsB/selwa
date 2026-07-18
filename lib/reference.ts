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
    .replace(/[()（）]/g, '') // strip parens but KEEP content: 'mg/L(FEU)' ≡ 'mg/L FEU' (basis preserved)
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

export interface PrintedRange {
  low: number | null;
  high: number | null;
  // Bounds carry STRICTNESS. "<5.2" excludes 5.2; "≤5.2" includes it. Collapsing the two made
  // `5.2` read as "Within your report's range" against a printed `<5.2` — a wrong reproduction
  // with no confirm. An absent bound is inclusive by convention (nothing to exclude).
  lowInclusive: boolean;
  highInclusive: boolean;
}

// A number, or nothing. NOT "whatever a string starts with": Number.parseFloat('3-15') returns 3,
// which silently turned a non-scalar cell into a confident comparison. A trailing report flag
// (↑ ↓ H L) is tolerated because real rows carry it ("569.412↑" is verbatim in our corpus).
export function parseScalar(s: string | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  const t = s.trim().replace(/[↑↓HL]+$/i, '').trim();
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Where does a value sit relative to the range PRINTED on the report? Honours bound strictness.
 * 'none' = we cannot say (no parseable range, or the value is not a scalar) → the caller must
 * defer rather than guess. Shared by the summary chip AND R11 so the two can never disagree
 * about what the report says.
 */
export function statusAgainstPrinted(v: number | null, pr: PrintedRange | null): 'below' | 'within' | 'above' | 'none' {
  if (pr === null || v === null) return 'none';
  if (pr.low !== null && (pr.lowInclusive ? v < pr.low : v <= pr.low)) return 'below';
  if (pr.high !== null && (pr.highInclusive ? v > pr.high : v >= pr.high)) return 'above';
  return 'within';
}

/**
 * R16 — can this printed range be a reference range for this analyte, in the unit we assumed?
 *
 * We never learn the printed range's unit; grounding assumes it matches the VALUE's unit. Real
 * reports break that (a conventional-unit value against an SI range, and vice versa), and the
 * result was a chip computed from two different units — see lib/printedRangeUnit.test.ts.
 *
 * We do not try to GUESS the true unit: two candidate units can both yield superficially sane
 * numbers, and guessing is the silent inference this codebase refuses everywhere else (R2 abstains
 * on unit mismatch rather than convert ambiguously). Instead we FALSIFY: a real reference range
 * for an analyte must overlap that analyte's absolute plausibility band. If — read in the assumed
 * unit — it cannot, the assumption is disproved and the caller must stop asserting a position.
 *
 * OVERLAP, not containment: legitimate printed ranges routinely run past a bound (troponin "0-0.04"
 * starts below absoluteLow, dipstick ranges start at 0). Requiring containment would fire on
 * ordinary reports. A null absolute bound means "no meaningful limit on that side" (±Infinity).
 * Returns true when we cannot judge (no entry bounds, or an unparsed range) — fail OPEN, because
 * this rule only ever REMOVES a chip, and an over-eager version would silently gut coverage.
 */
export function printedRangePlausible(
  pr: PrintedRange | null,
  entry: ReferenceEntry,
  sex: Sex = 'unknown',
  age?: number,
): boolean {
  if (pr === null) return true;

  // TEST 1 — disjoint from the absolute plausibility band. Catches gross mismatches.
  const absLow = entry.absoluteLow ?? -Infinity;
  const absHigh = entry.absoluteHigh ?? Infinity;
  if (!(absLow === -Infinity && absHigh === Infinity)) {
    const pLow = pr.low ?? -Infinity;
    const pHigh = pr.high ?? Infinity;
    if (pLow > absHigh || pHigh < absLow) return false; // no unit makes this this analyte's range
  }

  // TEST 2 — scale mismatch against our REFERENCE band. Absolute bounds are deliberately far wider
  // than any real range (they exist to catch OCR misreads), so they alone miss the common cases:
  // glucose 95 mg/dL vs a printed SI range, creatinine 1.0 mg/dL vs a printed µmol/L range. A wrong
  // unit is a MULTIPLICATIVE shift — it moves every bound by the same factor — so we require EVERY
  // comparable bound to be off by more than the tolerance before calling it suspect. Real
  // lab-to-lab variation is well under 2×; a factor of 10 cannot be a legitimate difference in the
  // same unit, and demanding all bounds agree on the shift keeps this from firing on one odd bound.
  const SCALE_TOLERANCE = 10;
  const { low, high } = resolveBounds(entry, sex, age);
  const pairs: [number, number][] = [];
  // Zero bounds are skipped: ratios against 0 are undefined, and printed ranges legitimately start
  // at 0 ("0-0.04" troponin, "0-21" bilirubin, dipsticks).
  if (low !== null && low !== 0 && pr.low !== null && pr.low !== 0) pairs.push([low, pr.low]);
  if (high !== null && high !== 0 && pr.high !== null && pr.high !== 0) pairs.push([high, pr.high]);
  if (pairs.length === 0) return true; // nothing comparable ⇒ cannot falsify ⇒ fail OPEN
  return !pairs.every(([ours, theirs]) => Math.max(ours / theirs, theirs / ours) > SCALE_TOLERANCE);
}

/**
 * Parse a report's printed reference-range string into numeric bounds (in the
 * range's own units — the caller unit-normalizes). Handles two-sided ranges
 * ("3.9-6.1", "3.9~6.1", "3.9–6.1"), one-sided upper ("<5.2", "≤ 90", "＜5.2"),
 * and one-sided lower (">90", "≥ 90"). Returns null when nothing numeric parses.
 * Used by R11 to compare the report's own range against ours.
 */
export function parsePrintedRange(s: string | null): PrintedRange | null {
  if (!s) return null;
  const t = s.trim().replace(/\s+/g, '');
  if (t === '') return null;
  // A signed number, optionally in scientific notation.
  const N = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?`;
  // Separators seen on real reports, incl. the OCR double-dash ("0--1.75" is verbatim in our
  // corpus). Matched WHOLE-FIELD (^...$) so a junk cell can never contribute a substring —
  // "-2-2" used to yield 2..2 because an unsigned pattern matched the tail.
  // Signed numbers + "--" as a separator are genuinely ambiguous: "-3.0--1.0" reads as
  // (-3.0 .. 1.0) with a "--" separator OR (-3.0 .. -1.0) with a "-" separator and a negative
  // high. Try every reading and accept ONLY if exactly one is coherent (low <= high); if two
  // readings are both coherent we cannot know which the lab meant, so we defer rather than guess.
  // ("0--1.75" from our corpus is unambiguous: 0..-1.75 would be low>high, leaving 0..1.75.)
  const readings: { low: number; high: number }[] = [];
  for (const sep of ['--', '-', '~', '–', '—']) {
    const m = t.match(new RegExp(`^(${N})${sep === '-' ? '-' : sep === '--' ? '--' : sep}(${N})$`));
    if (!m) continue;
    const low = Number(m[1]);
    const high = Number(m[2]);
    if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) continue; // incoherent
    if (!readings.some((r) => r.low === low && r.high === high)) readings.push({ low, high });
  }
  if (readings.length === 1) return { low: readings[0].low, high: readings[0].high, lowInclusive: true, highInclusive: true };
  if (readings.length > 1) return null; // ambiguous → defer, never guess
  // One-sided upper: "<5.2" is STRICT; "≤5.2" / "<=5.2" include the bound.
  const up = t.match(new RegExp(`^[<＜](=?)(${N})$`)) ?? t.match(new RegExp(`^[≤](=?)(${N})$`));
  if (up) {
    const inclusive = up[1] === '=' || /^[≤]/.test(t);
    const high = Number(up[2]);
    return Number.isFinite(high) ? { low: null, high, lowInclusive: true, highInclusive: inclusive } : null;
  }
  // One-sided lower: ">90" is STRICT; "≥90" / ">=90" include the bound.
  const lo = t.match(new RegExp(`^[>＞](=?)(${N})$`)) ?? t.match(new RegExp(`^[≥](=?)(${N})$`));
  if (lo) {
    const inclusive = lo[1] === '=' || /^[≥]/.test(t);
    const low = Number(lo[2]);
    return Number.isFinite(low) ? { low, high: null, lowInclusive: inclusive, highInclusive: true } : null;
  }
  return null; // unparseable → the caller must defer, never guess
}
