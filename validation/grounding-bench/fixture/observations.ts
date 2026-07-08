import type { LabObservation } from '../types';
// Synthetic observations (canonical SI units our table recognizes) so the scorer
// lands green with no credentialed data.
export const FIXTURE_OBSERVATIONS: LabObservation[] = [
  { analyteName: '空腹血糖', value: '5.5', unit: 'mmol/L', refLow: 3.9, refHigh: 6.1, abnormalFlag: 'normal' },
  { analyteName: '空腹血糖', value: '9.0', unit: 'mmol/L', refLow: 3.9, refHigh: 6.1, abnormalFlag: 'abnormal' },
  { analyteName: '血红蛋白', value: '90', unit: 'g/L', refLow: 130, refHigh: 175, abnormalFlag: 'abnormal' },
];
