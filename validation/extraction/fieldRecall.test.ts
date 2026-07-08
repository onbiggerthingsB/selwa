import { describe, it, expect } from 'vitest';
import { fieldRecall } from './fieldRecall';
import type { ExtractionSample, ExtractedField } from './types';

const gold: ExtractionSample['gold'] = [
  { name: '空腹血糖', value: '5.5', unit: 'mmol/L', referenceRange: '3.9-6.1', abnormalFlag: '' },
  { name: '血红蛋白', value: '140', unit: 'g/L', referenceRange: '130-175', abnormalFlag: '' },
];

describe('fieldRecall', () => {
  it('scores 1.0 when the prediction matches every field', () => {
    const pred: ExtractedField[] = gold.map((g) => ({ ...g }));
    const r = fieldRecall(pred, gold);
    expect(r.overall).toBeCloseTo(1, 6);
    expect(r.perField.value).toBeCloseTo(1, 6);
  });

  it('penalizes a misread value and a dropped row', () => {
    const pred: ExtractedField[] = [{ name: '空腹血糖', value: '55', unit: 'mmol/L', referenceRange: '3.9-6.1', abnormalFlag: '' }];
    const r = fieldRecall(pred, gold);
    // Row 2 fully missed; row 1 value wrong. Per-field value recall = 0/2.
    expect(r.perField.value).toBeCloseTo(0, 6);
    expect(r.perField.name).toBeCloseTo(1 / 2, 6); // only 空腹血糖 matched by name
    expect(r.overall).toBeLessThan(1);
  });
});
