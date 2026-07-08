# Health Translator — Validation Rigor Implementation Plan ("Prove the Number")

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing v1 validation harness into a methodologically defensible, auditable instrument — MQM severity-weighted fidelity, ECE/reliability, risk–coverage/AURC, and paradox-resistant agreement stats; a data-driven CheckList (MFT/INV/DIR) behavioral suite over the *real* guard; adversarial corpus enrichment; and ready-to-run MedRepBench + MIMIC-IV adapters — **without changing anything in `app/`, `lib/`, or `data/`.**

**Architecture:** Additive-only, all under `validation/` (which is never imported by the app; it imports `lib/` read-only, exactly as the runner already does). Every new module is a pure function built test-first. The original `validation/metrics.ts` and the 210 existing tests are untouched. `npm run validate` still runs fully offline and still exits non-zero on any missed high-stakes gold-abstain case — now additionally on any CheckList safety regression.

**Tech Stack:** TypeScript · `zod` (schema-validated corpus, as existing) · Vitest (co-located `*.test.ts`) · run by Vitest + `tsx` (`npm run validate`), never bundled into the app. `@anthropic-ai/sdk` is used only inside the key-gated MedRepBench extractor adapter (opt-in, mirrors the existing `googleAdapter`/`unguardedLlmAdapter`).

**Source of truth for the guard contracts (do not re-derive):**
- Labs: `groundExtraction(extraction: { rows: ExtractedRow[] }, sex: Sex, age?: number): GroundedReport`. `GroundedReport.rows[i].action: 'classify' | 'abstain' | 'confirm'` and `.classification: 'low'|'normal'|'high'|'critical'|'unclassified'` (`lib/types.ts`).
- Notes: `groundNotes(translation: NotesTranslation, originalText?: string): GroundedNotes`. `GroundedNotes.overallAction: 'render' | 'flag' | 'abstain'`; `NotesTranslation = { segments: Array<{ sourceText: string; translatedText: string; kind: SegmentKind }> }` (`lib/notesSchema.ts`, `lib/notesGrounding.ts`).
- Corpus: `CorpusCase` + `totalImmutables` (`validation/types.ts`); per-immutable survival predicates live in `validation/score.ts`.

---

## File structure (new / modified)

```
validation/
  metrics.ts               # UNCHANGED
  score.ts                 # MODIFY (Task 1): add + export countMatchedByCategory()
  severity.ts              # CREATE (Task 2): severityWeightedFidelity() — MQM weighting
  calibration.ts           # CREATE (Task 3): expectedCalibrationError() + reliabilityBins()
  coverage.ts              # CREATE (Task 4): riskCoveragePoint() + riskCoverageCurve() + aurc()
  agreement.ts             # CREATE (Task 5): rawAgreement/cohensKappa/gwetAC1/pabak/prevalence
  checklist/
    types.ts               # CREATE (Task 6): Verdict, BehavioralCase, LabsInput, NotesInput
    run.ts                 # CREATE (Task 7): runBehavioralCase() against the real guard
    cases/
      labs-verdicts.mft.ts     # CREATE (Task 8)
      unit-mismatch.dir.ts     # CREATE (Task 8)
      ocr-noise.inv.ts         # CREATE (Task 8)
      negation-flip.dir.ts     # CREATE (Task 8)
      dose-drug.dir.ts         # CREATE (Task 8)
    index.ts               # CREATE (Task 8): schema-checked aggregate + dup-id guard
    render.ts              # CREATE (Task 9): Markdown table of results
  corpus/
    unit-trap.case.ts      # CREATE (Task 10): uncurated-unit traps (urea mg/dL, glucose g/L)
    unknown-analyte.case.ts# CREATE (Task 10): off-table analyte → abstain
    index.ts               # MODIFY (Task 10): spread the two new files
    # (imperative-flip scoped OUT — guard can't catch hold→continue; documented in Task 16)
  calibration-demo.ts      # CREATE (Task 11): synthetic (score,correct) demo set for ECE/curve
  agreement-demo.ts        # CREATE (Task 11): synthetic verdict pairs for the agreement demo
  extraction/
    types.ts               # CREATE (Task 12): ExtractionSample, ExtractedField
    fieldRecall.ts         # CREATE (Task 12): field-level recall scorer
    extractor.ts           # CREATE (Task 13): Extractor interface + key-gated Claude adapter
    medrepbench.ts         # CREATE (Task 13): env-gated loader + runExtractionBenchmark()
    fixture/samples.ts     # CREATE (Task 12): 2 synthetic samples
    README.md              # CREATE (Task 13)
  grounding-bench/
    types.ts               # CREATE (Task 14): LabObservation
    groundingRecall.ts     # CREATE (Task 14): scores deterministic low/normal/high vs real flags
    mimicAdapter.ts        # CREATE (Task 14): documented stub
    fixture/observations.ts# CREATE (Task 14)
    README.md              # CREATE (Task 14)
  run.ts                   # MODIFY (Task 15): render new sections + CheckList regression gate
docs/
  VALIDATION-METHODOLOGY.md# CREATE (Task 16): the paper scaffold
```

Run all tests with `npm test`; a single file with `npx vitest run <path>`.

---

## M1 — Metric families

### Task 1: Per-category immutable scoring (`score.ts`)

MQM weighting needs *which* categories of immutable survived, not just a total. Add a per-category counter that reuses the existing predicates.

**Files:**
- Modify: `validation/score.ts`
- Test: `validation/score.test.ts` (create if absent; otherwise append)

- [ ] **Step 1: Write the failing test**

Create/append `validation/score.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { countMatchedByCategory } from './score';
import type { CorpusCase } from './types';

function labCase(over: Partial<CorpusCase> = {}): CorpusCase {
  return {
    id: 't', lang: 'en', kind: 'notes',
    sourceText: 'no effusion; metformin 850mg; K 4.2',
    goldTranslation: 'no effusion; metformin 850mg; K 4.2',
    immutables: {
      negations: ['未见 积液'],
      dosages: ['850mg'],
      drugs: [{ surface: 'metformin', canonicalId: 'metformin' }],
      numbers: [{ value: '4.2', unit: 'mmol/L' }],
    },
    shouldAbstain: false, highStakes: false, ...over,
  };
}

describe('countMatchedByCategory', () => {
  it('counts survivors per category against a candidate', () => {
    const c = labCase();
    const got = countMatchedByCategory(c, 'no effusion, metformin 850mg, potassium 4.2');
    expect(got).toEqual({ negations: 1, dosages: 1, drugs: 1, numbers: 1 });
  });

  it('reports a dropped drug and dropped negation', () => {
    const c = labCase();
    const got = countMatchedByCategory(c, 'potassium 4.2 with 850mg'); // no "effusion", no "metformin"
    expect(got.negations).toBe(0);
    expect(got.drugs).toBe(0);
    expect(got.dosages).toBe(1);
    expect(got.numbers).toBe(1);
  });

  it('returns all-zero for an empty candidate', () => {
    expect(countMatchedByCategory(labCase(), '')).toEqual({
      negations: 0, dosages: 0, drugs: 0, numbers: 0,
    });
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run validation/score.test.ts`
Expected: FAIL — `countMatchedByCategory` is not exported.

- [ ] **Step 3: Implement**

In `validation/score.ts`, add below `countMatchedImmutables` (reusing the existing module-private predicates `negationPreserved`, `dosagePreserved`, `drugPreserved`, `numberPreserved`):

```ts
export interface CategoryCounts {
  negations: number;
  dosages: number;
  drugs: number;
  numbers: number;
}

/**
 * Like countMatchedImmutables but split by immutable category — the input to
 * MQM severity weighting (severity.ts). Uses the same deterministic predicates.
 */
export function countMatchedByCategory(c: CorpusCase, candidate: string): CategoryCounts {
  const counts: CategoryCounts = { negations: 0, dosages: 0, drugs: 0, numbers: 0 };
  if (!candidate) return counts;
  for (const neg of c.immutables.negations) if (negationPreserved(neg, candidate)) counts.negations += 1;
  for (const dose of c.immutables.dosages) if (dosagePreserved(dose, candidate)) counts.dosages += 1;
  for (const drug of c.immutables.drugs)
    if (drugPreserved(drug.surface, drug.canonicalId, candidate)) counts.drugs += 1;
  for (const num of c.immutables.numbers) if (numberPreserved(num.value, candidate)) counts.numbers += 1;
  return counts;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run validation/score.test.ts` → PASS. Then `npm test` → still green.

- [ ] **Step 5: Commit**

```bash
git add validation/score.ts validation/score.test.ts
git commit -m "feat(validation): per-category immutable scoring for MQM weighting"
```

---

### Task 2: MQM severity-weighted fidelity (`severity.ts`)

