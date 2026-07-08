import { describe, it, expect } from 'vitest';
import { groundExtraction } from './grounding';
import type { LabExtraction } from '@/lib/extractionSchema';

const extraction: LabExtraction = {
  rows: [
    { name: '空腹血糖', value: '7.8', unit: 'mmol/L', printedRange: '3.9-6.1', confidence: 'high' },
    { name: '钾', value: '6.9', unit: 'mmol/L', printedRange: '3.5-5.3', confidence: 'high' },
    { name: '总胆固醇', value: '4.5', unit: 'mmol/L', printedRange: '<5.2', confidence: 'high' },
    { name: 'ceruloplasmin', value: '15', unit: 'umol/L', printedRange: '5-15', confidence: 'medium' },
  ],
};

describe('groundExtraction', () => {
  it('produces one grounded row per extracted row', () => {
    const report = groundExtraction(extraction, 'unknown');
    expect(report.rows).toHaveLength(4);
    expect(report.sex).toBe('unknown');
  });

  it('classifies a high-stakes high value and requires confirmation', () => {
    const { rows } = groundExtraction(extraction, 'unknown');
    const glu = rows.find((r) => r.entry?.key === 'fasting_glucose')!;
    expect(glu.classification).toBe('high');
    expect(glu.needsConfirm).toBe(true);
    expect(glu.flags.map((f) => f.id)).toContain('R4-HIGH-STAKES-ANY-ABNORMAL');
  });

  it('marks a critical value urgent', () => {
    const { rows } = groundExtraction(extraction, 'unknown');
    const k = rows.find((r) => r.entry?.key === 'potassium')!;
    expect(k.classification).toBe('critical');
    expect(k.flags.some((f) => f.severity === 'urgent')).toBe(true);
  });

  it('abstains (no classification) on an unknown analyte', () => {
    const { rows } = groundExtraction(extraction, 'unknown');
    const hcy = rows.find((r) => r.extracted.name === 'ceruloplasmin')!;
    expect(hcy.entry).toBeNull();
    expect(hcy.action).toBe('abstain');
    expect(hcy.classification).toBe('unclassified');
  });

  it('classifies a normal low-stakes value cleanly', () => {
    const { rows } = groundExtraction(extraction, 'unknown');
    const tc = rows.find((r) => r.entry?.key === 'total_cholesterol')!;
    expect(tc.classification).toBe('normal');
    expect(tc.action).toBe('classify');
  });

  it('auto-converts a convertible unit mismatch and flags the conversion (R2b)', () => {
    const ex = { rows: [{ name: 'GLU', value: '99', unit: 'mg/dL', printedRange: null, confidence: 'high' as const }] };
    const { rows } = groundExtraction(ex, 'unknown');
    const glu = rows.find((r) => r.entry?.key === 'fasting_glucose')!;
    expect(glu.classification).toBe('normal');          // 99 mg/dL = 5.49 mmol/L
    expect(glu.valueNum).toBeCloseTo(5.49, 1);
    expect(glu.flags.map((f) => f.id)).toContain('R2b-UNIT-CONVERTED');
    expect(glu.action).toBe('classify');
  });

  it('still abstains when no safe conversion exists (urea mg/dL)', () => {
    const ex = { rows: [{ name: '尿素', value: '14', unit: 'mg/dL', printedRange: null, confidence: 'high' as const }] };
    const { rows } = groundExtraction(ex, 'unknown');
    const urea = rows.find((r) => r.entry?.key === 'urea')!;
    expect(urea.action).toBe('abstain');
    expect(urea.flags.map((f) => f.id)).toContain('R2-UNIT-MISMATCH');
  });

  it('R11 unit-aware: a mg/dL printed range no longer false-disagrees with our mmol/L band', () => {
    // Glucose 99 mg/dL (printed range 70-99 mg/dL) auto-converts to ~5.49 mmol/L.
    // The printed range must be normalized to mmol/L (~3.9-5.5) before comparing to
    // our 3.9-6.1 — pre-fix this compared 70-99 to 3.9-6.1 and false-fired R11.
    const ex = {
      rows: [{ name: '空腹血糖', value: '99', unit: 'mg/dL', printedRange: '70-99', confidence: 'high' as const }],
    };
    const { rows } = groundExtraction(ex, 'unknown');
    expect(rows[0].flags.map((f) => f.id)).not.toContain('R11-RANGE-DISAGREEMENT');
  });

  // H1.5 — d-dimer FEU/DDU basis ambiguity. FEU and DDU units differ ~2× (the plainEn
  // even warns of this), so a bare 'mg/L' with no basis qualifier must NOT be silently
  // read as our canonical FEU value — abstain (matches the urea/calcium abstain-traps).
  it('abstains on an unqualified d-dimer unit (bare mg/L is FEU/DDU-ambiguous)', () => {
    const ex = { rows: [{ name: 'D-dimer', value: '0.3', unit: 'mg/L', printedRange: null, confidence: 'high' as const }] };
    const { rows } = groundExtraction(ex, 'unknown');
    const dd = rows.find((r) => r.entry?.key === 'd_dimer')!;
    expect(dd.action).toBe('abstain');
    expect(dd.flags.map((f) => f.id)).toContain('R2-UNIT-MISMATCH');
  });

  it('classifies a d-dimer with an explicit FEU basis (mg/L FEU and its exact µg/mL FEU equivalent)', () => {
    for (const unit of ['mg/L FEU', 'µg/mL FEU']) {
      const ex = { rows: [{ name: 'D-dimer', value: '0.3', unit, printedRange: null, confidence: 'high' as const }] };
      const { rows } = groundExtraction(ex, 'unknown');
      const dd = rows.find((r) => r.entry?.key === 'd_dimer')!;
      expect(dd.action, `unit ${unit}`).toBe('classify');
      expect(dd.classification).toBe('normal'); // 0.3 < 0.5 rule-out cutoff
    }
  });

  it('converts a same-basis d-dimer (480 ng/mL FEU → 0.48 mg/L FEU, still below the rule-out cutoff)', () => {
    // ng/mL FEU is the most common real report format; a same-basis decimal-scale
    // conversion restores the rule-out reassurance (was abstaining pre-fix).
    const ex = { rows: [{ name: 'D-dimer', value: '480', unit: 'ng/mL FEU', printedRange: null, confidence: 'high' as const }] };
    const { rows } = groundExtraction(ex, 'unknown');
    const dd = rows.find((r) => r.entry?.key === 'd_dimer')!;
    expect(dd.action).toBe('classify');
    expect(dd.valueNum).toBeCloseTo(0.48, 2);
    expect(dd.classification).toBe('normal');
    expect(dd.flags.map((f) => f.id)).toContain('R2b-UNIT-CONVERTED');
  });

  it('still abstains on a BASIS-less ng/mL d-dimer (no FEU/DDU qualifier → 1000× or 2× ambiguity)', () => {
    const ex = { rows: [{ name: 'D-dimer', value: '480', unit: 'ng/mL', printedRange: null, confidence: 'high' as const }] };
    const { rows } = groundExtraction(ex, 'unknown');
    const dd = rows.find((r) => r.entry?.key === 'd_dimer')!;
    expect(dd.action).toBe('abstain');
    expect(dd.flags.map((f) => f.id)).toContain('R2-UNIT-MISMATCH');
  });
});
