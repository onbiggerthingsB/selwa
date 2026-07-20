# Cycle plan — 2026-07-19 → reachability, safety-critical curation, and the reproduction/derivation boundary

Status: **NOT STARTED.** Written for implementation by Codex (gpt-5.6-sol) with no further conversation.
Baseline: branch `main` @ `9c5100a`, 643 tests green, `npx tsc --noEmit` clean.
Test runner for every step: `npx vitest run --pool=threads` (the forks pool fails under load).
Corpus runner: `npx tsx validation/real-corpus/run.ts`.

---

## 0. The design test this whole cycle is measured against

> **If a screen element changes based on the user's number in any way other than printing that number, it is a verdict.**

Two corollaries used repeatedly below:

- **Reproduction is safe; derivation is the risky act.** Printing what the report printed — its value, its unit, its own reference range, its own ↑ — is on the GENERIC-or-REPRODUCED side of the line. Computing a position and rendering it is on the other side, and is tolerated today only because the computation is done *exclusively in the report's own frame* (`lib/summary.ts:143-151`).
- **Conditionality is a channel.** A chip that appears for some values and not others is a verdict even if its text is neutral. So is a row appearing on the confirm screen. Text-only audits miss both.

Verification caveat, stated once and carried: the regulatory reasoning behind this test rests on the FDA WHOOP warning letter (July 2025) and 《医疗机构管理条例实施细则》第八十八条 as read on 2026-07-19. **Primary-source verification of the WHOOP letter text was not performed in this repo.** The 备案 / Art. 38 analysis in §11 is likewise secondary. Treat the design test as a project commitment we have chosen to honour, not as an adjudicated legal holding.

---

## 1. Preconditions — do these before writing any code

**P0.1 — Fix two stale spec headers.** `docs/superpowers/specs/2026-07-19-chinese-coverage.md:3` and `docs/superpowers/specs/2026-07-19-urinalysis-coverage.md:3` both say `Status: **NOT STARTED**`. Both shipped (`data/reference-labs.ts:53,959,985` carry the three bucket-A aliases; `data/english-aliases.test.ts:46-48` carry the locks; commit `7531700` shipped urinalysis). The chinese-coverage baseline of 54.1% (20/37) is superseded by the measured 62.2% (23/37). Mark both `SHIPPED (commit …)`, and correct the baseline line. An implementer reading these headers will otherwise redo shipped work or mis-baseline this cycle's prediction.

**P0.2 — Update `docs/superpowers/specs/2026-07-18-recognition-gap-worklist.md` §4.** The "SEPARATE BUG FOUND (not yet fixed)" — urine β2-microglobulin showing our serum "Typical range" — **is fixed**. `lib/guard.ts:409-430` implements `R17-BAND-NOT-COMPARABLE`; `lib/summary.ts:274-275` gates `typicalRange`/`source` on `!bandNotComparable`. Mark it resolved so it stops reappearing as a work item.

**P0.3 — Record the baseline measurement and commit it.** Run `npx tsx validation/real-corpus/run.ts` on `main` and paste the full output into the PR description of the first work item. Required because Item F changes the *meaning* of `needsConfirm`, after which R6-gold is no longer comparable across the change. The numbers to record:

```
MedRepBench (Chinese, PRIMARY): 143 rows · CHIP 72.0% · R6-gold 62.2% (23/37)
MIMIC (US):                     322 rows · CHIP 73.6% · R6-gold 42.0% (89/212)
chipWrong: 0 on both
```

---

## 2. Order of work, and why

Ordering principle: **live safety defects first; then work that unblocks measurement; then work that adds surface; rendering of anything model-authored last.**

| # | Item | Why here | Status |
|---|---|---|---|
| **W0** | Reachability blocker (§11) | Non-engineering. Until a domain resolves from mainland China, every item below improves a screen no target user can open. Must have a named owner and a date, or the plan is optimising a system with zero users. | **blocked on a human** |
| **W1** | Item C — negative-number parser + signedness gate | Smallest diff in the cycle, zero corpus-visible effect, unblocks the curation cycle (W4). Atomic commit. | ready |
| **W2** | Item D-1 — `GLU`/`葡萄糖` specimen scoping | Live cross-specimen identity defect on the now-primary corpus. Same class as the RBC→`rbc_count` near-miss already fixed. +0 metric, pure safety. | ready |
| **W3** | Item D-2/3/4 — `PT%` entry, `a-淀粉酶` scoping, must-stay-unknown locks | The only pre-registered metric movement in the cycle. **Must land before W5**, because W5 changes what `needsConfirm` means. | `PT%` **blocked on a decision** (sourcing); the two locks ready |
| **W4** | High-stakes curation cycle — 17 remaining entries | The largest live safety gap in the product (Lactate 8.4 in sepsis renders "Above your report's range", `needsConfirm=false`, no flag). Scheduled ahead of B/E/G on safety grounds. **Its own cycle, its own spec.** | ready, but out of *this* spec — see §10 |
| **W5** | Item F-2a + F-2b — conditional-referral leaks | Closes a design-test violation in the app's own terms. Lands as **one commit**; F-2a alone is misleading. Requires the metric rename in the same commit. | **blocked on a decision** (F-2b option a vs b) |
| **W6** | Item E defects #1 and #3, plus G's `unverified()` fix | Faithful-reproduction fixes. E#1 (`summary.ts:269`) must land before any A work touches that line. E#3 is a live wrong-heading safety bug at two call sites. | ready |
| **W7** | Item A — schema + prompt + `printedFlagDirection`, **dark** | Capture the report's own flag. Rendering is deliberately excluded (§7). | ready (dark only) |
| **W8** | Item B — widened `BANNED` gate + 3 data edits, then glossary rendering | Gate and data edits first, rendering second. Rendering before the gate ships triage prose. | ready |
| **W9** | Item G engineering-only tranche | All pre-reviewer. Template extraction is the long pole for the eventual Tibetan engagement. | ready |
| **W10** | Entry-point language selector + `lang` threading + persistence | Prerequisite for F Gap 3 and G Tier 0. Without it both ship translations nobody can reach. Placed here because W5–W9 do not depend on it, but nothing user-facing in Tibetan may ship before it. | ready |
| **W11** | Item F consent/PIPL work (Gaps 1–5), privacy notice, user agreement | Largest change; touches both API routes; the agreement text is blocked on counsel. | **blocked on a human** |
| **X** | Item A chip rendering | Excluded from this cycle. See §7 and §10. | **blocked on measurement** |

Two ordering constraints that are not negotiable:

- **W3 before W5.** Once `needsConfirm` stops driving the confirm list, R6-gold measures an internal boolean with no rendered correlate. Record 24/37 first.
- **W6 before W7.** Item A's proposed `reportRange` gate `(!defer || flagDir !== null)` is a *regression* against E's unconditional reproduction. E lands first and A does not touch `lib/summary.ts:269` at all.

---

## 3. W1 — Item C: negative-number parser + signedness gate

### Evidence

`lib/classify.ts:4` — `const NUMERIC = /^[+]?\d+(\.\d+)?$/`. Leading `-` rejected. `parseValue` has exactly one production consumer: `lib/grounding.ts:18`.

Today a negative value abstains silently and correctly: `parseValue('-5') → null` → `classify(null,…) → 'unclassified'` → `structurallySuspicious()` returns `true` on `valueNum === null` (`lib/guard.ts:62`) → **R5-LOW-OCR-CONFIDENCE-NUMERIC**, `needsConfirm = true`.

The user-visible chip is **unaffected** — `lib/summary.ts:156` uses `parseScalar` (`lib/reference.ts:184`), whose regex `^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$` already accepts negatives. The two parsers have silently diverged; `parseValue` is the stricter one.

Severity: **latent blocker, zero live impact.** Verified: no curated entry has a negative bound (`grep "absoluteLow: -\|refLow: -\|criticalLow: -"` → zero hits across 97 entries). Base Excess is explicitly deferred at `data/reference-labs.ts:2650-2651`, and that comment names this regex as the reason. `validation/real-corpus/realContentBench.ts:231-234` checks `row.entry === null` before `row.valueNum === null`, so R1 wins the abstain label regardless.

### Change — ONE atomic commit

1. `lib/classify.ts:4` → `/^[+-]?\d+(\.\d+)?$/`. **`\d+`, never `\d*`.** With `\d*` the bare token `'-'` — the urine dipstick negative, present 12× in `validation/real-corpus/sample.ts:123-138` — would parse.
2. Add a comment at `lib/classify.ts:4` recording the deliberate divergence from `parseScalar`: `parseValue` feeds the *classification* path, `parseScalar` the *reproduction* path; they also differ on trailing report flags (`"5.2↑"`), scientific notation, and leading-dot decimals. Do not merge them.
3. **Signedness gate, same commit.** In `structurallySuspicious` (`lib/guard.ts:56-64`), treat `valueNum < 0` as suspicious **unless** the entry declares it can be signed, derived as `entry.absoluteLow !== null && entry.absoluteLow < 0`.

### Why (3) is mandatory and not a nicety

Without it the regex change trades a latent defect for a live one. Once `parseValue` accepts negatives, R5 stops firing for negatives on curated entries, and two entry classes have `absoluteLow: null` so **R13 cannot catch the fallout**:

- qualitative dipstick entries (`data/reference-labs.ts:2270, 2297, 2324` — `unit: "qualitative"`, `refLow: 0, refHigh: 0`) — a value `"-1"` would newly classify as `'low'`;
- urine specific gravity (`data/reference-labs.ts:2380` — `refLow: 1.003`, `absoluteLow: null`) — a misread `"-1.020"` would newly classify as `'low'`.

The inferred form (`absoluteLow < 0`) is preferred over an explicit `signed?: true` on `ReferenceEntry`: it is smaller and cannot drift from the bounds.

### Do NOT

- Do **not** curate Base Excess in this item. Bundling it makes the diff's safety review conflate a parser change with a new high-stakes reference band. Update the `data/reference-labs.ts:2650-2651` deferral comment to say the regex is fixed and only the curation remains.
- Do **not** touch `parseScalar`, `parsePrintedRange` (`lib/reference.ts:230`) or `parseValueRange` (`:290+`). None routes through `NUMERIC`. `lib/parsePrintedRange.test.ts:135,158,160` already lock `'-3.0--1.0' → null`, `'-2~-1' → below`, `'-1-2' → none`; those must stay green untouched.
- Do **not** widen any `absoluteLow`/`absoluteHigh` to make a test pass. Those bounds are R13's only net.

### Tests

`lib/classify.test.ts` (extend `describe('parseValue')`, currently lines 5-16):

- `parseValue('-5') → -5`; `parseValue('-2.0') → -2`; `parseValue('+3') → 3` (existing behaviour lock).
- Hyphen-as-separator regression lock: `parseValue('0-2') → null`; `parseValue('3.5-5.1') → null` (already at `:12` — keep, annotate as load-bearing); `parseValue('-2-2') → null`; `parseValue('-3.0--1.0') → null`.
- **`parseValue('-') → null`** — the single test that catches a `\d*` slip.
- `parseValue('- 5') → null`.

`lib/guard.test.ts`:

- Negative value on a curated entry with `absoluteLow >= 0` (a qualitative dipstick entry, or SG) still raises R5 / abstains — this locks the signedness gate.
- Negative value on an entry with `absoluteLow < 0` does **not** raise R5 and classifies normally. (No such entry exists yet; construct one in the test fixture rather than adding one to `data/reference-labs.ts`.)

### Invariant it must not break

R5/R13 are the only things standing between a misparsed number and a classification. Enforced by `lib/guard.test.ts` and by `chipWrong = 0` on both corpora.

### Pre-registered metric movement