**Files:**
- Create: `validation/severity.ts`
- Test: `validation/severity.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { severityWeightedFidelity, SEVERITY_WEIGHTS, type SeverityEntry } from './severity';
import type { CorpusCase } from './types';

function caseWith(immutables: CorpusCase['immutables'], highStakes = false): CorpusCase {
  return {
    id: 'c', lang: 'en', kind: 'notes', sourceText: 's', goldTranslation: 'g',
    immutables, shouldAbstain: false, highStakes,
  };
}

const NEG = (n: string) => ({ negations: [n], dosages: [], drugs: [], numbers: [] });

describe('severityWeightedFidelity', () => {
  it('is 1.0 when every immutable survives', () => {
    const c = caseWith(NEG('未见 积液'));
    const entries: SeverityEntry[] = [{ case: c, emitted: true, candidate: 'no effusion' }];
    expect(severityWeightedFidelity(entries)).toBeCloseTo(1.0, 6);
  });

  it('collapses toward 0 when a Critical immutable (negation) is dropped', () => {
    const c = caseWith(NEG('未见 积液'));
    const entries: SeverityEntry[] = [{ case: c, emitted: true, candidate: 'effusion present' }];
    expect(severityWeightedFidelity(entries)).toBe(0);
  });

  it('weights a dropped non-high-stakes number (Major) far less than a dropped negation', () => {
    const negCase = caseWith(NEG('未见 积液'));
    const numCase = caseWith({ negations: [], dosages: [], drugs: [], numbers: [{ value: '7', unit: '' }] }, false);
    const dropNeg = severityWeightedFidelity([{ case: negCase, emitted: true, candidate: 'effusion' }]);
    const dropNum = severityWeightedFidelity([{ case: numCase, emitted: true, candidate: 'nothing here' }]);
    // Both dropped 1 immutable, but the negation penalty (25) >> the number penalty (5),
    // so over the SAME single case both are 0 — verify via a mixed case instead:
    const mixed = caseWith({ negations: ['未见 积液'], dosages: [], drugs: [], numbers: [{ value: '7', unit: '' }] }, false);
    const dropNumKeepNeg = severityWeightedFidelity([{ case: mixed, emitted: true, candidate: 'no effusion' }]); // neg survives, number dropped
    const dropNegKeepNum = severityWeightedFidelity([{ case: mixed, emitted: true, candidate: 'effusion, 7' }]); // number survives, neg dropped
    expect(dropNumKeepNeg).toBeGreaterThan(dropNegKeepNum); // losing the number hurts less than losing the negation
    expect(dropNeg).toBe(0);
    expect(dropNum).toBe(0);
  });

  it('excludes non-emitted cases and cases with no immutables; empty → NaN', () => {
    const empty = caseWith({ negations: [], dosages: [], drugs: [], numbers: [] });
    expect(Number.isNaN(severityWeightedFidelity([{ case: empty, emitted: true, candidate: 'x' }]))).toBe(true);
    expect(Number.isNaN(severityWeightedFidelity([{ case: caseWith(NEG('未见 积液')), emitted: false, candidate: '' }]))).toBe(true);
  });

  it('exposes the weight policy', () => {
    expect(SEVERITY_WEIGHTS.negations).toBe(25);
    expect(SEVERITY_WEIGHTS.numberHighStakes).toBe(25);
    expect(SEVERITY_WEIGHTS.numberDefault).toBe(5);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run validation/severity.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

Create `validation/severity.ts`:

```ts
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
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run validation/severity.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add validation/severity.ts validation/severity.test.ts
git commit -m "feat(validation): MQM severity-weighted fidelity"
```

---

### Task 3: Calibration — ECE + reliability bins (`calibration.ts`)

**Files:**
- Create: `validation/calibration.ts`
- Test: `validation/calibration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { reliabilityBins, expectedCalibrationError, type ScoredCase } from './calibration';

