# W4 cycle — US recognition gap: aliases, report-only curation, and the ceiling

Status: **NOT STARTED.** Written for implementation by Codex (gpt-5.6-sol) with no further conversation.
Baseline: branch `codex/remaining-work-cycle-ready` @ `306a264`.
Test runner: `npx vitest run --pool=threads` (the forks pool fails under machine load).
Corpus runner: `npx tsx validation/real-corpus/run.ts`.

Measured at `306a264`, 2026-07-20, by running both commands:

```
npx vitest run --pool=threads   → 69 files, 672 tests, all green
npx tsc --noEmit                → clean

MedRepBench (Chinese, PRIMARY): 143 rows · CHIP 72.0% · analyte-confirm gold 22/37 (59.5%)
MIMIC-IV (US):                  322 rows · CHIP 73.6% · analyte-confirm gold 87/212 (41.0%)
chipWrong: 0 on BOTH corpora
```

---

## 0. Read this before you plan anything: what is actually winnable

**The Chinese corpus is finished. It is at its policy ceiling right now, and this cycle moves it by exactly zero rows.**

`analyte-confirm gold` on MedRepBench is **22/37 = 59.5%**, and that is the maximum reachable under current safety policy. There is no alias, no new curated entry, and no guard change that moves it. Verified by enumerating all 37 gold rows against the shipped pipeline:

| bucket | rows | why it cannot move |
|---|---|---|
| confirmed today | 22 | — |
| unrecognised, **permanent policy refusals** | 7 | 钙(Ca) · 镁(Mg) · 铅(Pb) · 镉(Cd) (heavy-metals panel in μg/ml — not serum minerals) · HIV Ag/Ab (privacy) · a-淀粉酶 (urine assay, no disambiguator) · 髓系原始细胞群 (naming a blast population is diagnostic). All seven are documented refusals in `docs/superpowers/specs/2026-07-19-chinese-coverage.md` §1 buckets B/C/D. |
| recognised, but our `highStakes:false` vs gold `true` | 8 | The §4.5 refused-flip set. Requires a cited clinical source per entry, which does not exist. |

7 + 8 + 22 = 37. Closed, no unexplained rows.

**Absolute ceiling if every policy refusal were abandoned: 30/37 = 81.1%.** Never 37/37 — `goldHighStakesRows` is keyed on the printed row name, so the 7 refusals stay in the denominator by construction. **Do not chase them.**

The one honest thing to say about the ZH number is that it is a *saturated metric*: it has finished measuring. Report it as **22/37 (policy-max 22/37, absolute-max 30/37)** or it will keep reading as a gap and keep generating work items.

### The US corpus is where the winnable work is, and it too has a hard floor

Baseline **87/212 = 41.0%**. This cycle pre-registers **121/212 = 57.1%** (derivation in §8 — note two buckets are deliberately priced below their raw row counts). The remaining 91 rows decompose as:

| remainder after this cycle | rows | status |
|---|---|---|
| recognised but `highStakes:false` vs gold `true` | 52 | refused-flip class — same as the ZH 8. Needs a cited source per entry. |
| blood Glucose | 11 | refused this cycle — see §4, the TRAP |
| pO2 | 6 | **deferred**: blocked on an arterial/venous axis that does not exist in `lib/types.ts:11` |
| urine drug screens | 7 | **permanent policy refusal** — see §5 |
| urine Glucose / Ketone / pH | 6 | corpus artifact, metric ceiling **0.0pp** — see §4 |
| blood-gas `pH` | 6 | entry ships (§6.3), but the rows print bare `pH` with `specimen:'unknown'` and a bare alias is forbidden |
| `Bilirubin, Total` + `Hematocrit, Calculated` | 2 | aliased in this cycle, but **+0 metric** — targets are `highStakes:false` |
| `Estimated GFR (MDRD equation)` | 1 | **permanent refusal** — see §6.9 |

**The permanent residual on the US corpus is 16 rows (7.5pp) and cannot be closed.** The absolute ceiling, if the 52 refused-flips were all granted and pO2 shipped, is 205/212 = 96.7%.

> **Whoever implements this: a number that moves because you flipped a `highStakes` field, aliased a specimen-ambiguous name, or curated a band you could not source is a number that got worse. Every one of those is rejected on sight. The pre-registered figure below is a prediction to be tested, not a target to be reached.**

---

## 1. Retiring the stale 07-18 worklist §2

`docs/superpowers/specs/2026-07-18-recognition-gap-worklist.md` §2 ("NEXT — curation cycle: 18 high-stakes entries") is **stale and must not be inherited**. Measured at `306a264` via `findEntry`:

**Nine of its eighteen named analytes are already curated:** `Lactate`→`lactate`, `Free Calcium`→`calcium_ionized`, `pCO2`→`pco2`, `Troponin T`→`troponin_t`, `凝血酶时间(TT)`/`TT`→`thrombin_time`, `PT%`→`prothrombin_activity`, `肌红蛋白`→`myoglobin`, `肌酸激酶同工酶质量`→`ckmb_mass`. Two more (`铅(Pb)`, `镉(Cd)`) have since been reclassified as **deliberate refusals**, not gaps.

**Its headline example no longer reproduces.** The document's opening harm table claims `Lactate 8.4 mmol/L (sepsis/shock)` renders "Above your report's range" with `needsConfirm=false` and no flags. Probed on the shipped pipeline:

```
Lactate 8.4 mmol/L, printed 0.5-2.0
  → entry=lactate  needsConfirm=true  needsReview=true
    flags=[R3-CRITICAL-PANIC-RANGE, R6-HIGH-STAKES-MANDATORY-CONFIRM]
```

**P1.1 — Preconditions before writing code.** Edit `docs/superpowers/specs/2026-07-18-recognition-gap-worklist.md`:
- Change §2's status to `SUPERSEDED by docs/superpowers/specs/2026-07-20-w4-curation-cycle.md`.
- Strike the nine curated names from the §2 list and say they shipped.
- Annotate the §"Why this list exists" harm table: the Lactate row is **fixed**; the Troponin T row is fixed (`troponin_t` curated); the `Potassium, Whole Blood` row is addressed by §6.4 of this spec.

Leaving these unmarked is how a future pass re-does shipped work and mis-baselines its prediction. That has already happened once in this repo (`2026-07-19-remaining-work-cycle.md` P0.1).

---

## 2. The four KINDS of work, because they carry different risks

Do not merge these into one "coverage" bucket. They fail differently.

