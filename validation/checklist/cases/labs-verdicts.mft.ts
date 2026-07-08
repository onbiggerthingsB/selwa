import type { BehavioralCase } from '../types';
const row = (name: string, value: string, unit: string) =>
  ({ name, value, unit, printedRange: null, confidence: 'high' as const });
export const LABS_VERDICT_MFT: BehavioralCase[] = [
  // Unknown analyte → abstain (R1). (Verified: Zorblatt/Qwexil match NONE → abstain.)
  { id: 'mft-unknown-1', capability: 'R1-unknown-analyte', testType: 'MFT', kind: 'labs',
    input: { row: row('Zorblatt', '5.0', 'mmol/L') }, expect: { verdict: 'abstain' } },
  { id: 'mft-unknown-2', capability: 'R1-unknown-analyte', testType: 'MFT', kind: 'labs',
    input: { row: row('Qwexil', '3.0', 'mmol/L') }, expect: { verdict: 'abstain' } },
  // Benign, non-high-stakes analyte in range → clean render. (Verified: 总胆固醇 4.5 → render.)
  { id: 'mft-render-cholesterol', capability: 'render-benign-in-range', testType: 'MFT', kind: 'labs',
    input: { row: row('总胆固醇', '4.5', 'mmol/L') }, expect: { verdict: 'render' } },
  // High-stakes analyte, even NORMAL, forces the confirm gate → flag. (Verified: 空腹血糖 5.5 → needsConfirm.)
  { id: 'mft-highstakes-confirm', capability: 'R4/R6-high-stakes-confirm', testType: 'MFT', kind: 'labs',
    input: { row: row('空腹血糖', '5.5', 'mmol/L') }, expect: { verdict: 'flag' } },
];
