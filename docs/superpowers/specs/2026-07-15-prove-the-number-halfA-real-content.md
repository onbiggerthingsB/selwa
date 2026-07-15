---
type: project
title: "Prove the Number — Half A: grounding on REAL content (first non-self-referential measurement)"
created: 2026-07-15
status: measured
owner: agent
source: "validation/real-corpus/ — public MedRepBench sample fed through the shipped deterministic pipeline"
---

# Prove the Number — Half A: the guard on real report content

**First measurement of the deterministic pipeline against externally-authored data.** Every
prior green signal (316 tests, CheckList 13/13, release-gate recall 1.0, confirm-burden 2/2)
was graded against a corpus we authored and tuned the guard against — self-referential. This
feeds **real** rows from the public MedRepBench dataset (de-identified Chinese lab-report
images with author-provided gold field annotations) straight through `groundExtraction →
classify → guard`. Image-free, no API. Harness: `validation/real-corpus/` — run
`npx tsx validation/real-corpus/run.ts`.

## The numbers (11 real reports, 73 analyte rows, diverse panels)

| metric | value | reading |
|---|---|---|
| recognized by our 89-analyte table | **21 / 73 (28.8%)** | most real rows never map |
| **ABSTAIN-RATE** | **87.7%** (64/73) | on a real report the app is nearly silent |
| **CONFIRM-RATE** | **22.2%** (2/9 interpreted) | NOT confirm-fatigue |
| **AGREEMENT** | **100%** (9/9 scorable) | when we speak, we're right (small n) |

Abstain breakdown: **52 R1-unknown-analyte · 8 R2-unit-mismatch · 4 non-numeric.**

## What this actually says (the reframe)

The five hardening cycles (H0–H4) predicted the risk was the guard being *wrong* or
*over-confirming*. Real data says the opposite:

1. **Safety is intact.** 9/9 agreement with the lab's own flags — including Fib *low* (1.51,
   range 2–4) and WBC *high* (12.9, range 4.9–12.7). Confirm-rate 22%, sane.
2. **The failure mode is COVERAGE, not alarm.** ~7 of 8 real rows are withheld.
3. **The dominant cause is recoverable RECOGNITION, not guard logic.** Diagnosed by probe:
   - **Name-matching is brittle.** `血红蛋白` classifies; the source's OCR typo `红蛋白`
     (missing 血) AND the legitimate synonym `血红蛋白浓度` both fall to R1-unknown.
   - **Unit gaps.** `红细胞压积 39 %` (HCT as %) and `肌钙蛋白I 0.00 ng/ml` (troponin) abstain
     on R2 — real, common units (troponin ng/ml = µg/L; HCT % vs L/L).
   - Genuinely out-of-scope panels (allergen microarrays, heavy metals, cytology free-text,
     qualitative urine dipstick) **correctly** abstain — the moat working as designed.

**More guard hardening (a 6th cycle) would not move any of these numbers.** The leverage is
recognition coverage: OCR-noise-tolerant + synonym-aware name-matching, and a wider unit
table with conversions. That turns "abstain on nearly everything" into "abstain only on the
genuinely un-interpretable" — without touching the safety core that just scored 9/9.

## Caveats (honesty)

- Convenience sample of the first ~24 dataset rows, transcribed VERBATIM via WebFetch (sandbox
  blocks curl) — may carry minor transcription noise; a rigorous rerun downloads the CSV.
- Deliberately diverse (I included allergen/serology/urine/cytology panels), so 87.7% is the
  abstain-rate on *mixed* real reports; on a routine-chemistry/CBC-only slice the recoverable
  name/unit misses dominate and the achievable rate is far lower.
- Agreement n=9 is small — directional, not a headline. The abstain-rate is the robust number.
- `is_abnormal` is each report's OWN flag (vs its printed range), so agreement partly measures
  whether our reference bands match the lab's.

## Next (only if pursued — not another hardening cycle)

Coverage work, measured against THIS harness as the gate (watch the abstain-rate fall without
the agreement/confirm numbers degrading): (1) synonym + OCR-tolerant name normalization;
(2) expand the unit whitelist + conversions for real CBC/chemistry units; (3) grow the
reference table toward the common real-report analytes. Then re-pull a larger, random
MedRepBench sample (not convenience) for a defensible number. Half B (OCR field-recall on the
images) remains API-gated; H3's kill experiment folds into that run.