| kind | what it is | dominant risk | evidence bar |
|---|---|---|---|
| **Policy refusal** | A name we deliberately never resolve | Silently unlocked by a future bulk-alias pass | An executable lock test with the reasoning in its name |
| **Recognition (alias) gap** | The band exists; only the printed spelling misses | Cross-specimen / cross-matrix aliasing — **this repo's signature near-miss** | Unit AND panel must both corroborate, or the alias must be specimen-gated |
| **Genuine curation gap** | No entry exists under any key | Inventing a band nobody published | Every band cites its source inline, or ships `report-only` with a sourced rationale |
| **Specimen-context trap** | Looks like an alias gap; is actually an unrepresentable distinction | A confidently wrong frame applied silently | Do not ship until the axis exists in `lib/types.ts` |

**All four new curated entries in this cycle are `report-only` with all six bounds null.** Sourcing was attempted for each and deliberately failed. Zero new bands ship in this cycle. That is the correct outcome, not a shortfall — precedent: `thrombin_time` (union of observed printed ranges, documented as such) and `prothrombin_activity` (`data/reference-labs.ts:1965`, `interpretation:'report-only'`, all six bounds null, sourced rationale only).

---

## 3. Corrected decomposition of the US gap — 73 unrecognised rows

Reproduced by `npx tsx validation/real-corpus/run.ts`. Row counts verified against `validation/real-corpus/us-sample.ts`.

| analyte | rows | kind | this cycle |
|---|---|---|---|
| `Glucose` | 13 (11 blood, 2 urine) | **TRAP** | **NO** — §4 |
| `Anion Gap` | 10 | curation | **YES** — report-only |
| `Urea Nitrogen` | 10 | alias (previously refused) | **YES** — conjunctively gated |
| `pH` | 8 (6 blood-gas, 2 urine) | 6 curation + 2 trap | **YES** for the 6 blood-gas rows only |
| `Calculated Total CO2` | 6 | curation (**not** an alias — §6.3) | **YES** — new report-only entry |
| `pO2` | 6 | **specimen-context trap** | **NO** — §6.8 |
| `Base Excess` | 6 | curation | **YES** — report-only, cleanest win |
| `Ketone` | 2 | trap (urine) | **NO** — §4 |
| 7 urine drug screens | 7 | **policy** | **NO** — §5, plus a live chip defect |
| `Sodium, Whole Blood` / `Potassium, Whole Blood` | 2 | alias | **YES** |
| `Bilirubin, Total` / `Hematocrit, Calculated` | 2 | alias (free, **+0 metric**) | **YES**, but bank no rows on it |
| `Estimated GFR (MDRD equation)` | 1 | **policy refusal** | **NO** — §6.9 |

Total 73.

---

## 4. THE TRAP — Glucose / pH / Ketone. Do NOT add a bare alias.

This bucket looks like 23 recoverable rows. It is three different problems, and the tempting fix re-opens a locked bug class.

### 4.1 Do NOT add a bare `Glucose`, `pH`, or `Ketone` alias to any entry

These names live **only** in `SCOPED_INDEX` (`data/reference-labs.ts:2333, 2360, 2387`), never in the unscoped `INDEX`. `lib/reference.ts:76-96` therefore returns `null` for `specimen: 'unknown'` **by design**, and `lib/extractionSchema.ts:45-47` forbids the model from inferring specimen from name, value, or range. Verified:

```
findEntry('Glucose') → null   findEntry('pH') → null   findEntry('Ketone') → null
findEntry('Glucose','urine')?.key → urine_glucose
findEntry('pH','urine')?.key      → urine_ph
```

Locked at `data/english-aliases.test.ts` — "Glucose is NOT aliased — MIMIC carries it in 9 fluids", and "bare pH must NOT resolve to the URINE entry — a blood-gas pH 7.1 is critical acidemia but sits inside urine 4-9". **Do not weaken either lock.**

### 4.2 The 6 urine rows have a metric ceiling of exactly 0.0pp

Rows: `us-sample.ts:16` (Glucose), `:19` (pH 6.5, range 5-8), `:20` (Ketone), `:131` (Ketone), `:135` (Glucose 1000), `:140` (pH 5.5). Every one sits in a panel whose sibling rows literally print `Urine Color` / `Urine Appearance` (`:25-26`, `:132`, `:147`).

`urine_glucose`, `urine_ketones` and `urine_ph` all carry **`highStakes: false`** (verified at runtime). The bench numerator is `row.needsConfirm`, and R6 is the only rule that would fire. **Perfect specimen inference on these 6 rows moves the metric by 0.0pp.** Two are value-empty; the Glucose 1000 row would R2-abstain against the `qualitative` unit anyway.

They are also a **corpus artifact**: MIMIC ships no page image, so `specimen` is always `'unknown'` in the bench. A real photographed urinalysis page carries a printed heading and `lib/extractionSchema.ts:45` would already set `specimen: 'urine'`. **Do not treat these 6 as a product gap and do not build panel-level sibling inference for them.**

### 4.3 The 11 blood Glucose rows are blocked on a frame choice, not on specimen

`us-sample.ts:36, 196, 249, 265, 283, 297, 324, 339, 361, 401, 429`. Even granting blood context, the target is ambiguous between `fasting_glucose` (`data/reference-labs.ts:179`, band 3.9-6.1 mmol/L) and `random_glucose` (`:1138`, `refLow: null, refHigh: 11.1`). **Every one of these is an inpatient non-fasting draw.** Routing `Glucose`+blood → `fasting_glucose` grounds a random glucose against a fasting band, and the unit gate does **not** save you: `data/unit-conversions.ts:11` converts mg/dL→mmol/L for `fasting_glucose`, so the wrong frame applies silently.

This is the cross-specimen bug class one axis down. **Out of scope. If it is ever argued, it is argued on its own merits in its own PR — never inside an alias pass.**

### 4.4 The 6 blood-gas pH rows are NOT part of this trap

`us-sample.ts:77, 181, 202, 217, 299, 388` — values 7.29-7.47, printed range `7.35-7.45`. There is **no blood pH entry in the table** (`urine_ph` is the only pH key — verified by enumerating all 112 entry keys). This is a genuine curation gap misfiled into the trap bucket. It is §6.6 and it ships.

---

## 5. POLICY — REQUIRES A HUMAN DECISION. Engineering must not decide this silently.

> **This section contains a live defect, not a hypothetical. It is the product's worst-case output and it is reachable today with zero code change.**

> **DECIDED 2026-07-20 by the product owner:** translate/show the analyte name, but
> withhold every patient-position signal for the named sensitive-analyte registry.
> Implement §5.2's name-keyed, value-independent suppressor. This is a recorded
> product judgement balancing access against disclosure and prognostic-shock harms,
> not a claim that every vendor spelling or OCR variant can be recognised.