**None.** All corpus numbers unchanged: ZH 62.2% (23/37), US 42.0% (89/212), CHIP 72.0%/73.6%, `chipWrong` 0. Any movement means the change was not as scoped.

### Acceptance

- [ ] All six new `parseValue` cases pass, including `'-'` → `null`.
- [ ] Both `guard.test.ts` signedness cases pass.
- [ ] `npx tsx validation/real-corpus/run.ts` byte-identical to the P0.3 baseline.
- [ ] `data/reference-labs.ts:2650-2651` comment updated.

---

## 4. W2/W3 — Item D: Chinese coverage, pass 2

### 4.1 Measured state (run 2026-07-19)

```
MedRepBench (Chinese): 143 rows · CHIP 72.0% · R6-gold 62.2% (23/37)
MIMIC (US):            322 rows · CHIP 73.6% · R6-gold 42.0% (89/212)
```

The 14 unconfirmed Chinese gold-high-stakes rows are **not** all unrecognised names. Corrected breakdown, all rows `specimen='unknown'`:

**8 unrecognised (`entry === null`):**

| name | unit | printed range | panel |
|---|---|---|---|
| `PT%` | `%` | 70-140 | coagulation (PT, INR, APTT, Fib, TT, D-Dimer) |
| `人类免疫缺陷 病毒抗体/抗原 (P24)` | `S/CO` | ~<1 | infectious serology |
| `镉(Cd)` | `μg/L` | 0-200 | heavy metals |
| `铅(Pb)` | `μg/L` | 0-100 | heavy metals |
| `钙(Ca)` | `μg/ml` | 50-100 | heavy metals |
| `镁(Mg)` | `ug/ml` | 20-80 | heavy metals |
| `a-淀粉酶` | *(none)* | 35-135 | single-analyte, no specimen printed |
| `髓系原始细胞群` | `%` | *(none)* | flow cytometry |

**6 recognised but `highStakes: false` in our table while gold says true:** `WBC`→`wbc_count` (`data/reference-labs.ts:84`), `RBC`→`rbc_count` (:113), `HCT`→`hematocrit` (:164), `尿素`→`urea` (:370), `淋巴细胞数`→`lymphocyte_abs` (:988), `酮体`→`urine_ketones` (:2323). **This is not an aliasing gap.** See §4.5.

### 4.2 W2 — LIVE DEFECT: the `GLU` / `葡萄糖` specimen hole

`fasting_glucose` (`data/reference-labs.ts:187`) carries `'GLU'` and `'葡萄糖'` as **unscoped** aliases and has no `specimenAliases` block. `urine_glucose` (:2292-2293) declares `specimenAliases.urine: ['Glucose','GLU','尿糖']` — `葡萄糖` is absent. `findEntryMatch` (`lib/reference.ts:74-84`) consults `SCOPED_ALIAS_NAMES` only when specimen is `'urine'|'blood'`, so unknown falls through to the unscoped index. Measured:

```
GLU     unknown=fasting_glucose | blood=NULL | urine=urine_glucose
Glucose unknown=NULL            | blood=NULL | urine=urine_glucose
葡萄糖   unknown=fasting_glucose | blood=fasting_glucose | urine=NULL
```

`GLU` is **inverted**: printing "blood" yields `NULL`; printing nothing yields the blood entry. `data/english-aliases.test.ts:100-103` locks `findEntry('Glucose') === null` with the rationale "MIMIC carries it in 9 fluids" but never tested bare `GLU` or `葡萄糖`.

`lib/grounding.ts:16` reads `extracted.specimen ?? 'unknown'`, and specimen is optional, so **unknown is the common production path**. End-to-end reproduction of a Chinese urine dipstick row:

```
葡萄糖 15.0 mmol/L → entry=fasting_glucose, classification='high',
  flags R4-HIGH-STAKES-ANY-ABNORMAL, R6, R12
  section name: 空腹血糖 / "Fasting plasma glucose"
  plain:        空腹时的血糖水平 / "Blood sugar level after fasting."
```

B1 holds the *chip* (it defers on a non-numeric printed range), so `chipWrong` stays 0 — but the section **name and explanatory text** tell a patient reading a urine report that this is their fasting blood sugar, and the row enters `crossRowChecks` under a blood-glucose identity.

**Change.** Move `'GLU'` and `'葡萄糖'` out of `fasting_glucose.aliases` into `fasting_glucose.specimenAliases.blood`. Add `'葡萄糖'` to `urine_glucose.specimenAliases.urine`. Keep `'血糖'` and `'空腹血糖'` unscoped — unambiguously blood.

**Locks** (in `data/english-aliases.test.ts`, or a new `data/chinese-aliases.test.ts`):

- [ ] `findEntry('GLU')` and `findEntry('GLU', null)` → `null`
- [ ] `findEntry('葡萄糖')` and `findEntry('葡萄糖', null)` → `null`
- [ ] `findEntry('GLU','blood')?.key === 'fasting_glucose'`; `findEntry('葡萄糖','blood')?.key === 'fasting_glucose'`
- [ ] `findEntry('GLU','urine')?.key === 'urine_glucose'`; `findEntry('葡萄糖','urine')?.key === 'urine_glucose'`
- [ ] `findEntry('血糖')?.key === 'fasting_glucose'` unchanged

**Do NOT** touch `白细胞`, `红细胞`, `胆红素`. They also resolve to blood entries under unknown specimen, but that is **locked legacy behaviour** (`data/english-aliases.test.ts:29-38`, `:148-153`; rationale at `lib/reference.ts:76-83`). Changing it is a separate decision.

### 4.3 W3 — `PT%`: a new curated entry, NOT an alias

Corpus row: `PT% = 86.40 %`, printed range 70-140, alongside `PT` (seconds) and `INR` (ratio). Gold canonical: "Prothrombin activity percentage". Chinese: 凝血酶原活动度 (PTA).

**Why aliasing is unsafe, concretely.** PT-seconds and PT-activity-% move in *opposite directions*. Aliasing `PT%` onto `prothrombin_time` (`data/reference-labs.ts:1938-1962`, band 11-14.5 s, `criticalHigh: 30`) would compare 86.4 against a seconds band and classify it **critical-high**; R2's unit check (`allowedUnits: ['s','sec','秒']`) would abstain the chip, but the section would still be named "凝血酶原时间 / Prothrombin time" with seconds-framed plain text. Aliasing onto `inr` (:1964-1988) is worse in magnitude.

Entry shape:

- `key: 'prothrombin_activity'`, `specimen: 'blood'`, `interpretation: 'ours'`
- `aliases: ['PT%','PTA','凝血酶原活动度','PT活动度','凝血酶原活性']` — **never** `'PT'`. `normName` (`lib/reference.ts:5-11`) does not strip `%`, so `pt%` and `pt` stay distinct in `INDEX`; `data/reference-labs.test.ts:39` will confirm uniqueness.
- `unit: '%'`, `allowedUnits: ['%']`
- `refLow: 70`, `refHigh: 130`; `criticalLow: 40`, `criticalHigh: null` (a high PT% is not a panic value)
- `highStakes: true` (matches `prothrombin_time` and `inr`)
- `absoluteLow: 0`, `absoluteHigh: 200` — must not clip 70-130 or the critical bound (`data/reference-labs.test.ts:139` enforces this)
- `populationSensitive: false`
- `plain`/`definition` **must state the inverse relationship explicitly** ("lower percentages mean blood clots more slowly"), or a reader who knows PT-seconds will invert it. Both strings must pass the `CARD_BANNED` bank in `validation/b1VerdictLeakage.test.ts`.

> **RESOLVED 2026-07-19 — sourcing attempted and DELIBERATELY FAILED. Ship band-less.**
>
> The `refLow: 70` / `refHigh: 130` / `criticalLow: 40` figures above were stated from general
> knowledge. **All three are now withdrawn. Do not ship any of them.** Two independent sourcing
> passes over disjoint literatures (Chinese national standards; European/Japanese/US lab medicine)
> both returned no harmonised interval.
>
> **Why no band exists.** Bands found in the wild are mutually incompatible — 70–130, 80–120,
> 80–130, 75–100, 70–150, 85–100, ">70", and this corpus row's own printed 70–140. That spread is
> not measurement noise; it is the absence of a defined measurand. PT% is interpolated off each
> laboratory's own normal-pooled-plasma dilution curve, so it inherits reagent ISI, instrument,
> diluent and the pool itself — *more* method-dependent than PT-seconds, which is why INR was
> invented. Worse, at least three distinct quantities are all reported as "prothrombin activity %":
> **Quick %** (~33% sample; reflects FII, FV, FVII, FX *and fibrinogen* — almost certainly what a
> Chinese hospital on a Sysmex/Stago reports), **Owren %** (~5% sample; FV and fibrinogen supplied
> by reagent, so reflects only FII, FVII, FX), and **prothrombin index** (post-Soviet usage; a plain
> patient/normal ratio ×100). Importing a band across those is a category error, not an imprecision.
>
> Supporting citation, with its limit stated: **WS/T 220—2021** (NHC, PDF retrieved and clause read)
> declines to publish intervals and directs each laboratory to establish its own. **Do not overclaim
> this** — that standard scopes individual clotting-factor activity assays, not PTA specifically. It
> is strong evidence about the standards regime, weaker as a direct statement about PTA.
>
> **`criticalLow: null`. Do not ship 40.** Both passes converged on 40% from real retrieved
> documents, and it must still be rejected: 40% is a **diagnostic criterion, not a panic value** —
> one limb of a composite liver-failure diagnosis that also requires bleeding tendency, cause
> exclusion, and (in the Japanese criteria) an 8-week onset window. No Chinese 危急值 standard lists
> PTA; the emergency-lab consensus lists PT and APTT. The concrete failure mode is decisive: **a
> stably anticoagulated warfarin patient routinely sits below 40% PT activity.** Shipping 40 would
> fire the app's most alarming channel at a correctly-managed patient, from a threshold whose source
> document does not apply to them — a safety defect in the opposite direction from the one this
> cycle guards against. Liver-failure context, if wanted, belongs in non-alarming educational prose.

#### 4.3.1 Construction — the `thrombin_time` precedent does NOT mean what the note above assumed

**Verified against the code: `thrombin_time` is not band-less.** `data/reference-labs.ts` gives it
`refLow: 10, refHigh: 21`, and its `source` documents that band as the **union of two real printed
hospital ranges in this corpus** ("TT" 14–21 s; "凝血酶时间(TT)" 10.00–16.00 s), explicitly "not a
textbook figure and wider than any single laboratory's own range." That is a different pattern from
band-less and must not be cited as precedent for one.

The correct existing pattern is **`interpretation: 'report-only'`** — 14 entries already use it
(`urine_color`, `urine_nitrite`, …), all with `refLow: null, refHigh: null`.

**Both candidate constructions are defective. Verified empirically — read this before implementing.**

- **`interpretation: 'ours'` with both bounds null — SILENTLY WRONG. Do not use.** `classify()`
  returns `'normal'` for *every* value: probed 30 → `normal`, 86.4 → `normal`, 150 → `normal`. A
  severely impaired PT% of 30 would classify as normal.
- **`interpretation: 'report-only'` with `highStakes: true` — R6 NEVER FIRES as the code stands.**
  The report-only branch returns at `lib/guard.ts:244/246`
  (`return { action: 'classify', needsConfirm: …, flags }`) — **before R6 at `:354`**. `highStakes`
  is silently ignored, and the pre-registered +1 would not materialise.

**This is the same bug class the repo already fixed once, for R2.** The comment at `lib/guard.ts:268`
records it: *"R2 returns before R6 can fire, so without this a recognised-but-unit-mismatched
troponin abstained with needsConfirm=false AND no visible flag at all — strictly worse than not
recognising it, because R1 at least spoke. Recognising an analyte must never reduce what the user is
told."* The report-only path is a second instance of the same early-return hazard.

