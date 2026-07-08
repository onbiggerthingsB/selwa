---
type: project
title: "Health Translator — H3 Extraction-Reliability: DEFERRED (kill-experiment first)"
created: 2026-07-08
status: deferred
owner: agent
source: "Fable-5 design + Fable-5 adversarial critique (harden-h3-extraction-design workflow), 2026-07-08"
---

# H3 — Extraction Reliability: DEFERRED behind a kill experiment

> **DECISION (do NOT build H3.1–H3.4 yet).** A Fable-5 design proposed multi-pass self-consistency (a pure `lib/selfConsistency.ts` core + an escalate-only guard rule R14 + a cost-gating `shouldReextract`). A Fable-5 adversarial critique then showed the premise is **unvalidated and likely false for the target class**, and that building the plumbing first would ship a **false-reassurance path**. So H3 is gated behind one cheap experiment that must run FIRST.

## Why deferred (the critique's fatal findings)

1. **R14 is NOT external evidence like R11/R13.** R11 compares to the printed range *on the paper*; R13 to the *curated table* — real external ground truth. R14 compares the model *to itself*. The diff is deterministic; the signal is model-internal. And feeding `consolidate()`'s majority-voted value into `classify` re-introduces model authority over meaning via "voting" — a moat violation through the back door.
2. **Self-consistency is structurally blind to its own target class.** An image-driven misread (smudged 3/8, systematic layout misparse) repeats across passes. Temperature jitter decorrelates *decoding variance*, not *evidence-driven bias*, and R13/R11 cannot back it up (the premise is these misreads survive them). A false `stable:true` then manufactures "we read it twice" reassurance — **worse than not checking**.
3. **`shouldReextract` skips the most dangerous class by construction** — gating the 2nd pass on pass-1's *value* being consequential means a real high value misread as benign (e.g. 6.1→5.1) looks non-consequential and is never re-read. The gate is anti-correlated with danger in the false-negative direction (the one that matters — a patient told "normal" doesn't follow up). If gating at all, gate on **analyte identity** (always re-read high-stakes analytes) + structural suspicion, never on the possibly-corrupted value.
4. **Voting has no safe N.** 2 passes can only detect (every disagreement confirms → confirm-fatigue on correct rows from the noisier temp-0.6 pass); 3 passes let 2 shared systematic misreads outvote 1 correct reading and pre-fill the wrong value in `ConfirmValues`, anchoring the user at the exact gate meant to catch it.
5. **"Green offline" overclaims.** Hand-built multi-pass fixtures prove the plumbing (diff→R14→confirm), not the hypothesis. The H0 confirm-burden budget gate can't move on synthetic rows, so it's a green checkmark over a number that structurally can't change until after ship.
6. **Cross-pass alignment by analyte name is the second-hardest problem** (bilingual EN/中文 name normalization across passes), treated as a solved primitive.

## The gate: run the kill experiment FIRST (needs the API + MedRepBench)

Using the existing key-gated MedRepBench harness + gold labels, extract N **genuinely-decorrelated** passes (image transforms / a second prompt framing — NOT temperature jitter) over a modest sample and measure **two** numbers:
1. does disagreement predict misread (precision/recall vs gold), and
2. **the systematic false-agreement rate** — of the *actual misreads*, what fraction do *all* passes make identically.

**Number (2) is the kill criterion.** If a large share of real misreads are systematic, self-consistency is structurally blind to H3's target class and no downstream plumbing fixes it. This experiment is a fraction of the full build and decides whether H3.1–H3.4 get built at all.

## If it survives the gate — what to build (critique-corrected)

- **No `consolidate`-into-classify.** Any cross-pass disagreement on a consequential row → confirm; NEVER feed a disputed value into `classify`. Show both readings as chips (anti-anchoring UI is CORE, not optional).
- Decorrelate the **visual evidence** (crop/rotate/binarize), not the temperature; be explicit it still won't catch smudge-driven systematic misreads.
- Gate re-extraction on **analyte identity + structural suspicion**, never the value.
- Defer **bbox row-integrity** to a later optional milestone; treat any bbox signal as escalate-only, never authority.

