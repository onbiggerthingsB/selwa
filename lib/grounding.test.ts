import { describe, it, expect } from 'vitest';
import { groundExtraction } from './grounding';
import type { LabExtraction } from '@/lib/extractionSchema';
import { resolveText } from '@/lib/i18n';

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
    const ex = { rows: [{ name: 'GLU', value: '99', unit: 'mg/dL', printedRange: null, confidence: 'high' as const, specimen: 'blood' as const }] };
    const { rows } = groundExtraction(ex, 'unknown');
    const glu = rows.find((r) => r.entry?.key === 'fasting_glucose')!;
    expect(glu.classification).toBe('normal');          // 99 mg/dL = 5.49 mmol/L
    expect(glu.valueNum).toBeCloseTo(5.49, 1);
    expect(glu.flags.map((f) => f.id)).toContain('R2b-UNIT-CONVERTED');
    expect(glu.action).toBe('classify');
    const message = glu.flags.find((f) => f.id === 'R2b-UNIT-CONVERTED')!.message;
    expect(resolveText(message, 'en').text).toBe(
      'We converted 99 mg/dL to 5.49 mmol/L to compare with our reference range.',
    );
    expect(resolveText(message, 'zh').text).toBe(
      '我们已将 99 mg/dL 换算为 5.49 mmol/L 以便与参考范围比较。',
    );
    expect(resolveText(message, 'bo')).toMatchObject({
      text: resolveText(message, 'zh').text,
      resolvedLang: 'zh',
      review: 'unverified',
    });
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

  // H1.5 — d-dimer FEU/DDU basis ambiguity. FEU and DDU units differ ~2× (the fuller
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