**Therefore W3 is a data entry PLUS a guard fix, not a data entry alone:**

1. `key: 'prothrombin_activity'`, `interpretation: 'report-only'`, `specimen: 'blood'`,
   `refLow: null`, `refHigh: null`, `criticalLow: null`, `criticalHigh: null`,
   `highStakes: true` (consistent with **all five** coagulation siblings — `prothrombin_time`,
   `inr`, `thrombin_time`, `aptt`, `fibrinogen` are every one of them `highStakes: true`).
2. **Mirror the R2 fix on the report-only branch**: carry `needsConfirm: entry.highStakes` out of
   `lib/guard.ts:246` instead of hardcoded `false`.
   **Regression risk today is zero and this is checkable**: all 14 existing `report-only` entries are
   `highStakes: false`, so the change is a strict no-op for every shipped entry and activates only
   for `prothrombin_activity`. State that check in the PR.
3. Add a test asserting a `report-only` + `highStakes` entry reaches the confirm gate — the
   combination has **no coverage today** because it has never existed.

Direction metadata is the highest-risk field in this entry and must be tested explicitly:
**low % = impaired clotting**, inverse to PT-seconds. A copy-paste of PT-seconds directionality
would flag high values and silently pass a critically low one.

Suggested `source:` text — *"No harmonised reference interval exists for prothrombin activity %. The
value is interpolated from each laboratory's own normal-pooled-plasma dilution curve, so it depends
on reagent, instrument, diluent and population; WS/T 220—2021 declines to publish intervals for
clotting-factor activity assays and directs each laboratory to establish its own. Published bands
disagree widely (70–130, 80–120, 85–100, 70–140), and the name covers at least two different
measurands (Quick-type, which includes fibrinogen and FV; Owren-type, which does not). This app
therefore uses only the range printed on the patient's own report and abstains when none is present.
Low percent indicates impaired clotting — the opposite direction from prothrombin time in seconds."*

The corpus row (86.40% against its printed 70–140) resolves correctly as normal under this design
with **zero curated numbers**. The +1 R6-gold prediction stands **only if** fix (2) lands; if
R6-gold reports 23/37 instead of 24/37, fix (2) did not wire through — that is the finding, not a
rounding error.

Under B1 the chip reproduces the *report's* printed 70-140 regardless; our band drives only classification and the guards.

### 4.4 The must-stay-unknown locks

**`a-淀粉酶`** — bare α-amylase with no printed specimen is serum-or-urine ambiguous. Add `specimenAliases.blood: ['a-淀粉酶','α-淀粉酶','α淀粉酶','淀粉酶']` to the `amylase` entry (`data/reference-labs.ts:1215-1237`) — resolves **only** when OCR reads a printed blood/serum specimen. Moving the currently-unscoped `淀粉酶` into that list is a strict improvement: today a urine amylase inherits the serum frame. Lock `null` for `unknown`, `null`, and `urine`.

Do **not** use the printed 35-135 to argue identity. Using the printed range to decide *which analyte this is* is exactly the inference the design forbids.

**`髓系原始细胞群`** (myeloid blast population, flow cytometry, `%`, no printed range) — no curated band is defensible and naming a blast population is diagnostic under the design test. Lock `null` across every specimen. Permanently unconfirmable; a residual the metric can never close.

**Already locked, no work required:** `钙(Ca)`, `镁(Mg)`, `铅(Pb)`, `镉(Cd)`, HIV Ag/Ab are locked at `data/english-aliases.test.ts:60-95`. The corpus prints interior spaces (`人类免疫缺陷 病毒抗体/抗原 (P24)`) but `normName` collapses spaces and strips parens, so the existing locks bind the corpus strings. `铜(Cu)`/`铁(Fe)`/`锌(Zn)` from the same panel are also already `null` — verified, no live leak.

### 4.5 REFUSED — the six `highStakes` disagreements

**Any diff to a `highStakes` field in `data/reference-labs.ts` in this cycle is rejected on sight unless accompanied by a cited clinical source.**

Flipping `wbc_count`, `rbc_count`, `hematocrit`, `urea`, `lymphocyte_abs`, `urine_ketones` to `highStakes: true` takes R6-gold from 62.2% to ~86% in six one-word edits — and fires a mandatory confirm on every CBC row of every report. That is metric-gaming that degrades the product. `validation/real-corpus/gold-labels.ts:22-27` states its own limit: LLM labelers, not clinicians, adjudicating with "when genuinely torn, prefer TRUE". A whole-blood-count high-stakes disagreement is precisely the torn case.

**Deliverable instead:** record these six as a *known, accepted gap* in the `validation/real-corpus/run.ts` output, so it stops reappearing as a work item each pass. The real resolution is a clinician-reviewed critical-value list — the upgrade `gold-labels.ts` already names.

### 4.6 Pre-registered metric movement

**MedRepBench R6-gold: 23/37 (62.2%) → 24/37 (64.9%). Exactly +1 row.**

Derivation, stated in advance:

- `PT%` curated with `highStakes: true` → **+1**. R6 fires on `entry.highStakes` unconditionally (`lib/guard.ts:344-346`) before any unit check — proven by the `PT` row in the same panel, which has an empty unit, hits R2-UNIT-MISMATCH, and still confirms.
- `a-淀粉酶` blood-scoped alias → **+0** (every corpus row is `specimen: 'unknown'`). Honest: safety work with zero metric payoff.
- The five already-locked items and `髓系原始细胞群` → **+0** by design.
- The six `highStakes` disagreements → **+0**; refused above.
- `GLU`/`葡萄糖` → **+0 in both directions**. `goldFor('葡萄糖')` is `highStakes: false`, canonical "Urine glucose (dipstick)" — not in the 37-row denominator, so removing its (wrong) blood confirm costs nothing. **Denominator stays 37.**

US corpus expected unchanged at 89/212. `GLU` may drop out of some MIMIC rows; **if US R6-gold moves at all, inspect before accepting.**

**Any result other than 24/37 means the wiring is wrong, not that the work over- or under-performed.**

### 4.7 Acceptance (D)

- [ ] All five `GLU`/`葡萄糖` locks pass; `findEntry('血糖')` unchanged.
- [ ] `findEntry('a-淀粉酶')` → `null` for `unknown`/`null`/`urine`; `'blood'` → `amylase`.
- [ ] `findEntry('髓系原始细胞群')` → `null` for every specimen.
- [ ] The existing specimen-ambiguity locks in `data/english-aliases.test.ts` pass **unmodified**.
- [ ] `PT%` resolves to `prothrombin_activity`; `findEntry('PT')` still `prothrombin_time`; `data/reference-labs.test.ts:39` uniqueness and `:139` bounds tests green.
- [ ] R6-gold ZH reported: predicted 24/37. Report actual. If short, name the row.
- [ ] `chipWrong` 0 on both corpora.
- [ ] Six accepted `highStakes` disagreements printed in the runner output.
- [ ] Zero `highStakes` field diffs in `data/reference-labs.ts` other than the new `PT%` entry.

---

## 5. W5 — Item F-2: the conditional-referral leaks

### Evidence

The framing defence **holds for the text**. Every surfaced flag's copy (`lib/summary.ts:110-146`, `SURFACING_FLAGS`) is about reading confidence or scope, not clinical meaning. The clinical guards — R3, R4, R11, R12, R17 — are deliberately kept out of `SURFACING_FLAGS` and policed by `validation/b1VerdictLeakage.test.ts`. That is well built.

**It fails at the trigger, in two places.**

**F-2a.** `lib/guard.ts:345`:

```ts
if (entry.highStakes || classification === 'critical') {
```

`entry.highStakes` is **analyte-level** — value-independent, therefore safe: every potassium row gets the chip regardless of the number. `classification === 'critical'` is a **value-level** verdict derived from our curated `criticalLow`/`criticalHigh`. R6 is in `SURFACING_FLAGS` (`lib/summary.ts:126`). So the chip's *presence* is a function of the patient's number.

Reachable set verified: **3 entries are `highStakes: false` with a critical band** — `wbc_count [2, 30]`, `platelet_count [20, 1000]`, `phosphate [0.32, null]`. A patient with WBC 6 sees no chip; a patient with WBC 35 sees "Because this test matters, please confirm the value we read." Nothing else on the screen changed. For the other 35 high-stakes analytes the `||` short-circuits, which is why this went unnoticed — a 3-analyte hole, not a systemic one. The copy is also mildly dishonest: it says "because this test matters", but for these three the reason is "because your number is in our panic band."

**F-2b.** `components/ConfirmValues.tsx:25,69` renders a row **iff `r.needsConfirm`**. `needsConfirm` is set by R3 (critical, `guard.ts:290`), R5 (`:330`), R6 (`:346`), R13 (`:283`), R16 (`:374`), R17 (`:427`), and R11 on `valueFlips` (`:448`). R3, R11-flip and R17 are value-and-table-derived clinical conclusions. Keeping their *messages* internal does not help — the user observes that this row, and not the one above it, was singled out. `lib/uiCopy.ts:35-44` frames the selection as OCR-driven ("double-check a few results from your photo"), so a user reads singling-out as "the machine is unsure here" when the actual cause on an R3 row is "your potassium is 6.8." The existing gate cannot catch this: `b1VerdictLeakage.test.ts:97-102` inspects chip + surfaced flags only and never asserts which rows reach the confirm list.

### Changes — ONE commit

**F-2a alone is insufficient and would read as "fixed" in a green run.** Removing the critical arm from `guard.ts:345` removes the *text* leak, but R3 at `:290` still sets `needsConfirm` for critical rows, so confirm-list membership still varies with the number. F-2a and F-2b land together.

