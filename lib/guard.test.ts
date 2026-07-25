import { describe, it, expect } from 'vitest';
import { evaluateRow } from './guard';
import { findEntry } from './reference';
import { parseValue, classify } from './classify';
import type { ExtractedRow } from '@/lib/types';
import { resolveText } from '@/lib/i18n';

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

    const message = out.flags.find((f) => f.id === 'R1-UNKNOWN-ANALYTE')!.message;
    expect(resolveText(message, 'en').text).toBe(
      'This test is not in our reference set, so we are not interpreting it — anything shown here comes from your report itself. Confirm this with your clinician.',
    );
    expect(resolveText(message, 'zh').text).toBe(
      '该项目不在我们的参考资料中，因此我们不作解读——此处显示的内容均来自您的报告本身。请与您的医生确认。',
    );
    expect(resolveText(message, 'bo')).toMatchObject({
      text: resolveText(message, 'zh').text,
      resolvedLang: 'zh',
      review: 'unverified',
      usedFallback: true,
    });
  });

  it('R2: known analyte but mismatched unit → abstain', () => {
    const entry = findEntry('fasting_glucose')!;
    const ex = row({ name: '空腹血糖', value: '99', unit: 'mg/dL' });
    const out = evaluateRow(ex, entry, parseValue(ex.value), 'unclassified', 'unknown');
    expect(out.action).toBe('abstain');
    expect(ids(out.flags)).toContain('R2-UNIT-MISMATCH');
  });

  it('R3: a critical high-stakes value reviews internally and confirms only via analyte-level R6', () => {
    const entry = findEntry('potassium')!;
    const ex = row({ name: 'K+', value: '6.9', unit: 'mmol/L' });
    const cls = classify(parseValue(ex.value), entry, 'unknown');
    const out = evaluateRow(ex, entry, parseValue(ex.value), cls, 'unknown');
    expect(out.needsConfirm).toBe(true);
    expect(out.needsReview).toBe(true);
    expect(ids(out.flags)).toContain('R3-CRITICAL-PANIC-RANGE');
    expect(out.flags.some((f) => f.severity === 'urgent')).toBe(true);
  });

  it('R3: criticality alone stays internal and does not select a confirm-list row', () => {
    const entry = findEntry('wbc_count')!;
    const ex = row({ name: 'WBC', value: '1', unit: '10^9/L' });
    const cls = classify(parseValue(ex.value), entry, 'unknown');
    const out = evaluateRow(ex, entry, parseValue(ex.value), cls, 'unknown');
    expect(cls).toBe('critical');
    expect(entry.highStakes).toBe(false);
    expect(out.needsConfirm).toBe(false);
    expect(out.needsReview).toBe(true);
    expect(ids(out.flags)).toContain('R3-CRITICAL-PANIC-RANGE');
    expect(ids(out.flags)).not.toContain('R6-HIGH-STAKES-MANDATORY-CONFIRM');
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

  it('R5: a negative value stays suspicious when the entry does not admit signed values', () => {
    const entry = findEntry('SG')!;
    const ex = row({ name: 'SG', value: '-1.020', unit: 'SG' });
    const valueNum = parseValue(ex.value);
    const out = evaluateRow(ex, entry, valueNum, classify(valueNum, entry, 'unknown'), 'unknown');
    expect(out.needsConfirm).toBe(true);
    expect(ids(out.flags)).toContain('R5-LOW-OCR-CONFIDENCE-NUMERIC');
  });

  it('R5: a negative value is not suspicious when absoluteLow explicitly admits signed values', () => {
    const signedEntry = {
      ...findEntry('chloride')!,
      refLow: -5,
      refHigh: 5,
      criticalLow: null,
      criticalHigh: null,
      absoluteLow: -10,
      absoluteHigh: 10,
      highStakes: false,
    };
    const ex = row({ name: 'signed fixture', value: '-2', unit: signedEntry.unit });
    const valueNum = parseValue(ex.value);
    const classification = classify(valueNum, signedEntry, 'unknown');
    expect(classification).toBe('normal');
    const out = evaluateRow(
      ex,
      signedEntry,
      valueNum,
      classification,
      'unknown',
    );
    expect(out.action).toBe('classify');
    expect(out.needsConfirm).toBe(false);
    expect(ids(out.flags)).not.toContain('R5-LOW-OCR-CONFIDENCE-NUMERIC');
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

describe('R13 — implausible value suppression', () => {
  const k = findEntry('钾')!; // potassium, absolute bounds 1.0–15 mmol/L
  const kRow = (v: string) => row({ name: '钾', value: v, unit: 'mmol/L' });

  it('a decimal-shift misread (K 40) is suppressed: abstain + needsConfirm + R13 flag, no classification', () => {
    const out = evaluateRow(kRow('40'), k, 40, 'critical', 'unknown');
    expect(out.action).toBe('abstain'); // no low/normal/high rendered
    expect(out.needsConfirm).toBe(true); // confirm gate offers correction
    expect(ids(out.flags)).toContain('R13-IMPLAUSIBLE-VALUE');
  });

  it('a real critical-but-plausible value (K 6.8) is NOT suppressed — it classifies', () => {
    const out = evaluateRow(kRow('6.8'), k, 6.8, 'critical', 'unknown');
    expect(out.action).toBe('classify');
    expect(ids(out.flags)).not.toContain('R13-IMPLAUSIBLE-VALUE');
  });

  it('does not fire when the analyte has no bound on the exceeded side', () => {
    const out = evaluateRow(kRow('40'), { ...k, absoluteHigh: null }, 40, 'high', 'unknown');
    expect(out.action).not.toBe('abstain');
  });
});

describe('R11 — flip-gated printed-range disagreement', () => {
  // total_cholesterol is not high-stakes and has no critical band, so the
  // internal review signal here is driven purely by R11.
  const tc = findEntry('总胆固醇')!; // refHigh 5.2 (one-sided, desirable <5.2)

  it('a disagreement that FLIPS the call → internal review + caution, not confirmation', () => {
    // value 5.5 is HIGH under our <5.2 but NORMAL under the report's <6.5 → flips.
    const ex = row({ name: '总胆固醇', value: '5.5', unit: 'mmol/L', printedRange: '<6.5' });
    const out = evaluateRow(ex, tc, parseValue(ex.value), classify(parseValue(ex.value), tc, 'unknown'), 'unknown');
    const r11 = out.flags.find((f) => f.id === 'R11-RANGE-DISAGREEMENT');
    expect(r11?.severity).toBe('caution');
    expect(out.needsConfirm).toBe(false);
    expect(out.needsReview).toBe(true);
  });

  it('a disagreement that does NOT flip the call → info flag, no confirm', () => {
    // value 4.0 is NORMAL under both our <5.2 and the report's <7.0; ranges differ
    // materially (5.2 vs 7.0) but the call is unchanged → informational only.
    const ex = row({ name: '总胆固醇', value: '4.0', unit: 'mmol/L', printedRange: '<7.0' });
    const out = evaluateRow(ex, tc, parseValue(ex.value), classify(parseValue(ex.value), tc, 'unknown'), 'unknown');
    const r11 = out.flags.find((f) => f.id === 'R11-RANGE-DISAGREEMENT');
    expect(r11?.severity).toBe('info');
    expect(out.needsConfirm).toBe(false);
    expect(out.needsReview).toBe(false);
  });
});
