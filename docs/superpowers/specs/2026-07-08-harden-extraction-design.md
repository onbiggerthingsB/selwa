---
type: project
title: "Health Translator — Harden-Extraction Design (sequenced; Codex-reviewed)"
created: 2026-07-08
updated: 2026-07-08
status: draft
owner: agent
source: "superpowers:brainstorming (Fable 5), 2026-07-08; grounded in the 6-agent improvement-research (OCR-robustness lens) + the CheckList gap from the validation-rigor cycle; adversarially critiqued by Codex/GPT-5.5 (session 019f4228), which read the real code and materially reshaped this doc."
---

# Health Translator — Harden-Extraction Design (sequenced)

> **Status: DRAFT, Codex-reviewed.** This cycle changes guard behavior (`lib/`, `data/`) and, in one sub-cycle, the capture UX. The moat invariant holds throughout: *the LLM never decides clinical meaning* — every new signal is deterministic TypeScript over curated data, or a client heuristic that only asks for a better photo. Codex's critique is folded in; the single-cycle v1 of this doc was wrong in four load-bearing ways (below).

## 1. Problem

The system's safety rests on a human "confirm the values we read" gate. But **LLM-as-OCR fails silently and confidently** — a misread number returns clean, well-structured, high-confidence, with no error signal (MedRepBench: best open VLMs miss ~1 field in 5 on real Chinese lab images). The signals an engineer reaches for are *actively misleading*: token logprobs scored 0.705 AUC on a 55-field extraction benchmark; RLHF makes verbalized confidence overconfident. **The gate must be driven by EXTERNAL deterministic signals**, not by anything the model reports about itself.

## 2. What changed after the Codex review (the four corrections)

The naive single-cycle design would have shipped real bugs. Codex (reading the actual code) caught:

1. **R11 is unit-blind.** `grounding.ts` unit-converts the *value* to canonical SI before the guard ([grounding.ts:18](../../lib/grounding.ts)), but passes `printedRange` through **raw** ([grounding.ts:29](../../lib/grounding.ts)). R11 then compares raw printed-range numbers to canonical bounds ([guard.ts:152](../../lib/guard.ts)). A mg/dL report with printed range `70-99` gets compared to `3.9-6.1 mmol/L` → false disagreement. Strengthening R11 as originally proposed would fire a **systematic false confirm on every unit-converted analyte**. R11 must be unit-aware *and* classification-flip-gated first.
2. **`needsConfirm` alone is false reassurance for impossible values.** A one-click confirm still lets [summary.ts:57](../../lib/summary.ts) render a confident critical reading, and [result/page.tsx:52](../../app/result/page.tsx) accepts the re-grounded report **unconditionally** (no durable "unresolved" state). So R13's real job is **suppress clinical interpretation** (raw value, no low/normal/high, no plain-language meaning) until corrected — not merely `needsConfirm`.
3. **R7b is deeper than a detector.** The per-segment notes guard compares the LLM's *own* `sourceText` vs its translation — blind to a flip the model made when producing the segment ([notesGrounding.ts:59](../../lib/notesGrounding.ts)). Imperative polarity must be reconciled against **`originalText`** ([notesGrounding.ts:34](../../lib/notesGrounding.ts)), the way negation/drug/dose already are.
4. **The confirm contract is unresolved and unmeasured.** `action: 'confirm'` is dead type surface ([types.ts:25](../../lib/types.ts)) — never produced or consumed; `needsConfirm` is the real mechanism. Over-confirm is **invisible** to the risk-coverage metric ([run.ts:74](../../validation/run.ts), [coverage.ts:10](../../validation/coverage.ts)) — labs count as non-coverage only when `action==='abstain'`. Nothing downstream is measurable until this is settled.

**Consequence: split the work into sequenced cycles, foundation first.** A single cycle that lumps a false-confirming R11, an under-scoped R13, a shallow R7b, and a whole photo-gate product surface together is not safe or reviewable.

## 3. Invariant preservation (the moat)

- Every new signal is deterministic TS over curated, **sourced** data, or a client heuristic — the LLM gains no authority to decide meaning.
- The strongest new posture (from Codex): a value that fails an external plausibility signal (R13, or a future row-integrity/multi-pass check) **suppresses clinical interpretation** — raw value shown, no classification, no plain-language meaning — rather than offering a click-through confirm that still renders a confident reading. Suppression is the safe default; confirm is for recoverable uncertainty, not impossibility.
- R7b abstains on a flipped/dropped imperative with the source shown verbatim — identical to the R7–R9 discipline.
- The photo pre-gate only requests a better photo; it never alters extracted meaning.

## 4. Sequenced cycles

### H0 — Contract + measurement (FIRST; low-risk foundation)

Nothing else is safe to build until confirm is a resolved, measured concept.

- **Resolve the contract:** standardize on `needsConfirm` as *the* mechanism. **Remove the dead `'confirm'` from `GuardAction`** ([types.ts:25](../../lib/types.ts)) — verified unreferenced anywhere in `lib/app/components`. (We do NOT promote `confirm` to a guard action; needsConfirm already drives `ConfirmValues`.)
- **Make over-confirm measurable (validation-only, additive):** add a confirm-burden metric that reads `needsConfirm` from grounded labs rows over the corpus — `confirmRate` (fraction of emitted rows routed to confirm) and a per-rule breakdown (which rule set needsConfirm). This is the baseline the R13/R11 cycles will move; without it we can't tell hardening from confirm-fatigue. Wired into `report.md`.
- **Scope note:** deliberately does NOT add a distinct `'confirm'` Verdict to the CheckList (that would ripple every existing high-stakes case from `flag`→`confirm`). The confirm-burden metric reads `needsConfirm` directly; the CheckList vocabulary stays `render|flag|abstain`. Revisit only if H1 needs a distinct DIR assertion.
- **Deliverables:** `lib/types.ts` (remove dead action) + `validation/confirmBurden.ts` (+ test) + `run.ts` render. Touches `lib/` by one line; the rest is validation. `npm run validate` gains a "Confirm burden" section.

