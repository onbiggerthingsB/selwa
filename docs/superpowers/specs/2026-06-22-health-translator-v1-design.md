---
type: project
title: "Health Translator — v1 Expansion Design (Part B)"
created: 2026-06-22
updated: 2026-06-22
status: approved
owner: agent
source: "superpowers:brainstorming, 2026-06-22; grounded in docs/DESIGN.md + docs/V1-EXPANSION.md"
---

# Health Translator — v1 Expansion Design (Part B)

> **Status:** Design approved by Kerun (2026-06-22). Next: writing-plans turns this into a complete, milestone-structured implementation plan. **Do not rebuild the v0 deterministic safety core** — extend it.

## 1. Purpose & context

v0 ships Mode 1 for labs-only, Mandarin↔English: photograph → Claude-vision OCR → deterministic grounding (`lib/grounding` → `classify` → `guard` R1–R12 over `data/reference-labs`) → bilingual "Clinic Letter" report card with an abstention / "confirm with your clinician" guard; PHI on-device. This design expands scope **without weakening the safety guarantee**.

**The load-bearing invariant, restated:** *the LLM never decides safety.* In v0 the LLM only does OCR. v1 lets the LLM **translate free-text doctor notes** — but a **deterministic guard owns fidelity**, verifying the LLM's output against the source and abstaining on any mismatch. Meaning, ranges, classification, unit conversion, and translation-fidelity checks are all deterministic and tested.

## 2. Scope (resolved decisions)

| Decision | Choice |
|---|---|
| Plan coverage | **Features 1–4 in full** (TDD task detail); **Mode 2 = architecture sketch** milestone only (it is v2-sized and will churn after v1). Matches `DESIGN.md` (v1 = validation, v2 = Mode 2). |
| Doctor-notes safety model | **Constrained translate + deterministic guard + immutable-token preservation.** The LLM translates/simplifies; R7–R9 deterministically detect negations/dosages/drug names in **source and output**, preserve them verbatim, surface the original, flag "confirm with clinician", and **abstain on unresolved mismatch.** |
| Validation corpus | **Synthetic + public corpus now (~30–50 cases) with a real-de-identified-data drop-in slot** + clinician/bilingual review rubric. |
| MT baseline | **Pluggable `MtBaseline` adapter**: Google Cloud Translation adapter (key-gated) + offline fallback, so the comparison runs without external cost/keys. |

**Out of scope for v1:** full Mode 2 implementation; OCR of handwriting; languages beyond Mandarin↔English; auto-conversion of ambiguous units; any feature that lets the LLM assign a reference range, a classification, or a final clinical decision.

## 3. Cross-cutting safety invariants (preserved — these gate every feature)

1. The LLM never assigns or recalls a reference range, never classifies low/normal/high/critical, never diagnoses or prescribes.
2. **Notes fidelity is deterministic.** Immutable tokens — negation polarity, dosage strings (digits + unit + frequency), drug names, and numbers — are detected by curated rules over the **source** text, then verified present/unchanged in the LLM output. Failure → flag or abstain on that segment; the **source is always shown beside the translation.**
3. Unit conversion happens only via a curated, per-analyte, sourced factor for an **unambiguous** pair; otherwise abstain (v0 R2 unchanged for those).
4. Anything high-stakes or uncertain → "confirm with your clinician." The guard may only **escalate** caution, never reduce it.
5. PHI stays on-device (IndexedDB). Notes text transits the server transiently to reach Claude, exactly like images — never persisted server-side.
6. Every new deterministic unit is built test-first, like the v0 core. LLM-calling routes are tested against a mocked SDK.

## 4. Feature 1 — Doctor-notes plain-language translation + R7–R9

### Problem
Generic MT makes clinically-significant free-text errors (negation reversal benign→malignant, dropped/garbled dosages, look-alike drug substitutions) and never flags them. This feature translates + simplifies doctor notes while making those exact failure modes **detectable and fenced**.

### Units (each small, pure where possible, independently testable)

- **`data/medical-lexicon.ts`** — curated bilingual detection data:
  - `NEGATION_MARKERS`: EN (`not, no, without, negative, denies, rule out, cannot exclude, r/o, ruled out`) + ZH (`无, 未, 没有, 否认, 阴性, 排除, 不能排除, 未见, 未见异常`), each tagged with polarity/uncertainty strength.
  - `DOSE_UNITS` (`mg, mcg, µg, g, mL, IU, units, 片, 粒, 毫克, 毫升, 国际单位`) and `FREQUENCY_TOKENS` (`QD, BID, TID, QID, PRN, Q8H, qhs, 每日, 一日X次, 每天X次, 睡前, 饭后, 饭前, 顿服`).
  - `KNOWN_DRUGS`: a seed list of common generics + brands (EN + ZH + pinyin) with a canonical display form. Unknown tokens in a medication context are flagged, never guessed.
  - `HIGH_RISK_PAIRS`: false-friend / high-consequence terms with canonical translations and a "must-flag" marker (`良性`/`恶性`, `阳性`/`阴性`, `高血压`/`低血压`, `占位/占位性病变`, `待排`, `复查`, `考虑/符合/提示` hedge ladder).
