import { describe, expect, it } from 'vitest';
import { REFERENCE_LABS } from '@/data/reference-labs';
import { UNIT_CONVERSIONS } from '@/data/unit-conversions';
import { groundExtraction } from '@/lib/grounding';
import { resolveBounds } from '@/lib/reference';
import { buildSummary } from '@/lib/summary';
import type { GroundedReport, ReferenceEntry } from '@/lib/types';

const NUMBER = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[+-]?\\d+)?';
const RANGE_PARTS = new RegExp(
  `^(?:(${NUMBER})–(${NUMBER})|<\\s*(${NUMBER})|≥\\s*(${NUMBER}))(?:\\s+(.*))?$`,
  'i',
);

function representativeValue(entry: ReferenceEntry): string {
  const { low, high } = resolveBounds(entry, 'unknown');
  if (low !== null && high !== null) {
    return String(Number(((low + high) / 2).toPrecision(12)));
  }
  if (low !== null) return String(low);
  if (high !== null) return String(high);
  throw new Error(`Curated entry ${entry.key} has no reference bound`);
}

function parseTypicalRange(range: string): {
  low: number | null;
  high: number | null;
  unit: string;
} {
  const match = RANGE_PARTS.exec(range);
  if (!match) throw new Error(`Could not parse typical range: ${range}`);
  return {
    low: match[1] !== undefined
      ? Number(match[1])
      : match[4] !== undefined
        ? Number(match[4])
        : null,
    high: match[2] !== undefined
      ? Number(match[2])
      : match[3] !== undefined
        ? Number(match[3])
        : null,
    unit: match[5] ?? '',
  };
}

