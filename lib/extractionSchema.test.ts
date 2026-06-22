import { describe, it, expect } from 'vitest';
import { LabExtractionSchema, EXTRACTION_PROMPT } from './extractionSchema';

describe('LabExtractionSchema', () => {
  it('parses a well-formed extraction', () => {
    const ok = LabExtractionSchema.safeParse({
      rows: [{ name: 'GLU', value: '5.5', unit: 'mmol/L', printedRange: '3.9-6.1', confidence: 'high' }],
    });
    expect(ok.success).toBe(true);
  });
  it('allows nulls for absent fields', () => {
    const ok = LabExtractionSchema.safeParse({
      rows: [{ name: 'X', value: null, unit: null, printedRange: null, confidence: 'low' }],
    });
    expect(ok.success).toBe(true);
  });
  it('rejects an invalid confidence enum', () => {
    const bad = LabExtractionSchema.safeParse({
      rows: [{ name: 'X', value: '1', unit: 'mmol/L', printedRange: null, confidence: 'maybe' }],
    });
    expect(bad.success).toBe(false);
  });
  it('exposes an extract-only prompt that forbids inference', () => {
    expect(EXTRACTION_PROMPT).toMatch(/do not infer/i);
    expect(EXTRACTION_PROMPT).toMatch(/null/i);
  });
});
