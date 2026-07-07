---
type: project
title: "Health Translator — Validation Rigor Design (\"Prove the Number\")"
created: 2026-07-07
updated: 2026-07-07
status: approved
owner: agent
source: "superpowers:brainstorming, 2026-07-07; grounded in a 6-agent deep-research pass (validation methodology, competitive landscape, OCR robustness, regulatory posture, comprehension features). Builds on docs/DESIGN.md, docs/V1-EXPANSION.md, and the completed v1 harness (validation/)."
---

# Health Translator — Validation Rigor Design ("Prove the Number")

> **Status:** Design approved by Kerun (2026-07-07). Next: `writing-plans` turns this into a milestone-structured, commit-by-commit implementation plan. **This cycle changes nothing in `app/`, `lib/`, or `data/`** — it is *measurement machinery only*, added under `validation/` (and one methodology doc under `docs/`). The deterministic safety core is not touched.

## 1. Purpose & context

The system is mature: v0 (labs) and v1 (doctor-notes translation with the R7–R9 fidelity guard, 80+ analyte reference table, unit auto-conversion) ship, 210 tests green. The v1 **validation harness** already exists — it measures medical-term fidelity + abstention precision/recall of OUR guarded pipeline against pluggable MT baselines (offline / Google / unguarded-LLM), with a clinician-review export/import loop and a high-stakes release gate.

**The one thing holding the system back is not a missing feature — it is that the validation corpus is entirely synthetic.** That is the #1 credibility blocker for *both* real users and paper reviewers. This cycle makes the validation *methodologically defensible and auditable*, and stands up *ready-to-run* adapters for real **public** datasets (no PHI, no waiting for 30–50 de-identified reports), so the eventual numbers are credible and the frontier technique — a deterministic safety guard over an OCR-only LLM, presented as a **calibrated abstention gate** — is provable.

This directly serves the three stated goals: **real users at scale** (retires the synthetic-only limitation), **a frontier technique that wows** (a calibrated abstention gate no competitor ships), and **a paper-shaped scientific contribution** (using validated instruments that make the methodology *stronger* than the landmark MT-safety papers).

### 1.1 The load-bearing invariant (unchanged, and this cycle depends on it)

*The LLM never decides clinical meaning.* Everything that assigns meaning is deterministic TypeScript grounded in the curated reference table. This cycle does not relax that in any way — it **measures** it. A key consequence, confirmed by research: the confirm/abstain gate must **never** rely on the model's self-reported confidence or token log-probabilities (both are miscalibrated — logprob-mean scored only 0.705 ROC AUC on a 55-field extraction benchmark; RLHF makes verbalized confidence systematically overconfident). The metrics below are built to expose exactly this.

## 2. Scope (resolved decisions)