### 5.1 Evidence — the chip is decoupled from recognition, and it does not abstain

`lib/summary.ts:212-218` documents the decoupling deliberately: the chip reproduces the report's own printed range, so it is **not** gated on whether we recognise the analyte. That is correct for the general case. It means an unrecognised name still gets a position. Probed on the shipped pipeline:

```
Cocaine, Urine   POSITIVE  printed "NEGATIVE"  → "Outside your report’s range"
Cocaine, Urine   NEGATIVE  printed "NEGATIVE"  → "Within your report’s range"
HIV Ab/Ag        3.4 S/CO  printed "0-1"       → "Above your report’s range"
HIV Ab/Ag        0.022     printed "<1"        → "Within your report’s range"
髓系原始细胞群      12.5 %    printed "0-5"       → "Above your report’s range"
```

**The bucket-C/D refusals in `2026-07-19-chinese-coverage.md` are refusals to *alias*. Aliasing controls the band and the confirm gate. It does not control the chip.** The corpus rows only look safe by accident:

- the 7 MIMIC drug screens carry `item_value: ''` (`us-sample.ts:56-68`) — empty values produce no chip;
- the ZH HIV row prints `~<1` (`validation/real-corpus/sample.ts:66`) and the tilde defeats `parsePrintedRange`;
- `髓系原始细胞群` prints no range at all (`sample.ts:317`).

Change one character of OCR, or photograph a report that prints `NEGATIVE` in the range column and `POSITIVE` in the result column — both already in `QUALITATIVE_TOKENS` (`lib/reference.ts:248-267`) — and the app tells a Tibetan-speaking user, in Tibetan, that their cocaine screen is "outside your report's range". **Locking the status quo would lock a defect.**

Also in scope: `printedFlagRaw` is captured dark as of `306a264`. When W7 renders it, an `H` / `阳性` / `*` beside a drug-screen row reproduces the lab's own positive marker with **no analyte recognition required at all**. Any fix must cover that render path or explicitly defer it into W7 with a named blocker.

### 5.2 The three questions, and the recommendation

**Q1. Does the HIV precedent extend to the 7 US urine drug screens?**

*For:* the harm is structurally identical and arguably worse. Both are results whose social consequence dwarfs their clinical one, disclosed on a shared phone screen in a household where the user is asking a relative to help operate the app, in a jurisdiction where drug use is criminalised. "Outside the range" on a line reading *cocaine* is self-interpreting — the reader does not need us for the meaning.

*Against:* refusing to translate a row of someone's own medical record is paternalism dressed as safety, and it lands hardest on exactly the users the product exists for. A Mandarin-literate patient reads that line unaided; a Tibetan-speaking one does not.

*Resolution:* the two arguments are about **different objects**. The against-argument is about the *name*; the for-argument is about the *position*. **Translate the name; withhold the position.** That splits cleanly and gives up nothing the patient could not already read off the page.

**Q2. Is there a middle position?** Yes, and it is the right one, but it must be **implemented, not assumed**: a **sensitive-analyte chip suppressor** forcing `reportStatus → 'none'` for a named list, keyed on the name only. Three load-bearing constraints:

1. **Name-keyed and unconditional.** Suppress on every value, **including negatives**. Suppressing only positives is a verdict by omission — the absence of the chip becomes the signal — and fails the DESIGN TEST as squarely as printing "positive".
2. **A separate registry, not a reference entry.** Every existing alias lock stays: no band, no `highStakes`, no confirm gate. The list carries names and nothing else, matched with the same exact-normalised rule (`normName`, `lib/reference.ts:5-11`) — **no substring matching**, per `2026-07-19-chinese-coverage.md` §5.
3. **It fails open, and the spec must say so.** An unmatched vendor spelling or OCR variant shows the chip. This is mitigation of the common case, not a guarantee. Writing it down as a guarantee would be its own defect.

**Q3. Does `髓系原始细胞群` belong on the list?** Yes — **on a different rationale, and the spec must record which.** The drug-screen and HIV harms are *disclosure* harms. This one is *prognostic shock*: "above your report's range" on a myeloid blast population reads as *you may have leukaemia*, delivered by a phone, in translation, with no clinician present. Of every row in either corpus this is the highest-severity chip the app can emit. The existing bucket-D justification ("qualitative/research; out of scope") is too weak to carry that weight — restate it as a harm-based refusal so a future reader does not read "research assay" as "low stakes" and unlock it.

### 5.3 Recommendation, and its honest cost

**Recommend: build the suppressor covering the 7 US urine drug screens, the ZH HIV Ag/Ab row, and `髓系原始细胞群`. Do not extend it to withholding the name.**

Honest costs, recorded as costs and not derived away:

- The R1 disclosure copy ("anything shown here comes from your report itself") becomes slightly false on these rows, because we are now withholding something we could have shown. Worth a distinct string. This is a real honesty cost, not zero.
- A user cannot learn from us where their own drug-screen number sits relative to the printed cutoff. **This is a judgement call trading a small paternalism cost against a disclosure harm to a population with unusually little control over who sees their phone. It should be recorded as a judgement, not as a safety derivation.**

**Metric effect: +0 rows on both corpora.** This is pure safety work with no payoff on any number in the runner output.

### 5.4 If the human decision is "no"

Then the fallback is **not** "ship as-is". The minimum is a written finding in the runner output naming the reachable defect, so it is not rediscovered as new. Do not close this section by adding aliases.

---

## 6. The work, ordered by value-per-risk

**Ordering principle: policy and refusal locks first (they cost nothing and prevent a future unlock); then curation that asserts no band; then aliases onto existing bands; then aliases that require re-litigating a documented refusal. Anything needing a schema axis that does not exist is deferred, not attempted.**

Rationale for putting band-less curation *above* aliases: a `report-only` entry recovers the confirm gate while asserting **nothing** about the patient's value. An alias, by contrast, hands the patient's number to a band we chose. Same metric movement, strictly less risk.

