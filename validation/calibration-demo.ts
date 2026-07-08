// Advisory-signal calibration DEMONSTRATION set (validation-rigor cycle).
//
// NOT a corpus-derived number. A small synthetic (score, correct) set that
// illustrates the extraction-confidence signal's miscalibration — the LLM reports
// 'high' confidence yet is sometimes wrong (the documented overconfidence). The
// report labels this "advisory-signal calibration (demonstration)". Replace with
// real MedRepBench per-field confidences when available (extraction/).
import type { ScoredCase } from './calibration';

// high(0.9) confidence: mostly but not always correct; medium(0.6): mixed; low(0.3): mostly wrong.
export const CALIBRATION_DEMO: ScoredCase[] = [
  ...Array.from({ length: 10 }, (_, i) => ({ score: 0.9, correct: i < 7 })), // 70% correct @ 0.9 → overconfident
  ...Array.from({ length: 6 }, (_, i) => ({ score: 0.6, correct: i < 4 })),  // 67% @ 0.6
  ...Array.from({ length: 6 }, (_, i) => ({ score: 0.3, correct: i < 1 })),  // 17% @ 0.3
];