describe('specimen-scoped grounding', () => {
  it('never hands a known urine RBC row to the blood-count entry or band', () => {
    const row = groundExtraction(
      {
        rows: [
          {
            name: 'RBC',
            value: '0-2',
            unit: null,
            printedRange: '0-2',
            confidence: 'high',
            specimen: 'urine',
          },
        ],
      },
      'unknown',
    ).rows[0];

    expect(row.entry?.key).toBe('urine_rbc_microscopy');
    expect(row.entry?.key).not.toBe('rbc_count');
    expect(row.entry?.interpretation).toBe('report-only');
    expect(row.matchedVia).toBe('specimen-scoped');
    expect(row.action).toBe('classify');
    expect(row.classification).toBe('unclassified');
    expect([row.entry?.refLow, row.entry?.refHigh]).toEqual([null, null]);
    expect(row.flags.map((f) => f.id)).not.toContain('R18-SPECIMEN-MATCH-UNCORROBORATED');
    expect(row.flags.map((f) => f.id)).not.toContain('R1-UNKNOWN-ANALYTE');
    expect(row.flags.map((f) => f.id)).not.toContain('R2-UNIT-MISMATCH');
  });

  it('uses printed urine context to resolve a bare pH row', () => {
    const row = groundExtraction(
      {
        rows: [
          {
            name: 'pH',
            value: '5',
            unit: null,
            printedRange: '5.0-8.0',
            confidence: 'high',
            specimen: 'urine',
          },
        ],
      },
      'unknown',
    ).rows[0];

    expect(row.entry?.key).toBe('urine_ph');
    expect(row.matchedVia).toBe('specimen-scoped');
    expect(row.action).toBe('classify');
    expect(row.classification).toBe('normal');
    expect(row.flags.map((f) => f.id)).not.toContain('R1-UNKNOWN-ANALYTE');
    expect(row.flags.map((f) => f.id)).not.toContain('R18-SPECIMEN-MATCH-UNCORROBORATED');
  });

  it('records scoped provenance when context refines a legacy unscoped alias', () => {
    const row = groundExtraction(
      {
        rows: [
          {
            name: 'Specific Gravity',
            value: '1.015',
            unit: 'SG',
            printedRange: '1.003-1.030',
            confidence: 'high',
            specimen: 'urine',
          },
        ],
      },
      'unknown',
    ).rows[0];

    expect(row.entry?.key).toBe('urine_specific_gravity');
    expect(row.matchedVia).toBe('specimen-scoped');
    expect(row.action).toBe('classify');
    expect(row.flags.map((f) => f.id)).not.toContain('R18-SPECIMEN-MATCH-UNCORROBORATED');
  });

  it('classifies dimensionless specific gravity when the report leaves its unit blank', () => {
    const row = groundExtraction(
      {
        rows: [
          {
            name: 'Specific Gravity',
            value: '1.005',
            unit: null,
            printedRange: '1.005 - 1.025',
            confidence: 'high',
            specimen: 'urine',
          },
        ],
      },
      'unknown',
    ).rows[0];

    expect(row.entry?.key).toBe('urine_specific_gravity');
    expect(row.matchedVia).toBe('specimen-scoped');
    expect(row.action).toBe('classify');
    expect(row.classification).toBe('normal');
    expect(row.flags.map((f) => f.id)).not.toContain('R2-UNIT-MISMATCH');
    expect(row.flags.map((f) => f.id)).not.toContain('R18-SPECIMEN-MATCH-UNCORROBORATED');
  });

  it('abstains when a scoped urine match conflicts with a blood-gas printed range', () => {
    const row = groundExtraction(
      {
        rows: [
          {
            name: 'pH',
            value: '7.1',
            unit: 'pH',
            printedRange: '7.35-7.45',
            confidence: 'high',
            specimen: 'urine',
          },
        ],
      },
      'unknown',
    ).rows[0];

    expect(row.entry?.key).toBe('urine_ph');
    expect(row.matchedVia).toBe('specimen-scoped');
    expect(row.action).toBe('abstain');
    expect(row.classification).toBe('unclassified');
    expect(row.needsConfirm).toBe(false);
    expect(row.flags.map((f) => f.id)).toContain('R18-SPECIMEN-MATCH-UNCORROBORATED');
  });

  it.each([
    ['Glucose', 'urine_glucose'],
    ['Protein', 'urine_protein'],
    ['Ketones', 'urine_ketones'],
  ])('treats a printed qualitative reference as corroboration for %s', (name, key) => {
    const row = groundExtraction(
      {
        rows: [
          {
            name,
            value: 'Absent',
            unit: null,
            printedRange: 'Absent',
            confidence: 'high',
            specimen: 'urine',
          },
        ],
      },
      'unknown',
    ).rows[0];

    expect(row.entry?.key).toBe(key);
    expect(row.matchedVia).toBe('specimen-scoped');
    expect(row.action).toBe('classify');
    expect(row.classification).toBe('unclassified');
    expect(row.flags.map((f) => f.id)).not.toContain('R18-SPECIMEN-MATCH-UNCORROBORATED');
    expect(row.flags.map((f) => f.id)).not.toContain('R2-UNIT-MISMATCH');
    expect(row.flags.map((f) => f.id)).not.toContain('R5-LOW-OCR-CONFIDENCE-NUMERIC');
  });

  it.each(['Absent', 'Negative', 'Not Detected', 'Nil', '-', '阴性', '未检出'])(
    'recognises the printed qualitative reference token %s as evidence',
    (printedRange) => {
      const row = groundExtraction(
        {
          rows: [
            {
              name: 'Glucose',
              value: 'Absent',
              unit: null,
              printedRange,
              confidence: 'high',
              specimen: 'urine',
            },
          ],
        },
        'unknown',
      ).rows[0];

      expect(row.flags.map((f) => f.id)).not.toContain('R18-SPECIMEN-MATCH-UNCORROBORATED');
    },
  );

  it('does not treat a positive result token as a corroborating reference token', () => {
    const row = groundExtraction(
      {
        rows: [
          {
            name: 'Glucose',
            value: 'Positive',
            unit: null,
            printedRange: 'Positive',
            confidence: 'high',
            specimen: 'urine',
          },
        ],
      },
      'unknown',
    ).rows[0];

    expect(row.flags.map((f) => f.id)).toContain('R18-SPECIMEN-MATCH-UNCORROBORATED');
  });

  it('accepts an explicitly printed matching unit as scoped-match evidence', () => {
    const row = groundExtraction(
      {
        rows: [
          {
            name: 'pH',
            value: '5',
            unit: 'pH',
            printedRange: null,
            confidence: 'high',
            specimen: 'urine',
          },
        ],
      },
      'unknown',
    ).rows[0];

    expect(row.entry?.key).toBe('urine_ph');
    expect(row.action).toBe('classify');
    expect(row.flags.map((f) => f.id)).not.toContain('R18-SPECIMEN-MATCH-UNCORROBORATED');
  });

  // THE HOLE THE FIRST R18 LEFT OPEN. The original condition required `printed !== null`,
  // so a scoped match with NO printed range skipped the corroboration check entirely —
  // treating "no evidence" as "no problem". Measured before the fix: a mislabelled blood gas
  // (pH 7.1, no range, no unit, specimen 'urine') resolved to urine_ph and classified as
  // NORMAL against the urine band, with needsConfirm false, zero flags, and "Typical range
  // 5-8 pH" shown beside a life-threatening acidosis. The scoped name is the ONLY evidence of
  // specimen here, and R16/R17 cannot fire without a printed range, so nothing else caught it.
  it('abstains on a scoped match with NO printed range — absence of evidence is not corroboration', () => {
    const row = groundExtraction(
      {
        rows: [
          {
            name: 'pH',
            value: '7.1',
            unit: null,
            printedRange: null,
            confidence: 'high',
            specimen: 'urine',
          },
        ],
      },
      'unknown',
    ).rows[0];

    expect(row.entry?.key).toBe('urine_ph');
    expect(row.matchedVia).toBe('specimen-scoped');
    expect(row.action, 'an uncorroborated scoped match must not classify').toBe('abstain');
    expect(row.classification).toBe('unclassified');
    expect(row.flags.map((f) => f.id)).toContain('R18-SPECIMEN-MATCH-UNCORROBORATED');
  });

  it('keeps a bare pH row unknown when no printed specimen is available', () => {
    const row = groundExtraction(
      {
        rows: [
          {
            name: 'pH',
            value: '5',
            unit: 'pH',
            printedRange: '5.0-8.0',
            confidence: 'high',
            specimen: null,
          },
        ],
      },
      'unknown',
    ).rows[0];

    expect(row.entry).toBeNull();
    expect(row.matchedVia).toBe('unmatched');
    expect(row.action).toBe('abstain');
    expect(row.flags.map((f) => f.id)).toContain('R1-UNKNOWN-ANALYTE');
  });
});