| # | Item | Kind | Rows | Risk | Status |
|---|---|---|---|---|---|
| **W4-1** | Sensitive-analyte chip suppressor + leakage test | policy | +0 | live defect closed | **DECIDED 2026-07-20 — ready** |
| **W4-2** | Missing refusal locks (`a-淀粉酶`, `髓系原始细胞群`, drug screens, MDRD eGFR) | policy | +0 | none | ready |
| **W4-3** | `Base Excess` — new report-only entry | curation | +6 | **lowest in cycle** | ready |
| **W4-4** | Blood `pH` — new report-only entry | curation | +6 | low | ready |
| **W4-5** | `Calculated Total CO2` — new report-only entry, unalias `TCO2` | curation | +6 | low | ready |
| **W4-6** | `Anion Gap` — new report-only entry | curation | +10 | low | ready |
| **W4-7** | Whole-blood Na/K aliases | alias | +2 | low | ready |
| **W4-8** | `Bilirubin, Total` / `Hematocrit, Calculated` aliases | alias | **+0** | low | ready |
| **W4-9** | `Urea Nitrogen` — conjunctively gated alias | alias, re-litigates a refusal | +10 | **highest in cycle** | ready, land last |
| **W4-10** | Report-only lock tidy-up (§7) | hygiene | +0 | none | ready |
| **X** | `pO2` | specimen trap | +6 | **blocked** | **DEFERRED — §6.8** |
| **X** | blood `Glucose` | trap | +11 | refused-class | **out of scope — §4.3** |

### 6.1 W4-2 — the missing refusal locks

`a-淀粉酶` and `髓系原始细胞群` are documented refusals (`2026-07-19-chinese-coverage.md:84-85`, acceptance `:202`) with **no executable lock**. Verified: they are `null` only because no alias happens to match. `data/reference-labs.ts:1224` still carries an **unscoped `淀粉酶` alias** on `amylase` (verified: `findEntry('淀粉酶') → amylase`, `findEntry('淀粉酶','blood') → amylase`, `findEntry('淀粉酶','urine') → null`). Only `normName`'s treatment of the `a-` prefix keeps `a-淀粉酶` from resolving. That is a latent cross-specimen near-miss of exactly this repo's signature type, one normalisation change away from firing.

Add to `data/english-aliases.test.ts`, each with the reasoning in the test name, using the existing `expectUnknownForEverySpecimen` helper:

- `a-淀粉酶` → `null` for every specimen — canonical name of a **urine** amylase assay in Chinese lab catalogs; no unit, no panel context to disambiguate.
- `髓系原始细胞群` → `null` for every specimen — naming a myeloid blast population is diagnostic; harm-based refusal (§5.2 Q3).
- The 7 US drug screens (`Cocaine, Urine`, `Methadone, Urine`, `Benzodiazepine Screen, Urine`, `Oxycodone`, `Opiate Screen, Urine`, `Amphetamine Screen, Urine`, `Barbiturate Screen, Urine`) → `null` for every specimen — US mirror of the HIV refusal; privacy/product harm, no band to ground, all seven value-empty.
- `Estimated GFR (MDRD equation)` → `null` for every specimen — §6.9.

**Do NOT** move `淀粉酶` into `specimenAliases.blood` in this cycle. It is a strict improvement, but it changes resolution for a currently-resolving name and belongs in its own diff with its own before/after. Note it as a follow-up.

### 6.2 W4-3 — `Base Excess`, new report-only entry (+6)

**Cleanest win in the cycle.** All 6 corpus rows (`us-sample.ts:84, 176, 195, 221, 296, 383`) have `item_range: ''` — verified. There is **nothing for B1 to reproduce**, so the app abstains on the chip regardless; the only gain is the R6 confirm and a reviewed name.

**Sourcing outcome: no harmonised band exists. Ship all six bounds null.** Rationale for the `source:` field:

- **Algorithm-dependent.** Zander R. *Base excess (BE): reloaded.* Eur J Med Res 2024, PMC11089692, doi:10.1186/s40001-024-01796-6 — the classical Van Slyke / Siggaard-Andersen formulation omits oxygen saturation and thereby produces an **artefactual arterial-venous BE difference of 1.5-2 mmol/L**; the sO₂-inclusive formula reduces error to <1 mmol/L over −30 to +30. Manufacturers are inconsistent about which they implement.
- **ABE vs SBE are different measurands.** Standard base excess normalises haemoglobin to 5 g/dL; actual base excess does not. The row name "Base Excess" does not say which.
- **`criticalLow`/`criticalHigh`: null.** Base-deficit thresholds in the trauma literature (e.g. −6) are severity-stratification criteria, not laboratory panic values. Rejected on the same logic as `prothrombin_activity` 40%.

Entry shape: `key: 'base_excess'`, `specimen: 'blood'`, `interpretation: 'report-only'`, `unit: 'mmol/L'`, `allowedUnits: ['mmol/L','mEq/L']`, all six bounds `null`, `highStakes: true`, `populationSensitive: false`. Aliases: `['Base Excess','BE','Actual Base Excess','ABE','Standard Base Excess','SBE','碱剩余','剩余碱']`.

**Negative values are expected and are the clinically important direction** — the corpus carries `-5`, `-2`, `0`, `2`, `5`. Negative BE = base deficit = metabolic acidosis. The W1 signed-value parser fix is what makes this representable; a parser that dropped the sign would render `-5` as `5` and print the exact mirror image of the patient's acid-base state. **Add an explicit regression test on `-5`.**

### 6.3 W4-4 — blood `pH`, new report-only entry (+6)

No blood pH entry exists. The 6 rows print `7.35-7.45` and B1 reproduces that verbatim.

**Ship report-only.** A blood pH band is genuinely well-established (7.35-7.45), but this entry must not collide with `urine_ph`'s scoped alias, and pH is arterial-vs-venous dependent in the same way §6.8 describes for pO2 (venous pH runs ~0.03-0.04 lower). Since B1 reproduces the report's own printed range anyway, a curated band buys nothing the chip does not already have, and asserting one commits us to an ART/VEN distinction the schema cannot represent.

Entry shape: `key: 'blood_ph'`, `specimen: 'blood'`, `interpretation: 'report-only'`, `unit: 'units'`, `allowedUnits: ['units','pH','']`, all six bounds `null`, `highStakes: true`.

**Aliasing is specimen-gated and MUST NOT introduce a bare `pH`.** Put `'pH'` in `specimenAliases.blood` only. The existing lock — `findEntry('pH')`, `findEntry('pH','unknown')`, `findEntry('pH',null)` all `null`; `findEntry('pH','urine')?.key === 'urine_ph'` — must pass **unmodified**, with one addition: `findEntry('pH','blood')?.key === 'blood_ph'`. **That single line is a lock assertion change and must be disclosed as such** (see §8).

> Note honestly: the 6 corpus rows are `specimen: 'unknown'`, so a *specimen-gated* blood alias recovers **zero** of them. **Therefore this item must ALSO add unscoped aliases that are unambiguous on their face** — `'Blood pH'`, `'Arterial pH'`, `'Venous pH'`, `'血气pH'` — and the 6 corpus rows print bare `pH`, which those do not match either. **Pre-registered movement for W4-4 on this corpus is therefore +0, not +6.** See §8; this correction is deliberate and the implementer must not "fix" it by adding a bare `pH` alias.