1. **`lib/guard.ts:345`** — drop the critical arm from R6's surfaced trigger. Keep `R6-HIGH-STAKES-MANDATORY-CONFIRM` gated on `entry.highStakes` alone. Critical-driven confirm is already carried by R3 at `:290`; emit nothing new surfaced. Net: the R6 chip becomes a pure function of *which test this is*.
2. **F-2b — DECISION REQUIRED.**

   - **(a) Unconditional confirm.** `ConfirmValues.tsx:25` becomes `report.rows`; `:69` drops the conditional. `needsConfirm` survives as an internal field. Cleanest B1 story, cannot regress.
   - **(b) Reading-confidence-only selection.** `needsConfirm` narrowed to R5, R13, R16, and analyte-level R6; R3, R11-flip and R17 move to a new internal `needsReview` on `GroundedRow` (`lib/types.ts`) driving suppression and metrics but not the confirm list.

   > **DECIDED 2026-07-19: (b).** This overrides the "Recommendation: (a)" that stood here, on
   > evidence the spec asked for but did not have when it was written.
   >
   > **Finding 1 — the confirm screen is a BLOCKING GATE, not a review panel.**
   > `app/result/page.tsx:85` renders `{!confirmed ? <ConfirmValues/> : <SummaryView/>}`. The user
   > cannot see their report until they pass it. `ConfirmValues.tsx:35` passes through silently
   > when the list is empty, so today the gate is *invisible* on most reports.
   >
   > **Finding 2 — measured confirm burden** (`groundExtraction` over both committed corpora,
   > editable fields per report):
   >
   > | | today (median / max / total) | under (a) (median / max / total) |
   > |---|---|---|
   > | MedRepBench (ZH, primary) | **0** / 6 / 30 | **4** / 20 / 143 |
   > | MIMIC (US) | **4** / 10 / 91 | **14** / 24 / 322 |
   >
   > Both corpora exclude their largest panels (`sample.ts:17-19` drops an ~30-row IgE microarray
   > and two long urinalysis panels for size), so real-world maxima are **higher** than shown.
   >
   > Option (a) therefore converts an invisible pass-through into a mandatory wall of a median 4
   > (ZH) to 14 (US) editable fields on every report — currently rendered in Chinese for Tibetan
   > users, since `lib/i18n.ts` falls back to `zh`. For this user population that is a serious
   > regression, and the spec's own guardrail names the property at risk: the user actually
   > verifying the high-stakes numbers.
   >
   > **Finding 3 — (b) is also the more honest option, not merely the cheaper one.** The leak
   > being fixed is R3: a critical potassium is singled out under copy that says
   > "double-check a few results from your photo" (`lib/uiCopy.ts:35-44`). The true cause is
   > "your number is in our panic band." Moving R3/R11-flip/R17 to `needsReview` removes exactly
   > that dishonesty. What remains in `needsConfirm` — R5 (low OCR confidence), R13 (value
   > outside absolute physiological bounds), R16 (printed range implausible) — is value-triggered
   > but genuinely *about reading confidence*, so the OCR framing is true for those rows.
   > (b) also makes the gate fire *less* often than today, since R3 currently forces it.
   >
   > **Honest weakness of (b), which the implementer must not paper over.** (b) does NOT satisfy
   > the literal §0 design test: confirm-list membership still varies with the number via R13/R16.
   > It substitutes a finer line — value-dependence signalling *reading confidence* is permitted;
   > value-dependence signalling a *clinical conclusion* is not. This repo's history is that
   > subtle lines erode (B1 shipped half-done once already). **The conditionality gate below is
   > what keeps this one from eroding and is therefore mandatory, not optional, under (b).**
   >
   > **Gate construction under (b):** ground each curated analyte at a normal value and at a
   > critical-but-physiologically-plausible value, and assert the surfaced-flag id set **and**
   > confirm-list membership are identical. Critical-but-plausible is the correct second point
   > because R13 fires only on physiologically *impossible* values, which lie outside that range —
   > so the gate still catches the R3 leak without falsely failing on R13. Land it red first: it
   > fails today on `wbc_count`, `platelet_count`, `phosphate` (verified: exactly 3 entries are
   > `highStakes: false` with a critical band).
   >
   > **Metric consequence under (b), per item 3 below:** re-ground `realContentBench.ts:256` on
   > `needsConfirm || needsReview`. Without this, moving R3/R11/R17 out of `needsConfirm` promotes
   > critical rows into the "presented confidently" set — inflating the agreement denominator with
   > precisely the rows most likely to disagree. That is the 80%-self-graded failure mode, and it
   > is the single most likely way this change ships green and wrong.

3. **Metric rename, same commit — mandatory.** `validation/real-corpus/realContentBench.ts:275` computes `r6CoverageGold = goldHighStakesConfirmed / goldHighStakesRows` with the numerator being `row.needsConfirm` (`:221`), and `:256` defines the safety metric as `classifiedDetail.filter(d => !d.needsConfirm)` — "rows we present confidently".
   - Under (a), "high-stakes rows reaching the confirm gate" no longer describes anything a user experiences. Rename to `r6HighStakesFlagRate` (or equivalent) and re-ground it on `entry.highStakes` flag emission, and state in the runner output that the confirm screen is now unconditional.
   - Under (b), moving R3/R11/R17 out of `needsConfirm` would move critical rows *into* the "presented confidently" set, inflating the denominator of the agreement metric with the rows most likely to disagree. Re-ground `:256` on `needsConfirm || needsReview`.

   **Neither option is acceptable without the rename in the same change.** Shipping either with the old metric names reproduces the 80%-self-graded / 27.4%-gold-graded failure.

4. Optionally reword R6's copy to name the analyte-level reason ("Tests like this one are always double-checked").

### Guardrail against satisfying the letter (critic finding D)

Making the confirm list unconditional on a 40-row Chinese panel produces 40 editable fields on a phone. The letter is satisfied; the property — the user actually verifies the high-stakes numbers — is destroyed. Worse, `submit()` at `ConfirmValues.tsx:41-49` re-grounds from every edited field, so a user scrolling past can corrupt values they never looked at.

**If (a) is chosen:** high-stakes rows must remain visually and structurally distinguished within the unconditional list on an **analyte-level** basis (`entry.highStakes`, never `classification`), and the PR must report a **measured confirm-burden number** — median editable fields per report on both corpora, before and after.

### New gate — the one the file lacks

`validation/b1VerdictLeakage.test.ts`: assert over **trigger conditionality**, not text. For each curated entry, ground the same analyte at a normal value and at a critical value and assert the visible surface — surfaced-flag id set **and** confirm-list membership — is **identical**.

**This test fails today on `wbc_count`, `platelet_count`, `phosphate`. Write it first and land it red.** It is the gate that actually encodes the permanent design test.

### Invariant

No screen element may vary with the patient's number except the printed number itself. Enforced by the new conditionality gate above; `b1VerdictLeakage.test.ts`'s existing text banks stay unmodified.

### Pre-registered metric movement

R6-gold as currently defined becomes **undefined** after this change. Report, in the PR:

- the last pre-F number (24/37 ZH, 89/212 US, from W3);
- the newly named metric's first value;
- median confirm-burden before/after on both corpora;
- `chipWrong` still 0.

### Acceptance

- [ ] Conditionality gate lands red, then green.
- [ ] `lib/guard.ts:345` no longer references `classification`.
- [ ] Confirm-list membership is independent of every patient value on both corpora.
- [ ] Metric renamed and re-grounded in `realContentBench.ts`; runner output states the new semantics.
- [ ] Confirm-burden numbers reported.
- [ ] `chipWrong` 0 on both corpora.

---

## 6. W6 — Item E defects #1 and #3, plus the `reviewed()` mislabel

### 6.1 Defect #1 — the printed range is withheld on exactly the rows that need it most

`lib/summary.ts:269`:

```ts
reportRange: !defer ? (row.extracted.printedRange ?? '') : '',
```

Reproduction of the report's own range is gated on *our ability to compute a comparison from it*. Any row where `printedRange` is a non-null string that `parsePrintedRange` cannot parse — footnote refs, `见备注`, prose or asymmetric ranges, a qualitative range against a numeric value — hides text printed on the page in front of the user. Exactly inverted relative to §0: computing is the risky act, reproducing is the safe one.

**Change:** reproduce `printedRange` whenever it is a non-empty string, **independent of `defer`**.

**Do NOT** later narrow this to `(!defer || flagDir !== null)`. Item A must not touch this line.

Test edits (both currently assert `reportRange === ''` when deferring): `lib/summary.test.ts:172`, `lib/summaryDecoupled.test.ts:34`. Amend to assert an unparseable-but-present printed range is reproduced verbatim while the chip stays "Not assessed". These two edits are the behavioural core.

New case in `lib/summary.test.ts`: R1 row, unknown Chinese analyte, printed range `'见备注'` → chip "Not assessed", `reportRange === '见备注'`, `plain === ''`, `typicalRange === ''`, R1 flag present.

### 6.2 Defect #3 — R18 rows display a curated name we have just declared uncorroborated

`lib/summary.ts:249` keys off `entry`, not `handled`. An R18 row has a non-null `entry` (the guard returns at `lib/guard.ts:214` *after* matching), so the card renders `entry.name`. On the exact failure R18 exists to catch — the mislabelled blood gas resolving to `urine_ph`, documented at `lib/guard.ts:178-186` — the user sees the heading **"Urine pH"** above a blood pH, next to a flag saying we could not confirm the specimen.

**Change:** gate the name on `handled`, not `entry`, for `matchedVia === 'specimen-scoped'` R18 rows; fall back to `extracted.name` verbatim.

**Second call site — do not miss it.** `components/ConfirmValues.tsx:73` independently renders `r.entry.name`, falling back to `r.extracted.name` at `:91`. The same R18 row shows "Urine pH" on the confirm screen, which the user sees **first**. Fix both in the same commit.

Test: R18 blood-gas fixture already used in `lib/guard.test.ts` → assert `resolveText(section.name,'en').text === extracted.name` and **not** the curated entry name; plus a `ConfirmValues` render assertion for the same row.

### 6.3 The `reviewed()` mislabel at `lib/summary.ts:251-255`

`row.extracted.name` — raw OCR/model output — is wrapped in `reviewed()` for all three language slots. Nothing about that string was reviewed by anyone, and it suppresses the verification marker on the one string whose whole risk profile is that it might be misread.

**Two conflicting proposals existed. Use `unverified()` on all slots (Item G's form), not `zh: reviewed(...) / en: fallback('zh')` (Item E's form).** E's version hardcodes the assumption that the OCR'd name is Chinese, but source languages are ZH **and** EN, and neither `ExtractedRow` (`lib/types.ts:66-73`) nor `GroundedReport` (`:83-88`) carries a source-language field. On a MIMIC-style English report E's fix would label an English analyte name as reviewed Chinese and hand a `bo` user a `zh`-classed CJK-font English string. `unverified()` is language-agnostic and correct.

Related, low-risk: `lib/summary.ts:103-107` marks the empty string `reviewed('')`. Harmless but it muddies any future "count the reviewed strings" audit — replace with a dedicated `emptyLocalizedText` constant outside the review taxonomy.

Test: an R1 row rendered at `lang: 'en'` must emit `data-translation-review="unverified"` on the name. `components/LocalizedText.test.tsx` already exercises this marker.

### 6.4 Analyte name on abstained rows — decision recorded

**Show the extracted name verbatim. Do not machine-translate it.** Rejected alternative: translate with an unverified marker. The marker infrastructure works (`components/LocalizedText.tsx:55-77`), which is the trap — the failure mode is not that the user distrusts an unverified translation but that they *cannot* check it. The errors are not random either: unknown Chinese analyte names are dominated by near-homograph panel members (载脂蛋白A1 vs 载脂蛋白B, 直接胆红素 vs 间接胆红素, 游离 vs 总 T3/T4), where a plausible wrong translation lands on a real, different, adjacent test. Beside a faithfully reproduced "Above your report's range", an unverified name reads as a complete, understood row.

Honest cost: a Tibetan-monolingual user gains nothing *semantic* from the verbatim name. What they gain is a card they can hold beside the report and hand to a clinician, with value, unit, printed range and the report's own text all matched and legible.

**The correct place to spend effort is growing the lookup, not the trust boundary.** Every name moved into `data/reference-labs.ts` as `interpretation: 'report-only'` (`lib/types.ts:16`, handled at `lib/guard.ts:222-238`) buys a *reviewed* translated name with no band and no classification. Strictly additive to the verbatim floor.

### 6.5 Out of scope for W6

Item E's defect #2 (capture the report's own flag) is **W7**, and its rendering is excluded from this cycle entirely — see §7. **Do not add a `reportFlag` display field in W6.**

### Invariant

Every glyph on an abstained card must be traceable to a glyph on the paper or to a fixed reviewed label. Enforced by `validation/silentAssertion.test.ts` and by the R18 name test above.

### Acceptance

- [ ] `lib/summary.test.ts:172` and `lib/summaryDecoupled.test.ts:34` amended; `'见备注'` case passes.
- [ ] R18 blood-gas row shows `extracted.name` on both the summary card and the confirm screen.
- [ ] R1 row at `lang:'en'` emits `data-translation-review="unverified"` on the name.
- [ ] `lib/localizationBaseline.test.ts` **unchanged** — this item edits no EN/ZH source string. A hash movement here is a bug.
- [ ] `chipWrong` 0; no corpus metric movement expected.

---

## 7. W7 — Item A: capture the printed flag, DARK

### Evidence — the defect is real and worse than "uncaptured"

