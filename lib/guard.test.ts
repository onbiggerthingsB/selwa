import { describe, it, expect } from 'vitest';
import { evaluateRow } from './guard';
import { findEntry } from './reference';
import { parseValue, classify } from './classify';
import type { ExtractedRow } from '@/lib/types';

function row(p: Partial<ExtractedRow>): ExtractedRow {
  return { name: '', value: null, unit: null, printedRange: null, confidence: 'high', ...p };
}
function ids(flags: { id: string }[]) {
  return flags.map((f) => f.id);
}

describe('evaluateRow', () => {
  it('R1: unknown analyte → abstain, no classification', () => {
    const ex = row({ name: 'ceruloplasmin', value: '15', unit: 'umol/L' });
    const out = evaluateRow(ex, null, null, 'unclassified', 'unknown');
    expect(out.action).toBe('abstain');
    expect(ids(out.flags)).toContain('R1-UNKNOWN-ANALYTE');
  });

  it('R2: known analyte but mismatched unit → abstain', () => {
    const entry = findEntry('fasting_glucose')!;
    const ex = row({ name: '空腹血糖', value: '99', unit: 'mg/dL' });
    const out = evaluateRow(ex, entry, parseValue(ex.value), 'unclassified', 'unknown');
    expect(out.action).toBe('abstain');
    expect(ids(out.flags)).toContain('R2-UNIT-MISMATCH');
  });

  it('R3: critical value → confirm + urgent flag', () => {
    const entry = findEntry('potassium')!;
    const ex = row({ name: 'K+', value: '6.9', unit: 'mmol/L' });
    const cls = classify(parseValue(ex.value), entry, 'unknown');
    const out = evaluateRow(ex, entry, parseValue(ex.value), cls, 'unknown');
    expect(out.needsConfirm).toBe(true);
    expect(ids(out.flags)).toContain('R3-CRITICAL-PANIC-RANGE');
    expect(out.flags.some((f) => f.severity === 'urgent')).toBe(true);
  });

  it('R4: high-stakes mild abnormal → classify but flag clinician', () => {
    const entry = findEntry('ldl_cholesterol')!;
    const ex = row({ name: 'LDL-C', value: '3.8', unit: 'mmol/L' });
    const cls = classify(parseValue(ex.value), entry, 'unknown'); // high
    const out = evaluateRow(ex, entry, parseValue(ex.value), cls, 'unknown');
    expect(out.action).toBe('classify');
    expect(ids(out.flags)).toContain('R4-HIGH-STAKES-ANY-ABNORMAL');
  });

  it('R4: high-stakes NORMAL → no R4 flag', () => {
    const entry = findEntry('fasting_glucose')!;
    const ex = row({ name: 'GLU', value: '5.0', unit: 'mmol/L' });
    const cls = classify(parseValue(ex.value), entry, 'unknown'); // normal
    const out = evaluateRow(ex, entry, parseValue(ex.value), cls, 'unknown');
    expect(ids(out.flags)).not.toContain('R4-HIGH-STAKES-ANY-ABNORMAL');
  });

  it('R5: low OCR confidence on a numeric → confirm', () => {
    const entry = findEntry('total_cholesterol')!;
    const ex = row({ name: 'TC', value: '5.0', unit: 'mmol/L', confidence: 'low' });
    const cls = classify(parseValue(ex.value), entry, 'unknown');
    const out = evaluateRow(ex, entry, parseValue(ex.value), cls, 'unknown');
    expect(out.needsConfirm).toBe(true);
    expect(ids(out.flags)).toContain('R5-LOW-OCR-CONFIDENCE-NUMERIC');
  });

  it('R5: unparseable value (comparator) → confirm', () => {
    const entry = findEntry('tsh')!;
    const ex = row({ name: 'TSH', value: '<0.01', unit: 'mIU/L' });
    const out = evaluateRow(ex, entry, parseValue(ex.value), 'unclassified', 'unknown');
    expect(out.needsConfirm).toBe(true);
    expect(ids(out.flags)).toContain('R5-LOW-OCR-CONFIDENCE-NUMERIC');
  });

  it('R6: high-stakes analyte ALWAYS needs confirm even at high confidence + normal', () => {
    const entry = findEntry('potassium')!;
    const ex = row({ name: 'K', value: '4.0', unit: 'mmol/L', confidence: 'high' });
    const cls = classify(parseValue(ex.value), entry, 'unknown'); // normal
    const out = evaluateRow(ex, entry, parseValue(ex.value), cls, 'unknown');
    expect(out.needsConfirm).toBe(true);
    expect(ids(out.flags)).toContain('R6-HIGH-STAKES-MANDATORY-CONFIRM');
  });

  it('R11: report-printed range materially disagrees with ours → flag', () => {
    const entry = findEntry('fasting_glucose')!; // ours: 3.9-6.1
    const ex = row({ name: 'GLU', value: '5.0', unit: 'mmol/L', printedRange: '4.5-7.0' });
    const cls = classify(parseValue(ex.value), entry, 'unknown');
    const out = evaluateRow(ex, entry, parseValue(ex.value), cls, 'unknown');
    expect(ids(out.flags)).toContain('R11-RANGE-DISAGREEMENT');
  });

  it('R11: a near-identical printed range does NOT flag (avoids noise)', () => {
    const entry = findEntry('fasting_glucose')!;
    const ex = row({ name: 'GLU', value: '5.0', unit: 'mmol/L', printedRange: '4.1-5.9' });
    const cls = classify(parseValue(ex.value), entry, 'unknown');
    const out = evaluateRow(ex, entry, parseValue(ex.value), cls, 'unknown');
    expect(ids(out.flags)).not.toContain('R11-RANGE-DISAGREEMENT');
  });

  it('R12: population-sensitive analyte with unknown sex → flag', () => {
    const entry = findEntry('hemoglobin')!;
    const ex = row({ name: 'HGB', value: '140', unit: 'g/L' });
    const cls = classify(parseValue(ex.value), entry, 'unknown');
    const out = evaluateRow(ex, entry, parseValue(ex.value), cls, 'unknown');
    expect(ids(out.flags)).toContain('R12-POPULATION-SENSITIVE');
  });

  it('a normal, low-stakes, sex-neutral row classifies with no flags and no confirm', () => {
    const entry = findEntry('chloride')!;
    const ex = row({ name: 'Cl', value: '100', unit: 'mmol/L' });
    const cls = classify(parseValue(ex.value), entry, 'unknown');
    const out = evaluateRow(ex, entry, parseValue(ex.value), cls, 'unknown');
    expect(out.action).toBe('classify');
    expect(out.needsConfirm).toBe(false);
    expect(out.flags).toHaveLength(0);
  });
});
