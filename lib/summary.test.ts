import { describe, it, expect } from 'vitest';
import { buildSummary } from './summary';
import { groundExtraction } from './grounding';
import type { LabExtraction } from '@/lib/extractionSchema';

const extraction: LabExtraction = {
  rows: [
    { name: '空腹血糖', value: '7.8', unit: 'mmol/L', printedRange: '3.9-6.1', confidence: 'high' },
    { name: 'ceruloplasmin', value: '15', unit: 'umol/L', printedRange: '5-15', confidence: 'high' },
  ],
};

describe('buildSummary', () => {
  const report = groundExtraction(extraction, 'unknown');

  it('always includes disclaimers (EN and ZH)', () => {
    expect(buildSummary(report, 'en').disclaimers.length).toBeGreaterThan(0);
    expect(buildSummary(report, 'zh').disclaimers.length).toBeGreaterThan(0);
  });

  it('carries BOTH languages, the value, classification labels, plain meaning, and the reference range', () => {
    const { sections } = buildSummary(report, 'en');
    const glu = sections.find((s) => s.key === 'fasting_glucose')!;
    expect(glu.nameEn).toContain('Fasting plasma glucose');
    expect(glu.nameZh).toContain('空腹血糖');
    expect(glu.valueText).toBe('7.8 mmol/L');
    expect(glu.status).toBe('high');
    expect(glu.statusLabelEn.toLowerCase()).toContain('high');
    expect(glu.statusLabelZh).toBe('偏高');
    expect(glu.plainEn).toMatch(/blood sugar/i);
    expect(glu.plainZh).toMatch(/血糖/);
    expect(glu.refRange).toMatch(/3\.9–6\.1 mmol\/L/);
    expect(glu.flags.length).toBeGreaterThan(0); // high-stakes
    // flags carry both languages
    expect(glu.flags.every((f) => f.messageEn.length > 0 && f.messageZh.length > 0)).toBe(true);
  });

  it('presents an unknown analyte neutrally — not assessed, no invented meaning, no range', () => {
    const { sections } = buildSummary(report, 'en');
    const hcy = sections.find((s) => s.nameEn === 'ceruloplasmin')!;
    expect(hcy.status).toBe('unclassified');
    expect(hcy.statusLabelEn.toLowerCase()).toContain('not assessed');
    expect(hcy.plainEn).toBe('');
    expect(hcy.refRange).toBe('');
  });
});