`lib/summary.ts:146-166` `reportStatus()` derives position by arithmetic: `statusAgainstPrinted(parseScalar(row.extracted.value), printed)` (`:156`), with qualitative (`:159`) and range-valued (`:165`) fallbacks. All three are our computation.

`lib/extractionSchema.ts:3-25` `ExtractedRowSchema` has `name, value, unit, printedRange, confidence, specimen`. No flag field. Mirrored at `lib/types.ts:66-73`.

**The marker is not merely uncaptured — it is actively discarded.** `lib/reference.ts:186` `parseScalar` does `s.trim().replace(/[↑↓HL]+$/i, '')`, with a comment citing `"569.412↑"` as verbatim corpus text. That row is real: `validation/real-corpus/sample.ts:172`. When the model *does* transcribe the glyph (into `value`, the only field that could hold it), we strip it and re-derive our own answer. `validation/chipFidelity.test.ts:42` reproduces the same strip in its independent oracle, so the discard is currently blessed on both sides.

**Not verified:** what fraction of real Chinese hospital reports print a marker. Both corpora carry the flag as a *structured dataset field* (`is_abnormal`), not as page text, so neither can measure OCR capture.

### THE HARD CONSTRAINT: land this dark

**The `Marked high on your report` chip is NOT in this cycle.**

Reason: it is a user-visible clinical assertion with, by construction, an unmeasurable false-positive rate. Its correctness depends entirely on whether the model *transcribed* a glyph or *induced* one by comparing value to range — the induction the prompt tries to forbid. Lock 1 below only proves a **null** flag never yields a `Marked …` chip. Nothing can prove a **non-null** flag is genuine, because §7.5 Lock 7 correctly forbids synthesising `printedFlagRaw` from `is_abnormal`, and both corpora's flags are direction-free anyway (MIMIC binary, MedRepBench `'0'/'1'`). A hallucinated ↑ is *worse* than today's derived chip: it launders our inference as the lab's determination. That is the 80%/27.4% failure reproduced exactly.

**Land: the schema field, the prompt instruction, `printedFlagDirection`, and the tests. Render nothing.** Rendering is a separate later item gated on a hand-transcribed fixture of ≥50 rows read off page images, with a measured false-positive rate stated as a number before any pixel ships.

### 7.1 Schema

Add to `ExtractedRowSchema` (`lib/extractionSchema.ts:3-25`) and `ExtractedRow` (`lib/types.ts:66-73`):

```
printedFlagRaw: string | null    // model-supplied, verbatim glyph(s)
```

**Optional + nullable**, exactly like `specimen` (`extractionSchema.ts:16-24`): `.nullable().optional()`. Required for compatibility — `ExtractedRow` literals are constructed in at least nine places (`validation/real-corpus/realContentBench.ts:173`, `validation/run.ts:74`, `validation/grounding-bench/groundingRecall.ts:22`, `validation/checklist/cases/*.ts`, and the zod schema at `validation/checklist/types.ts:18`). Optional = zero call-site churn. Add the field to `validation/checklist/types.ts:18` too, or checklist cases cannot express a flag.

**"The report printed nothing" is `null`, never `''`.** There is a third state we cannot observe — "no flag column at all" vs "flag column present, this cell blank". **Do not attempt to capture it**; distinguishing them is a layout inference, the class of judgement the extraction prompt forbids everywhere else. Its unobservability is precisely why rendering is deferred.

### 7.2 The direction enum is derived by us, not by the model

```
type PrintedFlagDirection = 'high' | 'low' | 'abnormal';
printedFlagDirection(raw: string | null): PrintedFlagDirection | null
```

Pure function, **single string argument, no access to value or range.** Put it in `lib/reference.ts` beside `parseQualitative`, modelled on the closed table at `lib/reference.ts:194-221` (`QUALITATIVE_TOKENS` / `parseQualitative`). This preserves the invariant that the LLM is OCR-only: the model copies a glyph, a curated table assigns meaning.

Closed glyph table; anything unlisted → `null`, fail closed:

| direction | tokens |
|---|---|
| `high` | `↑` `H` `HI` `HIGH` `偏高` `增高` `升高` `高` |
| `low` | `↓` `L` `LO` `LOW` `偏低` `降低` `减低` `低` |
| `abnormal` | `*` `!` `A` `异常`, and any composite where direction is genuinely ambiguous |

Normalise like `normName` (`lib/reference.ts:5-11`): trim, lowercase, strip whitespace/punctuation.

Note `H`/`L` are also legitimate *analyte names* in MIMIC (`validation/real-corpus/us-sample.ts:262`, `:398` — rows literally named `H` and `L`, gold-labelled `non-analyte` at `validation/real-corpus/gold-labels.ts:93-95`). That is a name-column collision, not a flag-column one, so the table is unaffected — but it is the reason the prompt must say the flag is *positionally adjacent to the value*, not "any H on the page".

### 7.3 Prompt

`lib/extractionSchema.ts:34-44`. Line 41 (`Do NOT classify results as normal/abnormal…`) stays **verbatim** — it is the anchor. Add immediately after it, and mirror it in the field's `.describe()`:

> Some reports print an abnormality marker in or beside the result cell (for example ↑ ↓ H L * ! 偏高 偏低). Copy that marker into printedFlagRaw exactly as printed, as a verbatim string, and keep it OUT of the value field — value is the number alone. If no marker is printed for this row, printedFlagRaw MUST be null. Never write a marker that is not visibly printed on the page, and never produce one by comparing the value to the reference range; that comparison is not your task. If you cannot tell whether a mark is a flag or a printing artifact, use null.

Four deliberate properties: "copy … exactly as printed" matches the register of line 36; "keep it OUT of the value field" stops the current failure mode where the glyph lands in `value` and is stripped at `reference.ts:186`; "never produce one by comparing the value to the reference range" blocks the exact induction that matters (the model has both numbers in front of it); "if you cannot tell … use null" fails closed, matching the specimen rule at line 38.

**Leave the `[↑↓HL]+$` strip at `lib/reference.ts:186` in place.** After this lands it becomes a *defensive* fallback, not the primary path; removing it would regress rows where the model disobeys.

### 7.4 Do NOT

- Do **not** render any chip, badge, glyph, or field derived from `printedFlagRaw`.
- Do **not** touch `lib/summary.ts:269` (see W6) or add precedence logic in `lib/summary.ts:225-245`.
- Do **not** teach `validation/chipFidelity.test.ts` about flags. Its header (`:29-38`) says it deliberately re-derives; importing the production glyph table converts it back into the mirror that header warns against. **`chipFidelity.test.ts` and `goldLabelGates.test.ts` are must-not-touch for the entire cycle. Any diff to them is rejected.**
- Do **not** synthesise `printedFlagRaw` from `is_abnormal` in `realContentBench.ts:173`. `is_abnormal` is the oracle `goldLabelGates.test.ts:16-27` uses to grade the chip; feeding it back as an *input* makes `chipCorrect` self-referential and destroys the independence property those tests protect (`goldLabelGates.test.ts:50-55` guards this class of collapse).

### 7.5 Tests

Follow the `b1VerdictLeakage.test.ts` gate style — long header comment stating the invariant *and why it exists*, exhaustive enumeration, `expect(violations).toEqual([])`. New file: `validation/printedFlagReproduction.test.ts`.

- **Lock 2 — purity.** Matrix: each glyph in the table × a spread of `(value, printedRange)` pairs chosen so the *derived* status differs across them; assert `printedFlagDirection` returns an identical result. A function that started consulting the number fails immediately. Reinforce structurally by keeping the signature to a single `string | null`.
- **Lock 4 — fail closed.** `'?'`, `'⚑'`, `'见备注'`, `''`, `'  '` → `null`, and the raw string never appears in any user-visible copy. Blocks the "just render whatever the model sent" shortcut.
- **Lock 6 — prompt wording.** In `lib/extractionSchema.test.ts`, parallel to the existing `it('keeps specimen capture OCR-only…')` at `:47-58`: `it('keeps printed-flag capture copy-only…')` with `toMatch` on `/must be null/i`, `/never .* comparing the value to the reference range/i`, `/exactly as printed/i`. Cheapest real lock in the item.
- **Lock 7 — measurement honesty.** Assert **no corpus row carries a `printedFlagRaw`**.
- **Backward-compat.** Every existing fixture omits the field and must take the unchanged branch. `lib/extractionSchema.test.ts:5-11`'s "old row shape" test passes as-is.
- **Deferred to the rendering item, do not write now:** Lock 1 (non-invention over ~465 rows), Lock 3 (precedence both directions), Lock 5 (`ALLOWED_CHIPS` extension + flagged `FORCING_ROWS`), and the `silentAssertion` detector widening.

### Recorded for the future rendering item, so it is not lost

When the chip does ship:

- Precedence must sit **ahead of** `unusable` (`summary.ts:225-228`) and survive R13 and R16 — R16 is a claim about the *range* and the flag is not computed from the range; R13 is a claim about the *value* and the flag is a separate glyph the lab printed against its own correctly-read value. R13/R16 stay in `SURFACING_FLAGS` so the reading caveat is spoken beside it.
- Attribution must be **inside the chip string** ("Marked high on your report" / "报告标注偏高"), tone `'report'`, **never coloured** — colour is our valence judgement and is the precise thing the WHOOP letter treated as diagnostic intent.
- `validation/silentAssertion.test.ts`'s `asserted` detector currently keys on `/your report's range/` (cf. `realContentBench.ts:185`). A `Marked …` chip asserts a position the detector will not see, so the invariant silently stops covering the new path **while staying green**. Widen the detector in the same commit that introduces any new position-asserting chip.
- A **disagreement guard** is worth including: when `flagDir !== null` and `reportStatus(row) !== 'none'` and the two disagree, we have positive evidence one of our two readings is wrong. Suggest `R19-PRINTED-FLAG-DISAGREES`, added to `SURFACING_FLAGS` — it describes the report's own content and our confidence in reading it, which is speakable under the rule at `summary.ts:110-113`. It discloses the conflict rather than resolving it.
- `components/ConfirmValues.tsx:43` spreads `...r.extracted`, so `printedFlagRaw` survives a user edit. On an edited value the flag should be kept (it is still what the report printed) with R19 re-run against the corrected value.

### Invariant

The LLM is OCR-only; meaning is deterministic from a curated table. Enforced by Lock 2 (purity), Lock 6 (prompt wording), and by the fact that nothing renders.

### Pre-registered metric movement

**None.** No corpus row carries a flag; every metric byte-identical. Any movement means Lock 7 was violated.

### Acceptance

- [ ] `printedFlagRaw` optional+nullable in `extractionSchema.ts`, `types.ts`, `validation/checklist/types.ts`.
- [ ] `printedFlagDirection` takes exactly one `string | null` argument.
- [ ] Locks 2, 4, 6, 7 green; existing fixtures untouched.
- [ ] `grep -r printedFlagRaw components/ app/` returns nothing.
- [ ] `chipFidelity.test.ts`, `goldLabelGates.test.ts` diff-free.
- [ ] Corpus output byte-identical to the pre-W7 run.

---

## 8. W8 — Item B: render the glossary (gate and data first)

### Evidence

`lib/summary.ts:262` sets `glossary: handled ? entry!.plain : emptyText()`; declared at `lib/summary.ts:43`. **No component, page, or test reads it.** The only `glossary` references in the tree are that field, its doc comment (`:40-42`), and the exemption comment in `validation/b1VerdictLeakage.test.ts:15-18`. Computed and discarded.

Negative finding: `data/medical-lexicon.ts` is **not relevant** — it is the doctor-notes detector table (negations, dose units, drugs) and holds no glossary content.

Measured over all 111 entries (both languages):

| measure | count |
|---|---|
| `REFERENCE_LABS` entries | 111 (`interpretation: 'ours'` 97, `'report-only'` 14) |
| `plain` textually identical to `definition` in **both** en and zh | **26** |
| `plain` trips `CARD_BANNED` in EN | 38 |
| `plain` trips `CARD_BANNED` in ZH | 25 |
| `plain` trips the strict `BANNED` list (triage/urgency) | **3, all Chinese** |

So `plain` is emphatically **directional, by design** — that is what the split at `lib/summary.ts:259-262` exists to quarantine, and it is legal in the reference-material lane.

### 8.1 LIVE LATENT DEFECT — three triage strings, and a gate that would miss half of them

`BANNED` (unlike `CARD_BANNED`) is placement-independent (`validation/b1VerdictLeakage.test.ts:6-8`: the non-device lane also forbids triage/urgency signals). Three entries carry it:

- `neutrophil_abs` — EN "…needs prompt medical attention." / ZH "…需要及时就医。"
- `urine_ketones` — EN "…a warning sign needing prompt attention." / ZH "…需要及时就医的警示信号。"
- `lactate` — EN "…a critical value requiring immediate notification of the care team." / ZH "…列为危急值，需立即通知医疗团队。"

`lactate` is worst: it names a numeric threshold (4.0 mmol/L) *and* calls it a critical value. One tap from the patient's own lactate number, that is the bright line reconstructed by the reader in two steps.

**The gate as naively written would certify the defect.** Running the current `BANNED` bank (`b1VerdictLeakage.test.ts:44-56`) over all 111 `plain` values produces **only 3 hits, all Chinese**. The English counterparts do not trip: `BANNED` has `/promptly/i` (the `-ly` is load-bearing) and `/critical range/i`, which does not match "critical value".

**Therefore the gate must be widened before it is applied:** add `/needs? (urgent|prompt|immediate)/i` and `/critical value/i` to `BANNED`. Without this, the gate goes green after fixing three Chinese strings while shipping English triage prose into a newly-rendered glossary.

### 8.2 Order within W8 — strict

1. Widen `BANNED` with the two patterns.
2. Add the new exhaustive gate: every `REFERENCE_LABS[].plain` against **`BANNED` only**, not `CARD_BANNED` — directional education is the glossary's purpose and must remain legal. Land it **red**.
3. De-triage the three entries in both languages (six strings). Gate goes green.
4. Re-baseline `REFERENCE_BASELINE.en` and `.zh` (`lib/localizationBaseline.test.ts:10-14`). `entry.plain` has exactly one other consumer — that frozen hash. `data/reference-labs.test.ts:99` (non-empty both langs) and `:103` (`plain.bo === fallback('zh')`) still pass untouched.
5. Rewrite the exemption comment at `b1VerdictLeakage.test.ts:15-18` — it currently justifies leaving glossary unpoliced *because* it lives one tap away; that no longer covers triage text.
6. Only then, render.

### 8.3 What renders

Insert into `Section` (`components/SummaryView.tsx:42-128`), **after** the `row-foot` block (`:104-125`), as the last element in the `<li>`. Render only when **both**:

- `resolveText(s.glossary, lang).text` is non-empty (abstained/unrecognised rows return `emptyText()`, so the long tail gets no control at all — correct, and worth stating in the commit: the disclosure appears on recognised rows only);
- the glossary text **differs from `s.plain`**. 26 of 111 entries have `plain === definition` (all 14 `report-only` entries via `urineReportOnly` at `data/reference-labs.ts:33`, plus 12 `ours` entries such as `rbc_count`). For those a disclosure would expand to a verbatim repeat of the paragraph two lines above. Suppress.

Panel contents, in order, and **nothing else**:

1. The analyte **name** (`s.name`) as a heading — the glossary is about the *test*, not this reading.
2. `<LocalizedText value={s.glossary} lang={lang} />`, plus the secondary-language copy under the same `plain.secondary.text !== plain.primary.text` condition already used at `components/SummaryView.tsx:83-89`.

**Do NOT re-render `s.valueText`, `s.chip`, `s.reportRange`, or `s.typicalRange` inside the panel.** This is load-bearing, not a nicety — see 8.4.

New `UI_COPY` keys in `lib/uiCopy.ts` (all `en`/`zh` reviewed, `bo: fallback('zh')`): a control label (`whatIsThisTest` — "What is this test?" / "这项检查是什么？") and a close label if the dialog route is taken. Safe to add: `lib/localizationBaseline.test.ts:32-34` locks only the *legacy* subset and explicitly tolerates new keys — but re-read that assertion's shape before adding, since it iterates `LEGACY_UI_COPY`, not `UI_COPY`.

### 8.4 The control — use a native `<dialog>`

The rationale for the `plain`/`glossary` split is that directional text must not be *composed* with the patient's own number: a directional clause under a chip that already says "Above your report's range" reads as "your value is above, and above means diabetes."

- **`<details>`/`<summary>`** is ~15 lines with free keyboard/SR support, but when open the panel sits inside the same `<li>` as the value and the chip, in one viewport. It reduces co-visibility to a deliberate act; it does not eliminate the composition.
- **Native `<dialog>` modal (recommended)** — the tap opens a sheet covering the card. The patient's number and chip are **not present in the dialog**, so there is no surface on which the two compose. ~40 lines with `useRef` + `showModal()`/`close()`; native `<dialog>` gives focus trap, `Esc`, backdrop and `aria-modal` free.

If `<details>` is chosen for cost, **the commit must record that co-visibility-on-expand was accepted knowingly** — a later reviewer reading `lib/summary.ts:40-42` will otherwise read the shipped UI as contradicting it.

Accessibility (either route):

- A real `<button>` (or `<summary>`), keyboard-reachable, with a discernible name including the analyte name — "What is this test?" repeated 12 times is 12 identically-named controls to a screen-reader user. Compose an `aria-label` from `resolveText(s.name, lang).text`, or use a visually-hidden span.
- Touch target ≥ 44×44 CSS px. The audience is patients on phones.
- `<details>`: `<summary>` conveys expanded state natively — do **not** add a redundant `aria-expanded`. `<dialog>`: `aria-haspopup="dialog"`; return focus to the invoking button on close.
- Do **not** set `lang` yourself on the wrapper — `LocalizedText`/`TibetanText` already do this from the *resolved* language (`components/LocalizedText.tsx:19-29`).
- The zh paragraph needs the `.zh` class for the CJK font stack, consistent with `components/SummaryView.tsx:85`.
- New CSS required: `app/globals.css` has `.row-plain` (`:623`) and `.row-foot` (`:672`) but **no `details`/`dialog` styling at all**. Respect `prefers-reduced-motion` on any open/close transition.

### 8.5 The bo problem — state it, do not paper over it

`LANGUAGE_CONFIG.bo = { fallback: 'zh', secondary: 'en' }` (`lib/i18n.ts:42`). All 111 `entry.plain` values are `bo: fallback('zh')` — verified programmatically, zero direct-bo variants; `data/reference-labs.test.ts:103` enforces it. So `resolveText(glossary,'bo')` returns Chinese with `resolvedLang:'zh'`, `usedFallback:true`, `review:'unverified'` (forced by `lib/i18n.ts:100-103`). The user sees the Chinese paragraph plus one inline "翻译未经审核" marker (`components/LocalizedText.tsx:72-74`) and the page-level Tibetan-unavailable banner (`app/result/page.tsx:65-69`). `TibetanText` is not used (it engages only when `resolvedLang === 'bo'`).

**Keep `showVerification` at its default `true`.** Because the glossary body is a *single* `LocalizedText` instance the marker appears exactly once at the end of the paragraph. Do **not** pass `showVerification={false}` and hand-place a marker in the panel header — that trades a tested invariant for cosmetics.

Record honestly in the commit: this increases the volume of unreviewed-fallback clinical text on screen by roughly an order of magnitude per row for the app's primary audience. `lactate` alone is ~120 words of dense prose. Tibetan glossary review is the follow-on dependency; rendering is still a strict improvement over discarding (a bo user today gets one sentence and nothing else).

### 8.6 Tests

`validation/b1VerdictLeakage.test.ts`:

- The widened `BANNED` bank and the new `plain`-vs-`BANNED` gate (§8.2). Mirror the shape of the definition gate at `:299-307`.
- A wiring gate mirroring `:313-348`: assert `SummarySection.glossary` equals `entry.plain` for recognised rows and `''` for abstained ones, so a future refactor cannot silently re-point it at `definition` (making the feature a no-op).
- **Do NOT add `s.glossary` to `visibleCopies()` (`:102-107`).** That helper asserts non-empty in all three languages (`:144`, `:172`), and glossary is legitimately `''` on every abstained row — it would fail for the wrong reason. Give it its own gate with its own emptiness policy, routed through `expectSafeLocalizedCopies` so it inherits the `directBo` tripwire at `:134-139`/`:174-176`.

`components/SummaryView.test.tsx`:

- Recognised row (`空腹血糖 7.8`): control renders; the directional string is **absent from the DOM before interaction** (assert absence, not `.not.toBeVisible()`, if using the dialog route where content can be mounted-but-hidden); after clicking, it appears.
- Dialog route: assert `7.8` and the chip text are **not** inside the dialog subtree.
- Unrecognised row (`ceruloplasmin`): no control at all.
- Duplicate suppression: a `report-only` row (per the existing case at `lib/summary.test.ts:112`) renders **no** control.
- `lang="bo"`: panel primary carries `data-requested-lang="bo" data-resolved-lang="zh"` and exactly one `翻译未经审核`; secondary is EN. Mirror `components/SummaryView.test.tsx:63-80`.
- Keyboard: focusable, activates on `Enter`/`Space`; dialog route closes on `Esc` and returns focus.

`lib/summary.test.ts`: positive assertions on the `glossary` field itself — currently zero coverage. Minimum: non-empty and ≠ `plain` for `fasting_glucose`; `''` for `ceruloplasmin` (mirroring `:85`).

### Invariant

Directional clinical education may live in the reference-material lane but may never be composed with the patient's number, and triage/urgency language is forbidden everywhere. Enforced by the widened `BANNED` gate plus the dialog-subtree assertion.

### Pre-registered metric movement

**None on either corpus.** `lib/localizationBaseline.test.ts` `REFERENCE_BASELINE.en/.zh` **will** move — that is the one intended hash change in this item. A reviewer seeing those hashes move without an accompanying six-string diff should reject the PR.

### Acceptance

- [ ] `BANNED` gains `/needs? (urgent|prompt|immediate)/i` and `/critical value/i`.
- [ ] New `plain`-vs-`BANNED` gate lands red on 6 strings (3 EN + 3 ZH), then green.
- [ ] Six strings de-triaged; both reference hashes re-baselined with the diff in the commit.
- [ ] Glossary renders on recognised rows only; suppressed on all 26 identical-pair entries.
- [ ] Dialog subtree contains no value and no chip.
- [ ] `chipWrong` 0; corpus metrics otherwise unchanged.

---

## 9. W9/W10 — Item G engineering tranche, and the language-selector prerequisite

### 9.1 Verified state

Every `bo` entry in the repo is `fallback('zh')` — 419 in production code, zero exceptions. `resolveText` (`lib/i18n.ts:100-104`) fails closed correctly. **The mechanism is honest; the content is absent.**

**Defect worse than the premise:** `components/DisclaimerBanner.tsx:1-8` is hardcoded English prose rendered unconditionally at `app/layout.tsx:41` on **every route**. It is not a `LocalizedText`, takes no `lang`, and is outside the i18n system entirely. A `bo` user — and a `zh` user — reads the app's most persistent safety line in English. This is a `zh` bug as much as a `bo` one and should not wait on any reviewer.

**Second un-i18n'd outlier, and it also misinforms:** `app/~offline/page.tsx` is hardcoded English and says saved reports "are still available once you're back online" — but they live in IndexedDB (`lib/db.ts`) and are available *precisely when offline*. `app/manifest.ts:6-8` (`name`/`description`) is likewise EN-only, so the PWA install prompt is English.

**No error boundaries exist.** `app/` has no `error.tsx`, `global-error.tsx`, or `not-found.tsx`. A throw inside `SummaryView` — which W6, W7 and W8 all touch — drops the user to Next's default English stack-trace page.

### 9.2 Inventory (measured, English-side word counts)

| File | Strings | EN words |
|---|---|---|
| `data/reference-labs.ts` | **319** | 4,973 |
| `lib/uiCopy.ts` | 25 | 117 |
| `lib/notesGuard.ts` | 23 | 339 |
| `lib/guard.ts` | 13 | 276 |
| `components/CaptureCard.tsx` | 12 | 103 |
| `lib/summary.ts` | 8 | 24 |
| `lib/notesSummary.ts` | 6 | 15 |
| `lib/disclaimers.ts` | 5 | 136 |
| `lib/imageQuality.ts` | 3 | 46 |
| `lib/notesGrounding.ts` | 2 | 52 |
| `lib/grounding.ts` | 1 | 11 |
| `lib/crossRowChecks.ts` | 1 | 33 |
| `components/LocalizedText.tsx` | 1 | 2 |
| **TOTAL** | **419** | **6,127** |

The recruitment ask is **two numbers**: everything that is *not* the glossary is **100 strings / ~1,154 words** — a one-to-two-session job for a competent bilingual clinician. The 111-entry glossary at 4,973 words is a multi-week engagement. Recruit against 100; scope 319 separately. (The 97-vs-111 asymmetry is the 14 `urineReportOnly` entries at `data/reference-labs.ts:14-35` reusing `definition` as `plain`.)

### 9.3 W9 — ship all of this before any reviewer exists

1. **`DisclaimerBanner.tsx`** — bring into `LocalizedText`, thread `lang`.
2. **`app/~offline/page.tsx`** — i18n it **and fix the factual error** about offline availability. i18n `app/manifest.ts:6-8`.
3. **Error boundaries** — add `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`, localized, with the disclaimer intact.
4. **Extract the nine interpolated templates** into named, parameterized messages with the substitution points named and annotated for a reviewer. Sites: `lib/notesGuard.ts:740,784,815,838,850,888`; `lib/guard.ts:246` (`we expect ${entry.unit}`); `lib/grounding.ts:80-84` (`converted ${from} to ${to}`); and `lib/summary.ts:251-255` (not a template but passes OCR output straight through — already handled in W6). **Longest engineering lead item; strictly pre-reviewer.** Tibetan is verb-final and case-marked; a `${}` hole that works in EN/ZH word order may be ungrammatical in `bo`.
5. **Reviewer attestation.** `reviewed('…')` records *that* something was reviewed, not by whom, against what, or when. Add a distinct `boReviewed(text, { by, date, source? })` constructor that **structurally requires** attestation, making "reviewed Tibetan with no named reviewer" a type error. Do not overload `reviewed`; leave the 419 EN/ZH sites untouched.
6. **Coverage-count test.** Walk every exported `LocalizedText` and assert the reviewed-`bo` count equals a checked-in expected number (initially 0). Makes each reviewer tranche a deliberate one-line change and makes accidental unreviewed `bo` additions fail.
7. **Disclaimers-never-behind-content invariant test** (§9.4).
8. **`lib/summary.ts:103-107`** — replace `reviewed('')` with a dedicated `emptyLocalizedText` constant outside the review taxonomy.
9. **Rename `lib/localizationBaseline.test.ts` → `sourceCopyLock.test.ts`** and re-document per §9.5. "pre-Tibetan baseline" reads as expiring; it does not.
10. **Reviewer packet generator** — a script emitting the tiered string list with EN + ZH side by side, clinical key, screen context, and character-budget constraints.
11. **Tibetan typography validation.** `Noto_Serif_Tibetan` is wired (`app/layout.tsx:19-24`, `app/globals.css:76-84`) and `TibetanText` inserts `<wbr>` at tsheg boundaries (`components/TibetanText.tsx:18-32`). Validate stacked-glyph rendering and line-breaking on real Android WebView using `TIBETAN_TYPOGRAPHY_SAMPLE` — that fixture is deliberately non-linguistic (`components/TibetanText.tsx:5-12`) and needs no reviewer.
12. **Request timeout on the model call.** `app/api/extract/route.ts:32-47` awaits `messages.parse` with no `AbortSignal`. On a high-latency path this hangs until the platform kills it and the user sees the generic 502 at `:53`. Add an explicit timeout and a distinct, localized message.

### 9.4 W10 — the language-selector prerequisite

`app/result/page.tsx:53-61` is the **only** language toggle in the app. `app/page.tsx:9` pins `const [lang] = useState<Lang>('en')` with no setter; `app/page.tsx:24` renders `<CaptureCard />` bare — **`CaptureCard` takes no `lang` prop at all**; `app/page.tsx:25` hardcodes a Chinese sentence inline. And `app/result/page.tsx:20` `useState<Lang>('en')` is per-mount, so navigating home and back returns a Tibetan user to English.

Consequence: Item F Gap 3 ("move consent strings into `lib/uiCopy.ts` and render via `LocalizedText`") done literally produces **zero user-visible change** — there is no `lang` to render in and no way for the user to have chosen `bo` yet.

**W10 scope:** a language selector at the entry point, `lang` threaded into `CaptureCard`, and a durable preference (localStorage, read on mount in both `app/page.tsx` and `app/result/page.tsx`). De-hardcode `app/page.tsx:25`.

**Nothing user-facing in Tibetan may ship before W10.**

### 9.5 The `localizationBaseline` ritual — a correction

**Adding Tibetan does not break this test.** `lib/localizationBaseline.test.ts:99,107,115` parameterises over `['en','zh']` only, and `referenceText`/`disclaimerText` take `SourceLang`. The `bo` variant is never hashed. Filling in Tibetan leaves the `en`/`zh` resolutions byte-identical. The file says so at lines 31-32.

That is why it stays a forcing function: it fires only when someone edits English or Chinese *while* working on Tibetan — precisely the dangerous move (a reviewer rewords an ambiguous Chinese source, and reviewed shipped safety copy changes with no re-review). The ritual:

1. **Default answer to a red baseline during Tibetan work is: revert the EN/ZH edit.**
2. If the EN/ZH change is genuinely intended, it lands as its **own commit, ahead of and separate from** any `bo` work, with the new hash and the source of the new text recorded.
3. Update the `// Captured from clean pre-refactor HEAD <sha>` provenance comment (`:8`). A hash with a stale provenance line is worse than no hash.
4. **Never regenerate the hash from current code and paste it in.** Keep the hash literals hand-written; add a comment forbidding a regenerate script. The moment `npm run baseline:update` exists, the lock is decorative.
5. Extend parameterization to `bo` only *after* Tibetan is complete, as a separate deliberate act.