---

## Appendix A — the full Fable-5 design (for reference)

Design complete. Returning it as my final response.

---

# H3 — Extraction-Reliability Cycle: Design

## 0. Framing and the one decision that drives everything

The moat gap H3 targets is the **silent plausible misread on an otherwise-clean row**: `4.8` read as `4.3`, `6.1` as `8.1`, or a value transcribed perfectly but bound to the wrong analyte. R13 (`outsideAbsoluteBounds`, `lib/guard.ts:41`) only catches magnitude-absurd misreads; R11 only catches misreads that also contradict the *printed* range; R5 gates on model self-confidence, which the research says is RLHF-overconfident and worthless as a discriminator. None of them see a plausible misread that lands inside every band. That row sails straight to `classify` with no `needsConfirm`, and the whole safety story ("the human confirms the values we read") silently fails for exactly the values that matter.

The only signals that *predict* this failure class from the research are **cross-pass self-consistency** (independent re-reads disagree) and, weakly and unreliably, **bbox spatial integrity**. So the design question in the prompt — self-consistency diff vs. bbox row-integrity, which first — resolves cleanly.

**Decision: build multi-pass self-consistency first (H3.1–H3.4); defer bbox row-integrity to a later, optional milestone (H3.5).** Justification:

- **Signal quality.** Self-consistency directly targets the plausible-misread and row-misassociation cases (a value that jumps between passes reveals instability *regardless* of plausibility or printed-range agreement). Bbox coordinates from VLMs are, per the research, unreliable even when the text is right ("correct text predictions do not reliably entail correct spatial grounding"). Building the *first* confirm-trigger on noisy coordinates risks inflating confirm-burden (H0) with false alarms — the one thing we cannot afford.
- **Cost is a gate, not a blocker.** Bbox looks "free" (same call, more output tokens) while multi-pass "doubles cost." But the cost of multi-pass is controllable by *gating it to consequential reports only* (see §4), whereas the *value* of bbox is capped by its unreliability. High-value-tightly-gated beats low-value-cheap.
- **Both cores are pure and testable offline**, so neither has an implementation-risk advantage. Self-consistency wins on signal.
- **They compose later.** Once self-consistency is validated and shipped, bbox can be added as a *second, one-directional, escalate-only* signal (H3.5) — never authority to auto-correct or reassign a row.

Everything below keeps the invariant intact: **the LLM only supplies candidate transcriptions; every decision (align, vote, diff, confirm) is deterministic TypeScript keyed on cross-pass string equality — an external signal, exactly like R11 (printed range) and R13 (bounds), and explicitly *not* the model's self-reported confidence (that stays R5, kept separate and known-miscalibrated).**

---

## 1. The deterministic core (`lib/selfConsistency.ts`) — pure, no key

New module, mirroring the purity of `lib/guard.ts` / `lib/classify.ts`. It consumes N `LabExtraction`s (the existing `{ rows: ExtractedRow[] }` shape from `lib/extractionSchema.ts`) and produces a single consensus extraction plus a per-row consistency verdict. No I/O, no SDK, fully unit-testable.

