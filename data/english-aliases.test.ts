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

function expectUnknownForEverySpecimen(name: string) {
  expect(findEntry(name)).toBeNull();
  expect(findEntry(name, 'unknown')).toBeNull();
  expect(findEntry(name, null)).toBeNull();
  expect(findEntry(name, 'blood')).toBeNull();
  expect(findEntry(name, 'urine')).toBeNull();
}

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

  it('CBC names keep legacy/blood identity while known urine routes to microscopy', () => {
    expect(findEntry('White Blood Cells')?.key).toBe('wbc_count');
    expect(findEntry('White Blood Cells', 'blood')?.key).toBe('wbc_count');
    expect(findEntry('White Blood Cells', 'urine')?.key).toBe('urine_wbc_microscopy');
    expect(findEntry('WBC', 'urine')?.key).toBe('urine_wbc_microscopy');
    expect(findEntry('Red Blood Cells')?.key).toBe('rbc_count');
    expect(findEntry('Red Blood Cells', 'blood')?.key).toBe('rbc_count');
    expect(findEntry('Red Blood Cells', 'urine')?.key).toBe('urine_rbc_microscopy');
    expect(findEntry('RBC', 'urine')?.key).toBe('urine_rbc_microscopy');
  });

  it('serum calcium English names still resolve', () => {
    expect(findEntry('Calcium')?.key).toBe('calcium_total'); // MIMIC qualifies urine as "24 hr Calcium"
    expect(findEntry('Calcium, Total')?.key).toBe('calcium_total');
  });
});

describe('Chinese aliases — unit and panel corroborate these exact names', () => {
  it.each([
    ['淋巴细胞数', 'lymphocyte_abs'],
    ['中性细胞值', 'neutrophil_abs'],
    ['红蛋白', 'hemoglobin'],
  ])('%s resolves only by exact normalized match to %s', (name, key) => {
    expect(findEntry(name)?.key).toBe(key);
  });
});

describe('Chinese aliases — trace-element and sensitive names must STAY unknown', () => {
  it('钙(Ca) stays unknown — heavy-metals/trace-element panel in μg/ml, not serum calcium in mmol/L', () => {
    // Lock both sides of the boundary: bare serum names remain valid, while a future
    // "strip parenthetical suffixes" normalization must not turn 钙(Ca) into 钙 or Ca.
    expect(findEntry('钙')?.key).toBe('calcium_total');
    expect(findEntry('Ca')?.key).toBe('calcium_total');
    expectUnknownForEverySpecimen('钙(Ca)');
  });

  it('镁(Mg) stays unknown — heavy-metals/trace-element panel in ug/ml, not serum magnesium in mmol/L', () => {
    // As above, preserving legitimate serum aliases must not erase the panel boundary.
    expect(findEntry('镁')?.key).toBe('magnesium');
    expect(findEntry('Mg')?.key).toBe('magnesium');
    expectUnknownForEverySpecimen('镁(Mg)');
  });

  it('铅(Pb) stays unknown — heavy-metals/trace-element panel in μg/L and no curated lead entry exists', () => {
    expectUnknownForEverySpecimen('铅(Pb)');
  });

  it('镉(Cd) stays unknown — heavy-metals/trace-element panel in μg/L and no curated cadmium entry exists', () => {
    expectUnknownForEverySpecimen('镉(Cd)');
  });

  it('人类免疫缺陷病毒抗体/抗原(P24) stays unknown — sensitive HIV Ag/Ab result is deliberately uninterpreted', () => {
    expectUnknownForEverySpecimen('人类免疫缺陷病毒抗体/抗原(P24)');
  });
});

