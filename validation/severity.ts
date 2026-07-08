// MQM severity-weighted fidelity (validation-rigor cycle).
//
// The WMT gold standard (MQM) weights errors by severity with exponential
// penalties (Critical/Major/Minor). We apply it to immutable SURVIVAL: a missed
// immutable is an error weighted by its category. One missed Critical (a flipped
// negation, an altered dose, a substituted drug, or a dropped high-stakes number)
// collapses the case score; a dropped non-high-stakes number barely moves it.
//
// Default policy (overridable, documented): negation/dosage/drug = Critical(25);
// number = Critical(25) when the case is highStakes, else Major(5). Reported
// ALONGSIDE the flat term-weighted fidelity (metrics.ts), never instead of it.
// Grounding: MQM scoring models, themqm.org; WMT metrics tasks since 2021.

import type { CorpusCase } from './types';
import { countMatchedByCategory } from './score';

export const SEVERITY_WEIGHTS = {
  negations: 25,
  dosages: 25,
  drugs: 25,
  numberHighStakes: 25,
  numberDefault: 5,
} as const;

export interface SeverityEntry {
  case: CorpusCase;
  emitted: boolean;   // did OURS emit a translation for this case?
  candidate: string;  // the emitted text scored for immutable survival
}

function numberWeight(c: CorpusCase): number {
  return c.highStakes ? SEVERITY_WEIGHTS.numberHighStakes : SEVERITY_WEIGHTS.numberDefault;
}

// Total achievable penalty for a case: Σ weight(category) over all its immutables.
function maxPenalty(c: CorpusCase): number {
  const im = c.immutables;
  return (
    im.negations.length * SEVERITY_WEIGHTS.negations +
    im.dosages.length * SEVERITY_WEIGHTS.dosages +
    im.drugs.length * SEVERITY_WEIGHTS.drugs +
    im.numbers.length * numberWeight(c)
  );
}

// Incurred penalty: Σ weight(category) over the MISSED immutables.
function penalty(c: CorpusCase, candidate: string): number {
  const im = c.immutables;
  const matched = countMatchedByCategory(c, candidate);
  const missed = {
    negations: im.negations.length - matched.negations,
    dosages: im.dosages.length - matched.dosages,
    drugs: im.drugs.length - matched.drugs,
    numbers: im.numbers.length - matched.numbers,
  };
  return (
    missed.negations * SEVERITY_WEIGHTS.negations +
    missed.dosages * SEVERITY_WEIGHTS.dosages +
    missed.drugs * SEVERITY_WEIGHTS.drugs +
    missed.numbers * numberWeight(c)
  );
}

/**
 * Severity-weighted fidelity over EMITTED cases only:
 *   1 − (Σ incurred penalty) / (Σ max penalty).
 * Excludes non-emitted cases and cases with no immutables (maxPenalty 0).
 * Returns NaN when the denominator is empty (report "N/A").
 */
export function severityWeightedFidelity(entries: SeverityEntry[]): number {
  let incurred = 0;
  let max = 0;
  for (const e of entries) {
    if (!e.emitted) continue;
    const pmax = maxPenalty(e.case);
    if (pmax === 0) continue;
    incurred += penalty(e.case, e.candidate);
    max += pmax;
  }
  if (max === 0) return NaN;
  return 1 - incurred / max;
}
