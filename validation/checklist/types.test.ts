import { describe, it, expect } from 'vitest';
import { BehavioralCaseSchema, type BehavioralCase } from './types';

describe('BehavioralCaseSchema', () => {
  it('accepts a labs MFT case', () => {
    const c: BehavioralCase = {
      id: 'mft-unknown', capability: 'R1-unknown-analyte', testType: 'MFT', kind: 'labs',
      input: { row: { name: 'Zorblatt', value: '5', unit: 'mmol/L', printedRange: null, confidence: 'high' } },
      expect: { verdict: 'abstain' },
    };
    expect(BehavioralCaseSchema.parse(c).id).toBe('mft-unknown');
  });

  it('accepts an INV case with perturbations', () => {
    const c: BehavioralCase = {
      id: 'inv-alias', capability: 'analyte-synonym-invariance', testType: 'INV', kind: 'labs',
      input: { row: { name: '空腹血糖', value: '5.5', unit: 'mmol/L', printedRange: null, confidence: 'high' } },
      perturbations: [{ name: 'alias', patch: { name: 'GLU' } }, { name: 'whitespace', patch: { name: ' 空腹血糖 ' } }],
      expect: {},
    };
    expect(BehavioralCaseSchema.parse(c).perturbations?.length).toBe(2);
  });

  it('rejects an INV case without perturbations', () => {
    expect(() =>
      BehavioralCaseSchema.parse({
        id: 'bad', capability: 'x', testType: 'INV', kind: 'labs',
        input: { row: { name: 'K', value: '4', unit: 'mmol/L', printedRange: null, confidence: 'high' } },
        expect: {},
      }),
    ).toThrow();
  });
});
