// Risk–coverage / selective prediction (validation-rigor cycle).
//
// Frames the abstention guard as principled selective prediction: abstaining
// lowers selective risk at the cost of coverage. riskCoveragePoint is the
// deterministic guard's single operating point; riskCoverageCurve + aurc sweep a
// tunable confidence score (demonstrated on the advisory signal, ready for a real
// per-field score). Grounding: classification-with-rejection; "From Plausibility
// to Verifiability: Risk-Controlled Generative OCR" (arXiv 2603.19790).

export interface SelectiveCase {
  emitted: boolean; // covered (did not abstain)
  error: boolean;   // wrong on the covered decision (ignored when !emitted)
}

export interface CoveragePoint {
  coverage: number;      // |emitted| / N
  selectiveRisk: number; // errors / |emitted|; NaN when nothing emitted
}

export function riskCoveragePoint(cases: SelectiveCase[]): CoveragePoint {
  const n = cases.length;
  const emitted = cases.filter((c) => c.emitted);
  const coverage = n === 0 ? 0 : emitted.length / n;
  const selectiveRisk =
    emitted.length === 0 ? NaN : emitted.filter((c) => c.error).length / emitted.length;
  return { coverage, selectiveRisk };
}

export interface ScoredSelectiveCase {
  score: number; // higher = more trustworthy
  error: boolean;
}

export interface CurvePoint {
  coverage: number;
  risk: number;
}

/**
 * Sweep the abstain threshold from "cover none" to "cover all": accept cases in
 * descending score order. Each point is (coverage k/N, cumulative error rate over
 * the k accepted). Ties are ordered by input position; one curve point per case.
 */
export function riskCoverageCurve(cases: ScoredSelectiveCase[]): CurvePoint[] {
  const sorted = [...cases].sort((a, b) => b.score - a.score);
  const n = sorted.length;
  const pts: CurvePoint[] = [];
  let errors = 0;
  for (let k = 1; k <= n; k++) {
    if (sorted[k - 1].error) errors += 1;
    pts.push({ coverage: k / n, risk: errors / k });
  }
  return pts;
}

/** Area under the risk-coverage curve (trapezoidal over coverage). Lower is better. */
export function aurc(curve: CurvePoint[]): number {
  if (curve.length === 0) return NaN;
  let area = 0;
  let prevCov = 0;
  let prevRisk = curve[0].risk;
  for (const pt of curve) {
    const dCov = pt.coverage - prevCov;
    area += ((prevRisk + pt.risk) / 2) * dCov;
    prevCov = pt.coverage;
    prevRisk = pt.risk;
  }
  return area;
}
