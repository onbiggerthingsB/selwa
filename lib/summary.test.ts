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

  it('B1: the chip reproduces the REPORT’S OWN range (not our verdict), plus both languages, value, plain meaning, ranges', () => {
    const { sections } = buildSummary(report, 'en');
    const glu = sections.find((s) => s.key === 'fasting_glucose')!;
    expect(glu.nameEn).toContain('Fasting plasma glucose');
    expect(glu.nameZh).toContain('空腹血糖');
    expect(glu.valueText).toBe('7.8 mmol/L');
    // 7.8 is above the report's printed 3.9-6.1 → the chip reproduces the report, not an
    // independent "High" verdict from our table.
    expect(glu.tone).toBe('high');
    expect(glu.chipEn).toMatch(/above your report/i);
    expect(glu.chipZh).toBe('高于报告所列范围');
    expect(glu.plainEn).toMatch(/blood sugar/i);
    expect(glu.plainZh).toMatch(/血糖/);
    expect(glu.reportRange).toBe('3.9-6.1'); // the report's own range, verbatim
    expect(glu.typicalRange).toMatch(/3\.9–6\.1 mmol\/L/); // ours, shown as general context
    expect(glu.flags.length).toBeGreaterThan(0); // high-stakes
    expect(glu.flags.every((f) => f.messageEn.length > 0 && f.messageZh.length > 0)).toBe(true);
  });

  it('a classified value WITHIN the report’s range defers, not "in range" as a verdict', () => {
    const r = groundExtraction(
      { rows: [{ name: '空腹血糖', value: '5.0', unit: 'mmol/L', printedRange: '3.9-6.1', confidence: 'high' }] },
      'unknown',
    );
    const s = buildSummary(r, 'en').sections[0];
    expect(s.chipEn).toMatch(/within your report/i);
    expect(s.tone).toBe('normal');
  });

  it('a classified value with NO printed range asserts no verdict — defers to the clinician', () => {
    const r = groundExtraction(
      { rows: [{ name: '空腹血糖', value: '7.8', unit: 'mmol/L', printedRange: null, confidence: 'high' }] },
      'unknown',
    );
    const s = buildSummary(r, 'en').sections[0];
    expect(s.chipEn).toMatch(/clinician/i); // "Ask your clinician to interpret"
    expect(s.reportRange).toBe(''); // nothing to reproduce
  });

  it('presents an unknown analyte neutrally — not assessed, no invented meaning, no range', () => {
    const { sections } = buildSummary(report, 'en');
    const hcy = sections.find((s) => s.nameEn === 'ceruloplasmin')!;
    expect(hcy.tone).toBe('unclassified');
    expect(hcy.chipEn.toLowerCase()).toContain('not assessed');
    expect(hcy.plainEn).toBe('');
    expect(hcy.reportRange).toBe('');
    expect(hcy.typicalRange).toBe('');
  });
});

describe('R13 suppression rendering', () => {
  it('an implausible (misread) value shows raw + Not assessed + no clinical meaning + the R13 flag', () => {
    // 钾 40 mmol/L is a decimal-shift misread — R13 abstains.
    const report = groundExtraction(
      { rows: [{ name: '钾', value: '40', unit: 'mmol/L', printedRange: null, confidence: 'high' }] },
      'unknown',
    );
    const s = buildSummary(report, 'en').sections[0];
    expect(s.tone).toBe('unclassified'); // NOT classified as critical
    expect(s.chipEn.toLowerCase()).toContain('not assessed');
    expect(s.plainEn).toBe(''); // no plain-language clinical meaning rendered
    expect(s.valueText).toContain('40'); // raw value still shown for the user to check
    expect(s.flags.some((f) => /misread|check the number/i.test(f.messageEn))).toBe(true);
  });
});