- **`lib/notesSchema.ts`** — Zod `NotesTranslation` the LLM must return:
  `{ segments: [{ sourceText: string, translatedText: string, kind: 'finding'|'medication'|'instruction'|'followup'|'other' }] }`. The prompt instructs: translate + simplify only; **preserve every number, dose, negation, and drug name verbatim**; never add a diagnosis or recommendation; segment by clause. The schema constrains output; it does **not** ask the LLM to self-assess safety.
- **`lib/notesGuard.ts`** — the deterministic safety owner. Pure functions over `(sourceText, translatedText, lexicon)`:
  - `detectImmutables(text): Immutable[]` — finds negations, dose strings, drug names, numbers via the lexicon + regex (language-agnostic where possible; per-language marker sets).
  - `evaluateSegment(segment): { action: 'render'|'flag'|'abstain', flags: GuardFlag[], preserved: Immutable[], original: string }`:
    - **R7 negation/polarity:** every source negation must have a corresponding negation scoping the same finding in the output; missing/flipped polarity → `flag` (caution) or `abstain` if polarity is ambiguous. Hedge strength must not weaken (`cannot exclude` ≠ `no evidence of`).
    - **R8 dosage:** every source dose string must appear **verbatim** (digits + unit + frequency) in the output; any divergence (rounding, unit change, dropped frequency) → `flag`/`abstain`; the original dose is always surfaced.
    - **R9 drug name:** every source drug token must be preserved (original shown alongside any translation); unknown med-context tokens → flag, never substituted; look-alike substitution → abstain.
    - High-risk pairs present → always attach a "verify this term" flag.
  - This **replaces the `freeTextFlags` no-op** in `lib/guard.ts` (or `notesGuard` becomes the real implementation and `guard.ts` re-exports it).
- **`lib/notesGrounding.ts`** — `groundNotes(translation, lexicon): GroundedNotes` orchestrates per-segment `evaluateSegment`; returns `{ segments: GroundedSegment[] }` where each segment carries source, translation, action, flags, and the preserved immutables.
- **`lib/notesSummary.ts`** (or extend `summary.ts`) — render the notes section bilingually: **source always shown beside the simplified translation**, immutables visually pinned (dose/drug/negation chips), flags as the same calm callouts as labs, abstained segments shown as "shown as written; we can't safely simplify this one."
- **`app/api/translate-notes/route.ts`** — `runtime = 'nodejs'`; accepts `{ text, sourceLang? }` (text, not image), calls `client.messages.parse` with `NotesTranslation` schema, returns segments. Same key-server-only + generic-error discipline as `/api/extract`.
- **UI** — a "Add what the doctor said / told you" text area on the capture screen (paste or type), routed through the same confirm→report flow; a notes section in the report card list.

### Edge cases the guard must handle (enumerated for the plan)
Negation scope spanning clauses; double negation; ZH negation particles attached to the verb; dose ranges ("1–2 片"); decimal/fraction doses; unit transliteration (mg vs 毫克 — treated as equivalent via lexicon, not as a mismatch); multi-drug lists; drug names that are also common words; segment-boundary splits that separate a negation from its target (guard must evaluate at the clause level, not token level); empty/garbled notes → abstain whole.

### Why this is safe
The LLM can produce a fluent-but-wrong translation, but it **cannot** make the guard pass: the guard recomputes immutables from the source independently and demands they survive. The worst the LLM can do is trigger a flag/abstention — never a silent error. The source is always visible, so the user (or their clinician) can verify.

## 5. Feature 2 — Unit auto-conversion

### Units
- **`data/unit-conversions.ts`** — `Conversion[]` of `{ analyteKey, fromUnit, toUnit, factor, source }` for **unambiguous** SI↔conventional pairs only: glucose (mg/dL↔mmol/L ×0.0555), total/LDL/HDL cholesterol (×0.0259), triglycerides (×0.0113), creatinine (µmol/L↔mg/dL ×0.0113), total bilirubin (×0.0585), urea↔BUN (note the urea-vs-urea-nitrogen factor explicitly), uric acid (×0.0595), calcium, etc. Each sourced.
- **`lib/convert.ts`** — `convertValue(value: number, fromUnit: string, entry: ReferenceEntry): { value: number; unit: string } | null`. Returns the value in the entry's canonical unit, or `null` when no curated unambiguous conversion exists.
- **Integration in `lib/grounding.ts`:** when `unitMatches` is false but `convertValue` succeeds → convert to canonical, classify on the converted value, and attach a transparent **`R2b-UNIT-CONVERTED`** info flag showing both the original and converted value+unit. When no conversion exists → the existing **R2 abstain** is unchanged.

### Why this is safe
Conversions are curated, per-analyte (the factor depends on molar mass — not a generic formula), sourced, and unit-tested in both directions; the UI shows both numbers; ambiguous units still abstain. The guard gains transparency, not guesswork.

## 6. Feature 3 — Expanded reference table

