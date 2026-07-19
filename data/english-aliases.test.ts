// US-beachhead English analyte names (B1 decision: the diaspora photographs US-lab reports).
//
// The table was built Chinese-first, so US reports' plain English names did not resolve — which
// meant a real Troponin I got NO R6 mandatory-confirm. This locks the names we verified against
// the real MIMIC-IV d_labitems dictionary, and — just as importantly — locks the ones we must
// deliberately NOT alias.
//
// THE RULE (learned the hard way): an ambiguous name may resolve only when OCR reads explicit
// specimen context printed on the report. Missing/unknown context must keep the legacy safe
// behavior, because a wrong entry is worse than no entry (it hands the guards the wrong frame).

import { describe, it, expect } from 'vitest';
import { findEntry } from '@/lib/reference';
import { groundExtraction } from '@/lib/grounding';

describe('US English aliases — verified Blood-only names now resolve', () => {
  it('Troponin I resolves and regains its high-stakes confirm (the worst live gap)', () => {
    expect(findEntry('Troponin I')?.key).toBe('troponin_i');
    const row = groundExtraction(
      { rows: [{ name: 'Troponin I', value: '0.02', unit: 'ng/mL', printedRange: '0-0.04', confidence: 'high' }] },
      'unknown',
    ).rows[0];
    expect(row.entry?.highStakes).toBe(true);
    expect(row.flags.some((f) => f.id === 'R6-HIGH-STAKES-MANDATORY-CONFIRM')).toBe(true);
  });

  it('CBC + serum calcium English names resolve', () => {
    expect(findEntry('White Blood Cells')?.key).toBe('wbc_count'); // MIMIC: Blood only
    expect(findEntry('Red Blood Cells')?.key).toBe('rbc_count'); // MIMIC: Blood only
    expect(findEntry('Calcium')?.key).toBe('calcium_total'); // MIMIC qualifies urine as "24 hr Calcium"
    expect(findEntry('Calcium, Total')?.key).toBe('calcium_total');
  });
});

describe('US English aliases — specimen-ambiguous names must STAY unknown', () => {
  it('Glucose is NOT aliased — MIMIC carries it in 9 fluids (Blood, Urine, CSF, Pleural, Ascites, Joint, Body Fluid, Stool)', () => {
    // A CSF or pleural glucose is a different test with a different frame. Unknown > wrong entry.
    expect(findEntry('Glucose')).toBeNull();
  });

  it('Urea Nitrogen is NOT aliased — specimen-ambiguous AND the H1.5 urea-vs-BUN trap (x2.14)', () => {
    expect(findEntry('Urea Nitrogen')).toBeNull();
  });

  it('bare "pH" must NOT resolve to the URINE entry — a blood-gas pH 7.1 is critical acidemia but sits inside urine 4-9', () => {
    // Mapping it to urine_ph would hand the guards the wrong frame: no R3/R6, silently "normal".
    expect(findEntry('pH')).toBeNull();
  });

  it('ionized calcium is a DIFFERENT analyte from total calcium — never aliased together', () => {
    expect(findEntry('Free Calcium')?.key ?? null).not.toBe('calcium_total');
  });
});

describe('US English aliases — specimen-scoped urine names', () => {
  it('bare pH resolves only with urine context', () => {
    expect(findEntry('pH')).toBeNull();
    expect(findEntry('pH', 'unknown')).toBeNull();
    expect(findEntry('pH', null)).toBeNull();
    expect(findEntry('pH', 'urine')?.key).toBe('urine_ph');
    expect(findEntry('pH', 'blood')).toBeNull();
  });

  it('urinalysis names resolve with urine context', () => {
    expect(findEntry('Protein', 'urine')?.key).toBe('urine_protein');
    expect(findEntry('PRO', 'urine')?.key).toBe('urine_protein');
    expect(findEntry('Ketone', 'urine')?.key).toBe('urine_ketones');
    expect(findEntry('Ketones', 'urine')?.key).toBe('urine_ketones');
    expect(findEntry('Specific Gravity', 'urine')?.key).toBe('urine_specific_gravity');
    expect(findEntry('Glucose', 'urine')?.key).toBe('urine_glucose');
    expect(findEntry('GLU', 'urine')?.key).toBe('urine_glucose');
  });

  it('bare Glucose remains unknown for blood', () => {
    expect(findEntry('Glucose', 'blood')).toBeNull();
    expect(findEntry('GLU', 'blood')).toBeNull();
    expect(findEntry('PRO', 'blood')).toBeNull();
    expect(findEntry('Ketones', 'blood')).toBeNull();
    expect(findEntry('Specific Gravity', 'blood')).toBeNull();
  });
});
