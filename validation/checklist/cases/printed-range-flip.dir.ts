import type { BehavioralCase } from '../types';

// R11 DIR: a printed-range disagreement that would FLIP the low/normal/high call
// routes to confirm → verdict 'flag'. (A non-flipping disagreement stays an info
// flag and is covered by the guard unit tests; both map to 'flag' at the CheckList
// verdict level, so only the flip case is asserted behaviorally here.)
export const PRINTED_RANGE_FLIP_DIR: BehavioralCase[] = [
  {
    id: 'dir-r11-flip-cholesterol',
    capability: 'R11-flip-confirm',
    testType: 'DIR',
    kind: 'labs',
    // 5.5 is HIGH under our <5.2 but NORMAL under the report's printed <6.5 → flips.
    input: { row: { name: '总胆固醇', value: '5.5', unit: 'mmol/L', printedRange: '<6.5', confidence: 'high' } },
    expect: { verdict: 'flag' },
  },
];
