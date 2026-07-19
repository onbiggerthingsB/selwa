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
import { resolveText } from '@/lib/i18n';
import { MIMIC_US_SAMPLE } from './real-corpus/us-sample';
import { MEDREPBENCH_SAMPLE } from './real-corpus/sample';

function chipFor(name: string, value: string, unit: string | null, range: string | null): string {
  const rep = groundExtraction({ rows: [{ name, value, unit, printedRange: range, confidence: 'high' }] }, 'unknown');
  return resolveText(buildSummary(rep, 'en').sections[0].chip, 'en').text;
}

// AN ACTUALLY INDEPENDENT ORACLE.
//
// The previous version of this function imported the production `parsePrintedRange` and reused
// the production `Number.parseFloat`. It therefore agreed with the code by construction and
// blessed every parser bug Codex later found (strict `<` read as `<=`, `-2-2` mis-parsed as
// 2..2, `parseFloat('3-15')` -> 3, `2--40` unparsed). An oracle built from the implementation
// is not an oracle — it is a mirror. This one re-derives the answer from the report text with
// its own deliberately-simple, independently-written logic, and refuses anything it is not
// certain about (returns null → the row is not scored) so it can never rubber-stamp a guess.
function expectedChip(value: string, range: string): string | null {
  const v = value.trim().replace(/[↑↓HL]+$/i, '').trim();
  // a strict scalar, written from scratch
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;

  const r = range.trim().replace(/\s+/g, '');
  const NUM = String.raw`[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?`;

  // one-sided, strictness respected
  const m = r.match(new RegExp(`^([<>≤≥])(=?)(${NUM})$`));
  if (m) {
    const b = Number(m[3]);
    const inclusive = m[2] === '=' || m[1] === '≤' || m[1] === '≥';
    const isUpper = m[1] === '<' || m[1] === '≤';
    if (isUpper) return (inclusive ? n > b : n >= b) ? 'Above your report’s range' : 'Within your report’s range';
    return (inclusive ? n < b : n <= b) ? 'Below your report’s range' : 'Within your report’s range';
  }

  // two-sided: enumerate readings, accept only an unambiguous one (mirrors nothing — this is
  // simply the only defensible way to read "-3--1" style text)
  const readings: [number, number][] = [];
  for (const sep of ['--', '-', '~', '–', '—']) {
    const mm = r.match(new RegExp(`^(${NUM})${sep}(${NUM})$`));
    if (!mm) continue;
    const lo = Number(mm[1]);
    const hi = Number(mm[2]);
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi && !readings.some(([a, b]) => a === lo && b === hi)) readings.push([lo, hi]);
  }
  if (readings.length !== 1) return null; // unparseable or ambiguous → don't score
  const [lo, hi] = readings[0];
  if (n < lo) return 'Below your report’s range';
  if (n > hi) return 'Above your report’s range';
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