**In this cycle, W8 (Item B) is the ONLY item permitted to move a reference hash, and W11 the only one permitted to move the UI_COPY hash. A hash movement in W1, W2, W3, W5, W6, W7, W9 or W10 is a bug, not a chore.**

### 9.6 Tier order for the eventual reviewer, and why

The failure mode is not that the disclaimer goes unread — it is that **fluency asymmetry is itself a trust signal.** A patient who reads a fluent Tibetan sentence about their hemoglobin beside a Chinese block they must struggle through will rationally conclude the Tibetan part is the product and the Chinese part is boilerplate. Under §0, the disclaimer is load-bearing in keeping output GENERIC-or-REPRODUCED; degrading it relative to the content weakens the strongest safety claim exactly when the content gets most persuasive.

- **Tier 0 — before any content Tibetan ships.** `lib/disclaimers.ts` (5), the `DisclaimerBanner` string once in-system, `components/LocalizedText.tsx:13-17` "Unverified translation" (non-obvious and indispensable — the badge telling a `bo` user a string is unverified must itself be readable in `bo`, or the fail-closed marker fails silently), and `UI_COPY.tibetanUnavailable`. **~8 strings.**
- **Tier 1 — with any content.** All 36 guard messages: `lib/guard.ts` (13), `lib/notesGuard.ts` (23), plus `crossRowChecks`/`notesGrounding`/`grounding`/`imageQuality` (7). **~43 strings / ~750 words.** Contains all nine interpolated templates, so it depends on W9 item 4.
- **Tier 2.** `lib/uiCopy.ts` (25), `components/CaptureCard.tsx` (12), `lib/summary.ts` chips (8), `lib/notesSummary.ts` (6). **51 strings / ~260 words.** The chips are the closest the product gets to a verdict line — careful, not fast.
- **Tier 3.** The 319 glossary strings, `highStakes: true` first, then by observed frequency in `validation/real-corpus/`. Split the 111 `name` fields out as their own sub-tranche — cheap, high-value, and the thing a patient actually scans for.

### 9.7 Cannot ship without a reviewer, under any framing

- Any `bo: reviewed(...)` string. Not machine translation reviewed by a non-Tibetan-reader; not a Tibetan speaker without clinical literacy; not a clinician without Tibetan. **Do not decompose the role to accelerate.**
- Any weakening of `usedFallback → unverified` stamping (`lib/i18n.ts:100-104`) or suppression of the verification marker for `bo`.
- Removing `UI_COPY.tibetanUnavailable` or the `lang === 'bo'` notice at `app/result/page.tsx:65-75`.
- Extending `SourceLang` to include `'bo'` (`lib/i18n.ts:10`). The detectors and the validation corpus have no Tibetan competence.
- Partial Tibetan violating the tier ordering — blocked by the §9.3 item 7 test, not by discipline.

### 9.8 GUARDRAILS — the two ways Tibetan silently destroys the gate

**(B) The `directBo` tripwire is designed to fail the moment Tier 0 lands.** `validation/b1VerdictLeakage.test.ts:109-121` documents that it "MUST fail on the first direct clinical string" because "the EN/ZH regular expressions cannot police future Tibetan prose". An implementer optimising for green will delete or narrow it — one line, tests pass, and the entire clinical-copy gate silently stops covering the app's primary language.

> **The tripwire may be replaced only by Tibetan-specific `BANNED`/`CARD_BANNED` regex banks authored by the same medically-literate Tibetan reviewer, landed in the same commit. Removing it without replacement is a rejected diff, not a passing test.**

**(C) `ALLOWED_CHIPS` becomes self-certifying in Tibetan.** `validation/b1VerdictLeakage.test.ts:78-95` asserts every chip is a member of a hand-written exact-string set. For EN/ZH that is a real gate because a reviewer reads both. Extended to `bo`, the assertion becomes "the chip equals the string we put in the list" — tautological, in a script nobody on the team reads.

> **Tibetan chip strings enter `ALLOWED_CHIPS` only with an independent back-translation into EN recorded as a comment beside each entry, by a second reviewer.** The same applies to Item A's Lock 5 whenever the flag chip ships.

### Acceptance (W9/W10)

- [ ] `DisclaimerBanner`, `~offline`, and `manifest` all localized; the offline copy's factual error corrected.
- [ ] `app/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx` exist and are localized.
- [ ] Nine templates extracted, parameterized, annotated.
- [ ] `boReviewed` constructor requires attestation; reviewed-`bo` coverage test asserts 0.
- [ ] Disclaimers-never-behind-content test exists and passes.
- [ ] `localizationBaseline.test.ts` renamed and re-documented; **hashes unmoved**.
- [ ] Entry-point language selector exists, `CaptureCard` receives `lang`, preference persists across navigation.
- [ ] Extract route has a request timeout with a localized message.
- [ ] Zero `bo: reviewed(...)` strings anywhere.