- Grow `data/reference-labs.ts` from 28 → **~80–120** common analytes, added in grouped, individually-reviewable batches: full CBC + differential, extended metabolic panel, lipids, liver panel, renal panel + electrolytes (Ca/Mg/PO₄), thyroid (incl. T3/FT3/antibodies), cardiac & inflammatory markers (hs-CRP, ESR, BNP/NT-proBNP, troponin — flagged high-stakes), coagulation (PT/INR/APTT/D-dimer), HbA1c & metabolic, common vitamins/iron studies (ferritin, B12, folate, 25-OH-D), and frequent urinalysis fields. Every entry carries provenance (the existing required `source`, enriched).
- **Additive age support** (keeps the safety core stable): add optional `ageBands?: { ageMin: number; ageMax: number; refLow: Bound; refHigh: Bound }[]` to `ReferenceEntry`; `resolveBounds(entry, sex, age?)` gains an optional `age`. Existing entries (no `ageBands`) are unchanged. When `ageBands` exist and no age is supplied → R12 population-sensitive flag + widest-union band. Optional `sex`/`age` capture stays optional in the UI.
- The integrity test scales (unique keys, allowedUnits ⊇ unit, provenance present, criticalbounds outside reference band, the five high-stakes anchors still flagged).

## 7. Feature 4 — The validation number (the rigor proof)

A separate `validation/` tree (not shipped in the app bundle):

- **`validation/corpus/`** — ~30–50 cases as structured fixtures: `{ id, kind: 'labs'|'notes'|'mixed', input, gold: { translation, interpretation, shouldAbstain: string[], highStakes: string[] }, provenance }`. Seeded with synthetic + public-sample cases now; a documented **drop-in slot** for real de-identified reports.
- **`validation/baseline/`** — `interface MtBaseline { id: string; translate(text, from, to): Promise<string> }` with a **Google Cloud Translation adapter** (key-gated via env) and an **offline fallback adapter** (records "baseline unavailable" so the harness still runs). Optionally an unguarded-LLM adapter to isolate the safety delta.
- **`validation/metrics.ts`** (pure, unit-tested) — computes, for **our pipeline** and for **each baseline** over the same corpus:
  - **Medical-term fidelity rate** — did immutables (negation polarity, dose strings, drug names, numeric values) survive correctly vs gold?
  - **Abstention precision & recall** — of items we flagged/abstained, how many *should* have been per gold `shouldAbstain`/`highStakes`; and did we miss any we should have flagged?
  - An honest **error analysis** breakdown by failure type.
- **`validation/run.ts`** — runs ours + baselines across the corpus and emits a comparison report (Markdown/JSON artifact): our fidelity & abstention vs the baseline's, demonstrating the safety/comprehension delta.
- **`validation/review/`** — export cases for clinician/bilingual human review, capture verdicts (a simple schema + import), fold into the metrics. The "number" is the generated report; metrics math is unit-tested independently of the corpus.

## 8. Feature 5 — Mode 2 (architecture sketch only)

Real-time two-way speech interpreter, on the same safety + record spine. **Sketch deliverable:** interface definitions + a sequencing/risk milestone, not task-level TDD.

- **Pipeline:** streaming ASR (multilingual speech→text) → segment → translate(+per-segment confidence) → **the same `notesGuard`** (immutable fidelity + an "I'm unsure — confirm this" uncertainty surface) → TTS/captions → logged to the same on-device visit record.
- **Reuse:** `notesGuard`/immutable detection (Feature 1), the record store, the disclaimer/safety spine, the bilingual rendering.
- **New interfaces (defined, not implemented):** `AsrProvider`, `TtsProvider`, a streaming session model, a realtime uncertainty/abstention UX, latency + on-device/privacy considerations.
- Full Mode 2 is its own future brainstorm→plan cycle.

## 9. Testing strategy

Mirror v0: pure deterministic units (`notesGuard`, `convert`, `metrics`, expanded-table integrity, age-band `resolveBounds`, lexicon detectors) are **fully TDD'd** with explicit edge cases; LLM routes (`translate-notes`) are tested against a **mocked SDK**; the validation harness has metric unit tests and a smoke run over a tiny fixture corpus. No feature lands without its tests green and lint/build clean.

## 10. Milestone sequence (proposed)

1. **M1 — Expanded reference table + additive age support** (data + `resolveBounds` age arg; low-risk, improves labs immediately).
2. **M2 — Unit auto-conversion** (`data/unit-conversions`, `lib/convert`, grounding integration; replaces R2 abstain where safe).
3. **M3 — Doctor-notes translation + R7–R9 guard** (lexicon, notes schema/route, `notesGuard`, `notesGrounding`, notes UI — the headline).
4. **M4 — The validation number** (corpus, `MtBaseline`, metrics, run/report, review harness — measures M1–M3).
5. **M5 — Mode 2 architecture sketch** (interfaces + sequencing/risk milestone).

Each milestone produces working, tested software on its own and preserves every safety invariant in §3.

## 11. Open questions for writing-plans
- Exact seed size of `KNOWN_DRUGS` and the high-risk-pair list for M3 (start small, expand in M4 from error analysis).
- Whether the notes input ships in M3 or rides behind a flag until the guard's abstention precision is measured in M4 (recommend: ship in M3 with conservative abstention, tune via M4).