```ts
// lib/selfConsistency.ts
import type { LabExtraction, ExtractedRowZ } from '@/lib/extractionSchema';
import { findEntry } from '@/lib/reference';
import { parseValue } from '@/lib/classify';

export interface RowConsistency {
  stable: boolean;            // no material disagreement across passes
  valueDisagree: boolean;     // numeric values differ beyond epsilon
  decimalDisagree: boolean;   // same digits, different decimal placement (7.0 vs 70)
  unitDisagree: boolean;      // units differ after normalizeUnit
  presenceDisagree: boolean;  // row present in some passes, absent/null in others
  passesSeen: number;         // how many passes contributed a reading for this analyte
  variants: string[];         // distinct "value unit" strings observed, for UI hinting
}

// Align rows ACROSS passes by analyte identity: findEntry(name).key when matched,
// else a normalized-name fallback key. Deterministic; order-independent.
export function alignPasses(passes: LabExtraction[]): Map<string, ExtractedRowZ[]>;

// Compare the variants of ONE analyte. Numeric compare via parseValue with a
// relative epsilon; decimalDisagree detects same-significant-digits/different-magnitude
// (the decimal-shift class R13 misses when it stays in-bounds); unit via normalizeUnit.
export function diffRow(variants: ExtractedRowZ[]): RowConsistency;

// Majority-vote each field to a single consensus row (ties -> pass-1 value, marked
// unstable), returning the consensus extraction PLUS the per-analyte verdict keyed
// the same way as alignPasses.
export function consolidate(passes: LabExtraction[]): {
  extraction: LabExtraction;
  consistency: Map<string, RowConsistency>;
};
```

Design notes:
- **Consensus never invents a value.** Every field of the consensus row is one of the model's own transcriptions chosen by mechanical majority vote. When passes tie/disagree, we do *not* pick a "smart" value — we keep pass-1 and mark `stable:false`, which routes to confirm so the human decides.
- **`decimalDisagree` is its own flag** because a decimal shift that stays inside R13's wide bounds (e.g. `4.8`→`48` on an analyte whose absolute bound is 100) is precisely the plausible misread we're chasing.
- **Keyed by the same `findEntry` identity** so this composes with grounding without re-matching.

### Re-extraction predicate (also pure)

```ts
// lib/selfConsistency.ts (or lib/reextract.ts)
// Decide, from the FIRST grounded pass alone, whether a 2nd read is worth the call.
export function shouldReextract(report1: GroundedReport): boolean;
```

