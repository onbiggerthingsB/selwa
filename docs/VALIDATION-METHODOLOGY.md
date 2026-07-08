# Health Translator — Validation Methodology

> The paper-shaped artifact behind the numbers. The living results are auto-generated
> into [`validation/report.md`](../validation/report.md) by `npm run validate`; this
> document is the fixed methodology, instruments, and limitations those numbers slot into.
> All corpus cases are synthetic/public-style — **no real PHI**.

## 1. Thesis

Health Translator is a safety-guarded medical-**comprehension** tool, not a translator. The
danger it addresses is not bad translation but **confident, un-grounded interpretation**:
frontier LLMs answer patient lab questions fluently while lacking context, references, and any
uncertainty signal (JMIR 2024, e56655, found even GPT-4 lab answers "suffered from lack of
interpretation in one's medical context, incorrect statements, and lack of references"; an npj
Digital Medicine red-team found up to ~80% of frontier-LLM medical outputs required
professional review). Our architecture removes that surface: **the LLM does OCR/extraction
only; all clinical meaning is deterministic**, grounded in a curated reference table, and the
guard **abstains** on anything it cannot ground. This document specifies how we *measure* that.

## 2. Related work & instruments (what we reuse rather than invent)

- **Khoong et al., JAMA Intern Med 2019** — the canonical patient-facing medical-MT scheme:
  score each sentence for meaning-preserved, then sub-classify inaccurate ones by potential
  clinical harm. Chinese (our pair) was the harder, more dangerous case: 81% accurate vs 92%
  Spanish, with a meaningful fraction of **potentially life-threatening** errors; the flagship
  failure was an imperative flip ("hold the medicine" → "keep taking it").
- **Taira et al., JGIM 2021 (PMC8606479)** — a validated 5-point instrument (fluency /
  adequacy / meaning / severity + a dichotomous "intent retained"), 82.5% overall / 81.7%
  Chinese. We adopt this as the clinician-gold instrument for real data. Notably, **neither
  Khoong nor Taira reported inter-rater reliability** — see §3.4.
- **Flores et al., Ann Emerg Med 2012 (22424655)** — the medical-interpreting error taxonomy
  (omission 52%, false fluency 16%, substitution 13%, editorialization 10%, addition 8%; 63%
  clinically consequential). This maps 1:1 onto our immutables (omission = dropped
  negation/clause, substitution = drug swap, addition = hallucination) and grounds the guard's
  design in clinical evidence.
- **MQM** (themqm.org; the WMT metrics-task gold standard) — severity-weighted error scoring
  with exponential penalties (Critical/Major/Minor). We apply it to immutable survival (§3.1).
- **Ribeiro et al., ACL 2020 — CheckList** — behavioral testing (MFT/INV/DIR) that makes a
  robustness claim auditable rather than aggregate. Our R1–R12 + notesGuard suite is a
  CheckList (§3.5).
