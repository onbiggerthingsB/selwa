// R16 — PRINTED-RANGE UNIT MISMATCH (Codex should-fix #5).
//
// THE BUG: grounding assumes the report's printed reference range is in the SAME unit as the
// report's value. Real reports break that assumption — a US lab prints "250 mg/dL" against an
// SI range, a Chinese report prints an mmol/L value against a mg/dL range, bilingual/mixed
// templates do both. Nothing detected it, so the CHIP — B1's main user-visible output, which
// claims to reproduce the report's OWN comparison — asserted a position computed from two
// different units.
//
// Measured before the fix (lib/grounding + lib/summary, unchanged code):
//   TC 150 mg/dL  vs printed "3.0-5.2" (mmol/L)  → truth WITHIN, chip said "Above"
//   TC 6.5 mmol/L vs printed "125-200" (mg/dL)   → truth ABOVE,  chip said "Below"  ← inverted
//   Creatinine 1.0 mg/dL vs printed "59-104" (µmol/L) → truth WITHIN, chip said "Below"
// i.e. false alarm AND false reassurance, and in one case the exact opposite of the truth.
// needsConfirm does NOT suppress the chip, so a confirm flag did not save the user from reading
// a wrong position.
//
// THE FIX: we cannot know the printed range's unit, and GUESSING it would be exactly the silent
// inference this codebase refuses everywhere else (R2 abstains on unit mismatch; H1.5 chose
// abstain-traps over ambiguous conversion). So we FALSIFY the assumption instead — two tests, in
// lib/reference.ts printedRangePlausible(): (1) the range must overlap the analyte's absolute
// plausibility band; (2) since a wrong unit is a MULTIPLICATIVE shift, EVERY comparable bound must
// be off from our reference band by >10× before we call it suspect. When disproved we suppress the
// chip (defer) and confirm. We assert nothing rather than assert something wrong.
//
// WHAT THE MEASUREMENT DOES AND DOESN'T SHOW (do not read more into it than this):
//   • R16 fires on 0 of 353 real rows carrying a printed range (MIMIC-IV 242, MedRepBench 111).
//     Chip coverage is UNCHANGED (US 73.6%, held-out 71.2%; R6 56/70). Since this rule only ever
//     REMOVES a chip, that zero is the number that mattered: it costs nothing on real data.
//   • It does NOT show the rule helps on real data. Both corpora print value and range in
//     internally-consistent units, so NEITHER CORPUS CONTAINS THE FAILURE MODE — they cannot
//     exercise this rule at all. The evidence for the fix is the constructed cases below, not a
//     corpus win. Mixed-unit reports are a live risk for the US-diaspora beachhead specifically
//     (patients hold both SI Chinese reports and conventional US ones, and some print both), but
//     their real-world rate here is UNMEASURED.
//
// KNOWN RESIDUAL GAPS (deliberate, not oversights):
//   • Needs a table entry — an UNRECOGNISED analyte with mixed units still asserts a wrong chip
//     (bounds are per-analyte; same "no net" cost accepted for R13).
//   • Only catches shifts >10×. A 2× mismatch (mEq/L vs mmol/L on a divalent ion) slips through —
//     those units are already abstained by R2 / the H1.5 divalent traps, but the gap is real.
//   • Needs a non-null, non-zero reference bound to compare against; otherwise it fails OPEN.

import { describe, it, expect } from 'vitest';
import { groundExtraction } from '@/lib/grounding';
import { buildSummary } from '@/lib/summary';

function evaluate(name: string, value: string, unit: string, range: string) {
  const rep = groundExtraction({ rows: [{ name, value, unit, printedRange: range, confidence: 'high' }] }, 'unknown');
  const row = rep.rows[0];
  return {
    chip: buildSummary(rep, 'en').sections[0].chipEn,
    needsConfirm: row.needsConfirm,
    flagIds: row.flags.map((f) => f.id),
  };
}

const DEFER = 'Ask your clinician to interpret';

describe('R16 — a printed range whose unit cannot be ours never yields a position chip', () => {
  // Each row: the report prints the value and the range in DIFFERENT units.
  const MISMATCHED: [string, string, string, string, string][] = [
    ['Total cholesterol', '150', 'mg/dL', '3.0-5.2', 'SI range, conventional value'],
    ['Total cholesterol', '250', 'mg/dL', '3.0-5.2', 'Codex’s case — previously confirm=false'],
    ['Total cholesterol', '5.0', 'mmol/L', '125-200', 'conventional range, SI value'],
    ['Total cholesterol', '6.5', 'mmol/L', '125-200', 'previously chip said "Below" while truly above'],
    ['Fasting plasma glucose', '95', 'mg/dL', '3.9-6.1', 'SI range, conventional value'],
    ['Creatinine', '1.0', 'mg/dL', '59-104', 'µmol/L range, mg/dL value'],
  ];

  for (const [name, value, unit, range, why] of MISMATCHED) {
    it(`${name} ${value} ${unit} vs printed "${range}" defers instead of asserting (${why})`, () => {
      const r = evaluate(name, value, unit, range);
      expect(r.chip, 'must not assert a position from mismatched units').toBe(DEFER);
      expect(r.needsConfirm, 'a disproved range unit must reach the confirm gate').toBe(true);
      expect(r.flagIds).toContain('R16-PRINTED-RANGE-UNIT-SUSPECT');
    });
  }
});

describe('R16 — does not fire on legitimate same-unit printed ranges', () => {
  // The rule must be a scalpel: these are ordinary reports and must still get a real chip.
  const LEGIT: [string, string, string, string, string][] = [
    ['Total cholesterol', '5.0', 'mmol/L', '3.0-5.2', 'Within your report’s range'],
    ['Total cholesterol', '6.0', 'mmol/L', '3.0-5.2', 'Above your report’s range'],
    ['Total cholesterol', '250', 'mg/dL', '125-200', 'Above your report’s range'],
    ['Total cholesterol', '150', 'mg/dL', '125-200', 'Within your report’s range'],
    ['Fasting plasma glucose', '5.0', 'mmol/L', '3.9-6.1', 'Within your report’s range'],
    ['Creatinine', '1.0', 'mg/dL', '0.7-1.3', 'Within your report’s range'],
    // ranges that legitimately start at/below zero must not read as "outside the plausible band"
    ['Troponin I', '0.02', 'ng/mL', '0-0.04', 'Within your report’s range'],
    ['Total bilirubin', '10', 'umol/L', '0-21', 'Within your report’s range'],
  ];

  for (const [name, value, unit, range, wantChip] of LEGIT) {
    it(`${name} ${value} ${unit} vs printed "${range}" → ${wantChip}`, () => {
      const r = evaluate(name, value, unit, range);
      expect(r.flagIds, 'legitimate range must not be called unit-suspect').not.toContain('R16-PRINTED-RANGE-UNIT-SUSPECT');
      expect(r.chip).toBe(wantChip);
    });
  }
});
