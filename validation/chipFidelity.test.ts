// CHIP-FIDELITY GATE (B1's user-visible correctness).
//
// Under B1 the chip IS the product's main output: it reproduces where the value sits in the
// range PRINTED ON THE REPORT. That is pure arithmetic on what is visible on the page — so it
// must be computed entirely in the REPORT'S OWN frame (raw value vs raw printed range) and must
// never involve our reference table or our unit conversions.
//
// WHY THIS EXISTS: it didn't, and a real bug shipped. `reportStatus` compared row.valueNum —
// which grounding CONVERTS to our SI unit — against the report's raw printed text. Every
// unit-converted row was wrong, in BOTH directions:
//     HCT 39% (35-48)              -> valueNum 0.39  -> "Below your report's range"   (normal!)
//     Hemoglobin 14 g/dL (13.7-17.5) -> valueNum 140 -> "Above your report's range"   (normal!)
//     Troponin I 0.02 ng/mL (0-0.04) -> valueNum 20  -> "Above your report's range"   (normal!)
// i.e. false alarm AND false reassurance across the entire US beachhead. The old
// "confidently-wrong" metric could not see this, because it scored our INTERNAL classification
// — a signal the user never sees. This gate scores what the user actually reads.

import { describe, it, expect } from 'vitest';
import { groundExtraction } from '@/lib/grounding';
import { buildSummary } from '@/lib/summary';
import { parsePrintedRange } from '@/lib/reference';
import { MIMIC_US_SAMPLE } from './real-corpus/us-sample';
import { MEDREPBENCH_SAMPLE } from './real-corpus/sample';

function chipFor(name: string, value: string, unit: string | null, range: string | null): string {
  const rep = groundExtraction({ rows: [{ name, value, unit, printedRange: range, confidence: 'high' }] }, 'unknown');
  return buildSummary(rep, 'en').sections[0].chipEn;
}

// The truth, computed independently of the app: raw value vs raw printed range.
function expectedChip(value: string, range: string): string | null {
  const pr = parsePrintedRange(range);
  const v = Number.parseFloat(value);
  if (!pr || !Number.isFinite(v)) return null; // not scoreable
  if (pr.low !== null && v < pr.low) return 'Below your report’s range';
  if (pr.high !== null && v > pr.high) return 'Above your report’s range';
  return 'Within your report’s range';
}

describe('chip fidelity — unit-converted rows stay in the REPORT’S frame', () => {
  // Each of these regressed: the conversion moved the value out of the report's frame.
  const CASES: [string, string, string, string, string][] = [
    ['HCT', '39', '%', '35-48', 'Within your report’s range'],
    ['Hemoglobin', '14', 'g/dL', '13.7-17.5', 'Within your report’s range'],
    ['Hemoglobin', '9.2', 'g/dL', '13.7-17.5', 'Below your report’s range'],
    ['Troponin I', '0.02', 'ng/mL', '0-0.04', 'Within your report’s range'],
    ['Troponin I', '0.09', 'ng/mL', '0-0.04', 'Above your report’s range'],
    ['Phosphate', '3.5', 'mg/dL', '2.5-4.5', 'Within your report’s range'],
    ['Bicarbonate', '24', 'mEq/L', '22-30', 'Within your report’s range'],
    ['D-Dimer', '0.41', 'mg/L(FEU)', '0-0.55', 'Within your report’s range'],
  ];
  for (const [n, v, u, r, want] of CASES) {
    it(`${n} ${v} ${u} (report range ${r}) → ${want}`, () => {
      expect(chipFor(n, v, u, r)).toBe(want);
    });
  }
});

describe('chip fidelity — every real corpus row agrees with the report’s own frame', () => {
  it('no row’s chip contradicts raw-value-vs-raw-printed-range', () => {
    const wrong: string[] = [];
    let scored = 0;
    for (const corpus of [MIMIC_US_SAMPLE, MEDREPBENCH_SAMPLE]) {
      for (const rep of corpus) {
        for (const it of rep.items) {
          const want = expectedChip(it.item_value, it.item_range);
          if (want === null) continue; // no parseable range/value → nothing to reproduce
          const got = chipFor(it.item_name, it.item_value, it.item_unit || null, it.item_range || null);
          // A row may legitimately DEFER (unknown analyte / abstained) — that asserts nothing and
          // is safe. What must never happen is asserting the WRONG position.
          if (got === 'Ask your clinician to interpret' || got === 'Not assessed') continue;
          scored += 1;
          if (got !== want) wrong.push(`${it.item_name.trim()} ${it.item_value}${it.item_unit} (${it.item_range}) → "${got}" but report says "${want}"`);
        }
      }
    }
    expect(scored).toBeGreaterThan(50); // the gate must actually be scoring rows
    expect([...new Set(wrong)], `chip contradicts the report:\n${[...new Set(wrong)].join('\n')}`).toEqual([]);
  });
});
