import { describe, it, expect } from 'vitest';
import { normalizeUnit } from './reference';
import { groundExtraction } from './grounding';

// Step 2 (coverage bite): two ZERO-band-risk unit fixes found by the real-content measurement
// — D-dimer written "mg/L(FEU)" (paren form of the FEU basis) and hematocrit reported in %.
// The analyte + reference band already exist and are correct; we just weren't accepting the
// real unit spelling. Safety of the FEU basis-guard and R13 magnitude-guard must be preserved.

const g = (name: string, value: string, unit: string, range: string | null) =>
  groundExtraction({ rows: [{ name, value, unit, printedRange: range, confidence: 'high' }] }, 'unknown').rows[0];

describe('real-unit coverage — D-dimer FEU paren format', () => {
  it('"mg/L(FEU)" now classifies (same basis as our "mg/L FEU")', () => {
    const r = g('D-Dimer', '0.41', 'mg/L(FEU)', '0-0.55');
    expect(r.action).toBe('classify');
    expect(r.classification).toBe('normal');
  });

  it('SAFETY unchanged: bare basis-less d-dimer units still abstain', () => {
    expect(g('D-Dimer', '0.41', 'mg/L', '0-0.55').action).toBe('abstain'); // no FEU/DDU basis
    expect(g('D-Dimer', '0.41', 'mg/L(DDU)', '0-0.55').action).toBe('abstain'); // DDU basis, no conversion
  });

  it('normalizeUnit strips parens but keeps the basis token; unrelated units unaffected', () => {
    expect(normalizeUnit('mg/L(FEU)')).toBe(normalizeUnit('mg/L FEU'));
    expect(normalizeUnit('ng/mL(FEU)')).toBe(normalizeUnit('ng/mL FEU'));
    expect(normalizeUnit('mg/dL')).toBe('mg/dl');
    expect(normalizeUnit('10^9/L')).toBe('10^9/l');
  });
});

describe('real-unit coverage — hematocrit %', () => {
  it('HCT 39% converts (×0.01 → 0.39 L/L) and classifies normal', () => {
    const r = g('HCT', '39', '%', '35-48');
    expect(r.action).toBe('classify');
    expect(r.classification).toBe('normal');
  });

  it('红细胞压积 49.9% classifies but is CONFIRM-flagged vs the printed range (safe, not a silent wrong call)', () => {
    const r = g('红细胞压积', '49.9', '%', '37-47');
    expect(r.action).toBe('classify');
    expect(r.needsConfirm).toBe(true); // R11: our union band says normal, the report's range says high → confirm
  });

  it('SAFETY: a mis-scaled hematocrit (0.39 labeled %) → 0.0039 L/L is caught by R13, not classified', () => {
    expect(g('HCT', '0.39', '%', null).action).toBe('abstain');
  });

  it('the % conversion is analyte-scoped — a bare % on a non-hematocrit stays abstained', () => {
    // neutrophil-percent isn't a hematocrit; must not get the L/L conversion nor a false match.
    expect(g('嗜碱性粒细胞百分比', '0.1', '%', '0-1').entry?.key).not.toBe('hematocrit');
  });
});

describe('US conventional-unit coverage (MIMIC beachhead) — safe subset', () => {
  it('Bicarbonate mEq/L ≡ mmol/L (monovalent) classifies', () => {
    const r = g('Bicarbonate', '24', 'mEq/L', '22-30');
    expect(r.action).toBe('classify');
    expect(r.entry?.key).toBe('bicarbonate');
  });

  it('Hemoglobin g/dL converts (×10 → g/L) and classifies', () => {
    const r = g('Hemoglobin', '9.2', 'g/dL', '13.7-17.5');
    expect(r.action).toBe('classify'); // 92 g/L, below band → high-stakes confirm, still classified
    expect(r.entry?.key).toBe('hemoglobin');
  });

  it('Platelet Count K/uL ≡ 10^9/L classifies', () => {
    expect(g('Platelet Count', '250', 'K/uL', '150-400').action).toBe('classify');
  });

  it('MCHC g/dL converts (×10 → g/L); Amylase/Lipase IU/L ≡ U/L classify', () => {
    expect(g('MCHC', '33', 'g/dL', '32-36').action).toBe('classify');
    expect(g('Amylase', '60', 'IU/L', '30-110').action).toBe('classify');
    expect(g('Lipase', '30', 'IU/L', '10-60').action).toBe('classify');
  });

  it('Phosphate mg/dL converts (×0.3229 → mmol/L) and classifies', () => {
    expect(g('Phosphate', '3.5', 'mg/dL', '2.5-4.5').action).toBe('classify');
  });

  it('SAFETY: the H1.5 traps stay abstained — Calcium & Magnesium mg/dL, and pH "units"', () => {
    expect(g('Calcium, Total', '9.5', 'mg/dL', '8.5-10.5').action).toBe('abstain'); // mg/dL vs mEq/L trap
    expect(g('Magnesium', '2.0', 'mg/dL', '1.7-2.4').action).toBe('abstain'); // divalent trap
    // A blood-gas pH would mis-map to urine_ph; leaving "units" unmatched keeps it abstained.
    expect(g('pH', '7.4', 'units', '5-8').action).toBe('abstain');
  });
});