| Decision | Choice |
|---|---|
| Direction | **"Prove the number"** — validation rigor + the paper-shaped contribution (chosen over harden-extraction / deepen-comprehension / de-risk-for-scale). |
| Cycle ambition | **"Machinery first"** — build the rigorous validation machinery to completion (pure, deterministic, TDD'd, zero external blockers), *including* a ready-to-run MedRepBench extraction harness and a MIMIC-IV grounding-validator interface. **Executing** the real benchmarks (needs dataset access + API key + spend + weeks-long PhysioNet credentialing) is out of scope — the harness lands one command away. |
| CheckList form | **Data-driven, scored, rendered** behavioral suite (not opaque unit tests), so R1–R12/notesGuard become an enumerable artifact a clinician-reviewer inspects line-by-line — *and* it doubles as regression tests. |
| Corpus | Extend the existing synthetic corpus with **adversarial, deliberately-enriched** trap cases (unit-ambiguity, unknown-analyte, negation/imperative flips), reported transparently as enriched (not natural-prevalence). |
| Real data | **Public, PHI-free** only: MedRepBench (Chinese lab images) + MIMIC-IV (real ranges/flags). Adapters land; execution deferred. |

**Out of scope for this cycle (explicitly):** any change to `app/`, `lib/`, or `data/`; the **R13 physiological-bounds guard rule** and every other product/UI change (those belong to the *harden-extraction* and *deepen-comprehension* directions); actually running MedRepBench/MIMIC; the human teach-back / PEMAT comprehension study; automated health-literacy scoring of templates; any regulatory-wording change to templates.

## 3. Cross-cutting invariants (gate every task)

1. **`validation/` is never imported by `app/` or `lib/`.** It runs only under Vitest and `npm run validate` (tsx). This cycle preserves that boundary absolutely.
2. **No behavior change to the guarded pipeline.** The CheckList and benchmarks *observe* `groundExtraction` / `groundNotes` / `classify` through their existing public interfaces; they never modify them. The 210 existing tests stay green untouched.
3. **Every new module is built test-first** (co-located `*.test.ts`), like the existing harness.
4. **No real PHI, ever committed.** MedRepBench images (CC BY-NC) and any MIMIC data stay out of git; adapters read from env-gated local paths. Synthetic fixtures (2–3 fabricated samples) let every scorer land green *without* the real datasets or an API key.
5. **`npm run validate` still runs fully offline by default and still exits non-zero** if OURS misses any high-stakes gold-abstain case (the release gate is preserved and extended, never weakened).
6. **Deterministic metrics only** — every number is reproducible from the corpus with no LLM in the loop (the real-data adapters are the only key-gated, opt-in parts, exactly like the existing google/unguarded-llm baselines).

## 4. Architecture — additive, follows the existing flat layout

Nothing is rewritten. New sibling modules under `validation/`, plus one methodology doc. The existing `metrics.ts`, `score.ts`, `run.ts`, `corpus/`, `baseline/`, `review/` are extended or consumed, not replaced.

```
validation/
  metrics.ts               # UNCHANGED — the original three metrics stay exactly as-is
  severity.ts              # CREATE — MQM severity-weighted fidelity
  calibration.ts           # CREATE — Expected Calibration Error + reliability bins
  coverage.ts              # CREATE — risk–coverage operating point + curve + AURC
  agreement.ts             # CREATE — raw agreement, Cohen's κ, Gwet's AC1, PABAK, prevalence
  severity.test.ts / calibration.test.ts / coverage.test.ts / agreement.test.ts   # CREATE
  checklist/
    types.ts               # CREATE — BehavioralCase (MFT | INV | DIR) schema
    run.ts                 # CREATE — execute a BehavioralCase against the REAL guard entry points
    render.ts              # CREATE — render pass/fail table for the report
    cases/
      unknown-analyte.mft.ts     # MFT: unknown analyte → abstain
      unit-mismatch.dir.ts       # DIR: mg/dL↔mmol/L swap → abstain
      ocr-noise.inv.ts           # INV: whitespace/synonym/confusable-digit perturbations must NOT change the call
      negation-flip.dir.ts       # DIR: dropped/flipped negation → flag/abstain
      dose-drug.dir.ts           # DIR: altered dose / substituted drug → flag/abstain
    index.ts               # CREATE — schema-validated aggregate (mirrors corpus/index.ts)
    *.test.ts              # CREATE — every behavioral case must pass (regression)
  corpus/
    unit-trap.case.ts      # CREATE — mg/dL↔mmol/L ambiguity across high-stakes analytes
    unknown-analyte.case.ts# CREATE — off-table analytes → gold-abstain
    imperative-flip.case.ts# CREATE — Khoong-style "hold the medicine"→"keep taking it"
    index.ts               # MODIFY — spread the new case files into RAW_CASES
  extraction/              # CREATE — MedRepBench OCR-extraction benchmark (ready-to-run)
    types.ts               # ExtractionSample + gold rows (name/value/unit/range/flag)
    fieldRecall.ts         # field-level recall scorer (MedRepBench metric)
    extractor.ts           # Extractor interface + key-gated Claude-vision adapter
    medrepbench.ts         # env-gated loader (MEDREPBENCH_DIR) + runExtractionBenchmark()
    fixture/               # 2–3 synthetic samples so scorer lands green with no dataset/key
    README.md              # how to obtain MedRepBench + run
    *.test.ts
  grounding-bench/         # CREATE — MIMIC-IV grounding validator (interface + scorer; exec deferred)
    types.ts               # LabObservation (analyte/value/unit/refLow/refHigh/abnormalFlag)
    groundingRecall.ts     # scores our deterministic low/normal/high + unit-conversion vs real flags
    mimicAdapter.ts        # STUB — documents PhysioNet/CITI + labevents/d_labitems columns
    fixture/               # synthetic observations
    README.md
    *.test.ts
  run.ts                   # MODIFY — renderMarkdown emits the new metric sections + CheckList table
docs/superpowers/specs/
  2026-07-07-validation-rigor-design.md   # this file
docs/
  VALIDATION-METHODOLOGY.md  # CREATE — the paper scaffold (intro, related work, formal metric defs, limitations, refs)
```

## 5. The metric families (formal definitions)

All operate over the existing `CaseResult` / `GoldCase` contracts (from `metrics.ts`) plus small, additive per-case fields. The original three metrics are unchanged.

### 5.1 MQM severity-weighted fidelity (`severity.ts`)

The published MT gold standard (WMT metrics tasks) is **MQM**, which weights errors by severity with intentionally exponential penalties. We apply it to immutable survival: a missed immutable is an *error* weighted by its severity.

- **Severity by immutable category** (a policy table, overridable per case): negation-polarity, dosage, drug-name, and number-magnitude → **Critical (weight 25)**; unit → **Major (5)**; stylistic/other → **Minor (1)**.
- **Per emitted case**, penalty `P = Σ over missed immutables of weight(category)`; max penalty `Pmax = Σ over all immutables of weight(category)`.
- **Severity-weighted fidelity** `= 1 − (Σ P over emitted cases) / (Σ Pmax over emitted cases)`; excludes cases with `Pmax = 0`; returns `NaN` (→ "N/A") when the denominator is empty, exactly like the existing fidelity.
- Consequence: **one missed Critical (a flipped negation, an altered dose) collapses the score**, while stylistic awkwardness barely moves it — the headline number reflects clinical risk.
- Reuses `countMatchedImmutables` / `score.ts` for *which* immutables survived; `severity.ts` only adds the weighting. Reported **alongside** the flat term-weighted fidelity, not instead of it.

*Grounding:* MQM scoring models (themqm.org); the WMT-since-2021 gold standard.

### 5.2 Expected Calibration Error + reliability bins (`calibration.ts`)

Answers: *when the pipeline is "confident," is it actually right?* — a standard, reviewer-recognized framing.

- Input: a set of `(score ∈ [0,1], correct ∈ {0,1})`. The `score` is a confidence signal — **the extraction-confidence ordinal** (`low→0.3, medium→0.6, high→0.9`) or, later, real MedRepBench per-field confidence. `correct` is whether the associated decision was right.
- `reliabilityBins(cases, nBins)` → per-bin `{ lo, hi, meanScore, accuracy, count }`.
- `expectedCalibrationError(cases, nBins)` `= Σ (binCount / N) · |accuracy − meanScore|`.
- Renders as a reliability table in the report. Explicitly framed: this calibrates the **advisory** confidence signal — never the deterministic gate — and demonstrates *why* we do not gate on it.

*Grounding:* ECE + reliability diagrams (standard); the selective-prediction literature (Geifman & El-Yaniv 2017).

### 5.3 Risk–coverage + AURC (`coverage.ts`)

Frames the abstention guard as **principled selective prediction**: abstaining lowers selective risk at the cost of coverage.

- `riskCoveragePoint(results, gold)` → the deterministic guard's single operating point: `coverage = |emitted| / N`; `selectiveRisk = (fidelity-error on the emitted set)` (a case counts as an error when an emitted case dropped ≥1 Critical immutable, or emitted where gold said abstain).
- `riskCoverageCurve(scoredCases)` → sorts by a tunable confidence score, sweeps the abstain threshold, yields `[{coverage, risk}]`, and computes **AURC** (area under the risk-coverage curve; lower is better). Demonstrated on the extraction-confidence score; ready for a real per-field score later.
- Report shows the current guard as a labeled point on the coverage axis, plus the curve for the tunable signal.

*Grounding:* risk-coverage / AURC from classification-with-rejection; "From Plausibility to Verifiability: Risk-Controlled Generative OCR" (arXiv 2603.19790).

### 5.4 Inter-rater agreement, paradox-resistant (`agreement.ts`)

For the clinician gold: report agreement **correctly** on a skewed distribution where abstain/critical cases are rare.

- `confusion(a, b)` over two labelers' boolean verdicts (e.g. `shouldAbstain`), then: `rawAgreement`, `prevalence`, `cohensKappa`, **`gwetAC1`**, **`pabak`**.
- The report prints **AC1 + PABAK + raw agreement + prevalence** together and states the kappa-paradox in a note — κ collapses on rare-category skew even at high raw agreement, so κ alone would look artificially poor. Reporting AC1/PABAK is a cheap way to be *methodologically stronger than Khoong 2019 / Taira 2021, which reported no inter-rater reliability at all.*
- Wired to `validation/review/` verdict pairs (two reviewers' imported verdicts); lands with synthetic verdict fixtures.

*Grounding:* Zec et al. 2017 (the kappa paradox); Gwet's AC1; PABAK.

## 6. The CheckList behavioral suite (`validation/checklist/`)

Recast R1–R12 + notesGuard as an enumerable **behavioral-testing** artifact (Ribeiro et al., ACL 2020 — MFT/INV/DIR), executed against the *real* guard so it is simultaneously (a) a re-runnable regression suite and (b) the auditable safety artifact a clinician-reviewer reads line-by-line.

- **`BehavioralCase`** = `{ id, capability (e.g. 'R1-unknown-analyte'), testType, kind: 'labs'|'notes', input, expect }`:
  - **MFT** (minimum functionality): a single input → a required `action` (`abstain` | `flag` | `render`). E.g. unknown analyte → `abstain`; unit mismatch → `abstain`.
  - **INV** (invariance): a base input + a list of **label-preserving perturbations** (extra whitespace, analyte synonym/alias, a confusable-digit swap that a human reads identically, benign OCR noise) that must **not** change the low/normal/high call.
  - **DIR** (directional): a base input + a transform that **must** change the action a specific way (mg/dL↔mmol/L swap → `abstain`; drop/flip a negation → `flag`/`abstain`; alter a dose / substitute a drug → `flag`/`abstain`).
- **`run.ts`** executes each case through `groundExtraction` (labs) / `groundNotes` (notes) — the exact entry points the runner already uses — and returns `{ id, capability, testType, expected, actual, pass, ruleFired }`.
- **`render.ts`** emits a Markdown table for the report; **`checklist.test.ts`** asserts every case passes (a failure is a real regression).
- Enriched deliberately with adversarial cases; enrichment is stated in the artifact so results are never mistaken for natural-prevalence performance.

## 7. Real-data adapters (land green without data or a key)

Both mirror the existing key-gated baseline-adapter pattern: an offline/synthetic default that lands fully tested, plus an opt-in real path.

### 7.1 MedRepBench extraction benchmark (`validation/extraction/`)

Separates **OCR error** from **grounding error** — the current harness conflates them.

- `ExtractionSample` = `{ id, imagePath, gold: Array<{ name, value, unit, referenceRange, abnormalFlag }> }` — MedRepBench's exact five fields.
- `fieldRecall(predicted, gold)` → per-field recall (name/value/unit/range/flag) + overall, matching MedRepBench's metric; deterministic, unit-tested on the synthetic fixture.
- `Extractor` interface + a **key-gated Claude-vision adapter** (`claude-opus-4-8`, base64 image block, structured output — reusing the app's extraction schema shape but *inside `validation/`*, not importing app internals in a way that breaks the boundary — the adapter re-declares its own minimal schema).
- `medrepbench.ts` loads samples from `process.env.MEDREPBENCH_DIR` (nothing committed) and runs `runExtractionBenchmark(samples, extractor)`.
- README: obtain MedRepBench (HuggingFace, CC BY-NC 4.0 — research/paper use only, kept out of the product), run one command.

*Grounding:* MedRepBench (arXiv 2508.16674): 1,925 de-identified Chinese lab/exam images, best open VLMs ~77–79% field recall — a near-exact proxy quantifying how much the confirm-gate must catch.

### 7.2 MIMIC-IV grounding validator (`validation/grounding-bench/`)

Validates the **deterministic** grounding/classification/unit-conversion on real numeric distributions, image-free.

- `LabObservation` = `{ analyteName, value, unit, refLow, refHigh, abnormalFlag }`.
- `groundingRecall(observations)` runs our `groundExtraction`/`classify` and checks our low/normal/high against the dataset's abnormal flag, plus unit-conversion correctness on real messy units.
- `mimicAdapter.ts` is a **documented stub**: PhysioNet Credentialed Health Data License + CITI training (the weeks-long external dependency), and the `labevents` / `d_labitems` columns to map (with the caveat that MIMIC's post-hoc LOINC codes are imperfect and not to be trusted for identity).
- Lands with a synthetic-observation fixture so the scorer is tested now; real execution deferred.

*Grounding:* MIMIC-IV `labevents` ships real `ref_range_lower/upper` + abnormal flags (PhysioNet).

## 8. The paper scaffold (`docs/VALIDATION-METHODOLOGY.md`)

A durable methodology document the auto-generated `report.md` numbers slot into:

- **Intro / thesis:** the comprehension-and-safety moat; the danger is confident un-grounded interpretation, not bad translation (npj Digital Medicine red-team; JMIR 2024 lab-question study).
- **Related work / instruments:** Khoong 2019 (JAMA IM) meaning+harm two-level scheme (Chinese: 81.7% meaning retention, 8% potential life-threatening errors — the moat matters most in *this* pair); Taira 2021 (JGIM) validated 5-scale instrument; Flores 2012 error taxonomy (omission/substitution/addition maps 1:1 onto our immutables); MQM; Ribeiro 2020 CheckList; selective prediction; the kappa paradox (Zec 2017).
- **Methods:** formal definitions from §5–§6 (severity-weighted fidelity, ECE, risk-coverage/AURC, AC1/PABAK, the CheckList taxonomy) and the datasets/licensing from §7.
- **Limitations:** the synthetic-corpus caveat stated plainly; CONSORT-pilot framing (a 30–50-report study estimates precision, ~±0.10 on an ~80% metric, and cannot detect small between-system differences); deliberate enrichment of rare cells.

## 9. Testing & the release gate

- Every new module is TDD'd with a co-located `*.test.ts`; the full suite stays green (currently 210) and grows.
- `npm run validate` continues to run fully offline by default, now also printing the severity-weighted fidelity, ECE/reliability, risk-coverage + AURC, agreement stats (when verdict pairs exist), and the CheckList table.
- The **high-stakes release gate is preserved and strengthened**: the run still exits non-zero on any missed high-stakes gold-abstain case, and additionally on any **CheckList regression** (an MFT/DIR safety case that fails).

## 10. Milestone shape (for writing-plans)

- **M1 — Metric families:** `severity.ts`, `calibration.ts`, `coverage.ts`, `agreement.ts` (each test-first).
- **M2 — CheckList suite:** `checklist/` types + run + render + the five case families + tests.
- **M3 — Adversarial corpus enrichment:** the three new `corpus/*.case.ts` + `index.ts` wiring.
- **M4 — Real-data adapters:** `extraction/` (MedRepBench, ready-to-run) + `grounding-bench/` (MIMIC interface/stub).
- **M5 — Report + paper scaffold:** extend `run.ts` `renderMarkdown`; add the CheckList regression to the release gate; write `docs/VALIDATION-METHODOLOGY.md`.

Each milestone is independently green and leaves `npm run validate` runnable. M1 and M2 are the highest-leverage and have zero external dependencies; M4 is where the "ready-to-run" adapters land.

## 11. What this explicitly does NOT do

- No edits to `app/`, `lib/`, or `data/` — no new guard rule (R13 and physiological bounds are a *separate* harden-extraction cycle), no template wording change, no UI.
- No execution of the real benchmarks (no dataset download committed, no API spend, no PhysioNet credentialing) — those are one command / one process away, by design.
- No human-subjects comprehension study, no health-literacy template scoring, no regulatory-doc changes — those belong to other approved directions and can be sequenced next.