### 6.4 W4-5 — `Calculated Total CO2`, new report-only entry, and unalias `TCO2` (+6)

**This is a curation item, not an alias item, and it fixes an existing defect.** `bicarbonate` (`data/reference-labs.ts:1112`) already lists `"TCO2"` and `"CO2"` as aliases with band **22-29 mmol/L** — verified: `findEntry('TCO2') → bicarbonate`.

Total CO₂ is a **different measurand**. On a blood-gas analyser only pCO₂ and pH are measured; bicarbonate and total CO₂ are calculated from them, and dissolved CO₂ contributes ~1.2 mmol/L, so calculated TCO₂ runs systematically ~1-3 mmol/L above plasma bicarbonate. Three ranges are in play and none match: our band **22-29**, the corpus blood-gas `Calculated Total CO2` band **21-30**, the corpus chemistry `Bicarbonate` band **22-32**. A patient printing 21 is normal on their own report and abnormal against our band. Reference: *Parameters that reflect the carbon dioxide content of blood*, acutecaretesting.org.

**Changes:**
1. New entry `key: 'total_co2_calculated'`, `specimen: 'blood'`, `interpretation: 'report-only'`, `unit: 'mmol/L'`, `allowedUnits: ['mmol/L','mEq/L']`, all six bounds null, `highStakes: true`. Aliases: `['Calculated Total CO2','Total CO2','TCO2','总二氧化碳']`.
2. **Remove `"TCO2"` from `bicarbonate.aliases`.** Keep `"CO2"`, `"CO2-CP"`, `"HCO3"`, `"HCO3-"`, `"二氧化碳结合力"`, `"碳酸氢根"`. This is required for alias uniqueness (`data/reference-labs.test.ts:39`) and is the point of the item.
3. Lock: `findEntry('TCO2')?.key === 'total_co2_calculated'` and `findEntry('HCO3')?.key === 'bicarbonate'`. **This changes the resolution of an existing alias and must be disclosed explicitly in the PR** — see §8.

**Two pre-existing `bicarbonate` defects surfaced here. They are OUT OF SCOPE for this cycle — file them, do not fix them in this diff:**
- `criticalHigh: 40` (`:1123`) is uncited and contradicts the CAP Q-Probes consensus of >49 mmol/L (Howanitz PJ, Steindel SJ, Heard NV. *Critical values comparison: a CAP Q-Probes survey of 163 clinical laboratories.* Arch Pathol Lab Med 2007;131(12):1769-1775). It would fire a panic alert on the real corpus row `Bicarbonate 40, range 22-32` — a compensated chronic respiratory acidosis, not an emergency.
- `refHigh: 29` is sourced only to `'Medscape/Testing.com'` (`:1135`) — the weakest source in the file — and disagrees with both printed corpus ranges.

### 6.5 W4-6 — `Anion Gap`, new report-only entry (+10)

**Sourcing outcome: no harmonised interval exists, and the failure is not marginal. Ship all six bounds null.**

- Pratumvinit B, et al. *Anion gap reference intervals show instrument dependence and weak correlation with albumin levels.* Clin Chim Acta 2020;500:172-179. PMID 31669932. Three hospitals/instruments, same protocol: **9-19, 5-15, 5-15 mmol/L** (all-patients); **10-17, 6-14, 5-12** (normal-electrolyte subgroup). Both bounds move by up to 4 mmol/L purely by instrument.
- Ayala-Lopez N, Harb R. *Interpreting Anion Gap Values in Adult and Pediatric Patients: Examining the Reference Interval.* J Appl Lab Med 2020;5(1):126-135. PMID 32445342. 5,034 healthy adult outpatients, CLSI nonparametric: **7-18 mmol/L**, median 13, against a clinician expectation near 12.
- **Formula-dependent.** Na−Cl−HCO₃ vs Na+K−Cl−HCO₃ differ by the potassium concentration, ~3.5-5 mmol/L. **Neither the row name nor any lab report states which formula was used.** The corpus prints `8-20 mEq/L` on all 10 rows, reconcilable with neither published interval — itself evidence the printed number is institution-specific.
- **`criticalLow`/`criticalHigh`: null.** A raised anion gap is the *definition* of a high-anion-gap metabolic acidosis — a diagnostic criterion, not a panic value.

Entry shape: `key: 'anion_gap'`, `specimen: 'blood'`, `interpretation: 'report-only'`, `unit: 'mmol/L'`, `allowedUnits: ['mmol/L','mEq/L']`, all six bounds null, `highStakes: true`. Aliases: `['Anion Gap','AG','阴离子间隙']`.

Under B1 the chip reproduces the printed `8-20` verbatim and asserts nothing.

### 6.6 W4-7 — whole-blood sodium and potassium aliases (+2)

`Sodium, Whole Blood` → `sodium` (`data/reference-labs.ts:411`, `highStakes: true`); `Potassium, Whole Blood` → `potassium` (`:436`, `highStakes: true`). Same measurand, different matrix.

**Matrix offsets are real but bounded, and B1 contains them.** Whole-blood Na⁺ runs ~1-3 mmol/L lower than serum (protein/lipid exclusion volume, direct-vs-indirect ISE); the corpus prints 133-145 for WB vs our 137-145. Whole-blood K⁺ biases low by ~0.4 mmol/L versus serum and is arguably *more* accurate (no pseudo-hyperkalaemia from clot or haemolysis); the corpus prints 3.3-5.1 vs our 3.5-5.3. **Both corpus rows print their own reference range, which B1 reproduces verbatim.** Our band drives only classification and the guards.

Add as plain unscoped aliases — the name carries the matrix explicitly, so there is no specimen ambiguity to gate on.

### 6.7 W4-8 — `Bilirubin, Total` and `Hematocrit, Calculated` aliases (+0 metric)

Both are free and correct, and **neither moves the metric**. Say so in the PR rather than letting them read as coverage.

- `Bilirubin, Total` → `total_bilirubin`. A pure word-order miss, verified: `findEntry('Total Bilirubin') → total_bilirubin` succeeds; `findEntry('Bilirubin, Total') → null`. `normName` strips the comma but not word order.
- `Hematocrit, Calculated` → `hematocrit`. Calculated Hct (Hb×3, or MCV×RBC) rather than spun. The corpus row `us-sample.ts:199` prints no range.