describe('Policy refusals — normalization and alias passes must not unlock them', () => {
  it('a-淀粉酶 stays unknown — canonical urine-amylase name has no unit or panel context to disambiguate it', () => {
    // Follow-up, deliberately not done here: scope the still-resolving bare
    // 淀粉酶 alias to blood in its own before/after change.
    expect(findEntry('淀粉酶')?.key).toBe('amylase');
    expectUnknownForEverySpecimen('a-淀粉酶');
  });

  it('髓系原始细胞群 stays unknown — a blast-population position creates prognostic shock without a clinician', () => {
    expectUnknownForEverySpecimen('髓系原始细胞群');
  });

  it.each([
    'Cocaine, Urine',
    'Methadone, Urine',
    'Benzodiazepine Screen, Urine',
    'Oxycodone',
    'Opiate Screen, Urine',
    'Amphetamine Screen, Urine',
    'Barbiturate Screen, Urine',
  ])('%s stays unknown — urine drug-screen privacy refusal has no grounded band', (name) => {
    expectUnknownForEverySpecimen(name);
  });

  it('Estimated GFR (MDRD equation) stays unknown — it is a blank label row and the MDRD frame does not match our eGFR entry', () => {
    expectUnknownForEverySpecimen('Estimated GFR (MDRD equation)');
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

describe('Chinese/GLU aliases — explicit specimen selects the correct glucose frame', () => {
  it('GLU stays unknown when specimen is omitted or unknown', () => {
    expect(findEntry('GLU')).toBeNull();
    expect(findEntry('GLU', 'unknown')).toBeNull();
    expect(findEntry('GLU', null)).toBeNull();
  });

  it('葡萄糖 stays unknown when specimen is omitted or unknown', () => {
    expect(findEntry('葡萄糖')).toBeNull();
    expect(findEntry('葡萄糖', 'unknown')).toBeNull();
    expect(findEntry('葡萄糖', null)).toBeNull();
  });

  it('GLU and 葡萄糖 resolve to fasting glucose only with printed blood context', () => {
    expect(findEntry('GLU', 'blood')?.key).toBe('fasting_glucose');
    expect(findEntry('葡萄糖', 'blood')?.key).toBe('fasting_glucose');
  });

  it('GLU and 葡萄糖 resolve to urine glucose only with printed urine context', () => {
    expect(findEntry('GLU', 'urine')?.key).toBe('urine_glucose');
    expect(findEntry('葡萄糖', 'urine')?.key).toBe('urine_glucose');
  });

  it('unambiguous 血糖 keeps its legacy unscoped fasting-glucose identity', () => {
    expect(findEntry('血糖')?.key).toBe('fasting_glucose');
  });
});

describe('US English aliases — specimen-scoped urine names', () => {
  it('bare pH resolves only with explicit urine or blood context', () => {
    expect(findEntry('pH')).toBeNull();
    expect(findEntry('pH', 'unknown')).toBeNull();
    expect(findEntry('pH', null)).toBeNull();
    expect(findEntry('pH', 'urine')?.key).toBe('urine_ph');
    expect(findEntry('pH', 'blood')?.key).toBe('blood_ph');
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

  it('generic urine-only aliases remain unknown for blood', () => {
    expect(findEntry('Glucose', 'blood')).toBeNull();
    expect(findEntry('PRO', 'blood')).toBeNull();
    expect(findEntry('Ketones', 'blood')).toBeNull();
    expect(findEntry('Specific Gravity', 'blood')).toBeNull();
  });

  it('routes microscopy and dipstick collisions by their printed specimen', () => {
    expect(findEntry('RBC', 'blood')?.key).toBe('rbc_count');
    expect(findEntry('RBC', 'urine')?.key).toBe('urine_rbc_microscopy');
    expect(findEntry('WBC', 'blood')?.key).toBe('wbc_count');
    expect(findEntry('WBC', 'urine')?.key).toBe('urine_wbc_microscopy');
    expect(findEntry('胆红素', 'blood')?.key).toBe('total_bilirubin');
    expect(findEntry('胆红素', 'urine')?.key).toBe('urine_bilirubin');
  });

  it.each([
    ['Color', 'urine_color'],
    ['Appearance', 'urine_appearance'],
    ['Nitrite', 'urine_nitrite'],
    ['Bilirubin', 'urine_bilirubin'],
    ['Urobilinogen', 'urine_urobilinogen'],
    ['Pus Cells', 'urine_wbc_microscopy'],
    ['Epithelial Cells', 'urine_epithelial_cells'],
    ['Casts', 'urine_casts'],
    ['Crystals', 'urine_crystals'],
    ['Bacteria', 'urine_bacteria'],
    ['Yeast Cells', 'urine_yeast_cells'],
    ['Mucus Thread', 'urine_mucus'],
    ['Amorphous Deposits', 'urine_amorphous_deposits'],
  ])('requires printed urine context for the generic report-only name %s', (name, key) => {
    expect(findEntry(name)).toBeNull();
    expect(findEntry(name, 'unknown')).toBeNull();
    expect(findEntry(name, null)).toBeNull();
    expect(findEntry(name, 'blood')).toBeNull();
    expect(findEntry(name, 'urine')?.key).toBe(key);
  });
});
