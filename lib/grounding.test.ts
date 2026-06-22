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
});