### H1 — Labs guard hardening (after H0)

- **R13 — per-analyte absolute physiological bounds → SUPPRESS interpretation.** Add `absoluteLow`/`absoluteHigh` to `data/reference-labs.ts`, **sourced per analyte** and labelled honestly (these are plausibility bounds, *not* "biological impossibility"; alert-limit literature is the basis, with specimen/age caveats noted). New rule: a unit-matched value outside the bounds → **suppress classification** (raw value shown, no low/normal/high, no plain-language meaning; a distinct flag), not a click-through confirm. Framed honestly as a **narrow catch** (decimal shifts, digit confusables, absurd row-swaps) — it will NOT catch plausible misreads (4.8 vs 4.3), which is H3's job.
- **R11 — strengthen ONLY after making it sound.** (a) Make printed-range parsing **unit-aware**: normalize the printed range through the same curated conversion the value used before comparing. (b) Parse **one-sided ranges** (`<5.2`, `≥90`, decision cutoffs), not just `low-high`. (c) Route to `needsConfirm` **only when the disagreement could flip the low/normal/high classification** (or the printed range is internally inconsistent with the extracted unit/value) — not on every material mismatch, since legitimate assay/lab differences are common. Until (a)+(b)+(c) hold, R11 stays flag-only.

### H2 — Notes safety: R7b imperative polarity (separate; touches detectors + reconciliation)

- New immutable **type** `imperative` (extend `Immutable` in `types.ts` beyond negation|dosage|drug|number).
- Detector in `notesDetect.ts` + `medical-lexicon.ts` with the **full lexicon** Codex enumerated: hold/stop/suspend/discontinue/resume/reduce/increase — ZH `停 / 停用 / 停服 / 暂停 / 不要再吃 / 遵医嘱停 / 停药观察 / 恢复 / 减量 / 加量 / 改服 / 改为 / 继续 / 续用` + EN equivalents. False negatives are the danger, so any medication instruction whose imperative polarity we can't verify **defaults to abstain**.
- **The deep fix:** extend `notesGrounding.ts` **original-text reconciliation** ([notesGrounding.ts:34](../../lib/notesGrounding.ts)) to imperative polarity — reconcile against `originalText`, not the model-produced segment `sourceText`. A flip or drop → abstain.
- Re-scope the imperative-flip corpus family **IN** (now catchable) + CheckList DIR cases.

### H3 — Extraction reliability (arguably the real moat work; Codex: more central than R13)

- **Row-integrity** (analyte↔value↔unit↔printed-range association) and/or **multi-pass self-consistency** (extract 2–3×, diff; disagreement → suppress/confirm). These catch the *plausible* misreads and wrong-row values that R13 cannot. Treat any spatial/bbox signal as a **confirm-signal, never authority to auto-correct** (VLM box coords are themselves unreliable). Cost/latency of multi-pass is the tradeoff to design against; the confirm-burden metric from H0 measures whether it pays off.

### H4 — Photo-quality pre-gate (its own product cycle)

- **Report-level quality metadata** on `GroundedReport` (there is no field today — [types.ts:53](../../lib/types.ts)) + an override model; row-level `needsConfirm` cannot express a whole-report retake.
- Check quality on the **post-downscale image actually sent to Claude** ([downscaleImage.ts:11](../../lib/downscaleImage.ts)), not the preview — small Chinese text can survive the preview but die in the JPEG resize.
- Own the product surface Codex listed: EXIF orientation, crop, glossy paper/shadows, multi-page, screenshots, non-camera uploads, canvas decode on low-end phones. False-reject and false-accept are both real; the override must **escalate** the gate, never bypass safety. UX + device testing.

## 5. Cross-cutting (from Codex's "Missing")

- **Durable confirm state.** The confirm gate is one-shot today ([result/page.tsx:52](../../app/result/page.tsx) accepts the re-grounded report unconditionally). Interpretation-suppressing rules (R13, H3) must keep suppressing after a click-through if the value is still implausible — the app must distinguish "corrected" from "clicked past."
- **Per-rule telemetry:** which rows were confirmed / corrected / clicked-through-unchanged, and which rule fired — the only way to tune thresholds against reality.
- **Confirm-fatigue metric** separate from abstention/coverage (started in H0).

## 6. Open decision for H0 (recommendation)

**Contract:** standardize on `needsConfirm`; delete the dead `'confirm'` GuardAction (recommended — it's unreferenced and misled the v1 design). The alternative — promoting `confirm` to a first-class action/verdict end-to-end (guard, grounding, summary, UI, CheckList, metrics) — is more churn for no functional gain today, since `needsConfirm` already drives the UI. Recommendation: delete + measure via `needsConfirm`; revisit a first-class verdict only if H1's DIR cases need to distinguish confirm from flag.

## 7. Sequencing summary

H0 (foundation, ~S) → H1 (labs guard, ~M) → H2 (notes R7b, ~M) → H3 (extraction reliability, ~L, the real OCR moat) → H4 (photo gate, ~L, product surface). Each is its own writing-plans pass and its own branch; each leaves the suite green and `npm run validate` runnable. H0 unblocks measuring all of it.