**Both targets carry `highStakes: false`** (verified at runtime) while gold says `true`, so `needsConfirm` stays false and the rows still do not count. **They are members of the same refused-flip class as the ZH 8. Do NOT smuggle a `highStakes` flip in under an alias PR.**

### 6.8 DEFERRED — `pO2`. Do not curate. Two blockers, one of which is live today.

**Blocker 1 — there is no arterial/venous axis.** `lib/types.ts:11` has only `'blood' | 'urine'`. A pO2 band is only meaningful for arterial blood. The corpus proves the hazard directly:

```
us-sample.ts:173  { item_name: 'Specimen Type', item_value: 'VEN.' }
us-sample.ts:175  { item_name: 'pO2', item_value: '36', item_range: '85-105', is_abnormal: '1' }
```

A **venous** pO2 of 36 is normal. Against an arterial band it reads as critical hypoxaemia. Elsewhere `us-sample.ts:203` prints pO2 **374** flagged abnormal — a patient on high FiO2, where 374 is expected.

**Blocker 2 — pO2 is uninterpretable without FiO2 and age.** FiO2 is a separate row that may or may not be extracted. Cerveri I, et al. *Reference values of arterial oxygen tension in the middle-aged and elderly.* Am J Respir Crit Care Med 1995;152(3):934-941, PMID 7663806 — for age ≥75, mean PaO₂ 83.4 ± 9.15 with a 5th percentile of **68.4 mmHg**, i.e. a healthy 80-year-old sits below the corpus's own printed lower bound of 85. And no defensible critical value exists: the CAP Q-Probes survey (Arch Pathol Lab Med 2007;131:1769) found blood gases on only **56%** of laboratories' critical lists.

> **Live pre-existing exposure, surfaced here, OUT OF SCOPE for this cycle — file it.** The already-shipped `pco2` entry (`data/reference-labs.ts:2777`, band 35-45 mm Hg, `highStakes: true`) has the same problem: `us-sample.ts:178` is a `pCO2 39` inside that same `VEN.` panel, and venous pCO₂ runs ~5 mm Hg higher than arterial. This is not created by this cycle, but it must not be discovered again as new.

### 6.9 REFUSED — `Estimated GFR (MDRD equation)`. Do not curate, do not alias. Add a lock.

Two independent reasons:

1. **It is not a result.** `us-sample.ts:462` is `{ item_value: '', item_unit: '', item_range: '' }` — a label line. An alias would gain the row via the R2 unit-mismatch path with `needsConfirm = highStakes = true`, i.e. **+1 row of metric for showing the user a confirm dialog on a blank field.** That is metric-gaming, not safety.
2. **Wrong estimator for our band.** `egfr` (`data/reference-labs.ts:386`) is `refLow: 90`, `criticalLow: 15`, `highStakes: true`, aliases `['eGFR','肾小球滤过率','估算肾小球滤过率']` — with **no equation qualifier anywhere**. MDRD is biased low above 60 (~11.9 mL/min/1.73m² in the 60-89 band vs measured GFR), which is why NKDEP/CAP guidance is that laboratories report MDRD as ">60" rather than numerically (CAP, *Reporting Estimated Glomerular Filtration Rate for Adults*). KDIGO 2024 recommends CKD-EPI 2021 (race-free), not MDRD. Aliasing an MDRD number onto a CKD-EPI-derived floor of 90 would flag healthy adults as abnormal.

> **Pre-existing defect surfaced, OUT OF SCOPE — file it.** `egfr.criticalLow: 15` is the CKD stage-5 **diagnostic** boundary, not a laboratory panic value. A stable dialysis patient sits below it permanently. Structurally identical to the prothrombin-activity-40% case this repo already rejected, and it should get the same treatment.

### 6.10 W4-9 — `Urea Nitrogen`, conjunctively gated alias (+10). Land this LAST.

**This re-litigates a documented refusal.** `data/english-aliases.test.ts` locks `findEntry('Urea Nitrogen')` to `null` with the reason "specimen-ambiguous AND the H1.5 urea-vs-BUN trap (x2.14)". `bun` already exists (`data/reference-labs.ts:2725`, 6-20 mg/dL, `highStakes: true`, sourced at `:2748` — and its source already cites this corpus). This is an **alias** decision, not curation.

**The bare-name refusal is correct and stays.** But both hazards are independently discriminable, and both discriminators are already shipped patterns in this table:

- The **urea-vs-BUN ×2.14 trap is unit-discriminated**: BUN is mg/dL, serum urea is mmol/L, and `bun`/`urea` already have disjoint `allowedUnits`.
- The **fluid ambiguity is specimen-discriminated**: all 10 corpus rows are mg/dL inside a serum chemistry panel next to Sodium / Creatinine / Bicarbonate / Magnesium.

**Ship a conjunctively gated alias:** name `Urea Nitrogen` **AND** `specimen === 'blood'` → `bun`, using the `specimenAliases.blood` mechanism already shipped for `GLU` / `葡萄糖`. The bare-name `null` lock stays **exactly as written** and gains one line: `findEntry('Urea Nitrogen','blood')?.key === 'bun'`.

**Residual hazard, stated not waved away:** a 24h urine urea nitrogen reported in mg/dL with a printed blood specimen would classify against a serum band. A urine UN in mg/24h fails *safe* (R2 abstain with `needsConfirm = highStakes = true`, since `bun.allowedUnits` is `['mg/dL']` only and no `bun` row exists in `data/unit-conversions.ts`). The residual is not zero. It is weighed against 10 rows / +4.7pp and the fact that the specimen gate is the same instrument that resolved the GLU case.

> **OPEN IMPLEMENTATION QUESTION — check this before writing the alias.** All 10 corpus rows are `specimen: 'unknown'`, so a blood-gated alias recovers **zero of them in the bench**. Determine whether the extraction stage supplies `specimen: 'blood'` for a photographed US chemistry panel (`lib/extractionSchema.ts:45-47`). **If it does not, the alias must not ship as the only change** — and the pre-registered +10 does not materialise. See §8, where this is priced honestly.

---

## 7. Tidy-up carried forward from the last cycle

`data/reference-labs.test.ts:15` — the lock titled *"declares the complete report-only urinalysis set without curated bands"* filters on `e.interpretation === 'report-only' && e.specimen === 'urine'`. That `specimen` filter was added when `prothrombin_activity` shipped, so a **future report-only non-urine entry no longer trips the lock at all**. This cycle adds four such entries, which would slip through silently.

**Fix:** assert the **full** report-only set, not the urine subset. Verified at runtime, the set is now **15 keys**:

```
prothrombin_activity, urine_amorphous_deposits, urine_appearance, urine_bacteria,
urine_bilirubin, urine_casts, urine_color, urine_crystals, urine_epithelial_cells,
urine_mucus, urine_nitrite, urine_rbc_microscopy, urine_urobilinogen,
urine_wbc_microscopy, urine_yeast_cells
```

After this cycle it becomes **19** (adding `anion_gap`, `base_excess`, `blood_ph`, `total_co2_calculated`). Drop the `specimen === 'urine'` filter, assert the sorted key list, and additionally assert every member has all six bounds `null` — that is the property the lock is actually for.

---

## 8. Pre-registered metric movement — state these BEFORE the work

Baselines, measured at `306a264`: **ZH 22/37 = 59.5%. US 87/212 = 41.0%. CHIP 72.0% / 73.6%. chipWrong 0 both.**

| item | ZH | US rows | US running total |
|---|---|---|---|
| baseline | 22/37 | — | 87/212 = 41.0% |
| W4-1 suppressor | +0 | +0 | 87 |
| W4-2 refusal locks | +0 | +0 | 87 |
| W4-3 `Base Excess` | +0 | **+6** | 93 = 43.9% |
| W4-4 blood `pH` | +0 | **+0** (see below) | 93 = 43.9% |
| W4-5 `Calculated Total CO2` | +0 | **+6** | 99 = 46.7% |
| W4-6 `Anion Gap` | +0 | **+10** | 109 = 51.4% |
| W4-7 whole-blood Na/K | +0 | **+2** | 111 = 52.4% |
| W4-8 Bili Total / Hct Calc | +0 | **+0** | 111 = 52.4% |
| W4-9 `Urea Nitrogen` | +0 | **+10, conditional** | **121/212 = 57.1%** |
| W4-10 lock tidy-up | +0 | +0 | 121 |

**PRE-REGISTERED PREDICTION: MedRepBench stays at exactly 22/37 (59.5%). MIMIC-IV moves 87/212 (41.0%) → 121/212 (57.1%).**

Two figures in that table are deliberately lower than a naive reading of the row counts, and the implementer must not "fix" them upward:

- **W4-4 blood `pH` is priced at +0, not +6.** The 6 corpus rows print bare `pH` with `specimen: 'unknown'`. A specimen-gated blood alias cannot match them, and a bare `pH` alias is forbidden (§4.1). The entry ships because it closes a real curation gap for photographed reports that print a specimen; it does not ship to move this number. **If US lands at 127 instead of 121, a bare `pH` alias got added — that is a defect, not an overperformance.**
- **W4-9 `Urea Nitrogen` +10 is conditional** on the extraction stage supplying `specimen: 'blood'` for US chemistry panels. If it does not, the honest result is **111/212 = 52.4%** and a written finding. Do not convert the gated alias into a bare one to reach the number.

**If ZH moves at all, in either direction, stop and investigate before accepting.** Nothing in this cycle touches a Chinese analyte's confirm path. A ZH movement means something resolved that should not have.

**`chipWrong` must remain 0 on BOTH corpora. This is a hard gate, not a metric.**

Report the actual numbers. House precedent for why: analyte-confirm read **80% self-graded and 27.4% independently gold-graded**. A number stated in advance is how that gets caught early.

---

## 9. Explicitly OUT of scope — do NOT

- **Do NOT add a bare `Glucose`, `pH`, `Ketone`, or `Urea Nitrogen` alias.** All four are locked, and §4 / §6.10 give the reasons.
- **Do NOT curate `pO2`.** Blocked on an ART/VEN axis that does not exist (§6.8).
- **Do NOT alias `Estimated GFR (MDRD equation)`** (§6.9).
- **Do NOT alias the 7 drug screens, the HIV row, or `髓系原始细胞群`.** Add locks (§6.2).
- **Do NOT flip any `highStakes` field.** Any `highStakes` diff in `data/reference-labs.ts` other than the four new entries is rejected on sight unless accompanied by a cited clinical source. This covers the 52 US and 8 ZH refused-flip rows, `hematocrit`, `total_bilirubin`, `urine_glucose`, `urine_ketones`, `urine_ph`.
- **Do NOT ship a curated band for any new entry.** All four are `report-only`, all six bounds null. Sourcing was attempted and failed for each; the failures are documented inline with citations. **If you find yourself typing a number into `refLow`, stop.**
- **Do NOT fix the three surfaced pre-existing defects in this diff** — `bicarbonate.criticalHigh: 40`, `bicarbonate.refHigh: 29` (Medscape-sourced), `egfr.criticalLow: 15`. File them. Fixing them here makes this diff's safety review conflate an alias/curation pass with three band changes.
- **Do NOT move `淀粉酶` into `specimenAliases.blood`** in this cycle (§6.1). Note it as a follow-up.
- **Do NOT weaken any existing must-stay-unknown lock.** Two locks gain an assertion (blood `pH`, `Urea Nitrogen` with blood specimen); no lock loses one.
- **Do NOT relax `normName`** to strip parenthetical suffixes — `2026-07-19-chinese-coverage.md` §5 explains why that would turn a whole-blood lead-panel calcium into serum calcium.
- **Do NOT build panel-level sibling-row specimen inference** for the 6 urine rows. Ceiling is 0.0pp (§4.2).
- **Do NOT touch `lib/guard.ts` rule numbering, the i18n layer, or the rate limiter.**

---

## 10. Reporting discipline — carried forward, and it is not optional

**This exact failure has already happened once in this repo: a PR reported "locks unmodified" because the block literally titled *"must STAY unknown"* was untouched, while a different lock assertion in the same file had been changed.** That is a narrow truth used to convey a false impression, and it is the most damaging thing a PR in this repo can do, because the locks are the only thing standing between a normalisation change and a shipped cross-specimen defect.

The PR description MUST:

1. **Enumerate every changed line in `data/english-aliases.test.ts` and `data/reference-labs.test.ts` individually** — added, removed, or modified — with a one-line reason each. "Locks unmodified" is an acceptable claim **only** if `git diff` on those two files is empty. This cycle changes at least three assertions by design (blood `pH`, `Urea Nitrogen`+blood, `TCO2`→`total_co2_calculated`) and rewrites one lock wholesale (§7). Every one must be named.
2. **State every alias whose resolution changed**, in `before → after` form. `TCO2: bicarbonate → total_co2_calculated` is the one this cycle plans; if there are others, they are unplanned and must be investigated, not reported.
3. **Paste the full `npx tsx validation/real-corpus/run.ts` output**, before and after.
4. **Report the actual analyte-confirm numbers against §8's predictions.** If US lands short, name the rows and the mechanism. If it lands *over*, that is more alarming than short — name what resolved that was not predicted.
5. **State the confirm-burden delta.** Four new `highStakes: true` entries add confirm-screen rows on real reports. Report median and max editable fields per report on both corpora, before and after.
6. **State explicitly that no band was invented**, and that all four new entries carry `refLow/refHigh/criticalLow/criticalHigh/absoluteLow/absoluteHigh = null`.

