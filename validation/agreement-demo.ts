// Inter-rater agreement DEMONSTRATION set (validation-rigor cycle).
//
// NOT real clinician verdicts. Synthetic (reviewerA, reviewerB) boolean shouldAbstain
// pairs on a skewed abstain/normal distribution, illustrating the agreement stats.
// Replace with imported clinician-verdict pairs (validation/review/) when available.
import type { BooleanVerdictPair } from './agreement';

export const AGREEMENT_DEMO: BooleanVerdictPair[] = [
  ...Array.from({ length: 15 }, () => ({ a: false, b: false })),
  ...Array.from({ length: 2 }, () => ({ a: true, b: true })),
  { a: true, b: false },
  { a: false, b: true },
];