describe('report-only urinalysis grounding', () => {
  it.each([
    ['Nitrite', 'Negative', null, 'Negative', 'urine_nitrite'],
    ['Bilirubin', 'Absent', null, 'Absent', 'urine_bilirubin'],
    ['Urobilinogen', 'Absent', null, 'Absent', 'urine_urobilinogen'],
    ['RBC', '0-2', 'hpf', '0-2', 'urine_rbc_microscopy'],
    ['Pus Cells', '0-1', 'hpf', '0 - 5', 'urine_wbc_microscopy'],
  ])('handles %s without an owned clinical band', (name, value, unit, printedRange, key) => {
    const row = groundExtraction(
      {
        rows: [
          {
            name,
            value,
            unit,
            printedRange,
            confidence: 'high',
            specimen: 'urine',
          },
        ],
      },
      'unknown',
    ).rows[0];

    expect(row.entry?.key).toBe(key);
    expect(row.entry?.interpretation).toBe('report-only');
    expect(row.action).toBe('classify');
    expect(row.classification).toBe('unclassified');
    expect(row.flags.map((f) => f.id)).not.toContain('R1-UNKNOWN-ANALYTE');
    expect(row.flags.map((f) => f.id)).not.toContain('R2-UNIT-MISMATCH');
    expect(row.flags.map((f) => f.id)).not.toContain('R18-SPECIMEN-MATCH-UNCORROBORATED');
  });

  it('keeps a generic other-fluid name unknown instead of assigning a urine identity', () => {
    const row = groundExtraction(
      {
        rows: [
          {
            name: 'Crystals',
            value: 'Present',
            unit: null,
            printedRange: 'Absent',
            confidence: 'high',
            specimen: 'unknown',
          },
        ],
      },
      'unknown',
    ).rows[0];

    expect(row.entry).toBeNull();
    expect(row.matchedVia).toBe('unmatched');
    expect(row.action).toBe('abstain');
    expect(row.classification).toBe('unclassified');
    expect(row.flags.map((f) => f.id)).toContain('R1-UNKNOWN-ANALYTE');
  });

  it('keeps low-confidence report-only OCR in the confirmation flow', () => {
    const row = groundExtraction(
      {
        rows: [
          {
            name: 'Nitrite',
            value: 'Positive',
            unit: null,
            printedRange: 'Negative',
            confidence: 'low',
            specimen: 'urine',
          },
        ],
      },
      'unknown',
    ).rows[0];

    expect(row.entry?.key).toBe('urine_nitrite');
    expect(row.action).toBe('classify');
    expect(row.classification).toBe('unclassified');
    expect(row.needsConfirm).toBe(true);
    expect(row.flags.map((f) => f.id)).toContain('R5-LOW-OCR-CONFIDENCE-NUMERIC');
  });

  it('rejects an explicit unit contradiction on a scoped report-only identity', () => {
    const row = groundExtraction(
      {
        rows: [
          {
            name: 'RBC',
            value: '4.5',
            unit: '10^12/L',
            printedRange: '4.3-5.8',
            confidence: 'high',
            specimen: 'urine',
          },
        ],
      },
      'unknown',
    ).rows[0];

    expect(row.entry?.key).toBe('urine_rbc_microscopy');
    expect(row.action).toBe('abstain');
    expect(row.classification).toBe('unclassified');
    expect(row.flags.map((f) => f.id)).toContain('R18-SPECIMEN-MATCH-UNCORROBORATED');
  });

  it('does not treat an intentionally uncurated report-only unit as a contradiction', () => {
    const row = groundExtraction(
      {
        rows: [
          {
            name: 'Urobilinogen',
            value: '0.2',
            unit: 'mg/dL',
            printedRange: '0.0-1.0',
            confidence: 'high',
            specimen: 'urine',
          },
        ],
      },
      'unknown',
    ).rows[0];

    expect(row.entry?.key).toBe('urine_urobilinogen');
    expect(row.entry?.unit).toBe('as reported');
    expect(row.action).toBe('classify');
    expect(row.classification).toBe('unclassified');
    expect(row.flags.map((f) => f.id)).not.toContain('R18-SPECIMEN-MATCH-UNCORROBORATED');
  });
});