---

## 10. W4 and W11 — scheduled, scoped elsewhere

### W4 — the remaining high-stakes entries (own cycle, own spec)

**CORRECTED 2026-07-19 after direct measurement. The paragraph previously here was inherited from
`2026-07-18-recognition-gap-worklist.md` §2 and was STALE — it named 14 analytes as uncurated when
5 had been curated since that list was written.** Measured against `data/reference-labs.ts` on
`main` @ `62b9e23`:

```
CURATED   lactate · pco2 · hematocrit · myoglobin · ck_mb
MISSING   free_calcium · po2 · base_excess · anion_gap · urea_nitrogen
          troponin · bilirubin_total · total_co2 · thrombin
```

So the real gap is **9 uncurated high-stakes entries**, not 17.

**The worklist's headline example is also stale and must not be requoted.** It showed
`Lactate 8.4 mmol/L` in sepsis rendering "Above your report's range", `needsConfirm=false`, no flag.
`lactate` is now curated at `data/reference-labs.ts:2711` with `highStakes: true`,
`criticalHigh: 4`. Verified by direct lookup:

```
MATCH  Lactate            -> lactate  highStakes=true
MATCH  Lactic Acid        -> lactate  highStakes=true
MATCH  乳酸                -> lactate  highStakes=true
MATCH  LACTATE            -> lactate  highStakes=true
MISS   Lactate, Whole Blood
```

**This changes the KIND of work, not just the count.** For the 5 curated analytes the residual
failure is a RECOGNITION gap — specimen-qualified corpus name variants (`Lactate, Whole Blood`)
missing from `aliases`. That is an alias pass, subject to the §4.5 cross-specimen guardrail. For
the 9 missing analytes it is a CURATION gap needing a sourced band per entry. **Do not conflate
them; they carry different risks.** An alias pass can ship a cross-specimen identity bug (this repo
has nearly done so twice); a curation pass can ship an unsourced band.

Not folded into this spec because each curated entry needs a sourced band and a `highStakes`
justification, and bundling those with parser, i18n and consent work makes the safety review
unreviewable. **Schedule as the next cycle, ahead of any further B/E/G work.** Base Excess belongs
there (its parser precondition is discharged by W1).

**Before that cycle is written, re-measure.** This section was stale within one day. Run
`npx tsx validation/real-corpus/run.ts` and check `data/reference-labs.ts` directly — do not
inherit any analyte list from a prior document, including this one.

Same guardrail as §4.5 applies: **every `highStakes: true` and every `criticalLow`/`criticalHigh`
requires a cited clinical source in the entry's `source` field.**

Same guardrail as §4.5 applies: **every `highStakes: true` and every `criticalLow`/`criticalHigh` in that cycle requires a cited clinical source in the entry's `source` field.**

### W11 — Item F consent / PIPL (blocked on a human)

Verified state:

| Concern | Where | Status |
|---|---|---|
| Consent record | `lib/consent.ts:11-46` | localStorage `ht:transfer-consent`, `{version, at}`, `CONSENT_VERSION = 2` |
| Server enforcement | `lib/consentGate.ts:23-42` | header `x-ht-consent-version` must equal `CONSENT_VERSION`, else 403; honestly self-documented as integrity, not proof of consent (`:14-20`) |
| Consent UI | `components/CaptureCard.tsx:528-577` | single `phase === 'consent'` screen, one button |
| On-device redaction | `lib/redact.ts:1-11` | user-drawn boxes burned pre-upload; optional |
| Local storage | `lib/db.ts` | IndexedDB, per-visit delete, **no bulk erase, no retention limit** |

Gaps, code-fixable:

1. **Bundled consent.** One button covers three legally distinct processings — sensitive PI (Art. 29), third-party 委托处理 (Art. 23), and 出境 (Art. 39) — each of which requires its own 单独同意. Render N independent affirmative controls with per-item disclosures, submit blocked until all are ticked. `ConsentRecord` becomes `{version, at, scopes: {sensitive, thirdParty, crossBorder}}`; `checkConsent()` (`consentGate.ts:32`) must require the specific scope the route needs (both `/api/extract` and `/api/translate-notes` need all three — typed notes are also sensitive).
2. **Missing Art. 17 / Art. 39 elements.** Current text (`CaptureCard.tsx:546-552`) gives recipient, purpose, 30-day retention. Missing: overseas recipient's name and contact method, categories of PI, purpose and method of overseas processing, how the individual exercises PIPL rights against the overseas recipient, and the domestic handler's identity/contact. Add a `/privacy` route with the full content and link to it.
3. **The consent screen is not localized** — `CaptureCard.tsx:528-577` hardcodes English with `<span className="zh">` siblings, outside `lib/i18n.ts` entirely. **A Tibetan-speaking user cannot read the consent they are giving**, which is incompatible with 充分知情 (Art. 14). **Depends on W10.** `validation/b1VerdictLeakage.test.ts:106-118` exempts non-clinical chrome, so consent copy may carry real Tibetan without tripping the tripwire — but it still needs a native reviewer.
4. **No withdrawal path.** `revokeConsent()` (`consent.ts:41`) is called from no production component (grep: only `consent.test.ts`). Art. 15 requires withdrawal to be as easy as giving. Add a settings/privacy screen with revoke + "delete all saved visits", which needs a new `deleteAllVisits()` in `lib/db.ts` (currently only per-id `deleteVisit`).
5. **Retention has no mechanism.** IndexedDB opens at version 1 with no expiry. Disclose the period per Art. 17 and implement an auto-expiry — the code change, not only the disclosure.

**What code cannot fix, stated plainly:**

- **Art. 38 cross-border mechanism.** Consent under Art. 39 is a *precondition*, not the legal basis. The transfer additionally needs CAC 安全评估, 个人信息保护认证, or the CAC 标准合同 filed provincially — all three require a domestic legal entity as 个人信息处理者. The 2024 促进和规范数据跨境流动规定 exemptions do not help: the sub-100k exemption is expressly unavailable for sensitive PI.
- **PIPIA (Art. 55/56)** is mandatory for sensitive PI and for cross-border transfer, retained 3 years. A document, not a code change — worth writing anyway as the cheapest good-faith artifact.
- **ICP 备案** and **生成式人工智能服务备案** require a PRC-registered entity and PRC hosting. Not obtainable by a foreign individual. Realistic lanes: (a) a PRC partner entity holding the filings, (b) offline/on-device only with no cross-border call, (c) explicitly not serving mainland users. **Ship the consent work regardless — necessary under every lane, sufficient under none.**

**User agreement** (separate click-to-agree at first launch, *prior to and distinct from* the PIPL 单独同意 — bundling them re-creates gap 1). Required contents: operator identity and contact; service definition stated as the non-device claim, aligned verbatim with `lib/disclaimers.ts:12-25`; explicit non-device / non-诊疗 statement; machine-reading limitation (`disclaimers.ts:26-30`); an **unconditional** referral clause; translation-quality limitation naming the Tibetan fallback; prohibited uses (no emergencies, no dosing, no clinical decision-making, not for clinicians on patients); data-handling summary cross-linked to the privacy notice; liability limitation and governing law drafted by counsel; versioning and re-acceptance mirroring `CONSENT_VERSION`. Code shape: `lib/agreement.ts` mirroring `consent.ts`, a first-run gate above the capture flow in `app/page.tsx`, copy in `lib/uiCopy.ts`, a static `/terms` route. **Not** enforced server-side — it gates nothing crossing a boundary, so no `consentGate` analogue.

Note for the drafter: a disclaimer did **no work** in the FDA WHOOP matter. The agreement is not a substitute for W5; it is documentation of a design that is already defensible.

---

## 11. Explicitly NOT in this plan, and why

**Reachability — the non-engineering blocker that dominates everything above.** `.vercel/project.json` shows a Vercel deployment with **no custom domain anywhere in the repo**, and `vercel.json:6` pins `regions: ["iad1"]`. `*.vercel.app` is not resolvable from mainland China. **Today, with no domain bound, the product's delivered value to its target user is zero regardless of items A–G.** This belongs in the plan as an explicit, dated, non-engineering blocker with a named owner. No engineering work in this cycle discharges it. It is listed as W0 so it cannot be forgotten, not because it is implementable here.

**备案 filings (ICP and 生成式人工智能服务).** Not obtainable by a foreign individual operating personally. A distribution-model decision. See W11.

**A Q&A portal or any patient-specific advice surface.** Deliberately not scoped. Every design in this document is built on the reproduction/derivation boundary in §0; a free-text Q&A surface answering questions about the patient's own numbers is a statement about this person by construction and cannot be brought inside that boundary by disclaimer or by prompt. If it is wanted, it is a separate product decision with a separate regulatory posture, not a feature.

**The doctor-notes path.** `lib/notesGuard.ts` carries 23 of the 36 guard messages — the largest single guard surface — `app/api/translate-notes/route.ts` is a live paid route, and `lib/notesSummary.ts` emits chips. **No item in this cycle audits the notes path for the same conditional-referral leak W5 found in the labs path, and `validation/b1VerdictLeakage.test.ts` does not cover notes copy at all.** Notes are free-text *translation of clinical claims* — the one place the "LLM is OCR-only" invariant does not hold. This is a known, deliberate omission and should be the cycle after W4.

**Base Excess curation.** Deferred out of W1 on purpose (§3). Belongs in W4.

**Item A chip rendering.** Deferred on measurement grounds (§7). Not a scheduling preference — the false-positive rate is unmeasurable with the assets that exist today.

---

## 12. Global acceptance criteria

Every commit in this cycle:

- [ ] `npx tsc --noEmit` clean.
- [ ] `npx vitest run --pool=threads` green, **≥643 tests, none deleted or weakened to pass.** A test that was deleted, narrowed, or had an assertion relaxed to go green is a rejected diff. If a test must change, the commit message must state which invariant changed and why.
- [ ] `npx tsx validation/real-corpus/run.ts` reported before and after, both corpora.
- [ ] **`chipWrong` remains 0 on BOTH corpora.** Hard gate, not a metric.
- [ ] **No existing "must stay unknown" lock weakened.** The four specimen-ambiguity locks and the trace-element / HIV / flow-cytometry locks in `data/english-aliases.test.ts` pass **unmodified**.
- [ ] `validation/chipFidelity.test.ts` and `validation/goldLabelGates.test.ts` are **diff-free for the entire cycle**. Any change to either is rejected.
- [ ] `validation/b1VerdictLeakage.test.ts` and `validation/silentAssertion.test.ts` pass; the `directBo` tripwire is present and un-narrowed.
- [ ] Zero `highStakes` field diffs in `data/reference-labs.ts` except the new `prothrombin_activity` entry.
- [ ] Hash movements confined to W8 (`REFERENCE_BASELINE.en/.zh`) and W11 (`UI_COPY`). Anywhere else, a moved hash is a bug.
- [ ] Zero `bo: reviewed(...)` strings.
- [ ] Nothing renders `printedFlagRaw`.

Cycle-level metric report, in the final PR description:

| metric | baseline | predicted | actual |
|---|---|---|---|
| ZH R6-gold | 23/37 (62.2%) | **24/37 (64.9%)** after W3 | — |
| US R6-gold | 89/212 (42.0%) | unchanged | — |
| ZH chip coverage | 72.0% | unchanged | — |
| US chip coverage | 73.6% | unchanged | — |
| `chipWrong` both corpora | 0 | 0 | — |
| median confirm fields/report | measure at W5 | report before/after | — |

**Any result other than 24/37 on ZH means the wiring is wrong, not that the work over- or under-performed.** A shortfall is a thing to investigate and write up, never pressure to widen an alias list or flip a `highStakes` flag until the number arrives.