- **Selective prediction / risk-controlled OCR** (Geifman & El-Yaniv 2017; "From Plausibility
  to Verifiability", arXiv 2603.19790) — frames the abstention gate as coverage-vs-risk (§3.2).
- **The kappa paradox** (Zec et al. 2017, PMC5712640; Gwet's AC1; PABAK) — why we never report
  Cohen's κ alone on our skewed abstain/normal distribution (§3.4).

## 3. Metrics (formal definitions; implemented under `validation/`)

### 3.1 Severity-weighted fidelity (MQM) — `severity.ts`
Each immutable that fails to survive is an error weighted by category: negation / dosage /
drug = **Critical (25)**; a number is **Critical (25)** in a high-stakes case, else **Major
(5)**. Per emitted case, incurred penalty `P = Σ weight(missed)`, max `Pmax = Σ weight(all)`;
the score is `1 − ΣP/ΣPmax` over emitted cases with `Pmax > 0` (NaN when the denominator is
empty). A single flipped negation or altered dose collapses the score; stylistic drift barely
moves it. Reported **alongside** the flat term-weighted fidelity, never instead of it.

### 3.2 Risk–coverage & AURC — `coverage.ts`
The guard is a selective predictor. **Operating point:** coverage = emitted/N; selective risk
= errors/emitted (an emitted case is an error if it dropped ≥1 immutable or emitted where gold
said abstain). **Curve + AURC:** sweeping a tunable confidence threshold in descending order
yields the coverage-vs-risk trade-off; lower AURC is better. The operating point is a real
corpus number; the curve is demonstrated on the advisory signal until real per-field
confidences exist.

### 3.3 Calibration (ECE) — `calibration.ts`
`ECE = Σ (binCount/N)·|accuracy − meanScore|` over equal-width score bins, with a reliability
table. This calibrates the **advisory** extraction-confidence signal only — it quantifies *why
the deterministic guard is never gated on model-reported confidence* (token log-probs scored
only ~0.705 AUC on a 55-field extraction benchmark; RLHF makes verbalized confidence
overconfident).

### 3.4 Inter-rater agreement — `agreement.ts`
For the clinician gold we report **raw agreement + prevalence + Cohen's κ + Gwet's AC1 +
PABAK** together. On our skewed distribution (abstain/critical cases are rare) κ collapses even
at high raw agreement — the kappa paradox — so AC1/PABAK are the honest coefficients. Because
the landmark MT-safety papers reported *no* IRR at all, doing this makes our methodology
stronger than the work we are compared against.

### 3.5 CheckList behavioral suite — `checklist/`
R1–R12 + notesGuard executed against the **real** guard as MFT (unknown analyte → abstain;
benign in-range → render; high-stakes → flag), INV (whitespace/alias/case must not change the
verdict or classification), and DIR (uncurated unit → abstain; flipped negation → flag; dose
≥2× change or drug substitution → abstain). Every verdict is probe-verified; the suite doubles
as a re-runnable regression gate — a failing MFT/DIR case **blocks release**.

## 4. Datasets

- **Corpus** (`validation/corpus/`) — synthetic/public-style, **deliberately enriched** with
  adversarial traps (uncurated-unit, unknown-analyte, negation/dose/drug flips) and reported as
  enriched, not natural-prevalence.
- **MedRepBench** (arXiv 2508.16674; `validation/extraction/`) — 1,925 de-identified Chinese
  lab/exam report **images** scored on our exact five fields; separates OCR error from grounding
  error. CC BY-NC 4.0: research/paper use only, kept out of the product. Best open VLMs reach
  only ~77–79% field recall — a proxy for how much the confirm-the-values gate must catch.
  Adapter is ready-to-run (key-gated); execution deferred.
- **MIMIC-IV** (`validation/grounding-bench/`) — real reference ranges + abnormal flags to
  validate the deterministic classification image-free. Blocked on PhysioNet credentialing +
  CITI training; scorer + fixture land now, execution deferred.

## 5. Known gaps the CheckList surfaced (a feature, not an omission)

1. **Negation polarity is flagged, not blanked.** A flipped source negation
   (`未见积液` → "effusion is present") yields `flag` — the guard shows the wrong translation
   with a caution rather than abstaining. Candidate hardening: escalate R7 polarity mismatch
   from flag → abstain.
2. **No imperative-reversal rule.** A medication hold→continue flip
   (`暂停服用降压药` → "keep taking it") — Khoong's flagship *life-threatening* failure —
   currently renders clean. This is the strongest motivating case for a future **R7b**
   (imperative-polarity) rule in the harden-extraction cycle. It is deliberately excluded from
   the release-gated corpus (the guard would miss it and block the gate permanently).
3. mg/dL↔mmol/L for the curated analytes is a **safe auto-conversion success case**, not a
   failure — the trap is a genuinely *uncurated* unit (urea/BUN, calcium, wrong-dimension).

## 6. Limitations

- **Corpus is synthetic.** The real-data adapters (MedRepBench, MIMIC-IV) are built and
  ready-to-run, but no real de-identified reports have been scored yet. The numbers here measure
  guard *behavior*, not clinical outcomes.
- **Pilot framing.** A future 30–50-report study is, per CONSORT-pilot (Eldridge et al., BMJ
  2016), a feasibility + precision study: it can estimate an ~80% metric to about ±0.10 and
  **cannot** reliably detect small between-system differences. Rare cells (critical/abstain) are
  deliberately enriched, which must be reported as such.
- **Demonstration metrics.** ECE, the risk-coverage curve/AURC, and inter-rater agreement are
  currently computed on synthetic fixtures; they become real when MedRepBench per-field
  confidences and clinician-verdict pairs land.
