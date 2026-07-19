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
    expect(glu.chipEn).toMatch(/above your report/i);
    expect(glu.chipZh).toBe('高于报告所列范围');
    // TONE IS NEUTRAL even though the value is out of range: colour would assert OUR judgment
    // that this is bad — wrong for HDL/HBsAb/eGFR where out-of-range is good. The chip text
    // carries the (reproduced) position; the tint does not editorialise it.
    expect(glu.tone).toBe('report'); // neutral gray — never the semantic green 'normal'
    expect(glu.plainEn).toMatch(/blood sugar/i);
    expect(glu.plainZh).toMatch(/血糖/);
    expect(glu.reportRange).toBe('3.9-6.1'); // the report's own range, verbatim
    expect(glu.typicalRange).toMatch(/3\.9–6\.1 mmol\/L/); // ours, shown as general context
    expect(glu.flags.length).toBeGreaterThan(0); // high-stakes → R6 routing flag
    expect(glu.flags.every((f) => f.messageEn.length > 0 && f.messageZh.length > 0)).toBe(true);
    // B1: the surfaced flag may only talk about OUR READING — never a verdict on the value.
    expect(glu.flags.every((f) => /confirm the value we read|misread/i.test(f.messageEn))).toBe(true);
    expect(glu.flags.some((f) => /outside the usual range|critical range/i.test(f.messageEn))).toBe(false);
  });

  it('a classified value WITHIN the report’s range defers, not "in range" as a verdict', () => {
    const r = groundExtraction(
      { rows: [{ name: '空腹血糖', value: '5.0', unit: 'mmol/L', printedRange: '3.9-6.1', confidence: 'high' }] },
      'unknown',
    );
    const s = buildSummary(r, 'en').sections[0];
    expect(s.chipEn).toMatch(/within your report/i);
    expect(s.tone).toBe('report'); // neutral gray, NOT semantic green
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

  it('an UNKNOWN analyte still reproduces the report’s own comparison — but invents no meaning', () => {
    // DECOUPLED (grilling Q1): ceruloplasmin isn't in our table, but the report prints its own
    // range (5-15) and 15 sits within it. Reproducing that needs no table — it is the report's
    // own information, faithfully translated. Gating this on recognition threw away ~28 points
    // of coverage on the US beachhead for no safety gain.
    const { sections } = buildSummary(report, 'en');
    const cer = sections.find((s) => s.nameEn === 'ceruloplasmin')!;
    expect(cer.chipEn).toBe('Within your report’s range'); // reproduced, not invented
    expect(cer.reportRange).toBe('5-15'); // the report's own range — their info, surfaced
    expect(cer.tone).toBe('report'); // neutral gray: colour never editorialises
    // But we know nothing about this analyte, so we add nothing of our own:
    expect(cer.plainEn).toBe(''); // no invented meaning
    expect(cer.typicalRange).toBe(''); // no curated range to offer as context
  });

  it('a report-only row renders its definition but never an owned range or source', () => {
    const report = groundExtraction(
      {
        rows: [
          {
            name: 'Nitrite',
            value: 'Negative',
            unit: null,
            printedRange: 'Negative',
            confidence: 'high',
            specimen: 'urine',
          },
        ],
      },
      'unknown',
    );
    const row = report.rows[0];
    const section = buildSummary(report, 'en').sections[0];

    expect(row.entry?.interpretation).toBe('report-only');
    expect(row.action).toBe('classify');
    expect(section.nameEn).toBe('Urine Nitrite (Dipstick)');
    expect(section.chipEn).toBe('Within your report’s range');
    expect(section.plainEn).toMatch(/urine dipstick test/i);
    expect(section.plainZh).toContain('尿液');
    expect(section.typicalRange).toBe('');
    expect(section.source).toBe('');
    expect(section.flags.map((f) => f.messageEn).join(' ')).not.toMatch(/not in our reference set/i);
  });

  it.each([
    ['Absent', 'Absent', 'Within your report’s range'],
    ['Negative', 'Absent', 'Within your report’s range'],
    ['Positive', 'Absent', 'Outside your report’s range'],
    ['Trace', 'Negative', 'Outside your report’s range'],
  ])('reproduces qualitative result %s against printed reference %s', (value, printedRange, chip) => {
    const report = groundExtraction(
      {
        rows: [
          {
            name: 'Nitrite',
            value,
            unit: null,
            printedRange,
            confidence: 'high',
            specimen: 'urine',
          },
        ],
      },
      'unknown',
    );
    const section = buildSummary(report, 'en').sections[0];

    expect(section.chipEn).toBe(chip);
    expect(section.tone).toBe('report');
  });

  it.each([
    ['0-2', '0-2', 'Within your report’s range'],
    ['0 - 1', '0 - 5', 'Within your report’s range'],
    ['6-8', '0-5', 'Above your report’s range'],
    ['-2~-1', '0-5', 'Below your report’s range'],
    ['4-7', '0-5', 'Ask your clinician to interpret'],
  ])('reproduces range-valued result %s against printed range %s', (value, printedRange, chip) => {
    const report = groundExtraction(
      {
        rows: [
          {
            name: 'Pus Cells',
            value,
            unit: 'hpf',
            printedRange,
            confidence: 'high',
            specimen: 'urine',
          },
        ],
      },
      'unknown',
    );
    const section = buildSummary(report, 'en').sections[0];

    expect(section.chipEn).toBe(chip);
    if (chip === 'Ask your clinician to interpret') {
      expect(section.reportRange).toBe('');
    } else {
      expect(section.reportRange).toBe(printedRange);
      expect(section.tone).toBe('report');
    }
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
