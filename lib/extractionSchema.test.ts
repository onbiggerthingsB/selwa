import { describe, it, expect } from 'vitest';
import { LabExtractionSchema, EXTRACTION_PROMPT } from './extractionSchema';

describe('LabExtractionSchema', () => {
  it('keeps parsing the old row shape when specimen is absent', () => {
    const ok = LabExtractionSchema.safeParse({
      rows: [{ name: 'GLU', value: '5.5', unit: 'mmol/L', printedRange: '3.9-6.1', confidence: 'high' }],
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.rows[0].specimen).toBeUndefined();
  });

  it('allows nulls for absent fields', () => {
    const ok = LabExtractionSchema.safeParse({
      rows: [{ name: 'X', value: null, unit: null, printedRange: null, confidence: 'low' }],
    });
    expect(ok.success).toBe(true);
  });

  it.each(['urine', 'blood', 'unknown'] as const)('accepts the closed specimen value %s', (specimen) => {
    const ok = LabExtractionSchema.safeParse({
      rows: [{ name: 'pH', value: '5', unit: null, printedRange: '5.0-8.0', confidence: 'high', specimen }],
    });
    expect(ok.success).toBe(true);
  });

  it('accepts null specimen for backward compatibility', () => {
    const ok = LabExtractionSchema.safeParse({
      rows: [{ name: 'X', value: '1', unit: null, printedRange: null, confidence: 'low', specimen: null }],
    });
    expect(ok.success).toBe(true);
  });

  it('rejects an unsupported other-fluid specimen instead of forcing it into blood or urine', () => {
    const bad = LabExtractionSchema.safeParse({
      rows: [{ name: 'Glucose', value: '3.2', unit: 'mmol/L', printedRange: null, confidence: 'high', specimen: 'csf' }],
    });
    expect(bad.success).toBe(false);
  });

  it('rejects an invalid confidence enum', () => {
    const bad = LabExtractionSchema.safeParse({
      rows: [{ name: 'X', value: '1', unit: 'mmol/L', printedRange: null, confidence: 'maybe' }],
    });
    expect(bad.success).toBe(false);
  });

  it.each([null, '↑'] as const)(
    'accepts an explicitly copied printed flag value %s',
    (printedFlagRaw) => {
      const ok = LabExtractionSchema.safeParse({
        rows: [
          {
            name: 'X',
            value: '1',
            unit: null,
            printedRange: null,
            printedFlagRaw,
            confidence: 'low',
          },
        ],
      });
      expect(ok.success).toBe(true);
      if (ok.success) expect(ok.data.rows[0].printedFlagRaw).toBe(printedFlagRaw);
    },
  );

  it('keeps specimen capture OCR-only and safely defaults unprinted or other fluids', () => {
    expect(EXTRACTION_PROMPT).toMatch(/do not infer/i);
    expect(EXTRACTION_PROMPT).toMatch(/null/i);
    expect(EXTRACTION_PROMPT).toMatch(/specimen only from a printed section or panel heading/i);
    expect(EXTRACTION_PROMPT).toMatch(/explicit printed per-row specimen qualifier/i);
    expect(EXTRACTION_PROMPT).toMatch(/blood, serum, plasma, or whole-blood/i);
    expect(EXTRACTION_PROMPT).toMatch(/unknown.*other fluid/i);
    expect(EXTRACTION_PROMPT).toMatch(/unknown.*whenever no specimen is printed/i);
    expect(EXTRACTION_PROMPT).toMatch(
      /do not infer specimen from the analyte name, value, or reference range/i,
    );
  });

  it('keeps printed-flag capture copy-only and fail-closed', () => {
    expect(EXTRACTION_PROMPT).toContain(
      'Do NOT classify results as normal/abnormal and do NOT add reference ranges from your own knowledge — only copy the range printed on the page.',
    );
    expect(EXTRACTION_PROMPT).toMatch(/exactly as printed/i);
    expect(EXTRACTION_PROMPT).toMatch(/keep it OUT of the value field/i);
    expect(EXTRACTION_PROMPT).toMatch(/printedFlagRaw MUST be null/i);
    expect(EXTRACTION_PROMPT).toMatch(
      /never .* comparing the value to the reference range/i,
    );
    expect(EXTRACTION_PROMPT).toMatch(/printing artifact, use null/i);
  });
});
