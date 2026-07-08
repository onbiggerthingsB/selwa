import type { BehavioralCase } from '../types';
export const UNIT_MISMATCH_DIR: BehavioralCase[] = [
  // 尿素 (urea) has NO curated mg/dL factor → convertValue() returns null → abstain. (Verified.)
  { id: 'dir-unit-urea-mgdl', capability: 'R2-unit-mismatch', testType: 'DIR', kind: 'labs',
    input: { row: { name: '尿素', value: '14', unit: 'mg/dL', printedRange: null, confidence: 'high' } },
    expect: { verdict: 'abstain' } },
  // 空腹血糖 IS in the table, but g/L is a non-allowed, non-convertible unit → abstain. (Verified.)
  { id: 'dir-unit-glucose-gl', capability: 'R2-unit-mismatch', testType: 'DIR', kind: 'labs',
    input: { row: { name: '空腹血糖', value: '5.5', unit: 'g/L', printedRange: null, confidence: 'high' } },
    expect: { verdict: 'abstain' } },
];
