import type { BehavioralCase } from '../types';
export const OCR_NOISE_INV: BehavioralCase[] = [
  { id: 'inv-glucose-surface', capability: 'analyte-alias+whitespace-invariance', testType: 'INV', kind: 'labs',
    input: { row: { name: '空腹血糖', value: '5.5', unit: 'mmol/L', printedRange: null, confidence: 'high' } },
    perturbations: [
      { name: 'leading/trailing whitespace', patch: { name: ' 空腹血糖 ' } },
      { name: 'EN alias FPG', patch: { name: 'FPG' } },
      { name: 'lowercase alias fpg', patch: { name: 'fpg' } },
      { name: 'unit trailing whitespace', patch: { unit: 'mmol/L ' } },
    ],
    expect: {} },
];