describe('summary value/reference-band unit frame', () => {
  it('uses the valueText unit for every rendered curated band and every allowed unit', () => {
    const violations: string[] = [];

    for (const entry of REFERENCE_LABS.filter((candidate) => candidate.interpretation === 'ours')) {
      for (const allowedUnit of entry.allowedUnits) {
        const value = representativeValue(entry);
        const report = groundExtraction(
          {
            rows: [
              {
                name: entry.key,
                value,
                unit: allowedUnit || null,
                printedRange: null,
                confidence: 'high',
                specimen: entry.specimen,
              },
            ],
          },
          'unknown',
        );
        const row = report.rows[0];
        const section = buildSummary(report, 'en').sections[0];

        if (row.action !== 'classify') {
          violations.push(`${entry.key} [${allowedUnit || '(no unit)'}]: unexpectedly abstained`);
          continue;
        }

        const expectedValueText = allowedUnit ? `${value} ${allowedUnit}` : value;
        if (section.valueText !== expectedValueText) {
          violations.push(
            `${entry.key} [${allowedUnit || '(no unit)'}]: valueText=${JSON.stringify(section.valueText)}`,
          );
          continue;
        }

        if (section.typicalRange === '') {
          violations.push(`${entry.key} [${allowedUnit || '(no unit)'}]: band was suppressed`);
          continue;
        }

        const range = parseTypicalRange(section.typicalRange);
        if (range.unit !== allowedUnit) {
          violations.push(
            `${entry.key} [${allowedUnit || '(no unit)'}]: `
            + `valueText=${JSON.stringify(section.valueText)}, `
            + `typicalRange=${JSON.stringify(section.typicalRange)}`,
          );
        }
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('renders Hematocrit 23 % against the converted 35–51 % band, never L/L', () => {
    const report = groundExtraction(
      {
        rows: [
          {
            name: 'Hematocrit',
            value: '23',
            unit: '%',
            printedRange: null,
            confidence: 'high',
            specimen: 'blood',
          },
        ],
      },
      'unknown',
    );
    const section = buildSummary(report, 'en').sections[0];

    expect(section.valueText).toBe('23 %');
    expect(section.typicalRange).toBe('35–51 %');
    expect(section.typicalRange).not.toContain('L/L');
    expect(section.source).not.toBe('');
  });

  it('uses the report unit for every curated reverse-conversion rule', () => {
    const violations: string[] = [];

    for (const conversion of UNIT_CONVERSIONS) {
      const entry = REFERENCE_LABS.find(
        (candidate) => candidate.key === conversion.analyteKey,
      )!;
      const canonicalValue = Number(representativeValue(entry));
      const displayedValue = String(
        Number((canonicalValue * conversion.factorSIToConv).toPrecision(12)),
      );
      const report = groundExtraction(
        {
          rows: [
            {
              name: entry.key,
              value: displayedValue,
              unit: conversion.conventionalUnit,
              printedRange: null,
              confidence: 'high',
              specimen: entry.specimen,
            },
          ],
        },
        'unknown',
      );
      const row = report.rows[0];
      const section = buildSummary(report, 'en').sections[0];

      if (row.action !== 'classify' || section.typicalRange === '') {
        violations.push(
          `${entry.key} [${conversion.conventionalUnit}]: band was not rendered`,
        );
        continue;
      }

      const range = parseTypicalRange(section.typicalRange);
      if (range.unit !== conversion.conventionalUnit) {
        violations.push(
          `${entry.key} [${conversion.conventionalUnit}]: `
          + `valueText=${JSON.stringify(section.valueText)}, `
          + `typicalRange=${JSON.stringify(section.typicalRange)}`,
        );
      }

      const canonicalBounds = resolveBounds(entry, 'unknown');
      const exactLow =
        canonicalBounds.low === null
          ? null
          : canonicalBounds.low * conversion.factorSIToConv;
      const exactHigh =
        canonicalBounds.high === null
          ? null
          : canonicalBounds.high * conversion.factorSIToConv;
      if (range.low !== null && exactLow !== null && range.low < exactLow) {
        violations.push(
          `${entry.key} [${conversion.conventionalUnit}]: lower bound widened `
          + `${exactLow} to ${range.low}`,
        );
      }
      if (range.high !== null && exactHigh !== null && range.high > exactHigh) {
        violations.push(
          `${entry.key} [${conversion.conventionalUnit}]: upper bound widened `
          + `${exactHigh} to ${range.high}`,
        );
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('keeps the live one-sided HDL band in the 84 mg/dL value frame', () => {
    const report = groundExtraction(
      {
        rows: [
          {
            name: 'Cholesterol, HDL',
            value: '84',
            unit: 'mg/dL',
            printedRange: null,
            confidence: 'high',
            specimen: 'blood',
          },
        ],
      },
      'unknown',
    );
    const section = buildSummary(report, 'en').sections[0];

    expect(section.valueText).toBe('84 mg/dL');
    expect(section.typicalRange).toBe('≥ 38.67 mg/dL');
    expect(section.source).not.toBe('');
  });

  it('keeps an optional missing unit absent from both value and band', () => {
    const report = groundExtraction(
      {
        rows: [
          {
            name: 'Urine pH',
            value: '6',
            unit: null,
            printedRange: null,
            confidence: 'high',
            specimen: 'urine',
          },
        ],
      },
      'unknown',
    );
    const section = buildSummary(report, 'en').sections[0];

    expect(section.valueText).toBe('6');
    expect(section.typicalRange).toBe('5–8');
    expect(parseTypicalRange(section.typicalRange).unit).toBe('');
  });

  it('rounds converted lower bounds up and upper bounds down to four significant digits', () => {
    const report = groundExtraction(
      {
        rows: [
          {
            name: 'fasting_glucose',
            value: '100',
            unit: 'mg/dL',
            printedRange: null,
            confidence: 'high',
            specimen: 'blood',
          },
        ],
      },
      'unknown',
    );
    const section = buildSummary(report, 'en').sections[0];

    // Exact conversions are 70.27098 and 109.91102 mg/dL. Inward rounding
    // cannot make the displayed interval wider than the curated interval.
    expect(section.typicalRange).toBe('70.28–109.9 mg/dL');
    expect(70.28).toBeGreaterThanOrEqual(3.9 * 18.0182);
    expect(109.9).toBeLessThanOrEqual(6.1 * 18.0182);
  });

  it('suppresses the band and source when no curated reverse conversion exists', () => {
    const entry = REFERENCE_LABS.find((candidate) => candidate.key === 'urea')!;
    const report: GroundedReport = {
      sex: 'unknown',
      generatedAt: 0,
      rows: [
        {
          extracted: {
            name: 'Urea',
            value: '14',
            unit: 'mg/dL',
            printedRange: null,
            confidence: 'high',
            specimen: 'blood',
          },
          entry,
          matchedVia: 'exact',
          valueNum: 5,
          classification: 'normal',
          action: 'classify',
          needsConfirm: false,
          needsReview: false,
          flags: [],
        },
      ],
    };
    const section = buildSummary(report, 'en').sections[0];

    // Urea/BUN mg/dL is deliberately absent from the conversion table because
    // the quantities are not interchangeable. A legacy/defensive handled row
    // must therefore show neither a mismatched mmol/L band nor its provenance.
    expect(section.valueText).toBe('14 mg/dL');
    expect(section.typicalRange).toBe('');
    expect(section.source).toBe('');
  });
});