describe('calibration', () => {
  it('perfect calibration → ECE 0', () => {
    // 10 cases at score 0.9 where exactly 9 are correct; one bin.
    const cases: ScoredCase[] = Array.from({ length: 10 }, (_, i) => ({ score: 0.9, correct: i < 9 }));
    expect(expectedCalibrationError(cases, 1)).toBeCloseTo(Math.abs(0.9 - 0.9), 6);
  });

  it('overconfident signal → positive ECE', () => {
    // score 0.9 but only half correct → |0.5 − 0.9| = 0.4
    const cases: ScoredCase[] = Array.from({ length: 10 }, (_, i) => ({ score: 0.9, correct: i < 5 }));
    expect(expectedCalibrationError(cases, 1)).toBeCloseTo(0.4, 6);
  });

  it('bins by score and reports accuracy + mean per bin', () => {
    const cases: ScoredCase[] = [
      { score: 0.1, correct: false },
      { score: 0.2, correct: false },
      { score: 0.9, correct: true },
      { score: 0.95, correct: true },
    ];
    const bins = reliabilityBins(cases, 10);
    const low = bins.find((b) => b.count > 0 && b.hi <= 0.3)!;
    const high = bins.find((b) => b.count > 0 && b.lo >= 0.9)!;
    expect(low.accuracy).toBe(0);
    expect(high.accuracy).toBe(1);
    expect(high.count).toBe(2);
  });

  it('empty input → ECE NaN', () => {
    expect(Number.isNaN(expectedCalibrationError([], 10))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run validation/calibration.test.ts` → FAIL.

- [ ] **Step 3: Implement**

Create `validation/calibration.ts`:

```ts
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
```

- [ ] **Step 4: Run it, verify it passes** — `npx vitest run validation/calibration.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add validation/calibration.ts validation/calibration.test.ts
git commit -m "feat(validation): ECE + reliability bins for the advisory confidence signal"
```

---

### Task 4: Risk–coverage + AURC (`coverage.ts`)

**Files:**
- Create: `validation/coverage.ts`
- Test: `validation/coverage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { riskCoveragePoint, riskCoverageCurve, aurc, type SelectiveCase, type ScoredSelectiveCase } from './coverage';

describe('risk-coverage', () => {
  it('point: coverage = emitted/N, selectiveRisk = errors/emitted', () => {
    const cases: SelectiveCase[] = [
      { emitted: true, error: false },
      { emitted: true, error: true },
      { emitted: false, error: false }, // abstained → not covered, not an emitted error
      { emitted: true, error: false },
    ];
    const p = riskCoveragePoint(cases);
    expect(p.coverage).toBeCloseTo(3 / 4, 6);
    expect(p.selectiveRisk).toBeCloseTo(1 / 3, 6);
  });

  it('point: nothing emitted → coverage 0, selectiveRisk NaN', () => {
    const p = riskCoveragePoint([{ emitted: false, error: false }]);
    expect(p.coverage).toBe(0);
    expect(Number.isNaN(p.selectiveRisk)).toBe(true);
  });

  it('curve: abstaining the lowest-confidence errors first lowers risk as coverage falls', () => {
    // Higher score = more trustworthy. Errors sit at the low-score end.
    const cases: ScoredSelectiveCase[] = [
      { score: 0.1, error: true },
      { score: 0.2, error: true },
      { score: 0.8, error: false },
      { score: 0.9, error: false },
    ];
    const curve = riskCoverageCurve(cases);
    expect(curve[curve.length - 1].coverage).toBeCloseTo(1, 6);   // cover everything
    expect(curve[curve.length - 1].risk).toBeCloseTo(0.5, 6);     // 2/4 errors
    // At 50% coverage (keep the two highest scores) risk should be 0.
    const half = curve.find((pt) => Math.abs(pt.coverage - 0.5) < 1e-9)!;
    expect(half.risk).toBeCloseTo(0, 6);
    // A perfectly-ordered signal has AURC < the flat-risk rectangle (0.5).
    expect(aurc(curve)).toBeLessThan(0.5);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run validation/coverage.test.ts` → FAIL.

- [ ] **Step 3: Implement**

Create `validation/coverage.ts`:

```ts
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
```

- [ ] **Step 4: Run it, verify it passes** — `npx vitest run validation/coverage.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add validation/coverage.ts validation/coverage.test.ts
git commit -m "feat(validation): risk-coverage operating point + curve + AURC"
```

---

### Task 5: Paradox-resistant agreement (`agreement.ts`)

**Files:**
- Create: `validation/agreement.ts`
- Test: `validation/agreement.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { agreementStats, type BooleanVerdictPair } from './agreement';

describe('agreementStats', () => {
  it('perfect agreement → raw 1, all coefficients 1', () => {
    const pairs: BooleanVerdictPair[] = [
      { a: true, b: true }, { a: false, b: false }, { a: true, b: true },
    ];
    const s = agreementStats(pairs);
    expect(s.rawAgreement).toBe(1);
    expect(s.cohensKappa).toBeCloseTo(1, 6);
    expect(s.gwetAC1).toBeCloseTo(1, 6);
    expect(s.pabak).toBeCloseTo(1, 6);
  });

  it('the kappa paradox: high raw agreement on a skewed class deflates kappa; AC1/PABAK stay high', () => {
    // 90 agree-negative, 2 agree-positive, 8 disagree (4 each way) over N=100.
    // Marginals aPos=bPos=6 → pA=pB=0.06 (extreme skew). Raw agreement 0.92, yet
    // Cohen's kappa collapses to ~0.291 while Gwet's AC1 (~0.910) and PABAK (0.84) hold.
    const pairs: BooleanVerdictPair[] = [
      ...Array.from({ length: 90 }, () => ({ a: false, b: false })),
      ...Array.from({ length: 2 }, () => ({ a: true, b: true })),
      ...Array.from({ length: 4 }, () => ({ a: true, b: false })),
      ...Array.from({ length: 4 }, () => ({ a: false, b: true })),
    ];
    const s = agreementStats(pairs);
    expect(s.rawAgreement).toBeCloseTo(0.92, 6);
    expect(s.cohensKappa).toBeLessThan(0.5);   // paradox: kappa ≈ 0.291, looks poor
    expect(s.gwetAC1).toBeGreaterThan(0.9);    // paradox-resistant ≈ 0.910
    expect(s.pabak).toBeCloseTo(0.84, 6);      // 2·0.92 − 1
    expect(s.prevalence).toBeCloseTo(0.06, 6); // (0.06 + 0.06) / 2
  });

  it('empty → all NaN', () => {
    const s = agreementStats([]);
    expect(Number.isNaN(s.rawAgreement)).toBe(true);
    expect(Number.isNaN(s.gwetAC1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run validation/agreement.test.ts` → FAIL.

- [ ] **Step 3: Implement**

Create `validation/agreement.ts`:

```ts
// Inter-rater agreement for the clinician gold (validation-rigor cycle).
//
// On our skewed distribution (abstain/critical cases are rare), Cohen's kappa
// collapses even at high raw agreement — the well-documented kappa paradox. We
// therefore report AC1 + PABAK + raw agreement + prevalence together. The
// landmark MT-safety papers (Khoong 2019, Taira 2021) reported NO inter-rater
// reliability at all, so this is a cheap way to be methodologically stronger.
// Grounding: Zec et al. 2017 (the kappa paradox); Gwet's AC1; PABAK.

export interface BooleanVerdictPair {
  a: boolean; // reviewer A verdict (e.g. shouldAbstain)
  b: boolean; // reviewer B verdict
}

export interface AgreementStats {
  n: number;
  rawAgreement: number; // Po
  prevalence: number;   // mean positive rate across both raters
  cohensKappa: number;
  gwetAC1: number;
  pabak: number;
}

export function agreementStats(pairs: BooleanVerdictPair[]): AgreementStats {
  const n = pairs.length;
  const nan: AgreementStats = {
    n, rawAgreement: NaN, prevalence: NaN, cohensKappa: NaN, gwetAC1: NaN, pabak: NaN,
  };
  if (n === 0) return nan;

  let bothPos = 0, bothNeg = 0, aPos = 0, bPos = 0;
  for (const { a, b } of pairs) {
    if (a) aPos += 1;
    if (b) bPos += 1;
    if (a && b) bothPos += 1;
    else if (!a && !b) bothNeg += 1;
  }
  const po = (bothPos + bothNeg) / n;               // observed agreement
  const pA = aPos / n, pB = bPos / n;               // per-rater positive rates
  const prevalence = (pA + pB) / 2;

  // Cohen's kappa: chance agreement by independent marginals.
  const peCohen = pA * pB + (1 - pA) * (1 - pB);
  const cohensKappa = peCohen === 1 ? 1 : (po - peCohen) / (1 - peCohen);

  // Gwet's AC1: chance agreement via a prevalence-robust formulation.
  const piHat = (pA + pB) / 2;
  const peGwet = 2 * piHat * (1 - piHat);
  const gwetAC1 = peGwet === 1 ? 1 : (po - peGwet) / (1 - peGwet);

  // PABAK: prevalence-and-bias-adjusted kappa = 2·Po − 1.
  const pabak = 2 * po - 1;

  return { n, rawAgreement: po, prevalence, cohensKappa, gwetAC1, pabak };
}
```

- [ ] **Step 4: Run it, verify it passes** — `npx vitest run validation/agreement.test.ts` → PASS. Then `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add validation/agreement.ts validation/agreement.test.ts
git commit -m "feat(validation): paradox-resistant agreement (raw/kappa/AC1/PABAK/prevalence)"
```

---

## M2 — CheckList behavioral suite

### Task 6: CheckList types (`checklist/types.ts`)

**Files:**
- Create: `validation/checklist/types.ts`
- Test: `validation/checklist/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run validation/checklist/types.test.ts` → FAIL.

- [ ] **Step 3: Implement**

Create `validation/checklist/types.ts`:

```ts
// CheckList behavioral-case schema (validation-rigor cycle).
//
// R1–R12 + notesGuard recast as MFT/INV/DIR behavioral tests (Ribeiro et al.,
// ACL 2020), executed against the REAL guard. A unified Verdict normalizes the
// two guard vocabularies: labs 'classify'|'confirm'|'abstain' and notes
// 'render'|'flag'|'abstain' both map to render|flag|abstain (see run.ts).

import { z } from 'zod';

export const VerdictSchema = z.enum(['render', 'flag', 'abstain']);
export type Verdict = z.infer<typeof VerdictSchema>;

// Mirrors lib/types ExtractedRow (re-declared here to keep validation/ self-contained).
export const LabsRowSchema = z.object({
  name: z.string(),
  value: z.string().nullable(),
  unit: z.string().nullable(),
  printedRange: z.string().nullable(),
  confidence: z.enum(['low', 'medium', 'high']),
});

export const LabsInputSchema = z.object({
  row: LabsRowSchema,
  sex: z.enum(['male', 'female', 'unknown']).optional(),
  age: z.number().optional(),
});

export const NotesInputSchema = z.object({
  sourceText: z.string(),
  translatedText: z.string(),
  kind: z.enum(['finding', 'medication', 'instruction', 'followup', 'other']),
  originalText: z.string().optional(),
});

// A label-preserving perturbation for INV cases: a shallow patch applied to the
// labs row (or notes segment) that must NOT change the verdict/classification.
export const PerturbationSchema = z.object({
  name: z.string(),
  patch: z.record(z.string(), z.unknown()),
});

export const BehavioralCaseSchema = z
  .object({
    id: z.string(),
    capability: z.string(), // e.g. 'R1-unknown-analyte'
    testType: z.enum(['MFT', 'INV', 'DIR']),
    kind: z.enum(['labs', 'notes']),
    input: z.union([LabsInputSchema, NotesInputSchema]),
    perturbations: z.array(PerturbationSchema).optional(),
    expect: z.object({ verdict: VerdictSchema.optional() }),
  })
  .refine((c) => c.testType !== 'INV' || (c.perturbations?.length ?? 0) > 0, {
    message: 'INV cases require at least one perturbation',
  })
  .refine((c) => c.testType === 'INV' || c.expect.verdict !== undefined, {
    message: 'MFT/DIR cases require expect.verdict',
  });

export type LabsInput = z.infer<typeof LabsInputSchema>;
export type NotesInput = z.infer<typeof NotesInputSchema>;
export type BehavioralCase = z.infer<typeof BehavioralCaseSchema>;
```

- [ ] **Step 4: Run it, verify it passes** — `npx vitest run validation/checklist/types.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add validation/checklist/types.ts validation/checklist/types.test.ts
git commit -m "feat(validation): CheckList behavioral-case schema (MFT/INV/DIR)"
```

---

### Task 7: CheckList runner (`checklist/run.ts`)

**Files:**
- Create: `validation/checklist/run.ts`
- Test: `validation/checklist/run.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run validation/checklist/run.test.ts` → FAIL.

- [ ] **Step 3: Implement**

Create `validation/checklist/run.ts`:

```ts
// CheckList runner (validation-rigor cycle). Executes a BehavioralCase against
// the REAL guard entry points and normalizes the verdict. Pure & deterministic.

import { groundExtraction } from '@/lib/grounding';
import { groundNotes } from '@/lib/notesGrounding';
import type { SegmentAction, Sex, Classification, GroundedRow } from '@/lib/types';
import type { BehavioralCase, LabsInput, NotesInput, Verdict } from './types';

// Normalize the two guard vocabularies to the unified Verdict. A high-stakes /
// critical labs row keeps action='classify' but sets needsConfirm=true and carries
// a "confirm with clinician" flag — so those states are 'flag', not clean 'render'.
// (Verified against the real guard: 空腹血糖 5.5 mmol/L → classify + needsConfirm.)
function fromLabs(row: GroundedRow): Verdict {
  if (row.action === 'abstain') return 'abstain';
  if (row.needsConfirm || row.flags.length > 0) return 'flag';
  return 'render';
}
function fromNotes(a: SegmentAction): Verdict {
  return a; // already render|flag|abstain
}

interface Evaluated {
  verdict: Verdict;
  classification: Classification | null; // labs only
}

function evaluate(kind: 'labs' | 'notes', input: LabsInput | NotesInput): Evaluated {
  if (kind === 'labs') {
    const i = input as LabsInput;
    const report = groundExtraction({ rows: [i.row] }, (i.sex ?? 'unknown') as Sex, i.age);
    const row = report.rows[0];
    return { verdict: fromLabs(row), classification: row.classification };
  }
  const i = input as NotesInput;
  const grounded = groundNotes(
    { segments: [{ sourceText: i.sourceText, translatedText: i.translatedText, kind: i.kind }] },
    i.originalText,
  );
  return { verdict: fromNotes(grounded.overallAction), classification: null };
}

// Apply a shallow perturbation patch to a labs row or notes segment.
function applyPatch(input: LabsInput | NotesInput, patch: Record<string, unknown>, kind: 'labs' | 'notes'): LabsInput | NotesInput {
  if (kind === 'labs') {
    const i = input as LabsInput;
    return { ...i, row: { ...i.row, ...(patch as object) } };
  }
  return { ...(input as NotesInput), ...(patch as object) };
}

export interface CaseResult {
  id: string;
  capability: string;
  testType: BehavioralCase['testType'];
  kind: BehavioralCase['kind'];
  expected: Verdict | 'invariant';
  actual: Verdict;
  pass: boolean;
  detail?: string; // e.g. which perturbation broke invariance
}

export function runBehavioralCase(c: BehavioralCase): CaseResult {
  const base = evaluate(c.kind, c.input);

  if (c.testType === 'INV') {
    for (const p of c.perturbations ?? []) {
      const perturbed = evaluate(c.kind, applyPatch(c.input, p.patch, c.kind));
      if (perturbed.verdict !== base.verdict || perturbed.classification !== base.classification) {
        return {
          id: c.id, capability: c.capability, testType: c.testType, kind: c.kind,
          expected: 'invariant', actual: perturbed.verdict, pass: false,
          detail: `perturbation "${p.name}" changed verdict ${base.verdict}→${perturbed.verdict} / class ${base.classification}→${perturbed.classification}`,
        };
      }
    }
    return {
      id: c.id, capability: c.capability, testType: c.testType, kind: c.kind,
      expected: 'invariant', actual: base.verdict, pass: true,
    };
  }

  // MFT / DIR: a single required verdict.
  const expected = c.expect.verdict!;
  return {
    id: c.id, capability: c.capability, testType: c.testType, kind: c.kind,
    expected, actual: base.verdict, pass: base.verdict === expected,
  };
}
```

- [ ] **Step 4: Run it, verify it passes** — `npx vitest run validation/checklist/run.test.ts` → PASS.

> If an assertion about the real guard's verdict is wrong (e.g. a synonym isn't in `data/reference-labs`), FIX THE TEST CASE to match true guard behavior — do NOT change the guard. The CheckList documents what the guard actually does.

- [ ] **Step 5: Commit**

```bash
git add validation/checklist/run.ts validation/checklist/run.test.ts
git commit -m "feat(validation): CheckList runner over the real guard (verdict normalization)"
```

---

### Task 8: CheckList cases + aggregate (`checklist/cases/*`, `checklist/index.ts`)

**Files:**
- Create: `validation/checklist/cases/labs-verdicts.mft.ts`, `unit-mismatch.dir.ts`, `ocr-noise.inv.ts`, `negation-flip.dir.ts`, `dose-drug.dir.ts`
- Create: `validation/checklist/index.ts`
- Test: `validation/checklist/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { CHECKLIST } from './index';
import { runBehavioralCase } from './run';

describe('CHECKLIST', () => {
  it('has unique ids and covers all three test types', () => {
    const ids = CHECKLIST.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const types = new Set(CHECKLIST.map((c) => c.testType));
    expect(types).toEqual(new Set(['MFT', 'INV', 'DIR']));
  });

  it('every behavioral case passes against the real guard (safety regression suite)', () => {
    const failures = CHECKLIST.map(runBehavioralCase).filter((r) => !r.pass);
    expect(failures, JSON.stringify(failures, null, 2)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL (no `index.ts`).

- [ ] **Step 3: Implement the case files**

`validation/checklist/cases/labs-verdicts.mft.ts` — MFT coverage of the three labs verdict states (all probe-verified against the real guard):

```ts
import type { BehavioralCase } from '../types';
const row = (name: string, value: string, unit: string) =>
  ({ name, value, unit, printedRange: null, confidence: 'high' as const });
export const LABS_VERDICT_MFT: BehavioralCase[] = [
  // Unknown analyte → abstain (R1). (Verified: Zorblatt/Qwexil match NONE → abstain.)
  { id: 'mft-unknown-1', capability: 'R1-unknown-analyte', testType: 'MFT', kind: 'labs',
    input: { row: row('Zorblatt', '5.0', 'mmol/L') }, expect: { verdict: 'abstain' } },
  { id: 'mft-unknown-2', capability: 'R1-unknown-analyte', testType: 'MFT', kind: 'labs',
    input: { row: row('Qwexil', '3.0', 'mmol/L') }, expect: { verdict: 'abstain' } },
  // Benign, non-high-stakes analyte in range → clean render. (Verified: 总胆固醇 4.5 → render.)
  { id: 'mft-render-cholesterol', capability: 'render-benign-in-range', testType: 'MFT', kind: 'labs',
    input: { row: row('总胆固醇', '4.5', 'mmol/L') }, expect: { verdict: 'render' } },
  // High-stakes analyte, even NORMAL, forces the confirm gate → flag. (Verified: 空腹血糖 5.5 → needsConfirm.)
  { id: 'mft-highstakes-confirm', capability: 'R4/R6-high-stakes-confirm', testType: 'MFT', kind: 'labs',
    input: { row: row('空腹血糖', '5.5', 'mmol/L') }, expect: { verdict: 'flag' } },
];
```

`validation/checklist/cases/unit-mismatch.dir.ts` — a known analyte in a genuinely **uncurated** unit abstains (R2). Verified against `data/unit-conversions.ts`: `mg/dL` IS a curated safe auto-conversion for glucose/cholesterols/creatinine/bilirubin/uric-acid (those *classify*, not abstain — do NOT use them here); the uncurated traps are **urea/BUN** (deliberately excluded: BUN ×2.14 ambiguity) and any **wrong-dimension** unit:

```ts
import type { BehavioralCase } from '../types';
export const UNIT_MISMATCH_DIR: BehavioralCase[] = [
  // 尿素 (urea) has NO curated mg/dL factor → convertValue() returns null → abstain. (Verified.)
  { id: 'dir-unit-urea-mgdl', capability: 'R2-unit-mismatch', testType: 'DIR', kind: 'labs',
    input: { row: { name: '尿素', value: '14', unit: 'mg/dL', printedRange: null, confidence: 'high' } },
    expect: { verdict: 'abstain' } },
  // 空腹血糖 IS in the table, but g/L is a non-allowed, non-convertible unit → abstain. (Verified.)
  { id: 'dir-unit-glucose-gl', capability: 'R2-unit-mismatch', testType: 'DIR', kind: 'labs',
    input: { row: { name: '空腹血糖', value: '5.5', unit: 'g/L', printedRange: null, confidence: 'high' } },
    expect: { verdict: 'abstain' } },
];
```

`validation/checklist/cases/ocr-noise.inv.ts` — label-preserving surface noise must NOT change the verdict OR the classification. The base is a high-stakes analyte (verdict `flag`, class `normal`); every perturbation must stay `flag`/`normal` (all four probe-verified):

```ts
import type { BehavioralCase } from '../types';
export const OCR_NOISE_INV: BehavioralCase[] = [
  { id: 'inv-glucose-surface', capability: 'analyte-alias+whitespace-invariance', testType: 'INV', kind: 'labs',
    input: { row: { name: '空腹血糖', value: '5.5', unit: 'mmol/L', printedRange: null, confidence: 'high' } },
    perturbations: [
      { name: 'leading/trailing whitespace', patch: { name: ' 空腹血糖 ' } },
      { name: 'EN alias GLU', patch: { name: 'GLU' } },
      { name: 'lowercase alias glu', patch: { name: 'glu' } },
      { name: 'unit trailing whitespace', patch: { unit: 'mmol/L ' } },
    ],
    expect: {} },
];
```

`validation/checklist/cases/negation-flip.dir.ts` — a flipped source negation. **Verified:** the guard **flags** the polarity mismatch (`R7-NEGATION-POLARITY-MISMATCH`) — it does *not* abstain — so the expected verdict is `flag`. That the guard flags (shows the wrong translation with a caution) rather than blanks a flipped negation is a deliberate, documented finding recorded in `docs/VALIDATION-METHODOLOGY.md`:

```ts
import type { BehavioralCase } from '../types';
export const NEGATION_FLIP_DIR: BehavioralCase[] = [
  { id: 'dir-negation-flip', capability: 'R7-negation-polarity', testType: 'DIR', kind: 'notes',
    input: { sourceText: '未见明显积液', translatedText: 'effusion is present', kind: 'finding', originalText: '未见明显积液' },
    expect: { verdict: 'flag' } },
];
```

`validation/checklist/cases/dose-drug.dir.ts` — an altered dose or substituted drug. **Verified:** a dose change with magnitude ratio ≥2× abstains (`R8-DOSE-MAGNITUDE-DIVERGENCE`); a drug substitution abstains (`R9-DRUG-SUBSTITUTED`). A sub-2× change only *flags* — so use 850→400 (ratio ≈2.1×) to exercise the abstain path:

```ts
import type { BehavioralCase } from '../types';
export const DOSE_DRUG_DIR: BehavioralCase[] = [
  { id: 'dir-dose-altered', capability: 'R8-dose', testType: 'DIR', kind: 'notes',
    input: { sourceText: '二甲双胍 850mg 每日两次', translatedText: 'metformin 400mg twice daily', kind: 'medication', originalText: '二甲双胍 850mg 每日两次' },
    expect: { verdict: 'abstain' } },
  { id: 'dir-drug-substituted', capability: 'R9-drug', testType: 'DIR', kind: 'notes',
    input: { sourceText: '阿托伐他汀 20mg', translatedText: 'atenolol 20mg', kind: 'medication', originalText: '阿托伐他汀 20mg' },
    expect: { verdict: 'abstain' } },
];
```

`validation/checklist/index.ts`:

```ts
import { BehavioralCaseSchema, type BehavioralCase } from './types';
import { LABS_VERDICT_MFT } from './cases/labs-verdicts.mft';
import { UNIT_MISMATCH_DIR } from './cases/unit-mismatch.dir';
import { OCR_NOISE_INV } from './cases/ocr-noise.inv';
import { NEGATION_FLIP_DIR } from './cases/negation-flip.dir';
import { DOSE_DRUG_DIR } from './cases/dose-drug.dir';

const RAW: BehavioralCase[] = [
  ...LABS_VERDICT_MFT, ...UNIT_MISMATCH_DIR, ...OCR_NOISE_INV, ...NEGATION_FLIP_DIR, ...DOSE_DRUG_DIR,
];

// Schema-validate + duplicate-id guard at module load (mirrors corpus/index.ts).
const seen = new Set<string>();
export const CHECKLIST: BehavioralCase[] = RAW.map((c) => {
  const parsed = BehavioralCaseSchema.parse(c);
  if (seen.has(parsed.id)) throw new Error(`Duplicate checklist id: ${parsed.id}`);
  seen.add(parsed.id);
  return parsed;
});
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run validation/checklist/index.test.ts`
Expected: PASS. If a DIR/MFT case's expected verdict does not match real guard behavior, **adjust the case** (or pick a genuinely-uncurated unit/analyte) — never the guard. This is the intended discovery step: the CheckList must reflect what the guard actually does.

- [ ] **Step 5: Commit**

```bash
git add validation/checklist/cases validation/checklist/index.ts validation/checklist/index.test.ts
git commit -m "feat(validation): CheckList case families + schema-checked aggregate"
```

---

### Task 9: CheckList render (`checklist/render.ts`)

**Files:**
- Create: `validation/checklist/render.ts`
- Test: `validation/checklist/render.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { renderChecklist } from './render';
import type { CaseResult } from './run';

const rows: CaseResult[] = [
  { id: 'a', capability: 'R1', testType: 'MFT', kind: 'labs', expected: 'abstain', actual: 'abstain', pass: true },
  { id: 'b', capability: 'R7', testType: 'DIR', kind: 'notes', expected: 'abstain', actual: 'render', pass: false, detail: 'x' },
];

describe('renderChecklist', () => {
  it('renders a table with a pass summary and marks failures', () => {
    const md = renderChecklist(rows);
    expect(md).toContain('1/2 passed');
    expect(md).toContain('| a | R1 | MFT');
    expect(md).toContain('**FAIL**');
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Implement**

Create `validation/checklist/render.ts`:

```ts
import type { CaseResult } from './run';

export function renderChecklist(results: CaseResult[]): string {
  const passed = results.filter((r) => r.pass).length;
  const lines: string[] = [];
  lines.push('## CheckList behavioral suite (R1–R12 + notesGuard)');
  lines.push('');
  lines.push(`${passed}/${results.length} passed. MFT = minimum functionality, INV = invariance, DIR = directional.`);
  lines.push('');
  lines.push('| Case | Capability | Type | Kind | Expected | Actual | Result |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of results) {
    lines.push(
      `| ${r.id} | ${r.capability} | ${r.testType} | ${r.kind} | ${r.expected} | ${r.actual} | ${r.pass ? 'pass' : '**FAIL**'} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
```

- [ ] **Step 4: Run it, verify it passes** — PASS. Then `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add validation/checklist/render.ts validation/checklist/render.test.ts
git commit -m "feat(validation): CheckList results table renderer"
```

---

## M3 — Adversarial corpus enrichment

### Task 10: Adversarial trap cases (`corpus/*.case.ts`, `corpus/index.ts`)

**Files:**
- Create: `validation/corpus/unit-trap.case.ts`, `validation/corpus/unknown-analyte.case.ts`
- Modify: `validation/corpus/index.ts`, `validation/types.ts` (extend `AbstainReasonSchema`), `validation/types.test.ts` (if it enumerates the members)
- Test: `validation/corpus/index.test.ts` (append; or create if absent)

> **All gold verdicts below are probe-verified against the real guard.** An imperative-flip (hold→continue) family was intentionally scoped **out**: the guard does not detect medication-instruction imperative reversal (`暂停服用降压药` → "Keep taking it" returns `render`, verified), so it cannot be a release-gated gold-abstain case here — forcing it would block the gate forever, and fixing it is a guard change (out of scope). It is recorded as a known gap in Task 16 (motivating a future **R7b** rule), per spec §6.1.

- [ ] **Step 1: Extend the abstain-reason enum (additive; `validation/` only)**

In `validation/types.ts`, add `'unknown_analyte'` to `AbstainReasonSchema`:

```ts
export const AbstainReasonSchema = z.enum([
  'dropped_negation',
  'dose_mismatch',
  'drug_ambiguous',
  'number_unit_mismatch',
  'unit_conversion_ambiguous',
  'unknown_analyte', // NEW: analyte not present in the curated reference table
]);
```

If `validation/types.test.ts` asserts the enum members, add `'unknown_analyte'` there. Run `npx vitest run validation/types.test.ts` → PASS.

- [ ] **Step 2: Write the failing corpus test**

Append to (or create) `validation/corpus/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CORPUS } from './index';

describe('corpus enrichment', () => {
  it('includes the adversarial trap families with unique ids', () => {
    const ids = CORPUS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((i) => i.startsWith('unit-trap-'))).toBe(true);
    expect(ids.some((i) => i.startsWith('unknown-analyte-'))).toBe(true);
  });

  it('every new trap case is gold-abstain', () => {
    const traps = CORPUS.filter((c) => c.id.startsWith('unit-trap-') || c.id.startsWith('unknown-analyte-'));
    expect(traps.length).toBeGreaterThan(0);
    for (const c of traps) expect(c.shouldAbstain).toBe(true);
  });
});
```

- [ ] **Step 3: Run it, verify it fails** — FAIL.

- [ ] **Step 4: Implement the case files**

`validation/corpus/unit-trap.case.ts` — a known analyte in a genuinely **uncurated** unit must abstain (R2). Probe-verified: `尿素 mg/dL` and `空腹血糖 g/L` both abstain (`mg/dL` for glucose/cholesterols/creatinine/bilirubin/uric-acid IS a curated safe conversion and would instead *classify* — not used here):

```ts
import type { CorpusCase } from '../types';
// Uncurated-unit trap: a value whose unit has no curated unambiguous conversion must
// abstain (R2), never silently mis-classify. Grounding: the mg/dL-vs-mmol/L family of
// real-world harms (ChatGPT diabetes study, arXiv 2501.07931) — the safe response is
// to refuse a conversion the table does not curate. (urea/BUN and calcium are the
// deliberately-excluded uncurated units per data/unit-conversions.ts.)
export const UNIT_TRAP_CASES: CorpusCase[] = [
  {
    id: 'unit-trap-urea-mgdl', lang: 'zh', kind: 'labs',
    sourceText: '尿素 14 mg/dL', goldTranslation: 'Urea 14 mg/dL (no unambiguous SI conversion)',
    immutables: { negations: [], dosages: [], drugs: [], numbers: [{ value: '14', unit: 'mg/dL' }] },
    shouldAbstain: true, highStakes: false, abstainReason: 'unit_conversion_ambiguous',
  },
  {
    id: 'unit-trap-glucose-gl', lang: 'zh', kind: 'labs',
    sourceText: '空腹血糖 5.5 g/L', goldTranslation: 'Fasting glucose 5.5 g/L (non-standard unit)',
    immutables: { negations: [], dosages: [], drugs: [], numbers: [{ value: '5.5', unit: 'g/L' }] },
    shouldAbstain: true, highStakes: true, abstainReason: 'number_unit_mismatch',
  },
];
```

`validation/corpus/unknown-analyte.case.ts` — an off-table analyte must abstain (R1). Probe-verified: `Zorblatt` matches nothing → abstain:

```ts
import type { CorpusCase } from '../types';
export const UNKNOWN_ANALYTE_CASES: CorpusCase[] = [
  {
    id: 'unknown-analyte-1', lang: 'en', kind: 'labs',
    sourceText: 'Zorblatt 5.0 mmol/L', goldTranslation: 'Zorblatt 5.0 mmol/L (not a known analyte)',
    immutables: { negations: [], dosages: [], drugs: [], numbers: [{ value: '5.0', unit: 'mmol/L' }] },
    shouldAbstain: true, highStakes: false, abstainReason: 'unknown_analyte',
  },
];
```

Modify `validation/corpus/index.ts` — spread the two new files into `RAW_CASES` (follow the existing import + spread pattern):

```ts
// ...existing imports...
import { UNIT_TRAP_CASES } from './unit-trap.case';
import { UNKNOWN_ANALYTE_CASES } from './unknown-analyte.case';

// ...inside the RAW_CASES array, add:
//   ...UNIT_TRAP_CASES, ...UNKNOWN_ANALYTE_CASES,
```

- [ ] **Step 5: Run the release gate to confirm the new gold matches real behavior**

Run: `npm run validate`
Expected: the run completes and **high-stakes recall stays 1.0** — OURS abstains on `unit-trap-glucose-gl` (the one high-stakes new case) and on every existing high-stakes gold-abstain case. These verdicts are probe-verified, so a mismatch means a typo in the case — fix the CASE, never the guard.

- [ ] **Step 6: Run tests** — `npx vitest run validation/corpus/index.test.ts` → PASS. `npm test` → green.

- [ ] **Step 7: Commit**

```bash
git add validation/corpus validation/types.ts validation/types.test.ts
git commit -m "feat(validation): adversarial corpus — uncurated-unit + unknown-analyte traps; abstain-reason enum"
```

---

## M4 — Real-data adapters (ready-to-run; execution deferred)

### Task 11: Demo fixtures for ECE / risk-coverage curve / agreement (`calibration-demo.ts`, `agreement-demo.ts`)

The deterministic guard emits no probability, and the offline run has no clinician-verdict pairs — so ECE, the risk-coverage **curve/AURC**, and inter-rater **agreement** are demonstrated on small synthetic fixtures (labeled "demonstration" in the report) until real MedRepBench confidences / clinician verdicts exist. (The severity-weighted fidelity and the risk-coverage *point* are real corpus numbers — Task 15.)

**Files:**
- Create: `validation/calibration-demo.ts`, `validation/agreement-demo.ts`
- Test: `validation/calibration-demo.test.ts`, `validation/agreement-demo.test.ts`

- [ ] **Step 1: Write the failing tests**

`validation/calibration-demo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CALIBRATION_DEMO } from './calibration-demo';
import { expectedCalibrationError } from './calibration';

describe('CALIBRATION_DEMO', () => {
  it('is a labelled advisory-signal set with scores in [0,1]', () => {
    expect(CALIBRATION_DEMO.length).toBeGreaterThanOrEqual(10);
    for (const c of CALIBRATION_DEMO) {
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(1);
      expect(typeof c.correct).toBe('boolean');
    }
  });
  it('is intentionally miscalibrated (overconfident) to exercise ECE > 0', () => {
    expect(expectedCalibrationError(CALIBRATION_DEMO, 10)).toBeGreaterThan(0);
  });
});
```

`validation/agreement-demo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { AGREEMENT_DEMO } from './agreement-demo';
import { agreementStats } from './agreement';

describe('AGREEMENT_DEMO', () => {
  it('is a set of boolean verdict pairs with high raw agreement', () => {
    expect(AGREEMENT_DEMO.length).toBeGreaterThanOrEqual(10);
    expect(agreementStats(AGREEMENT_DEMO).rawAgreement).toBeGreaterThan(0.8);
  });
});
```

- [ ] **Step 2: Run them, verify they fail** — FAIL.

- [ ] **Step 3: Implement**

`validation/calibration-demo.ts`:

```ts
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
```

`validation/agreement-demo.ts`:

```ts
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
```

- [ ] **Step 4: Run them, verify they pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add validation/calibration-demo.ts validation/agreement-demo.ts validation/calibration-demo.test.ts validation/agreement-demo.test.ts
git commit -m "feat(validation): synthetic calibration + agreement demonstration fixtures"
```

---

### Task 12: MedRepBench field-recall scorer + fixture (`extraction/`)

**Files:**
- Create: `validation/extraction/types.ts`, `validation/extraction/fieldRecall.ts`, `validation/extraction/fixture/samples.ts`
- Test: `validation/extraction/fieldRecall.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { fieldRecall } from './fieldRecall';
import type { ExtractionSample, ExtractedField } from './types';

const gold: ExtractionSample['gold'] = [
  { name: '空腹血糖', value: '5.5', unit: 'mmol/L', referenceRange: '3.9-6.1', abnormalFlag: '' },
  { name: '血红蛋白', value: '140', unit: 'g/L', referenceRange: '130-175', abnormalFlag: '' },
];

describe('fieldRecall', () => {
  it('scores 1.0 when the prediction matches every field', () => {
    const pred: ExtractedField[] = gold.map((g) => ({ ...g }));
    const r = fieldRecall(pred, gold);
    expect(r.overall).toBeCloseTo(1, 6);
    expect(r.perField.value).toBeCloseTo(1, 6);
  });

  it('penalizes a misread value and a dropped row', () => {
    const pred: ExtractedField[] = [{ name: '空腹血糖', value: '55', unit: 'mmol/L', referenceRange: '3.9-6.1', abnormalFlag: '' }];
    const r = fieldRecall(pred, gold);
    // Row 2 fully missed; row 1 value wrong. Per-field value recall = 0/2.
    expect(r.perField.value).toBeCloseTo(0, 6);
    expect(r.perField.name).toBeCloseTo(1 / 2, 6); // only 空腹血糖 matched by name
    expect(r.overall).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Implement**

`validation/extraction/types.ts`:

```ts
// MedRepBench-style extraction sample (validation-rigor cycle). Five fields,
// matching MedRepBench's schema/metric (arXiv 2508.16674): item name, measured
// value, unit, reference range, abnormality flag. Images are never committed.
export interface ExtractedField {
  name: string;
  value: string;
  unit: string;
  referenceRange: string;
  abnormalFlag: string; // '', 'H', 'L', or dataset-specific
}

export interface ExtractionSample {
  id: string;
  imagePath: string; // absolute/relative path into MEDREPBENCH_DIR; not committed
  gold: ExtractedField[];
}
```

`validation/extraction/fieldRecall.ts`:

```ts
import type { ExtractedField, ExtractionSample } from './types';

const FIELDS = ['name', 'value', 'unit', 'referenceRange', 'abnormalFlag'] as const;
type Field = (typeof FIELDS)[number];

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '').trim();
}

// Match a predicted row to a gold row by normalized name (the row key MedRepBench
// uses); recall is computed per field over gold rows.
export interface RecallResult {
  perField: Record<Field, number>;
  overall: number;
}

export function fieldRecall(predicted: ExtractedField[], gold: ExtractionSample['gold']): RecallResult {
  const predByName = new Map(predicted.map((p) => [norm(p.name), p]));
  const hits: Record<Field, number> = { name: 0, value: 0, unit: 0, referenceRange: 0, abnormalFlag: 0 };
  for (const g of gold) {
    const p = predByName.get(norm(g.name));
    if (!p) continue; // whole row missed → no field credited
    hits.name += 1; // name matched by construction
    for (const f of FIELDS) {
      if (f === 'name') continue;
      if (norm(p[f]) === norm(g[f])) hits[f] += 1;
    }
  }
  const denom = gold.length;
  const perField = Object.fromEntries(
    FIELDS.map((f) => [f, denom === 0 ? NaN : hits[f] / denom]),
  ) as Record<Field, number>;
  const overall =
    denom === 0 ? NaN : FIELDS.reduce((s, f) => s + perField[f], 0) / FIELDS.length;
  return { perField, overall };
}
```

`validation/extraction/fixture/samples.ts`:

```ts
import type { ExtractionSample } from '../types';
// Synthetic samples so the scorer lands green with NO dataset and NO API key.
export const FIXTURE_SAMPLES: ExtractionSample[] = [
  { id: 'fx-1', imagePath: 'fixture://1', gold: [
    { name: '空腹血糖', value: '5.5', unit: 'mmol/L', referenceRange: '3.9-6.1', abnormalFlag: '' },
    { name: '血红蛋白', value: '140', unit: 'g/L', referenceRange: '130-175', abnormalFlag: '' },
  ] },
  { id: 'fx-2', imagePath: 'fixture://2', gold: [
    { name: '低密度脂蛋白胆固醇', value: '4.2', unit: 'mmol/L', referenceRange: '<3.4', abnormalFlag: 'H' },
  ] },
];
```

- [ ] **Step 4: Run it, verify it passes** — `npx vitest run validation/extraction/fieldRecall.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add validation/extraction/types.ts validation/extraction/fieldRecall.ts validation/extraction/fixture validation/extraction/fieldRecall.test.ts
git commit -m "feat(validation): MedRepBench field-level recall scorer + synthetic fixture"
```

---

### Task 13: MedRepBench extractor + loader (`extraction/extractor.ts`, `extraction/medrepbench.ts`, README)

**Files:**
- Create: `validation/extraction/extractor.ts`, `validation/extraction/medrepbench.ts`, `validation/extraction/README.md`
- Test: `validation/extraction/medrepbench.test.ts`

- [ ] **Step 1: Write the failing test** (uses a fake extractor — no key, no images)

```ts
import { describe, it, expect } from 'vitest';
import { runExtractionBenchmark } from './medrepbench';
import { FIXTURE_SAMPLES } from './fixture/samples';
import type { Extractor } from './extractor';

const perfect: Extractor = {
  id: 'perfect-fake',
  async extract(sample) { return sample.gold.map((g) => ({ ...g })); },
};

describe('runExtractionBenchmark', () => {
  it('aggregates field recall across samples with a pluggable extractor', async () => {
    const report = await runExtractionBenchmark(FIXTURE_SAMPLES, perfect);
    expect(report.sampleCount).toBe(FIXTURE_SAMPLES.length);
    expect(report.meanOverallRecall).toBeCloseTo(1, 6);
    expect(report.perField.value).toBeCloseTo(1, 6);
  });

  it('an extractor that drops a row lowers recall', async () => {
    const lossy: Extractor = { id: 'lossy', async extract(s) { return s.gold.slice(0, 1); } };
    const report = await runExtractionBenchmark(FIXTURE_SAMPLES, lossy);
    expect(report.meanOverallRecall).toBeLessThan(1);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Implement**

`validation/extraction/extractor.ts` (interface + key-gated Claude adapter; the adapter re-declares its own minimal schema so `validation/` stays self-contained):

```ts
// Pluggable extractor for the MedRepBench benchmark (validation-rigor cycle).
// The offline/fake path needs no key; the Claude adapter is opt-in and key-gated,
// mirroring baseline/googleAdapter + baseline/unguardedLlmAdapter.
import type { ExtractedField, ExtractionSample } from './types';

export interface Extractor {
  id: string;
  extract(sample: ExtractionSample): Promise<ExtractedField[]>;
}

/**
 * Claude-vision extractor. Reads the image from sample.imagePath and asks the
 * model to transcribe the five fields — EXTRACTION ONLY (no interpretation),
 * matching the app's OCR-only invariant. Requires ANTHROPIC_API_KEY; throws if
 * unset so callers keep it strictly opt-in. Lazy-imports the SDK so the module
 * loads without it.
 */
export function claudeExtractor(): Extractor {
  return {
    id: 'claude-vision',
    async extract(sample: ExtractionSample): Promise<ExtractedField[]> {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error('ANTHROPIC_API_KEY required for the claude-vision extractor');
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const { readFileSync } = await import('node:fs');
      const client = new Anthropic({ apiKey: key });
      const b64 = readFileSync(sample.imagePath).toString('base64');
      const mediaType = sample.imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const msg = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/png' | 'image/jpeg', data: b64 } },
            { type: 'text', text:
              'Transcribe EVERY lab row from this report as JSON: {"rows":[{"name","value","unit","referenceRange","abnormalFlag"}]}. ' +
              'Copy exactly what is printed. Do NOT infer, convert, or interpret. Use "" for any field not printed. Output JSON only.' },
          ],
        }],
      });
      const text = msg.content.find((b) => b.type === 'text');
      const raw = text && 'text' in text ? text.text : '{"rows":[]}';
      const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      return (json.rows ?? []).map((r: Record<string, unknown>) => ({
        name: String(r.name ?? ''), value: String(r.value ?? ''), unit: String(r.unit ?? ''),
        referenceRange: String(r.referenceRange ?? ''), abnormalFlag: String(r.abnormalFlag ?? ''),
      }));
    },
  };
}
```

`validation/extraction/medrepbench.ts` (env-gated loader + aggregating runner):

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fieldRecall } from './fieldRecall';
import type { Extractor } from './extractor';
import type { ExtractionSample } from './types';

const FIELDS = ['name', 'value', 'unit', 'referenceRange', 'abnormalFlag'] as const;

export interface ExtractionReport {
  extractorId: string;
  sampleCount: number;
  meanOverallRecall: number;
  perField: Record<(typeof FIELDS)[number], number>;
}

/**
 * Load samples from MEDREPBENCH_DIR (a directory of {id}.json gold files whose
 * imagePath points at the co-located image). Nothing is committed. Throws a clear
 * error when the env var is unset so this stays strictly opt-in.
 */
export function loadMedRepBench(dir = process.env.MEDREPBENCH_DIR): ExtractionSample[] {
  if (!dir) throw new Error('MEDREPBENCH_DIR is unset — download MedRepBench and point this at the gold dir (see README).');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as ExtractionSample);
}

export async function runExtractionBenchmark(
  samples: ExtractionSample[],
  extractor: Extractor,
): Promise<ExtractionReport> {
  const perField: Record<string, number> = { name: 0, value: 0, unit: 0, referenceRange: 0, abnormalFlag: 0 };
  let overall = 0;
  let scored = 0;
  for (const s of samples) {
    const predicted = await extractor.extract(s);
    const r = fieldRecall(predicted, s.gold);
    if (Number.isNaN(r.overall)) continue;
    overall += r.overall;
    for (const f of FIELDS) perField[f] += r.perField[f];
    scored += 1;
  }
  const div = scored === 0 ? NaN : scored;
  return {
    extractorId: extractor.id,
    sampleCount: samples.length,
    meanOverallRecall: overall / div,
    perField: Object.fromEntries(FIELDS.map((f) => [f, perField[f] / div])) as ExtractionReport['perField'],
  };
}
```

`validation/extraction/README.md`:

```markdown
# MedRepBench extraction benchmark (ready-to-run)

Scores Claude-vision field-level recall (name/value/unit/reference-range/abnormality-flag)
on real de-identified Chinese lab report images — separating OCR error from the
deterministic grounding error. **No images are committed** (MedRepBench is CC BY-NC 4.0:
research/paper use only; keep it out of the product corpus).

## Run
1. Download MedRepBench (arXiv 2508.16674) from HuggingFace.
2. Write one `{id}.json` per image (`{ id, imagePath, gold: [{name,value,unit,referenceRange,abnormalFlag}] }`)
   into a local dir; set `MEDREPBENCH_DIR` to it.
3. `ANTHROPIC_API_KEY=... MEDREPBENCH_DIR=... npx tsx -e "import {loadMedRepBench,runExtractionBenchmark} from './validation/extraction/medrepbench'; import {claudeExtractor} from './validation/extraction/extractor'; runExtractionBenchmark(loadMedRepBench(), claudeExtractor()).then(r=>console.log(r))"`

Best open VLMs score ~77–79% overall field recall on MedRepBench — a proxy for how
much the confirm-the-values gate must catch. The fixture (`fixture/samples.ts`) lets
the scorer + runner run green with no dataset and no key.
```

- [ ] **Step 4: Run it, verify it passes** — `npx vitest run validation/extraction/medrepbench.test.ts` → PASS. `npm test` → green. (No key/images touched — the fake extractor drives it.)

- [ ] **Step 5: Commit**

```bash
git add validation/extraction/extractor.ts validation/extraction/medrepbench.ts validation/extraction/README.md validation/extraction/medrepbench.test.ts
git commit -m "feat(validation): MedRepBench extractor (key-gated) + env-gated loader/runner"
```

---

### Task 14: MIMIC-IV grounding validator (interface + stub) (`grounding-bench/`)

**Files:**
- Create: `validation/grounding-bench/types.ts`, `groundingRecall.ts`, `mimicAdapter.ts`, `fixture/observations.ts`, `README.md`
- Test: `validation/grounding-bench/groundingRecall.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { groundingRecall } from './groundingRecall';
import { FIXTURE_OBSERVATIONS } from './fixture/observations';

describe('groundingRecall', () => {
  it('scores our deterministic classification agreement vs the dataset abnormal flag', () => {
    const r = groundingRecall(FIXTURE_OBSERVATIONS);
    expect(r.scored).toBeGreaterThan(0);
    expect(r.agreement).toBeGreaterThanOrEqual(0);
    expect(r.agreement).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Implement**

`validation/grounding-bench/types.ts`:

```ts
// Real-observation grounding validator (validation-rigor cycle). Validates the
// DETERMINISTIC low/normal/high classification against real reference ranges +
// abnormal flags (MIMIC-IV labevents), image-free — separating grounding error
// from OCR error. Execution deferred (PhysioNet credentialing); scorer lands now.
export interface LabObservation {
  analyteName: string;   // report/source analyte name (mapped to our table by grounding)
  value: string;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
  abnormalFlag: 'normal' | 'abnormal'; // dataset's own flag, collapsed to binary
}
```

`validation/grounding-bench/groundingRecall.ts`:

```ts
import { groundExtraction } from '@/lib/grounding';
import type { LabObservation } from './types';

export interface GroundingRecallResult {
  total: number;
  scored: number;    // observations our table recognized + classified (not abstained/unclassified)
  agreement: number; // fraction where our normal/abnormal matches the dataset flag
}

// Our classification collapses to binary: normal → 'normal'; low/high/critical → 'abnormal'.
function isAbnormal(classification: string): boolean | null {
  if (classification === 'normal') return false;
  if (classification === 'low' || classification === 'high' || classification === 'critical') return true;
  return null; // unclassified/abstained → not scored
}

export function groundingRecall(observations: LabObservation[]): GroundingRecallResult {
  let scored = 0;
  let agree = 0;
  for (const o of observations) {
    const report = groundExtraction(
      { rows: [{ name: o.analyteName, value: o.value, unit: o.unit, printedRange: null, confidence: 'high' }] },
      'unknown',
    );
    const cls = report.rows[0].classification;
    const ours = isAbnormal(cls);
    if (ours === null) continue; // our guard abstained/couldn't classify → not counted here
    scored += 1;
    if (ours === (o.abnormalFlag === 'abnormal')) agree += 1;
  }
  return { total: observations.length, scored, agreement: scored === 0 ? NaN : agree / scored };
}
```

`validation/grounding-bench/fixture/observations.ts`:

```ts
import type { LabObservation } from '../types';
// Synthetic observations (canonical SI units our table recognizes) so the scorer
// lands green with no credentialed data.
export const FIXTURE_OBSERVATIONS: LabObservation[] = [
  { analyteName: '空腹血糖', value: '5.5', unit: 'mmol/L', refLow: 3.9, refHigh: 6.1, abnormalFlag: 'normal' },
  { analyteName: '空腹血糖', value: '9.0', unit: 'mmol/L', refLow: 3.9, refHigh: 6.1, abnormalFlag: 'abnormal' },
  { analyteName: '血红蛋白', value: '90', unit: 'g/L', refLow: 130, refHigh: 175, abnormalFlag: 'abnormal' },
];
```

`validation/grounding-bench/mimicAdapter.ts` (documented stub — no execution):

```ts
// MIMIC-IV adapter — DOCUMENTED STUB (execution deferred).
//
// Access: PhysioNet Credentialed Health Data License + CITI training + DUA
// (weeks of lead time — the long pole). Source tables:
//   - hosp/labevents: itemid, valuenum, valueuom, ref_range_lower, ref_range_upper, flag
//   - hosp/d_labitems: itemid → label, fluid, category (NB: post-hoc LOINC codes are
//     imperfect — do NOT trust them for analyte identity; map via label + our aliases).
// Map each labevents row → LabObservation (collapse `flag` to normal/abnormal), then
// score with groundingRecall(). Keep all MIMIC data OUT of git (env-gated path).
import type { LabObservation } from './types';

export function loadMimicObservations(_dir = process.env.MIMIC_DIR): LabObservation[] {
  throw new Error(
    'MIMIC-IV execution is deferred: complete PhysioNet credentialing + CITI training, ' +
      'export labevents+d_labitems to a local CSV, set MIMIC_DIR, and implement the CSV→LabObservation map. See README.',
  );
}
```

`validation/grounding-bench/README.md`:

```markdown
# MIMIC-IV grounding validator (interface + stub; execution deferred)

Validates the deterministic low/normal/high classification + unit handling against
real reference ranges and abnormal flags, with NO image dependence — cleanly
separating grounding error from OCR error.

**Blocked on external access:** PhysioNet Credentialed Health Data License + CITI
training + a signed DUA (weeks of lead time). Start that now; it is the long pole.
When credentialed: export `hosp/labevents` + `hosp/d_labitems`, map rows to
`LabObservation` (see `mimicAdapter.ts`), set `MIMIC_DIR`, and run `groundingRecall`.
The scorer + synthetic fixture run green today.
```

- [ ] **Step 4: Run it, verify it passes** — `npx vitest run validation/grounding-bench/groundingRecall.test.ts` → PASS. `npm test` → green.

- [ ] **Step 5: Commit**

```bash
git add validation/grounding-bench
git commit -m "feat(validation): MIMIC-IV grounding validator — scorer + fixture + deferred stub"
```

---

## M5 — Report + paper scaffold

### Task 15: Extend the report + add the CheckList release gate (`run.ts`)

**Files:**
- Modify: `validation/run.ts`
- Test: `validation/run.test.ts` (append; or create)

- [ ] **Step 1: Write the failing test**

Append to `validation/run.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { runValidation, renderMarkdown } from './run';
import { CHECKLIST } from './checklist/index';
import { runBehavioralCase } from './checklist/run';

describe('report + checklist gate', () => {
  it('report renders all four metric families + the checklist table', async () => {
    const report = await runValidation();
    const md = renderMarkdown(report);
    expect(md).toContain('Severity-weighted fidelity'); // corpus (real)
    expect(md).toContain('Risk–coverage');              // corpus point + demo curve/AURC
    expect(md).toContain('Calibration');                // ECE demo
    expect(md).toContain('Inter-rater agreement');      // agreement demo
    expect(md).toContain('CheckList behavioral suite');
    expect(report.ours.severityWeightedFidelity).toBeDefined();
    expect(report.ours.coverage.coverage).toBeGreaterThanOrEqual(0);
  });

  it('checklistRegression is false when every behavioral case passes', () => {
    const failed = CHECKLIST.map(runBehavioralCase).filter((r) => !r.pass);
    expect(failed).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — FAIL.

- [ ] **Step 3: Implement**

In `validation/run.ts`:

1. Import the new modules, demos, and CheckList:

```ts
import { severityWeightedFidelity, type SeverityEntry } from './severity';
import { riskCoveragePoint, riskCoverageCurve, aurc, type SelectiveCase, type CoveragePoint } from './coverage';
import { reliabilityBins, expectedCalibrationError } from './calibration';
import { agreementStats } from './agreement';
import { CALIBRATION_DEMO } from './calibration-demo';
import { AGREEMENT_DEMO } from './agreement-demo';
import { CHECKLIST } from './checklist/index';
import { runBehavioralCase, type CaseResult as ChecklistResult } from './checklist/run';
import { renderChecklist } from './checklist/render';
```

2. **Thread the emitted candidate string out of `runOursOnCase`** so severity-weighted fidelity is scored over the *same* string the primary fidelity used (labs → `c.sourceText` as today at line ~62; notes → the joined `emittedText`, `''` when abstained). This keeps the two fidelity numbers consistent and touches **neither** `metrics.ts` nor `CaseResult`. Give `runOursOnCase` a local richer return:

```ts
interface OursRun { result: CaseResult; candidate: string }
// runOursOnCase now returns { result, candidate }, where `candidate` is exactly the
// string passed to countMatchedImmutables for that case (sourceText for labs;
// emittedText for notes, '' when abstained). CaseResult / metrics.ts are untouched.
```

   Then in `runValidation`, split runs from results and build the metric inputs from the real candidate:

```ts
const oursRuns: OursRun[] = cases.map(runOursOnCase);
const oursResults = oursRuns.map((r) => r.result);
const ours = scorePipeline('ours', oursResults, gold);

const severityEntries: SeverityEntry[] = cases.map((c, i) => ({
  case: c, emitted: oursResults[i].emitted, candidate: oursRuns[i].candidate,
}));
const selective: SelectiveCase[] = oursResults.map((r, i) => ({
  emitted: r.emitted,
  // emitted but wrong: dropped ≥1 immutable, or emitted where gold said abstain
  error: r.emitted && (r.matchedImmutables < totalImmutables(cases[i]) || cases[i].shouldAbstain),
}));
ours.severityWeightedFidelity = severityWeightedFidelity(severityEntries);
ours.coverage = riskCoveragePoint(selective);
```

   Declare the two new fields on `PipelineScore`: `severityWeightedFidelity: number` and `coverage: CoveragePoint`. In `scorePipeline`, initialise them (`severityWeightedFidelity: NaN`, `coverage: { coverage: NaN, selectiveRisk: NaN }`) so baselines are well-typed; only OURS overwrites them above.

3. Run the CheckList and add its regression to the report + gate:

```ts
const checklistResults: ChecklistResult[] = CHECKLIST.map(runBehavioralCase);
const checklistRegression = checklistResults.some(
  (r) => !r.pass && (r.testType === 'MFT' || r.testType === 'DIR'), // safety-bearing tests only
);
// Add to the ValidationReport object: checklistResults, checklistRegression.
// Extend the gate: const releaseBlocker =
//   errorAnalysis.some((e) => e.oursMissedHighStakes) || checklistRegression;
```

   (Add `checklistResults: ChecklistResult[]` and `checklistRegression: boolean` to the `ValidationReport` interface.)

4. In `renderMarkdown`, add these sections after the existing Scores table. Two are **real corpus numbers** (severity, risk-coverage point); three are **demonstrations** on the advisory signal / synthetic verdict pairs, clearly labelled as such (they become real when MedRepBench confidences / clinician verdicts land):

```ts
// --- MQM severity-weighted fidelity (corpus, real) ---
lines.push('## Severity-weighted fidelity (MQM, corpus)');
lines.push('');
lines.push(`OURS: ${fmt(report.ours.severityWeightedFidelity)} — a missed Critical immutable ` +
  `(flipped negation / altered dose / substituted drug / dropped high-stakes number) collapses the score.`);
lines.push('');

// --- Risk–coverage: corpus operating point (real) + advisory-signal curve (demonstration) ---
const demoCurve = riskCoverageCurve(CALIBRATION_DEMO.map((c) => ({ score: c.score, error: !c.correct })));
lines.push('## Risk–coverage (selective prediction)');
lines.push('');
lines.push(`OURS operating point (corpus): coverage ${fmt(report.ours.coverage.coverage)}, ` +
  `selective risk ${fmt(report.ours.coverage.selectiveRisk)}. Abstaining lowers risk at the cost of coverage.`);
lines.push(`Advisory-signal curve (demonstration): AURC ${fmt(aurc(demoCurve))} over ${demoCurve.length} points.`);
lines.push('');

// --- Calibration of the advisory confidence signal (demonstration) ---
lines.push('## Calibration of the advisory confidence signal (demonstration)');
lines.push('');
lines.push(`ECE ${fmt(expectedCalibrationError(CALIBRATION_DEMO, 10))} over ${CALIBRATION_DEMO.length} labelled points ` +
  `— the deterministic guard is NOT gated on this signal; this quantifies why (model confidence is miscalibrated).`);
lines.push('');
lines.push('| score bin | mean score | accuracy | n |');
lines.push('| --- | --- | --- | --- |');
for (const b of reliabilityBins(CALIBRATION_DEMO, 5)) {
  if (b.count === 0) continue;
  lines.push(`| ${b.lo.toFixed(1)}–${b.hi.toFixed(1)} | ${fmt(b.meanScore)} | ${fmt(b.accuracy)} | ${b.count} |`);
}
lines.push('');

// --- Inter-rater agreement (demonstration; paradox-resistant) ---
const ag = agreementStats(AGREEMENT_DEMO);
lines.push('## Inter-rater agreement (demonstration; paradox-resistant)');
lines.push('');
lines.push(`raw ${fmt(ag.rawAgreement)}, prevalence ${fmt(ag.prevalence)}, ` +
  `Cohen's κ ${fmt(ag.cohensKappa)}, Gwet's AC1 ${fmt(ag.gwetAC1)}, PABAK ${fmt(ag.pabak)}. ` +
  `On a skewed abstain/normal split κ deflates (the kappa paradox) while AC1/PABAK hold — report all four, never κ alone.`);
lines.push('');

// --- CheckList behavioral suite ---
lines.push(renderChecklist(report.checklistResults));
```

5. In `main()`, keep the non-zero exit on `report.releaseBlocker` (now also true on a CheckList safety regression). Print which cause fired: e.g. `if (report.checklistRegression) console.error('RELEASE BLOCKER: CheckList safety regression');` and the existing high-stakes-recall message.

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run validation/run.test.ts` → PASS. Then `npm run validate` → prints the extended report, exits 0 (assuming no regression). Then `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add validation/run.ts validation/run.test.ts
git commit -m "feat(validation): report renders MQM/risk-coverage/ECE/agreement + CheckList release gate"
```

---

### Task 16: The paper scaffold (`docs/VALIDATION-METHODOLOGY.md`)

**Files:**
- Create: `docs/VALIDATION-METHODOLOGY.md`

- [ ] **Step 1: Write the document** (no test — prose artifact). Include, with the citations gathered during design:

- **Thesis / intro:** comprehension+safety moat; the danger is confident un-grounded interpretation, not bad translation (npj Digital Medicine red-team ≤80% needing review; JMIR 2024 lab-question study).
- **Related work / instruments:** Khoong 2019 (JAMA IM) two-level meaning+harm (Chinese 81.7% meaning retention, 8% potential life-threatening — moat matters most in this pair); Taira 2021 (JGIM) validated 5-scale instrument; Flores 2012 error taxonomy (omission/substitution/addition ↔ our immutables); MQM (exponential severity); Ribeiro 2020 CheckList (MFT/INV/DIR); selective prediction / risk-controlled OCR (arXiv 2603.19790); the kappa paradox (Zec 2017, Gwet AC1, PABAK).
- **Methods:** the formal definitions implemented in `severity.ts` / `calibration.ts` / `coverage.ts` / `agreement.ts`, the CheckList taxonomy, and the datasets/licensing (MedRepBench CC BY-NC; MIMIC-IV PhysioNet).
- **Results (living):** point to `validation/report.md` as the auto-generated numbers.
- **Known gaps the CheckList surfaced (a feature, not an omission):** (1) the guard **flags** a negation-polarity flip (`未见积液`→"effusion present") but does not blank it — a candidate to escalate R7 from flag→abstain; (2) the guard has **no medication-instruction imperative-reversal rule** — a hold→continue flip (`暂停服用降压药`→"keep taking it", Khoong's flagship life-threatening failure) currently renders clean; recommend a future **R7b** rule. Both are named here as motivating targets for the harden-extraction cycle. Note also that mg/dL↔mmol/L for the curated analytes is a *safe auto-conversion* success case, not a failure.
- **Limitations:** the synthetic-corpus caveat stated plainly; CONSORT-pilot framing (a 30–50-report study estimates precision ~±0.10 on an ~80% metric, cannot detect small between-system differences); deliberate enrichment of rare cells reported transparently; ECE / risk-coverage-curve / agreement are demonstrated on synthetic fixtures this cycle (real inputs land with MedRepBench + clinician verdicts).

- [ ] **Step 2: Commit**

```bash
git add docs/VALIDATION-METHODOLOGY.md
git commit -m "docs: validation methodology / paper scaffold with cited instruments"
```

---

## Self-review checklist (run after implementing)

- [ ] `npm test` fully green (≥ 210 + all new tests).
- [ ] `npm run validate` runs offline, prints MQM + risk-coverage + Calibration + Agreement + CheckList sections, exits 0.
- [ ] No file under `app/`, `lib/`, or `data/` was modified (`git diff --name-only main -- app lib data` is empty). The only `validation/`-internal modification beyond new files is the additive `AbstainReasonSchema` enum entry (Task 10) and the additive `PipelineScore` / `ValidationReport` fields + `runOursOnCase` return shape (Task 15); `metrics.ts`, `score.ts`'s existing exports, `CaseResult`, and `GoldCase` are unchanged.
- [ ] No real PHI, no MedRepBench images, no MIMIC data committed — the `fixture/` dirs are synthetic and intended to commit; real-data dirs are env-gated (`MEDREPBENCH_DIR`, `MIMIC_DIR`) and never staged.
- [ ] Type names consistent across tasks: `Verdict`, `BehavioralCase`, `CaseResult` (checklist), `SeverityEntry`, `ScoredCase`, `SelectiveCase`, `ScoredSelectiveCase`, `CoveragePoint`, `OursRun`, `BooleanVerdictPair`, `LabObservation`, `ExtractionSample`, `ExtractedField`.
- [ ] Every DIR/MFT CheckList case's expected verdict and every enriched corpus case's `shouldAbstain` matches REAL guard behavior (all probe-verified while authoring; re-confirmed by the green suite + `npm run validate` gate) — the guard was never changed to satisfy a case. The imperative-flip family is **excluded** and documented as a known gap (Task 16), not force-fitted.

## Execution handoff

Plan complete. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.
2. **Inline Execution** — execute tasks in this session with checkpoints.

Milestones are independently green; M1 (metrics) and M2 (CheckList) are the highest-leverage and have zero external dependencies.
