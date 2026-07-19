// DECOUPLING (grilling Q1): under B1 the chip reproduces the range PRINTED ON THE REPORT —
// pure arithmetic on the page, needing no reference-table lookup. So it must NOT be gated on
// whether we recognise the analyte. Recognition-bound coverage was ~47% on the US beachhead
// while range-bound coverage is ~75%: gating the chip on the table discarded ~28 points of
// deliverable value on rows where we could faithfully reproduce what the report already says.
//
// The one thing that still suppresses the chip: R13 (we have positive evidence the VALUE was
// misread). Reproducing a position for a number we believe is wrong would be worse than silence.
// Unknown analytes have no R13 (bounds are per-analyte) — that is the "no net" cost accepted in
// grilling Q2, after the data killed a table-free plausibility net.

import { describe, it, expect } from 'vitest';
import { groundExtraction } from '@/lib/grounding';
import { buildSummary } from '@/lib/summary';
import { resolveText } from '@/lib/i18n';

const sec = (name: string, value: string, unit: string | null, range: string | null) =>
  buildSummary(groundExtraction({ rows: [{ name, value, unit, printedRange: range, confidence: 'high' }] }, 'unknown'), 'en').sections[0];

describe('decoupled chip — an UNKNOWN analyte still gets the report’s own comparison', () => {
  it('Anion Gap (not in our table) with a printed range reproduces the position', () => {
    const s = sec('Anion Gap', '14', 'mEq/L', '8-20');
    expect(resolveText(s.chip, 'en').text).toBe('Within your report’s range');
    expect(s.reportRange).toBe('8-20'); // the report's own range surfaces too — it's their info
  });

  it('an unknown analyte OUT of its printed range reproduces that too', () => {
    expect(resolveText(sec('Anion Gap', '25', 'mEq/L', '8-20').chip, 'en').text).toBe('Above your report’s range');
  });

  it('an unknown analyte with NO printed range still asserts nothing', () => {
    const s = sec('Anion Gap', '14', 'mEq/L', null);
    expect(resolveText(s.chip, 'en').text).toMatch(/clinician|not assessed/i);
    expect(s.reportRange).toBe('');
  });

  it('but we add NO education/typical-range for an analyte we do not know', () => {
    const s = sec('Anion Gap', '14', 'mEq/L', '8-20');
    expect(resolveText(s.plain, 'en').text).toBe(''); // no invented meaning
    expect(s.typicalRange).toBe(''); // we have no curated range to offer as context
  });
});

describe('decoupled chip — safety limits', () => {
  it('R13 (we believe the value was MISREAD) suppresses the comparison even with a printed range', () => {
    // K+ 40 mmol/L is physically impossible — reproducing "above your range" on a number we
    // believe we misread would assert a position from bad data.
    const s = sec('钾', '40', 'mmol/L', '3.5-5.1');
    expect(resolveText(s.chip, 'en').text).not.toMatch(/above|below|within/i);
  });

  it('a non-numeric value asserts nothing (nothing to reproduce)', () => {
    expect(resolveText(sec('滴虫', 'Negative(-)', null, 'Negative(-)').chip, 'en').text).toMatch(/clinician|not assessed/i);
  });

  it('a KNOWN analyte is unaffected — still reproduces the report’s frame', () => {
    expect(resolveText(sec('Hemoglobin', '9.2', 'g/dL', '13.7-17.5').chip, 'en').text).toBe('Below your report’s range');
  });
});
