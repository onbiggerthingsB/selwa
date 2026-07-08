import type { BehavioralCase } from '../types';

// R13 DIR: a value physiologically implausible in its unit (decimal-shift / misread)
// must SUPPRESS interpretation → abstain. Real critical-but-plausible values are NOT
// suppressed (covered by the guard unit tests + the labs-verdict MFT cases).
const labs = (name: string, value: string, unit: string): BehavioralCase['input'] => ({
  row: { name, value, unit, printedRange: null, confidence: 'high' },
});

export const IMPLAUSIBLE_VALUE_DIR: BehavioralCase[] = [
  {
    id: 'dir-r13-potassium-misread',
    capability: 'R13-implausible-value',
    testType: 'DIR',
    kind: 'labs',
    input: labs('钾', '40', 'mmol/L'), // decimal shift of 4.0 → suppress
    expect: { verdict: 'abstain' },
  },
  {
    id: 'dir-r13-glucose-misread',
    capability: 'R13-implausible-value',
    testType: 'DIR',
    kind: 'labs',
    input: labs('空腹血糖', '550', 'mmol/L'), // absurd magnitude → suppress
    expect: { verdict: 'abstain' },
  },
];
