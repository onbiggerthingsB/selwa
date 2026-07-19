# Recognition-gap work list (post Codex #7)

Status: **alias pass shipped; curation cycle NOT started.**
Source: adversarial triage of the 136 unrecognised analyte names in the two real corpora
(`validation/real-corpus/`), classified by Sonnet 5 and then attacked by Opus 4.8, which
**downgraded 14 proposed aliases** it could break.

## Why this list exists

Codex #7 replaced the self-graded R6 coverage with an independent-label version. That exposed the
real number: **self-graded 80.0% (56/70) vs gold-labelled 27.4% (58/212)** on the beachhead corpus.
142 high-stakes rows were invisible because we cannot NAME the analyte.

The concrete harm, measured on the shipped pipeline — the chip is deliberately decoupled from
recognition, so an unrecognised analyte still gets a position chip with **no confirm gate and no
surfaced flag**:

| row | printed range | what the user sees |
| --- | --- | --- |
| Lactate 8.4 mmol/L (sepsis/shock) | 0.5-2.0 | "Above your report's range", `needsConfirm=false`, flags: none |
| Troponin T 2.4 ng/mL (massive MI) | 0-0.01 | "Above your report's range", `needsConfirm=false`, flags: none |
| Potassium, Whole Blood 7.2 mEq/L | 3.5-5.1 | "Above your report's range", `needsConfirm=false`, flags: none |

A life-threatening potassium is presented exactly as flatly as a mildly high cholesterol. R6 exists
to prevent this and cannot fire, because recognition is its trigger.

## 1. DONE — alias pass (15 aliases, shipped)

Names that are unambiguously the same quantity/specimen/unit as an existing entry. Each survived an
Opus adversarial attempt to find a specimen, matrix, unit-basis, molecule, or matcher-collision
hazard, and each was mechanically re-checked here for `normName()` index collisions.

`INR(PT)`→inr · `PT国际标准比值(INR)`→inr · `凝血酶原时间(PT)`→prothrombin_time ·
`活化部分凝血活酶(APTT)`→aptt · `纤维蛋白原(FIB)`→fibrinogen · `B型钠尿肽`→bnp ·
`中性粒细胞数`→neutrophil_abs · `中性细胞比率`→neutrophil_pct · `嗜酸性粒细胞百分比`→eosinophil_pct ·
`均血红蛋白里`→mch · `超敏C-反应蛋白`→hs_crp · `β2微球蛋白`→beta2_microglobulin ·
`Cholesterol, HDL`→hdl_cholesterol · `Cholesterol, Total`→total_cholesterol ·
`Cholesterol, LDL, Calculated`→ldl_cholesterol

**Effect, measured:** MedRepBench R6-gold **21.6% → 35.1%**. MIMIC R6-gold **27.4% → unchanged**.
`chipWrong` stayed **0** on both corpora.

**Read that second number.** The cheap fix does not touch the beachhead, because every US
high-stakes gap needs a *new curated entry*, not an alias — which is exactly what the adversary
concluded when it downgraded them. Aliasing cannot close this.

## 2. NEXT — curation cycle: 18 high-stakes entries (NOT started)

Each needs sourced reference bands + R13 absolute plausibility bounds + adversarial review, per the
established pattern. **Do not rush these** — a wrong band is worse than no entry, because the entry
turns "we don't know" into a confident comparison.

Highest value for the US beachhead (drives the 27.4%):
`Lactate` · `Free Calcium` (ionised — NOT total calcium, different band) · `pO2` · `pCO2` ·
`Base Excess` · `Anion Gap` · `Urea Nitrogen` (BUN — NOT urea; differs by ~2.8× conversion) ·
`Troponin T` · `Bilirubin, Total` · `Hematocrit, Calculated` · `Calculated Total CO2`

Chinese corpus: `凝血酶时间(TT)` / `TT` (thrombin time) · `PT%` (prothrombin activity) · `肌红蛋白`
(myoglobin) · `肌酸激酶同工酶质量` (CK-MB mass) · `铅(Pb)` / `镉(Cd)` (blood heavy metals — whole-blood
matrix, distinct from serum minerals)

Plus 20 non-high-stakes entries (coverage, not safety): RDW-SD, urobilinogen, tumour markers,
`Asparate Aminotransferase (AST)` (the adversary showed our existing `ast` band does **not** match
the printed 0-40, so this is a curation question, not an alias), etc.

## 3. DELIBERATE DECLINES — 53 names, and they must stay declined

These are **not** gaps to close. Recording them so a future pass doesn't "fix" them:

- **Sensitive (14 incl. high-stakes):** drug-of-abuse screens (cocaine, methadone, opiate,
  oxycodone, amphetamine, barbiturate), HIV/syphilis/hepatitis serology, HPV subtypes,
  pharmacogenomic genotypes. Surfacing a position on these is a privacy and product harm, not a
  translation win. This is also why MedRepBench's `chipAccuracy` is 88.3% rather than higher — part
  of that gap is a deliberate product decision, not missing coverage.
- **Specimen-ambiguous:** `Glucose` (nine fluids in MIMIC), `pH` (blood ~7.35-7.45 critical vs urine
  ~5-8 — one alias cannot serve both), `Ketone`, `钙(Ca)`/`镁(Mg)` (whole-blood trace-element panel,
  not serum), `红蛋白` (OCR fragment that is a suffix of BOTH 血红蛋白 hemoglobin and 肌红蛋白 myoglobin).
- **Qualitative/descriptive:** microscopy, crystals, bacteria, flow-cytometry populations.

Closing these safely requires **panel/specimen context capture**, which is the already-deferred
prerequisite — not an alias.

## 4. SEPARATE BUG FOUND during triage (not yet fixed)

The Opus adversary, while clearing `β2微球蛋白`, demonstrated a **pre-existing** hazard that the alias
did not create and does not worsen (the same state is already reachable via the entry's canonical
`β2-微球蛋白`), but which is real and unmitigated:

> A specimen-unqualified **urine** β2-microglobulin of 1.03 mg/L against a printed range 0-0.3
> renders a correct chip ("Above your report's range") next to **"Typical range 0.8-2.4 mg/L"** —
> our *serum* band. R11-RANGE-DISAGREEMENT fires and sets `needsConfirm=true`, but R11 is excluded
> from `SURFACING_FLAGS`, so **nothing warns the user**. R16 does not catch it either: 2.4 vs 0.3 is
> an 8× ratio, under `SCALE_TOLERANCE = 10`. R13 fires only for *normal* urine values — it catches
> the healthy patient and misses the injured one.

Generalised: whenever our curated band materially disagrees with the printed range, we still show
"Typical range …" with no visible caveat. Options: surface an R11 variant (its message is about the
report's own content, so it is speakable under B1), suppress `typicalRange` when R11 fires, or
tighten `SCALE_TOLERANCE`. Needs its own decision — recorded here so it is not lost.