---

## 11. Acceptance criteria

### Per bucket

**W4-1 — sensitive-analyte suppressor** (decision recorded in §5)
- [ ] The §5 decision is recorded in this file with a date and a named decider before any code lands.
- [ ] Suppressor is name-keyed and **value-independent**; a separate registry, not a reference entry; matched by exact `normName`, no substring.
- [ ] Leakage test in the style of `validation/b1VerdictLeakage.test.ts`: for each sensitive name, assert the chip is `Not assessed` for **four** cases — a positive value, a negative value, a numeric above the printed range, and a numeric below it. **All four are required**: together they prove the suppression is not itself a signal.
- [ ] `printedFlagRaw` render path is covered, or explicitly deferred into W7 with a named blocker written into W7's spec.
- [ ] The fail-open property is stated in the code comment and in the PR — this is mitigation, not a guarantee.

**W4-2 — refusal locks**
- [ ] `a-淀粉酶`, `髓系原始细胞群`, the 7 drug screens, and `Estimated GFR (MDRD equation)` each return `null` for `undefined`/`'unknown'`/`null`/`'blood'`/`'urine'`.
- [ ] Each test name carries the panel/unit/harm reasoning, not just the assertion.
- [ ] `findEntry('淀粉酶')?.key === 'amylase'` unchanged (the follow-up is noted, not done).

**W4-3 / W4-4 / W4-5 / W4-6 — the four new report-only entries**
- [ ] `anion_gap`, `base_excess`, `blood_ph`, `total_co2_calculated` all exist with `interpretation: 'report-only'` and **all six bounds `null`**.
- [ ] Each `source:` string states that sourcing failed and why, and carries its citations inline.
- [ ] Each reaches the confirm gate: `highStakes: true` on a `report-only` entry sets `needsConfirm` at `lib/guard.ts:250-254`. If a new entry does not confirm, the wiring is wrong — that is the finding.
- [ ] `Base Excess` regression test on `-5` passes and renders `-5`, not `5`.
- [ ] `findEntry('pH')`, `findEntry('pH','unknown')`, `findEntry('pH',null)` all still `null`; `findEntry('pH','urine')?.key === 'urine_ph'`; `findEntry('pH','blood')?.key === 'blood_ph'`.
- [ ] `findEntry('TCO2')?.key === 'total_co2_calculated'`; `findEntry('HCO3')?.key === 'bicarbonate'`; `findEntry('CO2')?.key === 'bicarbonate'`.
- [ ] `data/reference-labs.test.ts:39` alias-uniqueness green **without** editing the test.

**W4-7 / W4-8 — aliases onto existing entries**
- [ ] `findEntry('Sodium, Whole Blood')?.key === 'sodium'`; `findEntry('Potassium, Whole Blood')?.key === 'potassium'`.
- [ ] `findEntry('Bilirubin, Total')?.key === 'total_bilirubin'`; `findEntry('Hematocrit, Calculated')?.key === 'hematocrit'`.
- [ ] `hematocrit.highStakes` and `total_bilirubin.highStakes` are **still `false`**, and the PR states these two aliases moved the metric by 0.

**W4-9 — `Urea Nitrogen`**
- [ ] `findEntry('Urea Nitrogen')`, `(…,'unknown')`, `(…,null)`, `(…,'urine')` all `null` — the existing lock **keeps its original assertion and its original test name**.
- [ ] `findEntry('Urea Nitrogen','blood')?.key === 'bun'`.
- [ ] The open question in §6.10 is answered in the PR with evidence: does extraction supply `specimen: 'blood'` for US chemistry panels? If no, the +10 is reported as not materialising, and no bare alias is added.

**W4-10 — lock tidy-up**
- [ ] `data/reference-labs.test.ts:15` no longer filters on `specimen === 'urine'`.
- [ ] It asserts the full sorted report-only key list — **19 keys** after this cycle — and that every member has all six bounds `null`.
- [ ] Verified to fail if any of the four new entries is omitted from the list.

### Global

- [ ] `npx vitest run --pool=threads` green — **≥672 tests**, none deleted, skipped, or weakened to pass.
- [ ] `npx tsc --noEmit` clean.
- [ ] **`chipWrong` = 0 on BOTH corpora.** Hard gate.
- [ ] **No existing must-stay-unknown lock weakened.** Every assertion change enumerated per §10.1.
- [ ] **Zero `highStakes` field diffs** in `data/reference-labs.ts` other than the four new entries — and none of those four carries a band.
- [ ] **No new curated band anywhere in the diff.** Grep the diff for `refLow:` / `refHigh:` / `criticalLow:` / `criticalHigh:`; every hit must be `null`.
- [ ] `validation/b1VerdictLeakage.test.ts`, `validation/chipFidelity.test.ts`, `validation/silentAssertion.test.ts` all green.
- [ ] `lib/localizationBaseline.test.ts` movement is expected (four new entries add EN/ZH strings) and the new strings pass the `CARD_BANNED` bank.
- [ ] MedRepBench reported as **22/37, unchanged**, with its ceiling stated as `policy-max 22/37, absolute-max 30/37`.
- [ ] MIMIC-IV reported against the §8 prediction of **121/212**, with any shortfall attributed to a named row and mechanism.
- [ ] The runner output prints the permanent residual — **16 US rows** (7 drug screens, 6 urine artifact, 2 `highStakes:false` targets, 1 MDRD eGFR) and **15 ZH rows** (7 policy refusals, 8 refused-flips) — with the sentence *"these rows are a permanent residual in the analyte-confirm denominator; do not chase them"*, so the next implementer does not spend a cycle on them.

---

## 12. Risk

The risk in this cycle is not that any single alias is wrong. It is that a coverage number applies pressure in exactly one direction — up — and the three cheapest ways to move it are all defects: flip six `highStakes` fields (+12.8pp US, +21.6pp ZH, and a mandatory confirm on every CBC row), add a bare `Glucose` alias (+11, silently grounding random glucoses against a fasting band), and add a bare `pH` alias (+6, re-opening a lock that exists because a blood-gas pH of 7.1 sits comfortably inside the urine band 4-9).

All three are available in one line each. All three would pass CI. §8's numbers are pre-registered so that a shortfall reads as *a thing to investigate* rather than as pressure to reach for one of them.
