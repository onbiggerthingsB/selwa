// US-beachhead English analyte names (B1 decision: the diaspora photographs US-lab reports).
//
// The table was built Chinese-first, so US reports' plain English names did not resolve — which
// meant a real Troponin I got NO R6 mandatory-confirm. This locks the names we verified against
// the real MIMIC-IV d_labitems dictionary, and — just as importantly — locks the ones we must
// deliberately NOT alias.
//
// THE RULE (learned the hard way): only alias a name whose SPECIMEN is unambiguous in the real
// data. Our table separates specimen by naming (fasting_glucose / random_glucose / urine_glucose,
// urine_ph, urine_protein) and has no fluid field, while extraction captures no panel context —
// so an ambiguous name cannot be resolved to the right entry, and a wrong entry is worse than
// no entry (it hands the guards the wrong reference frame).

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
