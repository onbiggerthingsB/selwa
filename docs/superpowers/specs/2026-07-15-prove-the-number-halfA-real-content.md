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

## The numbers (25 real reports, 143 analyte rows, diverse panels)

| metric | value | reading |
|---|---|---|
| recognized by our 89-analyte table | **43 / 143 (30.1%)** | most real rows never map |
| **ABSTAIN-RATE** | **79.0%** (113/143) | on a real report the app is largely silent |
| **CONFIRM-RATE** | **33.3%** (10/30 interpreted) | NOT confirm-fatigue |
| **AGREEMENT** | **96.7%** (29/30 scorable) | when we speak, we're right |

Abstain breakdown: **100 R1-unknown-analyte · 9 R2-unit-mismatch · 4 non-numeric.**
Split (coverage work develops on TRAIN, is gated on HELD-OUT it never sees):
`train` 16 rpt / 97 rows — abstain 80.4%, agree 94.7% (n=19) · `heldout` 9 rpt / 46 rows —
abstain 76.1%, agree 100% (n=11).

**The single agreement miss is SAFE, not silent.** `谷草转氨酶` (AST) 11 U/L, printed range
2–40 → we call it *low* (our band's floor > 11) while the report calls it normal — but R11
fires and routes it to **confirm** ("we read this as low; it disagrees with your report's
range"). And R11's flip-gating is correct on real data: the same rule fires WITHOUT confirm
when the band difference doesn't change the call (AST 19.1, both normal). So the guard's
safety holds on real content: 29/30 agree outright, and the 30th is confirm-flagged.

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

- Convenience sample of dataset rows ~1–45 (25 reports w/ items), transcribed VERBATIM via
  WebFetch (sandbox blocks curl; HF datasets-server 503s). May carry minor transcription noise.
  The **defensible** number needs the raw CSV: `MEDREPBENCH_CSV=/path/datasets-meta-zhCN.csv
  npx tsx validation/real-corpus/run.ts` (loader + deterministic held-out split already built).
- Deliberately diverse (allergen/serology/urine/cytology/HPV/genotype panels included), so 79%
  is the abstain-rate on *mixed* real reports; on a routine-chemistry/CBC slice the recoverable
  name/unit misses dominate and the achievable rate is far lower.
- Agreement n=30 (up from 9) — firmer, still modest. The abstain-rate is the robust number.
- `is_abnormal` is each report's OWN flag (vs its printed range), so a disagreement can mean our
  reference band differs from the lab's — and when that difference flips the call, R11 catches
  it and routes to confirm (verified: the one miss is confirm-flagged, not silent).

## Step 2 — first coverage bite (done, merged)

Two ZERO-band-risk unit fixes the measurement pinpointed (analyte + band already correct, we
just weren't accepting the real unit spelling), plus one R11 correctness fix they surfaced:
- **D-dimer `mg/L(FEU)`** — `normalizeUnit` now strips parens but keeps the basis token, so
  the paren form ≡ our `mg/L FEU`. Bare basis-less `mg/L` / `(DDU)` still abstain (safety kept).
- **Hematocrit `%`** — `%`→`L/L` ×0.01 conversion (magnitude-separable per H1.5; R13 catches
  mis-scaling). Analyte-scoped, so a `%` on a non-hematocrit is unaffected.
- **R11 flip-gate fix** — surfaced by HCT 49.9%: R11 pre-filtered on the *bands* differing
  >15% before checking the flip, so a value in the narrow gap between our (sex-unknown, wider)
  band and a narrower printed range flipped silently. R11 now fires on a VALUE-LEVEL flip
  regardless of band closeness. Strictly adds confirms — never removes — so it can't make a
  safe row unsafe.

Result (gated on held-out): abstain **76.1% → 73.9%** on held-out (R2 unit-mismatches 9→6),
raw agreement dipped (96.7→93.9%) as HCT % added 2 band-vs-report disagreements — **both now
confirm-flagged**, so **confident-agreement stayed 100% and confidently-wrong = 0** (locked as
a harness safety-gate test). 326 lib/data/validation tests pass. The disciplined loop works:
measure → safe fix → re-measure on held-out → abstain down, safety intact.

## Step 3 — re-target to the BEACHHEAD corpus: US-lab reports (done, merged)

The US-diaspora decision means the beachhead photographs US-lab reports (English names, US
*conventional* units), not Chinese/SI. Sourced the **MIMIC-IV Clinical Database Demo v2.2**
(`validation/real-corpus/us-sample.ts`) — 100 real de-identified US patients (Beth Israel
Deaconess), **fully public, no credentialing**, ODbL — with all five fields (analyte, value, US
unit, ref range, abnormal flag). 22 real panels / 322 rows, non-cherry-picked (hash-sampled).

Result: recognized **46.9%** (up from 30.1% — English names match our aliases better),
**abstain 74.8%, confident-agreement 100%, confidently-wrong 0** (safety holds on US data too;
locked as a US gate test). The tell is the abstain breakdown: **R2 unit-mismatch jumped from 9
(Chinese/SI) to 67 rows (21%)** — because our table is SI and US reports use conventional units.
The offenders (recognized analytes abstaining purely on unit): Bicarbonate `mEq/L`, Hemoglobin
`g/dL`, Platelet `K/uL`, Magnesium/Calcium/Phosphate `mg/dL`, MCHC `g/dL`, pH `units`,
Lipase/Amylase `IU/L`.

**→ The beachhead's defining coverage gap is US conventional-unit support, not analyte breadth.**
Safe subset for the next bite (unambiguous / magnitude-separable): Bicarbonate mEq/L→mmol/L (×1),
Hemoglobin g/dL→g/L (×10), Platelet K/uL→10⁹/L (×1), pH `units` alias, Lipase/Amylase IU/L≡U/L.
**Trap-adjacent — do NOT add blindly:** Calcium & Magnesium `mg/dL`→mmol/L are H1.5's deliberate
abstain-traps (mg/dL vs mEq/L divalent ambiguity); they need the full adversarial-review cycle.

## Next (only if pursued — not another hardening cycle)

Coverage work, measured against THIS harness as the gate (watch the abstain-rate fall without
the agreement/confirm numbers degrading): (1) synonym + OCR-tolerant name normalization;
(2) expand the unit whitelist + conversions for real CBC/chemistry units; (3) grow the
reference table toward the common real-report analytes. Then re-pull a larger, random
MedRepBench sample (not convenience) for a defensible number. Half B (OCR field-recall on the
images) remains API-gated; H3's kill experiment folds into that run.
