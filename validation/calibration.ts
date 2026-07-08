// Confidence calibration for an ADVISORY signal (validation-rigor cycle).
//
// Answers: when the pipeline's confidence signal is high, is it actually right?
// Input is a generic (score∈[0,1], correct) set — the extraction-confidence
// ordinal now (low→0.3, medium→0.6, high→0.9), real per-field confidence later.
// This calibrates the ADVISORY signal only; it demonstrates WHY we never gate the
// deterministic guard on model-reported confidence. Grounding: Expected
// Calibration Error + reliability diagrams; selective prediction (Geifman &
// El-Yaniv 2017).

export interface ScoredCase {
  score: number;   // confidence in [0,1]
  correct: boolean;
}

export interface ReliabilityBin {
  lo: number;
  hi: number;
  count: number;
  meanScore: number; // NaN when empty
  accuracy: number;  // NaN when empty
}

/** Equal-width bins over [0,1]; a score of exactly 1 lands in the top bin. */
export function reliabilityBins(cases: ScoredCase[], nBins: number): ReliabilityBin[] {
  const bins: ReliabilityBin[] = Array.from({ length: nBins }, (_, i) => ({
    lo: i / nBins,
    hi: (i + 1) / nBins,
    count: 0,
    meanScore: 0,
    accuracy: 0,
  }));
  for (const c of cases) {
    const s = Math.min(Math.max(c.score, 0), 1);
    let idx = Math.floor(s * nBins);
    if (idx >= nBins) idx = nBins - 1;
    const b = bins[idx];
    b.count += 1;
    b.meanScore += s;
    b.accuracy += c.correct ? 1 : 0;
  }
  for (const b of bins) {
    if (b.count === 0) {
      b.meanScore = NaN;
      b.accuracy = NaN;
    } else {
      b.meanScore /= b.count;
      b.accuracy /= b.count;
    }
  }
  return bins;
}

/** ECE = Σ (binCount/N) · |accuracy − meanScore|. NaN when there are no cases. */
export function expectedCalibrationError(cases: ScoredCase[], nBins: number): number {
  if (cases.length === 0) return NaN;
  const bins = reliabilityBins(cases, nBins);
  let ece = 0;
  for (const b of bins) {
    if (b.count === 0) continue;
    ece += (b.count / cases.length) * Math.abs(b.accuracy - b.meanScore);
  }
  return ece;
}
