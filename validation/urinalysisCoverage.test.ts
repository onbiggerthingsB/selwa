import { describe, expect, it } from 'vitest';
import { groundExtraction } from '@/lib/grounding';
import { buildSummary } from '@/lib/summary';
import { resolveText } from '@/lib/i18n';
import type { LabExtraction } from '@/lib/extractionSchema';

// The spec preserves the exact cells below for the acceptance-critical rows.
// The final six microscopy values/ranges were not retained, so they remain null:
// this fixture measures name/definition coverage without fabricating report data.
const ASTER_URINALYSIS: LabExtraction = {
  rows: [
    { name: 'Color', value: 'Pale Yellow', unit: null, printedRange: null, confidence: 'high', specimen: 'urine' },
    { name: 'Appearance', value: 'Clear', unit: null, printedRange: null, confidence: 'high', specimen: 'urine' },
    { name: 'pH', value: '5', unit: null, printedRange: '5 - 7.5', confidence: 'high', specimen: 'urine' },
    { name: 'Specific Gravity', value: '1.005', unit: null, printedRange: '1.005 - 1.025', confidence: 'high', specimen: 'urine' },
    { name: 'Glucose', value: 'Absent', unit: null, printedRange: 'Absent', confidence: 'high', specimen: 'urine' },
    { name: 'Protein', value: 'Absent', unit: null, printedRange: 'Absent', confidence: 'high', specimen: 'urine' },
    { name: 'Ketones', value: 'Absent', unit: null, printedRange: 'Absent', confidence: 'high', specimen: 'urine' },
    { name: 'Bilirubin', value: 'Absent', unit: null, printedRange: 'Absent', confidence: 'high', specimen: 'urine' },
    { name: 'Urobilinogen', value: 'Absent', unit: null, printedRange: 'Absent', confidence: 'high', specimen: 'urine' },
    { name: 'Nitrite', value: 'Negative', unit: null, printedRange: 'Negative', confidence: 'high', specimen: 'urine' },
    { name: 'RBC', value: '0-2', unit: 'hpf', printedRange: '0-2', confidence: 'high', specimen: 'urine' },
    { name: 'Pus Cells', value: '0-1', unit: 'hpf', printedRange: '0 - 5', confidence: 'high', specimen: 'urine' },
    { name: 'Epithelial Cells', value: '0 - 1', unit: null, printedRange: null, confidence: 'high', specimen: 'urine' },
    { name: 'Casts', value: null, unit: null, printedRange: null, confidence: 'high', specimen: 'urine' },
    { name: 'Crystals', value: null, unit: null, printedRange: null, confidence: 'high', specimen: 'urine' },
    { name: 'Bacteria', value: null, unit: null, printedRange: null, confidence: 'high', specimen: 'urine' },
    { name: 'Yeast Cells', value: null, unit: null, printedRange: null, confidence: 'high', specimen: 'urine' },
    { name: 'Mucus Thread', value: null, unit: null, printedRange: null, confidence: 'high', specimen: 'urine' },
    { name: 'Amorphous Deposits', value: null, unit: null, printedRange: null, confidence: 'high', specimen: 'urine' },
  ],
};

function byName(report: ReturnType<typeof groundExtraction>, name: string) {
  return report.rows.find((row) => row.extracted.name === name)!;
}

describe('19-row Aster urinalysis acceptance fixture', () => {
  const report = groundExtraction(ASTER_URINALYSIS, 'unknown');
  const sections = buildSummary(report, 'en').sections;

  it('reduces “not in our reference set” from the documented 18/19 baseline to at most four', () => {
    expect(report.rows).toHaveLength(19);
    const unknown = report.rows.filter((row) =>
      row.flags.some((flag) => flag.id === 'R1-UNKNOWN-ANALYTE'),
    );
    expect(unknown.map((row) => row.extracted.name)).toEqual([]);
    expect(unknown.length).toBeLessThanOrEqual(4);
  });

  it('keeps pH and blank-unit specific gravity on their curated urine entries', () => {
    for (const name of ['pH', 'Specific Gravity']) {
      const row = byName(report, name);
      expect(row.action, name).toBe('classify');
      expect(row.flags.map((flag) => flag.id), name).not.toContain('R2-UNIT-MISMATCH');
      expect(row.flags.map((flag) => flag.id), name).not.toContain(
        'R18-SPECIMEN-MATCH-UNCORROBORATED',
      );
    }
  });

  it('uses qualitative printed references to corroborate existing dipstick aliases', () => {
    for (const name of ['Glucose', 'Protein', 'Ketones']) {
      const row = byName(report, name);
      const section = sections.find((item) => item.key === row.entry?.key)!;
      expect(row.action, name).toBe('classify');
      expect(row.flags.map((flag) => flag.id), name).not.toContain(
        'R18-SPECIMEN-MATCH-UNCORROBORATED',
      );
      expect(row.flags.map((flag) => flag.id), name).not.toContain('R2-UNIT-MISMATCH');
      expect(row.flags.map((flag) => flag.id), name).not.toContain(
        'R5-LOW-OCR-CONFIDENCE-NUMERIC',
      );
      expect(resolveText(section.plain, 'en').text.length, name).toBeGreaterThan(0);
      expect(resolveText(section.plain, 'zh').text.length, name).toBeGreaterThan(0);
    }
  });

  it('handles new report-only dipstick rows without R1 or an invented typical range', () => {
    for (const name of ['Nitrite', 'Bilirubin', 'Urobilinogen']) {
      const row = byName(report, name);
      const section = sections.find((item) => item.key === row.entry?.key)!;
      expect(row.entry?.interpretation, name).toBe('report-only');
      expect(row.action, name).toBe('classify');
      expect(resolveText(section.chip, 'en').text, name).toBe('Within your report’s range');
      expect(section.typicalRange, name).toBe('');
      expect(section.source, name).toBe('');
    }
  });

  it('keeps RBC/Pus Cells in urine microscopy and reproduces only the printed comparison', () => {
    for (const name of ['RBC', 'Pus Cells']) {
      const row = byName(report, name);
      const section = sections.find((item) => item.key === row.entry?.key)!;
      expect(row.entry?.specimen, name).toBe('urine');
      expect(row.entry?.interpretation, name).toBe('report-only');
      expect(row.entry?.key, name).not.toMatch(/^(rbc|wbc)_count$/);
      expect(row.action, name).toBe('classify');
      expect(resolveText(section.chip, 'en').text, name).toBe('Within your report’s range');
      expect(section.typicalRange, name).toBe('');
      expect(section.source, name).toBe('');
    }
  });
});
