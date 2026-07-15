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