Returns true iff pass-1 contains at least one **consequential** row: `entry.highStakes`, `classification === 'critical'`, or a value **near a decision cutoff** (within a small relative margin of `resolveBounds`/critical thresholds — a "borderline" test), on a row that is **not already `needsConfirm`** (if it's already confirming, a 2nd read adds no marginal safety). This is the whole cost-control mechanism (§4) and it's a pure predicate over the existing `GroundedReport`, trivially testable.

---

## 2. Guard integration — new rule R14, escalate-only

`evaluateRow` (`lib/guard.ts:47`) gains one optional trailing param, exactly as R11's `normalizedPrintedRange` was threaded in:

```ts
export function evaluateRow(
  extracted, entry, valueNum, classification, sex, age,
  normalizedPrintedRange?,
  consistency?: RowConsistency | null,   // NEW, optional, back-compat
): GuardOutcome
```

New branch, placed **after** R13 (so an already-suppressed/abstained row never also fires R14) and alongside R5/R11 in the `needsConfirm` accumulation section:

```
// R14 — cross-pass extraction instability. Independent re-reads of THIS row
// disagreed on value/unit/decimal. External deterministic signal (string equality
// across samples), NOT model self-confidence. Escalate to confirm; never suppress,
// never auto-correct, never classify.
if (consistency && !consistency.stable) {
  needsConfirm = true;
  flags.push(flag('R14-EXTRACTION-UNSTABLE', 'caution',
    'We read this number more than once and got slightly different results, so please check it against your report.',
    '我们多次读取该数值时结果略有不同，请与您的报告核对。'));
}
```

`grounding.ts` (`groundExtraction`, line 8) gains a matching optional param and passes the per-row verdict through:

```ts
export function groundExtraction(
  extraction: LabExtraction, sex: Sex, age?: number,
  consistency?: Map<string, RowConsistency>,   // NEW
): GroundedReport
```

Inside the `.map`, after `findEntry`, look up `consistency?.get(entry?.key ?? normKey(name))` and pass it as the new `evaluateRow` argument. When `consistency` is `undefined` (the entire current production path, and ConfirmValues re-grounding), R14 is a no-op — **zero behavior change until the multi-pass path is switched on.**

**Why this respects the invariant:** R14's boolean is computed by `diffRow` from string/numeric equality across independent samples. The model contributed only candidate readings; it did not decide "these disagree" and it did not report a confidence that we trusted. The decision surface is identical in kind to R11 and R13 — deterministic TS reading external evidence.

---

## 3. Data flow / where the extra call lives

Keep `app/api/extract/route.ts` a **thin, stateless, single-pass OCR endpoint.** Do *not* move N-pass orchestration or gating into the route — grounding needs `sex`/`age` and runs client-side, and the route's whole contract is "one image in, OCR rows out." The client already owns orchestration (`CaptureCard.submit`, line 62), owns the transient PHI, and already re-grounds. Put the gated 2nd call and the pure consolidation there.

**Only route change** — accept an optional decorrelation knob so pass 2 is a genuinely independent sample, not a cached echo:

```ts
// route.ts: read optional `variant` from the form; map to sampling params
const variant = Number(form.get('variant') ?? 0);
// ...
temperature: variant === 0 ? 0 : 0.6,   // pass 1 deterministic; later passes decorrelated
// optionally append a short nonce to EXTRACTION_PROMPT to break identical decoding
```

Return shape is unchanged (`{ data: parsed }`).

**New client flow in `CaptureCard.submit`:**

1. `pass1 = POST /api/extract (variant 0)` → `report1 = groundExtraction(pass1, sex, age)` (no consistency).
2. If the multi-pass flag is on **and** `shouldReextract(report1)`: `pass2 = POST /api/extract (variant 1)`. (Tie-break `pass3` only when pass1/pass2 disagree on a *high-stakes/critical* row and a 3rd vote could resolve it — rare.)
3. `{ extraction, consistency } = consolidate([pass1, pass2])`.
4. `report = groundExtraction(extraction, sex, age, consistency)` → R14 fires only where a consequential row is unstable.
5. Otherwise `report = report1`.

Show a distinct progress state between steps 1 and 4 ("Double-checking the important numbers… · 正在复核重要数值…"), reusing the `extracting` phase styling.

`ConfirmValues.tsx` needs no change to *function*: it filters `needsConfirm`, and step 4 sets it. On submit it re-grounds without consistency (line 39) — correct, because the user's corrected value is now authoritative and R14 is moot. **Optional nice-to-have** (flag it, don't build in H3): thread `consistency.variants` into `ConfirmValues` to pre-populate the disagreeing readings ("we read 4.8 or 4.3") as selectable chips — higher-quality confirm, but pure UI and out of the critical path.

---

## 4. Cost / latency envelope + toggle

- **Toggle:** env/flag `SELF_CONSISTENCY_PASSES` (default `1` = off; `2` enables the second read; `3` allows the rare tie-break). Ships **dark** — merged, wired, but `1` in prod until H3.3's number clears a bar.
- **Gating = `shouldReextract`.** Pass 1 always runs. A second full vision call fires *only* for reports containing a consequential, not-already-confirming row. On a typical mixed corpus that's a minority of reports, so expected added cost is roughly **+0.15–0.25× per report, not +1×**. Cheap, uninteresting reports (all-normal CBC with no high-stakes row) pay nothing.
- **Latency:** gating is *post*-pass-1 (we need pass-1 content to decide), so the 2nd call is **sequential** — it adds one call's latency, but only on the gated subset, on a flow that is already multi-second. Precision (never re-read a report that doesn't need it) is worth more here than parallelism. A hard per-report cap (`max 3 calls`) bounds worst case.
- **PHI:** unchanged — both calls are transient/server-passthrough; consolidation is on-device; nothing persists.

---

## 5. Interaction with existing gates — no double-confirm

