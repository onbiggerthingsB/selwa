import { describe, it, expect } from 'vitest';
import { runBehavioralCase } from './run';
import type { BehavioralCase } from './types';

// Uses the REAL guard. 'Zorblatt' is not in data/reference-labs → must abstain (R1).
const unknownMft: BehavioralCase = {
  id: 'mft-unknown', capability: 'R1-unknown-analyte', testType: 'MFT', kind: 'labs',
  input: { row: { name: 'Zorblatt', value: '5', unit: 'mmol/L', printedRange: null, confidence: 'high' } },
  expect: { verdict: 'abstain' },
};

describe('runBehavioralCase', () => {
  it('MFT passes when the real guard produces the expected verdict', () => {
    const r = runBehavioralCase(unknownMft);
    expect(r.pass).toBe(true);
    expect(r.actual).toBe('abstain');
  });

  it('MFT fails (does not throw) on a wrong expectation', () => {
    const r = runBehavioralCase({ ...unknownMft, id: 'x', expect: { verdict: 'render' } });
    expect(r.pass).toBe(false);
    expect(r.actual).toBe('abstain');
  });

  it('INV passes when every perturbation keeps the same verdict AND classification', () => {
    const inv: BehavioralCase = {
      id: 'inv-alias', capability: 'analyte-synonym-invariance', testType: 'INV', kind: 'labs',
      input: { row: { name: '空腹血糖', value: '5.5', unit: 'mmol/L', printedRange: null, confidence: 'high' } },
      perturbations: [
        { name: 'whitespace', patch: { name: ' 空腹血糖 ' } },
        { name: 'alias', patch: { name: 'GLU' } },
      ],
      expect: {},
    };
    const r = runBehavioralCase(inv);
    expect(r.pass).toBe(true);
  });
});
