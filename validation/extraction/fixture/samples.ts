import type { ExtractionSample } from '../types';
// Synthetic samples so the scorer lands green with NO dataset and NO API key.
export const FIXTURE_SAMPLES: ExtractionSample[] = [
  { id: 'fx-1', imagePath: 'fixture://1', gold: [
    { name: '空腹血糖', value: '5.5', unit: 'mmol/L', referenceRange: '3.9-6.1', abnormalFlag: '' },
    { name: '血红蛋白', value: '140', unit: 'g/L', referenceRange: '130-175', abnormalFlag: '' },
  ] },
  { id: 'fx-2', imagePath: 'fixture://2', gold: [
    { name: '低密度脂蛋白胆固醇', value: '4.2', unit: 'mmol/L', referenceRange: '<3.4', abnormalFlag: 'H' },
  ] },
];