- **R13 first.** R14 sits after the R13 abstain/return, so a magnitude-absurd row is suppressed once, never re-read, never double-flagged.
- **R14 only *matters* on otherwise-clean rows.** If a row already `needsConfirm` via R5/R11-flip/R3/R6, R14 adds nothing observable (it's already confirming). Its *unique* contribution is precisely the silent-plausible-misread on a clean high-stakes/borderline row — the gap. `shouldReextract` even excludes already-confirming rows from triggering a 2nd pass, so we never spend a call to re-confirm something already confirmed.
- **H4 photo-gate composition.** A marginal-but-not-failed photo is a *natural* re-extraction trigger and can be folded into `shouldReextract` later. But when the user takes the H4 **override** path (`escalateConfirm`, `CaptureCard` line 90), *every* row is already `needsConfirm` — so **skip multi-pass entirely in that case** (redundant, wasteful). Multi-pass targets the good-photo / plausible-misread case that H4 can't see.
- **Confirm-burden budget (H0).** R14 flags ride into `confirmBurden.byRule` automatically (`validation/confirmBurden.ts`) since `groundExtraction` carries them. Add a report line and a budget assertion: R14 must not lift `confirmRate` above baseline + a small delta. Because gating restricts R14's population to consequential rows, its contribution is structurally bounded. Add a checklist case (`validation/checklist`) proving a synthetic disagreement escalates to confirm and an agreement does not, wired into the existing release gate (`checklistRegression`).

---

## 6. What lands green without a key vs. what's key-gated

Mirror the validation adapter pattern exactly (`validation/extraction/extractor.ts`'s `claudeExtractor` throws without `ANTHROPIC_API_KEY`; the offline scorer runs on committed fixtures).

**Pure / offline / green with committed fixtures:**
- `lib/selfConsistency.ts` (`alignPasses`, `diffRow`, `consolidate`) + `selfConsistency.test.ts` with hand-built multi-pass fixtures: full agreement, value-disagree, decimal-shift-in-bounds, unit-disagree, row-missing-in-one-pass, and row-misassociation (a value that migrates to a different analyte between passes).
- `shouldReextract` + tests (high-stakes present, critical present, borderline near-cutoff, all-clean → false, already-confirming → false).
- Guard R14 branch + `guard.test.ts` cases; `grounding.test.ts` case feeding a `consistency` map and asserting `needsConfirm` + `R14` flag id.
- `validation/selfconsistency/` scorer, mirroring `validation/extraction/fieldRecall.ts`: `consistencyPredictsError(passes, gold)` measuring precision/recall of "disagreement ⇒ actual mismatch-vs-gold" over committed synthetic pass sets. Green offline; establishes the *shape* of the number.

**Key-gated / opt-in (throws without `ANTHROPIC_API_KEY`, nothing committed):**
- `validation/selfconsistency/multiPassExtractor.ts` — calls the real SDK N times with decorrelated sampling (mirrors `claudeExtractor`), used to produce N real passes over the MedRepBench images (reuse `MEDREPBENCH_DIR`, `loadMedRepBench`).
- The env-gated runner that feeds those real passes through `consolidate` + `consistencyPredictsError` to yield **the real number**: how well does cross-pass disagreement flag genuine misreads, and at what confirm-cost. This is the gate for flipping `SELF_CONSISTENCY_PASSES` to `2` in prod.

---

## 7. Milestones — each independently green + moat-safe

- **H3.1 — Deterministic self-consistency core.** `lib/selfConsistency.ts` + `shouldReextract` + full offline tests. No route change, no cost, no behavior change. Green.
- **H3.2 — Guard R14 + grounding wiring + burden coverage.** Optional `consistency` params on `evaluateRow`/`groundExtraction`; R14 branch; `confirmBurden`/report/checklist coverage + budget assertion. Still no live cost (consistency is `undefined` in the prod path → R14 no-op). Green.
- **H3.3 — Key-gated multi-pass extractor + validation adapter.** `validation/selfconsistency/` real-pass runner measuring disagreement-vs-correctness on MedRepBench. Opt-in, throws without key. Produces the number that authorizes shipping. Green offline (fixtures), gated for real.
- **H3.4 — Route + client integration behind a dark flag.** `variant`→temperature on `route.ts`; gated sequential 2nd pass + `consolidate` + re-ground in `CaptureCard.submit`; progress UI; per-report call cap; `SELF_CONSISTENCY_PASSES` defaults off. Ship dark; enable only after H3.3 clears the bar. Green.
- **H3.5 (later, optional) — bbox row-integrity.** Optional normalized row bbox in `extractionSchema`; pure `lib/rowIntegrity.ts` (analyte/value/unit/range share a horizontal band; value/unit columns are consistent); a **one-directional escalate-to-confirm** rule (R15), gated and deduped against R14 to avoid double-confirm; same offline-first → key-gated → dark-flag rollout. Deferred because coordinates are unreliable — validate precision offline and prove it doesn't inflate confirm-burden *before* it ever touches a live report, and never let it auto-correct or reassign a row.

Every milestone holds the invariant: the model contributes only candidate transcriptions; alignment, voting, diffing, and the confirm decision are deterministic TypeScript over external signals; disagreement can only **escalate to the human confirm gate**, never suppress a confirm, auto-correct a value, reassign a row, or classify.

Relevant files: `/Users/likerun/Desktop/health-translator/lib/selfConsistency.ts` (new), `/Users/likerun/Desktop/health-translator/lib/guard.ts` (R14), `/Users/likerun/Desktop/health-translator/lib/grounding.ts` (optional param), `/Users/likerun/Desktop/health-translator/app/api/extract/route.ts` (`variant`→temperature), `/Users/likerun/Desktop/health-translator/components/CaptureCard.tsx` (gated 2nd pass), `/Users/likerun/Desktop/health-translator/validation/selfconsistency/` (new adapter), `/Users/likerun/Desktop/health-translator/validation/confirmBurden.ts` (budget).

---

## Appendix B — the full Fable-5 adversarial critique

# Adversarial review: H3 Extraction-Reliability Cycle

I read `lib/guard.ts`, `app/api/extract/route.ts`, and `validation/confirmBurden.ts` to ground this. The design is careful, well-sequenced on the surface, and its escalate-only / never-auto-correct discipline is genuinely good. But it rests on one rhetorical move that does not survive contact, and its cost gate is anti-correlated with the exact danger it claims to target. Details below, most-severe first.

## 1. The load-bearing claim — "R14 is the same kind of external signal as R11/R13" — is false, and it's the whole justification

The design says R14's boolean is "identical in kind to R11 and R13 — deterministic TS reading external evidence," and repeats it three times to satisfy the invariant. This is a sleight of hand. R13 compares the model's value against a **human-curated reference table**. R11 compares it against the **printed range on the paper** — actual on-document ground truth. Both are external to the model. R14 compares the model **against itself** (other samples of the same model on the same image). The *diff* is deterministic; the *signal* is not external — it is model-internal agreement. "Cross-pass string equality" is determinism in the comparator, not independence in the evidence.

This matters because the invariant you actually care about is "meaning is not decided by the model." A confirm *triggered* by self-agreement is defensible (escalate-only). But the design also feeds `consolidate()`'s **majority-voted value into `groundExtraction` → `classify`** (§3 step 4). That means: when 2-of-3 samples share a systematic misread, the model's self-majority selects which number gets classified, and the correct minority reading is discarded. You have re-introduced model authority over meaning through the back door of "voting," while telling yourself it's as external as the curated table. It is not.

## 2. Self-consistency is structurally blind to exactly the failure class H3 exists to catch

The design's own framing (§0): R13/R11 can't see plausible in-bounds misreads (`4.8→4.3`), so self-consistency is the only signal that catches them. But the SYSTEM constraints already flag the counter: "the model can make the SAME misread every pass (systematic error)." The design's mitigation is (a) temperature 0.6 on pass 2 and (b) "pair with plausibility (R13) + printed-range (R11)."

Both mitigations evaporate precisely on the target population. R13/R11 **cannot** back up self-consistency here — the whole premise of H3 is that these misreads survive R13 and R11. So for the rows H3 is built for, there is **no backstop**: if the resample repeats the misread, you get false `stable: true` → no confirm → and now the number carries the implicit endorsement "we read it twice." That is *worse* than not checking, because it manufactures reassurance for the one class where you have no independent check.

And a smudged `3`/`8` or a systematic layout misparse is driven by the **image**, not by decoding variance — so it is exactly the kind of error that temperature jitter does *not* decorrelate. Temperature 0.6 perturbs the distribution over identical visual evidence; it barely touches evidence-driven bias. You are decorrelating the variance you don't have (structured-output OCR at temp 0 is near-deterministic) and leaving the bias you fear.

**The number that decides whether H3 is worth building is not "does disagreement predict error" (H3.3's stated metric). It is the *false-agreement rate*: of real misreads, what fraction do all passes make identically.** The design never proposes measuring it. If that fraction is high — and for image-driven OCR errors it plausibly is — the cycle is oversold and every "double-checked" signal is a lie of omission.

## 3. `shouldReextract` skips the most dangerous error class by construction

This is the sharpest concrete flaw. The cost gate fires a second pass only for rows that are *already* consequential **in pass 1** — highStakes, `critical`, or near a cutoff. The design calls this "the whole cost-control mechanism" and boasts it "structurally bounds" R14's population.

Consider the worst clinical error: a true value of `6.1` (borderline-high, near the cutoff) misread as `5.1` (dead-normal, not near any cutoff, not critical, not flagged). `shouldReextract` sees a boring normal row → returns `false` → **no second pass is ever spent on the misread that hides a real abnormality.** The gate is anti-correlated with danger in the false-reassurance direction — the direction that matters most, because a patient told "normal" doesn't follow up. You've optimized cost by systematically declining to re-read the false-negative misreads that are the entire point.

You cannot gate the second pass on pass-1's *value* being consequential, because the misread corrupts the value. If you gate at all, gate on **analyte identity** (always re-read high-stakes *analytes* regardless of their pass-1 value) plus structural suspicion — never let a normal-looking number buy a row out of verification.

## 4. Two-pass voting is structurally incoherent; three-pass enables systematic-majority burial

With `SELF_CONSISTENCY_PASSES=2` you can never *vote* — only *detect disagreement* — so **every** disagreement is a confirm regardless of which pass was right. Since temp-0.6 pass 2 is noisier than temp-0 pass 1, you will introduce fresh errors on rows pass 1 read correctly, and each one spuriously confirms a **correct high-stakes row**. That is direct confirm-fatigue inflation on good data — the H0 harm the design claims gating bounds.

With 3 passes you *can* vote, but now 2 shared systematic misreads outvote 1 correct reading and `consolidate` installs the wrong value as the displayed default. Even though `valueDisagree` still forces a confirm (any spread → `stable:false`), the user is shown the **majority-misread value pre-filled** in `ConfirmValues`. There is no N that is safe, because the only available tiebreak is more model samples. The design demotes the anti-anchoring "show both readings as chips" UI to an *optional nice-to-have* — it is not optional. A single pre-filled `4.8` anchors the user to the wrong number at the exact confirm gate that is supposed to catch it. Pre-populating a disputed value with the model's majority is a false-reassurance path inside the safety gate itself.

## 5. "Green offline" overclaims the safety validation

The design says H3.1/H3.2 "land green" and `consistencyPredictsError` "establishes the shape of the number" on committed synthetic fixtures. Hand-built multi-pass fixtures that disagree where you designed them to disagree prove the **plumbing** (diff → R14 → confirm), not the **hypothesis** (real cross-pass disagreement predicts real misreads). The hypothesis is only tested by H3.3's key-gated real run, which (a) can't run in CI, (b) needs MedRepBench images, and (c) measures a temperature-jitter decorrelator of unproven power.

Worse, the H0 **budget assertion** ("R14 must not lift `confirmRate` above baseline + delta"), wired into the release gate as a green checkmark, is untestable offline in any load-bearing way: `confirmBurden` runs on synthetic rows where R14 fires exactly as you scripted. The real confirm-burden only moves when the live 2-pass path runs in prod. So you have a green gate over a number that structurally cannot move until after you ship the risk. That is false assurance in the validation harness, not just the product.

## 6. Alignment by analyte key hides the row-misassociation case it claims to catch

`alignPasses` keys rows by `findEntry(name).key`, "else a normalized-name fallback key. Deterministic; order-independent." That one clause carries enormous unspecified weight. Row-misassociation is often a **name** misread or an analyte swap. When the name differs across passes, the fallback mints two different keys, the rows don't join, and you get `presenceDisagree` on both → confirm (tolerable). But across a **bilingual EN/中文** corpus, cross-pass, cross-language name normalization is itself an error-prone match; any instability there either manufactures confirm noise or, worse, mis-joins two different analytes' values into one `variants` set and computes a meaningless diff on them. The design treats this as a solved primitive ("Deterministic; order-independent"). It is the second-hardest problem in the module and is where silent misalignment will actually live.

## 7. The cost envelope is a guess presented as a bound, on an inverted population

"+0.15–0.25× per report, not +1×" assumes consequential rows are a minority "on a typical mixed corpus." But nobody urgently photographs a perfect CBC. The real production population self-selects toward reports *with* abnormal/high-stakes rows — the gated subset is plausibly the **majority**, pushing back toward the `+1×` the design says it avoids. And the sequential post-pass-1 gate adds a full multi-second vision round-trip to exactly the worried-user / consequential reports — the worst reports to slow down. Speculative-parallel-then-cancel is foreclosed "for precision," but precision here buys latency on the anxious user.

## What I'd cut, and what I'd sequence differently

**Cut:**
- **`consolidate`-into-classify.** Replace with a hard rule: *any* cross-pass disagreement on a consequential row → confirm, and **never** feed a disputed value into `classify`. Show both readings as chips (promote §3's "optional" anti-anchoring UI to core). This deletes the model-majority-selects-meaning surface (§1) and the anchoring path (§4) at once.
- **Temperature-jitter as the decorrelator** — or at minimum, stop claiming the research's ROC numbers transfer to it. If you pursue self-consistency, perturb the **visual evidence** (crop/rotate/binarize variants), which is genuinely independent, and be explicit it *still* won't catch smudge-driven systematic misreads.
- **`shouldReextract`'s pass-1-value gate.** Gate on analyte identity (re-read high-stakes analytes unconditionally) + structural suspicion, never on the possibly-corrupted value.
- **The "green offline" framing on the safety claim.** Label H3.1/H3.2 tests as plumbing-only and attach a real kill-criterion number to the one test that matters.

**Resequence to validation-first.** The design builds the deterministic core, guard rule, and wiring (H3.1/H3.2) *before* the H3.3 run that decides whether the premise holds. That is backwards — you build three integrations before the cheapest thing that can kill the idea.

## Single highest-leverage first move

Before any module, guard rule, or client wiring: run the **kill experiment**. Using only the existing key-gated MedRepBench harness plus a diff and the gold labels, extract N genuinely-decorrelated passes (image transforms, ideally a second prompt framing) over a modest sample and measure **two** numbers — not one:

1. does disagreement predict misread (precision/recall vs gold), and
2. **the systematic false-agreement rate**: of the *actual misreads*, what fraction do *all* passes make identically.

Number (2) is the gate. If a large share of real misreads are systematic, self-consistency is structurally blind to the class H3 was built for (§2), and no amount of downstream plumbing fixes it — you'd be shipping a "double-checked" reassurance signal whose reliability is capped by an unmeasured blind spot. That experiment is a fraction of H3.3 and it should decide whether H3.1–H3.4 get built at all. Everything else in the design is competent execution of a premise that has not yet earned its first number.
