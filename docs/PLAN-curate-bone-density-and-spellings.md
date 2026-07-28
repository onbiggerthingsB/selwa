# PLAN — Curate bone densitometry, and three printed spellings the table already covers

**Repo:** `/Users/likerun/Desktop/health-translator` · **Branch:** `main` · **Baseline commit:** `32a882a`
**Written:** 2026-07-28 · **Executor:** a fresh engineer with no access to the originating conversation.

---

## 0. What this product is, and the one rule that decides every question below

A Next.js PWA. A user photographs a Chinese-language hospital lab report; the app explains each row in plain language. Users: elderly Tibetans and Mandarin-weak readers in Lhasa, plus a US Mandarin-diaspora beachhead.

**THE INVARIANT:** *The LLM is OCR-only. Meaning is deterministic from a curated table. Never assert what cannot be verified against the printed page.* The model extracts text. It never classifies, diagnoses, or translates a clinical claim.

**A mechanic you must understand before touching `data/reference-labs.ts`.** The status chip ("below / within / above your report's range") is **table-independent**. It is arithmetic on the printed value against the printed range (`statusAgainstPrinted` in `lib/reference.ts`, consumed by `lib/summary.ts:162`), and it renders even for rows the table cannot name. Therefore:

- Declining to curate an analyte does **not** stop the user seeing a position for it.
- `chipWrong === 0` is necessary but **not sufficient**, and has been proven insufficient by measurement — see `validation/camera-path/README.md` §"Why this is the important finding", where two values misread identically in all three runs produced identical chips.
- Curation's job is to add **meaning** and **guards**, not to enable the chip.

---

## 1. The evidence this plan acts on

A real 31-page Lhasa health check was replayed through `findEntry` on 2026-07-28. Recognition: **107/129 rows = 82.9%**. Twenty-two distinct printed names went unrecognised. I verified all 22 are unresolved at `32a882a`:

```
npx tsx -e "import { findEntry } from './lib/reference'; ..."   # every one returns null for
                                                                # 'unknown', 'blood' and 'urine'
```

Scope is **GOAL A** and **GOAL B** only. Everything else is an explicit non-goal (§10).

### GOAL A — bone densitometry, 16 rows, an entire uncovered modality

```
T11 BMD    T11 BMC    T11 T值    T11 Z值
T12 BMD    T12 BMC    T12 T值    T12 Z值
L1  BMD    L1  BMC    L1  T值    L1  Z值
均值 BMD   均值 BMC   均值 T值   均值 Z值
```

`均值` = the mean row. T11/T12/L1 are the vertebral site labels the report prints. BMD = bone mineral density, BMC = bone mineral content, T值/Z值 = T-score/Z-score.

### GOAL B — three printed spellings the table already covers under a different spelling

I diagnosed each one against the current matcher. The diagnoses are exact, not guesses:

| printed | currently | control that DOES resolve | root cause |
|---|---|---|---|
| `血清碳酸氢盐（HC03）测定` | `null` | `血清碳酸氢盐（HCO3）测定` → `bicarbonate` | `HC03` is printed with a **digit zero**; the curated alias `'碳酸氢盐（HCO3）'` has a **letter O** |
| `血清三碘甲状原氨酸(T3)` | `null` | `血清三碘甲状腺原氨酸(T3)` → `total_t3` | a dropped `腺`; already recorded in `validation/camera-path/full-report-2026-07-26.md:56` |
| `血清胱抑素` | `null` | `胱抑素C` → `cystatin_c` | **an entry already exists**, and `lib/reference.test.ts:93-96` *deliberately* locks bare `胱抑素` as unknown. See §6 — this one is a finding, not a fix. |

Useful `normName` facts I verified (`lib/reference.ts:5-17`): it lowercases, collapses ASCII **and** ideographic spaces, folds `γ→y`, and strips `： : ． . , ( ) （ ） [ ] 【 】`. So:

- `'碳酸氢盐（HC03）'` and `'碳酸氢盐(HC03)'` both → `碳酸氢盐hc03` — **one alias covers both bracket widths.**
- `'T11 BMD'` → `t11bmd`; `'L1  BMC'` (double space) → `l1bmc` — **one alias covers any spacing.**
- `'血清碳酸氢盐（HC03）测定'` → the candidate ladder in `nameCandidates()` produces `碳酸氢盐（HC03）`, so the alias must be the **bare** form, not the prefixed one.

---

## 2. Ground rules for this change

### 2.1 Inventory locks — STOP AND ASK, never silently rebaseline

This repo deliberately fails builds on inventory drift. Every lock below is a *tripwire*, not a chore. You must:

1. Make the change **without touching any lock**.
2. Run the suite. Exactly the locks listed in §8 must go red, and **nothing else**. *A red test outside that list is a bug in your change, not a lock to move.*
3. Report the actual before/after values in a table and **wait for human approval**.
4. Only then update the lock values **and** the explanatory comment above each one, in a separate commit.

### 2.2 `curatedBo === 0` is a safety invariant, not a lock

It proves no unreviewed Tibetan ships. Every new string uses `bo: fallback('zh')`. **Never** `reviewed()` for `bo`. The `zh` and `bo` content hashes in `lib/localizationBaseline.test.ts` must stay **byte-identical to each other** — that identity is the proof. If your rebaseline makes them differ, you have shipped unreviewed Tibetan; stop.

### 2.3 Hardcoded counts live in production source too

`lib/tibetanImport.ts:516` and `:533` **throw** on drift. They are not tests. Grep before you assume:

```
grep -rn "\b158\b\|\b585\b\|\b584\b\|\b968\b\|\b422\b" --include="*.ts" --include="*.tsx" . | grep -v node_modules
```

### 2.4 Duplicate object keys are silent

A second `specimenAliases:` (or any property) inside one entry silently drops the first, and `tsc` does not catch it. The tripwire is `data/reference-labs.test.ts:420` — *"never declares the same property twice inside one entry"*. It reads the **source text** and slices on `/^    key: '([a-z0-9_]+)',$/gm`, i.e. **exactly four spaces of indentation**. Your new entries must use that indentation or the scan will not see them at all.

### 2.5 Alias collisions are the dominant failure mode here

Real defects already caught in review on this table:

- `PCT` means procalcitonin **and** plateletcrit. A bare `PCT` alias routed a procalcitonin of 2.5 ng/mL (serious infection) to plateletcrit with no flags.
- `Tg` means thyroglobulin **and** triglycerides.
- `PH值` added unscoped sent a blood-gas pH of 7.10 to urine pH, classified normal, no flags.
- **The entry key is also indexed** (`lib/reference.ts:23` — `for (const token of [e.key, ...localizedNames, ...e.aliases])`). Naming a key `pct` made bare `PCT` resolve regardless of aliases. **Check keys, not just alias arrays.**

For bone density this is acute: `BMD`, `BMC`, `T值`, `Z值`, `均值` are all generic. `T值`/`Z值` are *statistical score names*, not analytes. §5 and §7 exist to make a bare `T值` structurally unable to become a confident match.

### 2.6 The 钙(Ca) precedent

`lib/reference.test.ts:198` and `data/english-aliases.test.ts` lock `钙(Ca)` and `镁(Mg)` as **UNKNOWN**: they are trace-element panel rows in µg/ml, so a plausible-looking "strip parenthetical suffixes" normalization would turn them into serum calcium/magnesium in mmol/L. Any rule you propose must be checked against it. This plan proposes **no** normalization rule, precisely for this reason (§4).

---

## 3. Baseline to record before touching anything

Run all three and paste the output into your working notes. These are the numbers I measured at `32a882a`.

```bash
npx tsc --noEmit                          # clean
npx vitest run --pool=threads             # 90 files, 1147 passed | 41 skipped
node --import tsx validation/real-corpus/run.ts     # plain tsx uses sandbox-blocked IPC
```

`--pool=threads` is **required**; the default forks pool fails under load in this repo.

Baseline `validation/real-corpus/run.ts` output — **none of the 22 target names appears in any of these corpora**, which I verified by grep. Therefore this output must be **byte-identical** after your change. Any movement means you resolved something you did not intend to.

```
=== MedRepBench — Chinese reports, SI units (stress corpus) ===
combined  rows  143 · CHIP  72.0% (103 reproduced / 40 defer) · analyte-confirm 100.0% (35/35 recognised high-stakes rows)
combined  chip-vs-report  92.8% (103 correct / 0 WRONG / 8 deferred of 111 answerable)
combined  recog  55.9% · abstain  47.6% · confirm  42.7% · agree 100.0% (n=33, wrong 0)

=== MIMIC-IV demo — real US hospital labs, conventional units (BEACHHEAD) ===
combined  rows  322 · CHIP  73.6% (237 reproduced / 85 defer) · analyte-confirm 100.0% (112/112 recognised high-stakes rows)
combined  chip-vs-report 100.0% (237 correct / 0 WRONG / 0 deferred of 237 answerable)
combined  recog  65.2% · abstain  47.5% · confirm  56.2% · agree 100.0% (n=64, wrong 0)

=== Field — de-identified Lhasa CBC+CRP (grounding regression) ===
combined  rows   27 · CHIP 100.0% (27 reproduced / 0 defer) · analyte-confirm 100.0% (4/4 recognised high-stakes rows)
combined  recog  96.3% · abstain   3.7% · confirm  15.4% · agree 100.0% (n=17, wrong 0)

✓ US safety gate: 0 confidently-wrong rows (disagreements are protected by confirmation or internal review).
```

---

## STEP 1 — Freeze the 2026-07-28 recognition evidence (write this RED, first)

**Why first:** the 129-row report is not committed (it carries patient identifiers). The only way the next engineer can reproduce the before/after is a frozen name list. This mirrors the existing pattern: `validation/camera-path/runs-2026-07-25.ts` + `cameraPath.test.ts`.

**Note:** `validation/` is **not** scanned by `extractLocalizedTextCorpus` (`LOCALIZED_TEXT_SOURCE_DIRS = ['app','components','data','lib']`, `lib/localizedTextCorpus.ts:7`), so nothing here moves a localization lock.

### 1a. New file `validation/camera-path/unresolved-names-2026-07-28.ts`

```ts
// FROZEN RECOGNITION EVIDENCE — 2026-07-28.
//
// A 31-page Lhasa comprehensive health check (体检报告), photographed with the patient's consent
// and replayed through findEntry(). Recognition at the time: 107 of 129 rows = 82.9%. These are
// the 22 distinct printed row names that did NOT resolve.
//
// NO IMAGES AND NO PATIENT DATA ARE COMMITTED. Only the printed row LABELS are recorded here;
// they carry no identifying information.
//
// This list is a frozen record, not a target. The three groups below encode a DECISION each:
// what we curated, what we curated under a different spelling, and what we deliberately declined.

/** GOAL A — bone densitometry. An entire modality the table did not cover. */
export const BONE_DENSITOMETRY_NAMES_2026_07_28 = [
  ['T11 BMD', 'bone_bmd_t11'],
  ['T11 BMC', 'bone_bmc_t11'],
  ['T11 T值', 'bone_t_score_t11'],
  ['T11 Z值', 'bone_z_score_t11'],
  ['T12 BMD', 'bone_bmd_t12'],
  ['T12 BMC', 'bone_bmc_t12'],
  ['T12 T值', 'bone_t_score_t12'],
  ['T12 Z值', 'bone_z_score_t12'],
  ['L1 BMD', 'bone_bmd_l1'],
  ['L1 BMC', 'bone_bmc_l1'],
  ['L1 T值', 'bone_t_score_l1'],
  ['L1 Z值', 'bone_z_score_l1'],
  ['均值 BMD', 'bone_bmd_mean'],
  ['均值 BMC', 'bone_bmc_mean'],
  ['均值 T值', 'bone_t_score_mean'],
  ['均值 Z值', 'bone_z_score_mean'],
] as const;

/** GOAL B — spellings the table already covered under a different spelling. */
export const RESPELLED_NAMES_2026_07_28 = [
  // 'HC03' is printed with a DIGIT ZERO where the chemical symbol HCO3 has a letter O.
  ['血清碳酸氢盐（HC03）测定', 'bicarbonate'],
  // A dropped 腺 vs the curated 血清三碘甲状腺原氨酸(T3). Already recorded as OCR instability in
  // validation/camera-path/full-report-2026-07-26.md.
  ['血清三碘甲状原氨酸(T3)', 'total_t3'],
] as const;

/**
 * Names we read and DELIBERATELY do not resolve. Each carries its reason. These are decisions
 * with owners, not a backlog: a future pass that makes one of them resolve must delete its line
 * here and say why.
 */
export const DECLINED_NAMES_2026_07_28 = [
  [
    '血清胱抑素',
    'Cystatins A, B and C are distinct proteins and the page did not print the subtype. '
      + 'lib/reference.test.ts already locks a bare 胱抑素 as unknown; naming it Cystatin C would '
      + 'assert a subtype the page does not show.',
  ],
  [
    '检测结果:DOB',
    'The 13C urea breath test. Removed from the table on 2026-07-28 because it was falsely '
      + "specimen: 'blood' (it is a breath assay) and its DOB abbreviation collides with date of "
      + 'birth. It needs a breath specimen frame first.',
  ],
  ['基础代谢率', 'Basal metabolic rate. Out of scope for this pass; no frame decided.'],
  ['其他', 'A literal "other" row. Not an analyte.'],
] as const;
```

### 1b. New file `validation/camera-path/recognition-2026-07-28.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { findEntry, printedSpecimenFor } from '@/lib/reference';
import { REFERENCE_LABS } from '@/data/reference-labs';
import {
  BONE_DENSITOMETRY_NAMES_2026_07_28,
  RESPELLED_NAMES_2026_07_28,
  DECLINED_NAMES_2026_07_28,
} from './unresolved-names-2026-07-28';

describe('recognition on the 2026-07-28 Lhasa health check', () => {
  it.each(BONE_DENSITOMETRY_NAMES_2026_07_28)(
    'resolves the bone densitometry row %s to %s, and only from an unknown printed specimen',
    (printed, key) => {
      expect(findEntry(printed, 'unknown')?.key).toBe(key);
      expect(findEntry(printed, null)?.key).toBe(key);
      // A bone densitometry row is never on a blood or urine panel. The measurement frame makes
      // that structural, not a matter of alias hygiene (lib/reference.ts specimenSafeMatch).
      expect(findEntry(printed, 'blood')).toBeNull();
      expect(findEntry(printed, 'urine')).toBeNull();
    },
  );

  it.each(RESPELLED_NAMES_2026_07_28)('resolves the printed spelling %s to %s', (printed, key) => {
    expect(findEntry(printed, 'blood')?.key).toBe(key);
  });

  it.each(DECLINED_NAMES_2026_07_28)('keeps %s unresolved on purpose (%s)', (printed) => {
    for (const specimen of ['unknown', 'blood', 'urine', null] as const) {
      expect(findEntry(printed, specimen)).toBeNull();
    }
  });

  // The whole point of the measurement frame for this modality.
  it('reaches every bone entry only from an unknown printed specimen', () => {
    const bone = REFERENCE_LABS.filter((entry) => entry.key.startsWith('bone_'));
    expect(bone).toHaveLength(16);
    for (const entry of bone) {
      expect(entry.specimen, entry.key).toBe('measurement');
      expect(printedSpecimenFor(entry), entry.key).toBe('unknown');
      expect(entry.interpretation, entry.key).toBe('report-only');
      expect(entry.source, entry.key).toBe('');
      expect(
        [entry.refLow, entry.refHigh, entry.criticalLow, entry.criticalHigh, entry.absoluteLow, entry.absoluteHigh],
        entry.key,
      ).toEqual([null, null, null, null, null, null]);
    }
  });
});
```

**Verify:** `npx vitest run --pool=threads validation/camera-path/recognition-2026-07-28.test.ts`
Expected now: the 16 bone cases and the 2 respelled cases **fail**; the 4 declined cases **pass**. That red is the "before" measurement. Record it.

---

## STEP 2 — GOAL B.1: the `HC03` digit-zero spelling

### The decision you are being asked to ratify: explicit alias, NOT folding

The brief raises two options. Argue them, then take (a).

**(a) Explicit alias.** Add one string to `bicarbonate`'s alias array. Blast radius: one entry, one index token, provably.

**(b) Extend `foldOcrConfusables` (`lib/reference.ts:368`) from units to names.** This is the riskier option and should be **rejected**. Reasons, in order of weight:

1. **The unit fold is safe because the unit vocabulary is CLOSED and exhaustively checkable.** `unitComparisonKeyCollisions()` (`lib/reference.ts:382`) is asserted empty over the *entire shipped inventory* (~73 strings, `lib/reference.test.ts:323`). Adding a colliding unit fails the suite. The name index has 968 tokens and grows with every curation pass; the same guarantee costs more and buys less.
2. **The fold would change behaviour for inputs that are NOT in the index, and nothing tests those.** Today a name we cannot read falls through to `R1-UNKNOWN-ANALYTE`, which is *spoken* to the user ("This test is not in our reference set"). Under name folding, a printed name could silently start resolving to a **wrong entry** — the dominant failure mode on this table (§2.5). Folding trades a safe, disclosed abstention for an undisclosed possible misroute.
3. **Concrete collision surface.** `o→0` and `i→l` on names would merge, among others: `Cl` with `CI`, `IgG` with `lgG`, `CO2` with `C02`, `PO4` with `P04`, `Li` with `Ll`. Most are benign *today*; the point is that every future alias, forever, must be reviewed under folding, and the `钙(Ca)` class of defect (§2.6) shows this project has already been bitten once by a normalization rule that looked obviously fine.
4. **`normName` is not only the matcher.** It is exported and used by `lib/directBoAudit.test.ts`, `lib/tibetanInvariants.test.ts` (the B12 name-collision gate) and to build `INDEX` itself. Folding would move the 968-key index count and could *merge* two aliases of the same entry, making the count movement itself hard to interpret.

**Decision: (a).** Record the reasoning in the source comment. → **OPEN QUESTION #1** (§11) if the human disagrees.

### 2a. Edit `data/reference-labs.ts`, entry `bicarbonate` (key at line 1228, aliases at line 1236)

Current:

```ts
aliases: ["HCO3", "HCO3-", "CO2", "CO2-CP", "二氧化碳结合力", "碳酸氢根", '碳酸氢盐', '碳酸氢盐（HCO3）'],
```

Change to (one string added, plus the comment):

```ts
    // '碳酸氢盐（HC03）' is the SAME printed row read with a DIGIT ZERO where the chemical symbol
    // has a letter O — measured verbatim on a real Lhasa health check, 2026-07-28
    // (validation/camera-path/unresolved-names-2026-07-28.ts). Deliberately an explicit alias
    // rather than extending lib/reference.ts's foldOcrConfusables to names: that fold is safe for
    // UNITS only because the unit vocabulary is closed and its collisions are asserted empty over
    // the whole shipped inventory. Folding names would widen matching for inputs that are not in
    // the index at all, turning a disclosed R1 abstention into a possible silent misroute.
    // normName strips both bracket widths, so this one string also covers '碳酸氢盐(HC03)'.
    aliases: ["HCO3", "HCO3-", "CO2", "CO2-CP", "二氧化碳结合力", "碳酸氢根", '碳酸氢盐', '碳酸氢盐（HCO3）', '碳酸氢盐（HC03）'],
```

**Do NOT add a bare `'HC03'`.** Keeping the scope to the parenthesised form is what makes this reviewable; §7 asserts the bare form stays refused.

### 2b. Verify

```bash
npx vitest run --pool=threads lib/reference.test.ts data/reference-labs.test.ts data/english-aliases.test.ts
```

Then:

```
findEntry('血清碳酸氢盐（HC03）测定', 'blood')?.key === 'bicarbonate'
findEntry('碳酸氢盐（HC03）')?.key            === 'bicarbonate'
findEntry('碳酸氢盐(HC03)')?.key              === 'bicarbonate'   // half-width, same normName
findEntry('血清碳酸氢盐（HCO3）测定', 'blood')?.key === 'bicarbonate'   // unchanged
findEntry('血清碳酸氢盐（HC03）测定', 'urine') === null          // prefix/panel contradiction
findEntry('HC03')                              === null          // scope stayed narrow
```

The table-wide tripwires in `lib/reference.test.ts` (`never collapses two different analytes onto one index token`, line 59; `never lets a measurement suffix repoint a curated name to another analyte`, line 230) re-run automatically and must stay green.

---

## STEP 3 — GOAL B.2: the dropped-`腺` T3 spelling

### 3a. Edit `data/reference-labs.ts`, entry `total_t3` (key at line 1869, aliases at line 1877)

Current:

```ts
aliases: ["TT3", "Total T3", "T3", "总T3", "总三碘甲状腺原氨酸", "三碘甲腺原氨酸", '三碘甲状腺原氨酸(T3)', '三碘甲状腺原氨酸（T3）'],
```

Add **exactly one** string, `'三碘甲状原氨酸(T3)'`:

```ts
    // A dropped 腺 vs the curated '三碘甲状腺原氨酸(T3)'. This is OCR instability, not a different
    // measurand: the same photograph produced both spellings across runs
    // (validation/camera-path/full-report-2026-07-26.md), and 2026-07-28 printed only the corrupt
    // one. The (T3) suffix is what pins this to TOTAL T3; a bare corrupted stem stays refused,
    // because the bare CORRECT stem '三碘甲状腺原氨酸' does not resolve either and making the
    // corruption more permissive than the original would be incoherent.
    aliases: [..., '三碘甲状腺原氨酸（T3）', '三碘甲状原氨酸(T3)'],
```

### 3b. Verify

```
findEntry('血清三碘甲状原氨酸(T3)', 'blood')?.key  === 'total_t3'
findEntry('三碘甲状原氨酸(T3)')?.key               === 'total_t3'
findEntry('血清三碘甲状腺原氨酸(T3)', 'blood')?.key === 'total_t3'   // unchanged
findEntry('血清三碘甲状原氨酸(T3)', 'urine')        === null
findEntry('三碘甲状原氨酸')                         === null   // bare corrupted stem stays refused
findEntry('游离三碘甲状原氨酸')                     === null   // the FREE-T3 corruption is NOT rescued
findEntry('血清游离三碘甲状腺原氨酸')?.key          === 'free_t3'   // unchanged
```

**Noted, not fixed:** the bare *correct* spelling `三碘甲状腺原氨酸` does not resolve either, while the variant `三碘甲腺原氨酸` does. That asymmetry predates this change. Do not fix it here — it is a separate before/after change with its own total-vs-free ambiguity argument. → **OPEN QUESTION #2**.

---

## STEP 4 — GOAL B.3: `血清胱抑素` — a finding, not a fix

**Answer to "check whether an entry exists under another name": yes.** `data/reference-labs.ts:1786` curates `cystatin_c` with aliases `["Cys-C","CysC","Cystatin C","胱抑素C","半胱氨酸蛋白酶抑制剂C"]`, and `findEntry('胱抑素C','blood')` resolves today.

**And the requested alias is already explicitly refused, on purpose.** `lib/reference.test.ts:92-96`:

```ts
// DELIBERATELY NOT AN ALIAS. Cystatins A, B and C are distinct proteins; only cystatin C is the
// kidney assay this entry curates, so a bare 胱抑素 that dropped the subtype must keep abstaining
// rather than silently resolve to cystatin C.
it('refuses a cystatin name that has lost its subtype', () => {
  expect(findEntry('胱抑素', 'blood')).toBeNull();
  expect(findEntry('胱抑素C', 'blood')?.key).toBe('cystatin_c');
});
```

**Recommendation: do NOT add the alias.** Under the invariant, the page printed `血清胱抑素` and did not print a subtype; naming it "Cystatin C" asserts a fact that is not on the page. Adding it would require deleting a test somebody wrote deliberately, which is a human decision, not a mechanical one. The user is not left with nothing: the table-independent chip still renders, and `R1-UNKNOWN-ANALYTE` is *spoken* ("This test is not in our reference set, so we are not interpreting it").

**What to do instead:** the refusal is now recorded with its reason in `DECLINED_NAMES_2026_07_28` (Step 1a) and pinned by the `keeps %s unresolved on purpose` test (Step 1b). That converts an invisible gap into a decision with an owner.

**A narrower option exists if the human overrules me.** Because `findExactMatch` runs before the prefix-splitting ladder, adding the literal alias `'血清胱抑素'` to `cystatin_c` would make the *serum-prefixed* form resolve while leaving bare `胱抑素` refused — mechanically clean, and defensible on the argument that the only routine serum cystatin assay is cystatin C. I do not recommend it: it is a subtle rule that reads as arbitrary. → **OPEN QUESTION #3.**

---

## STEP 5 — GOAL A: curate the 16 bone densitometry rows

### 5.1 Frame: reuse `'measurement'`. Do NOT invent a new specimen.

`lib/types.ts:26` defines `specimen: 'blood' | 'urine' | 'measurement'`, and documents `'measurement'` as *"a BODY MEASUREMENT, not an assay of any specimen"*. Bone densitometry fits that definition exactly: a DXA scan measures the body; there is no specimen. Reusing it buys three things for free:

- `printedSpecimenFor()` (`lib/reference.ts:44`) returns `'unknown'`, and `specimenSafeMatch` (`:50`) **refuses** a measurement entry whenever the report explicitly printed blood or urine. A bone row can never be reached from a blood panel.
- The measurement unit-contradiction guard already exists — `lib/guard.ts` fires `R2-UNIT-MISMATCH` and abstains when `entry.specimen === 'measurement'` and a *printed* unit contradicts the curated family.
- No change to `lib/types.ts`, no widening of `ScopedSpecimen`, no change to the OCR contract (`lib/extractionSchema.ts` only ever offers `urine | blood | unknown`, and a bone density page prints no specimen heading).

A new `'densitometry'` frame would touch `lib/types.ts`, `printedSpecimenFor`, the `entry.specimen === 'measurement'` branch in `lib/guard.ts`, and `data/reference-labs.test.ts:338`'s key/specimen assertion — for zero safety gain. → **OPEN QUESTION #4.**

### 5.2 Interpretation: `report-only`, bandless, no source

T-scores and Z-scores are *defined* relative to a reference population; BMD cutoffs are equipment- and population-dependent. `report-only` is the honest choice, and the honest `source` for it is the **empty string** — that is the documented convention, stated at `data/reference-labs.ts:64-69`: *"`source` is a CITATION field, and an empty one is the structural marker that this entry asserts no reference interval."* Report-only entries that genuinely carry a citation are enumerated in `SOURCED_REPORT_ONLY_KEYS` (`data/reference-labs.test.ts:8`). **Do not add the bone keys there.**

### 5.3 Shape: 16 separate entries, each with a site-specific alias

**Why 16 and not 4.** Four entries (BMD/BMC/T/Z) with the site enumerated in the alias list would be equally *safe* — the aliases are enumerated either way, so no bare `T值` ever resolves. The reason for 16 is **display fidelity**: with four entries, a row printed `T11 BMD` and a row printed `均值 BMD` would render the identical name, and `均值` is a **derived aggregate**, materially different from a single-site measurement. Naming the site is verifiable — it is printed right there on the page — and merging them is exactly the kind of quiet flattening the invariant exists to prevent. → **OPEN QUESTION #5.**

**Why a bare `T值` cannot become a confident match.** Three independent structural reasons, each of which you must assert in §7:

1. Every alias is the **full printed cell** (`'T11 T值'`), never a bare quantity token.
2. Every **key** carries the `bone_` prefix, so the key-is-also-indexed hazard (§2.5) cannot produce a bare `bmd` / `t值` token.
3. The entries live in the `'measurement'` frame, so even a hypothetical bare match is unreachable whenever the report prints a specimen.

### 5.4 Add the helper to `data/reference-labs.ts`

Place it immediately after `bodyMeasurement` (which ends at line 115), before `urineReportOnly`.

```ts
interface BoneDensitometryInput {
  key: string;
  name: LocalizedText;
  aliases: string[];
  definition: LocalizedText;
  unit: string;
  allowedUnits: string[];
}

// BONE DENSITOMETRY (DXA). Sixteen rows on a real Lhasa health check, 2026-07-28: BMD, BMC, T值
// and Z值 at T11, T12, L1 and a 均值 row. An entire modality the table could not name, so the user
// saw sixteen raw labels and nothing else (validation/camera-path/unresolved-names-2026-07-28.ts).
//
// FRAME. A DXA scan is not an assay of any specimen, so these reuse the 'measurement' frame added
// for height/BP/pulse/SpO2 rather than inventing a new one. That is not a convenience: it is what
// makes a bone row STRUCTURALLY unreachable from a blood or urine panel (lib/reference.ts
// specimenSafeMatch), which matters because BMD/BMC/T值/Z值 are generic tokens.
//
// REPORT-ONLY AND BANDLESS, ON PURPOSE. A T-score is DEFINED as a distance from a young-adult
// reference population, and a Z-score from an age-matched one; BMD cutoffs are equipment- and
// population-dependent. We have no population-appropriate source for a Tibetan cohort at 3,650 m,
// and a plausible-looking number would be an invented band. The user gets the curated NAME and
// DEFINITION plus the hospital's own printed range and the existing table-independent chip.
//
// ALIASES ARE THE FULL PRINTED CELL, NEVER A BARE QUANTITY. 'T11 BMD', not 'BMD'. T值 and Z值 are
// STATISTICAL SCORE NAMES, not analytes; a bare one names nothing. Keys carry a bone_ prefix for
// the same reason — the entry key is indexed alongside the aliases (lib/reference.ts), so a key
// of 'bmd' would make a bare BMD resolve regardless of what the alias array says.
//
// NO unitOptional. It is deliberately absent from this shape, not merely unset: the unitOptional
// inventory is locked to two dimensionless urine quantities (data/reference-labs.test.ts) and
// report-only rows never reach unitMatches anyway, so a blank printed unit is already accepted.
function boneDensitometry(input: BoneDensitometryInput): ReferenceEntry {
  return {
    key: input.key,
    name: input.name,
    aliases: input.aliases,
    specimen: 'measurement',
    interpretation: 'report-only',
    unit: input.unit,
    allowedUnits: input.allowedUnits,
    refLow: null,
    refHigh: null,
    criticalLow: null,
    criticalHigh: null,
    absoluteLow: null,
    absoluteHigh: null,
    // Report-only entries return before R6, so highStakes is the ONLY thing that would route these
    // to the confirmation screen. FALSE, argued: a bone density number demands no prompt action the
    // way a potassium or a troponin does, and a densitometry page prints sixteen of these rows at
    // once — making them all mandatory-confirm would flood one screen and is exactly the
    // confirm-fatigue the baseline in validation/confirmBurden.ts exists to watch. The reading risk
    // (a dropped minus sign on a T值) is still covered: R5 routes any low-confidence report-only row
    // to confirmation.
    highStakes: false,
    populationSensitive: false,
    definition: input.definition,
    plain: input.definition,
    source: '',
  };
}
```

### 5.5 Add the 16 entries at the END of `REFERENCE_LABS`

Append after the final `bloodReportOnly({ key: 'ast_alt_ratio', ... })`, before the closing `];`. Appending keeps the `localizationBaseline` hash diff a pure append, which makes the rebaseline reviewable.

**Indentation is load-bearing:** `  boneDensitometry({` at two spaces, `    key: '...',` at four (§2.4).

Exemplars — write these four verbatim:

```ts
  // ---- Bone densitometry (see boneDensitometry above: measurement frame, report-only, bandless)
  boneDensitometry({
    key: 'bone_bmd_t11',
    name: defineText({
      en: reviewed('Bone mineral density (T11)'),
      zh: reviewed('骨密度（T11）'),
      bo: fallback('zh'),
    }),
    aliases: ['T11 BMD'],
    unit: 'g/cm2',
    allowedUnits: ['g/cm2', 'g/cm²', 'g/cm^2'],
    definition: defineText({
      en: reviewed('The amount of bone mineral per unit area, measured at the site labelled T11 on your report.'),
      zh: reviewed('报告上标注为 T11 的部位所测得的单位面积骨矿物质含量。'),
      bo: fallback('zh'),
    }),
  }),
  boneDensitometry({
    key: 'bone_bmc_t11',
    name: defineText({
      en: reviewed('Bone mineral content (T11)'),
      zh: reviewed('骨矿含量（T11）'),
      bo: fallback('zh'),
    }),
    aliases: ['T11 BMC'],
    unit: 'g',
    allowedUnits: ['g'],
    definition: defineText({
      en: reviewed('The total amount of bone mineral measured at the site labelled T11 on your report.'),
      zh: reviewed('报告上标注为 T11 的部位所测得的骨矿物质总量。'),
      bo: fallback('zh'),
    }),
  }),
  boneDensitometry({
    key: 'bone_t_score_t11',
    name: defineText({
      en: reviewed('Bone density T-score (T11)'),
      zh: reviewed('骨密度T值（T11）'),
      bo: fallback('zh'),
    }),
    aliases: ['T11 T值'],
    unit: 'SD',
    allowedUnits: ['SD'],
    definition: defineText({
      en: reviewed('A score that states the bone density measured at the site labelled T11 on your report as a number of standard deviations from a young-adult reference population.'),
      zh: reviewed('将报告上标注为 T11 的部位所测骨密度，表示为与年轻成人参照人群相差多少个标准差的数值。'),
      bo: fallback('zh'),
    }),
  }),
  boneDensitometry({
    key: 'bone_z_score_t11',
    name: defineText({
      en: reviewed('Bone density Z-score (T11)'),
      zh: reviewed('骨密度Z值（T11）'),
      bo: fallback('zh'),
    }),
    aliases: ['T11 Z值'],
    unit: 'SD',
    allowedUnits: ['SD'],
    definition: defineText({
      en: reviewed('A score that states the bone density measured at the site labelled T11 on your report as a number of standard deviations from an age-matched reference population.'),
      zh: reviewed('将报告上标注为 T11 的部位所测骨密度，表示为与同龄参照人群相差多少个标准差的数值。'),
      bo: fallback('zh'),
    }),
  }),
```

Then instantiate the remaining 12 identically, substituting only the site:

| site token | keys | EN name suffix | ZH name suffix | alias prefix |
|---|---|---|---|---|
| `T12` | `bone_bmd_t12`, `bone_bmc_t12`, `bone_t_score_t12`, `bone_z_score_t12` | `(T12)` | `（T12）` | `T12 ` |
| `L1` | `bone_bmd_l1`, `bone_bmc_l1`, `bone_t_score_l1`, `bone_z_score_l1` | `(L1)` | `（L1）` | `L1 ` |
| `均值` | `bone_bmd_mean`, `bone_bmc_mean`, `bone_t_score_mean`, `bone_z_score_mean` | `(mean)` | `（均值）` | `均值 ` |

For **T12** and **L1**, the definition text is the T11 text with `T11` replaced by `T12` / `L1` in both languages.

For **均值**, replace the site clause. Do **not** write "the mean across the measured vertebrae" — that infers which sites the average covers. Write only what the page shows:

- BMD en: `The amount of bone mineral per unit area, for the row labelled 均值 (mean) on your report.` / zh: `报告上标注为“均值”一行的单位面积骨矿物质含量。`
- BMC en: `The total amount of bone mineral, for the row labelled 均值 (mean) on your report.` / zh: `报告上标注为“均值”一行的骨矿物质总量。`
- T-score en: `A score that states the bone density on the row labelled 均值 (mean) on your report as a number of standard deviations from a young-adult reference population.` / zh: `将报告上标注为“均值”一行的骨密度，表示为与年轻成人参照人群相差多少个标准差的数值。`
- Z-score en: same, with `an age-matched reference population` / `同龄参照人群`.

**Definition constraints — check every string against these before committing:** state only what the quantity **is**. No direction claims ("rises with", "low means"), no clinical role ("used for screening", "assesses osteoporosis risk"), no causal language. All of these have been corrected on this table before. → the Chinese wording should get a native-reader pass; flag it in your handoff.

### 5.6 Unit choices, argued

- **BMD `g/cm2`.** `normalizeUnit` does not fold the superscript, so `g/cm2`, `g/cm²` and `g/cm^2` are three distinct comparison keys and all three must be whitelisted (exactly as `bmi` does with `kg/m2` at line ~3258). This triggers Step 6.
- **BMC `g`.** Single unit, no equivalence group needed. Verified: `unitComparisonKey('g') === 'g'`, distinct from the shipped `g/l`.
- **T值/Z值 `SD`.** A T-score is *by definition* expressed in standard deviations; that is honest and printed-page-independent. Real reports usually print **no** unit for these rows, which is fine — `reportOnlySpecimenContradicted` only fires on a **non-empty** printed unit, and the report-only branch never calls `unitMatches`. If the OCR does put something else in the unit cell, the row abstains with the measurement `R2-UNIT-MISMATCH` message, which is the safe direction.
  Rejected: `unit: 'as reported'`. That string is the wildcard for entries whose printed unit **genuinely varies** (`data/reference-labs.ts:118`, `lib/tibetanImport.test.ts:330`). A T-score's unit does not vary; it is absent. Using the wildcard here would switch off the guard for no reason and would move the locked `'as reported'` count from 16. → **OPEN QUESTION #6.**
- **Never** whitelist non-equivalent units as if they were equivalent. A past defect allowed `IU/L` vs `IU/mL` — a 1000× difference.

### 5.7 Negative values and negative printed ranges — verified, no code change needed

T-scores are routinely negative. I traced this end to end at `32a882a`:

- `structurallySuspicious()` in `lib/guard.ts` marks a negative value suspicious unless `absoluteLow < 0` — but it is **unreachable** for these rows: `evaluateRow` returns from the `interpretation === 'report-only'` branch before R2/R13/`structurallySuspicious` ever run.
- `parseScalar('-3.0')` → `-3` (signed scalars accepted).
- `parsePrintedRange('-2.5~-1.0')` → `{low:-2.5, high:-1, lowInclusive:true, highInclusive:true}`; a value of `-3.0` yields `'below'`, `-0.5` yields `'above'`. Correct.
- `parsePrintedRange('-2.5--1.0')` → `null` (two coherent readings, so it **defers** rather than guessing). Correct and important — the chip shows "Ask your clinician to interpret" instead of inverting.
- `parsePrintedRange('>-1')` → `{low:-1, lowInclusive:false}`. Correct.
- `parsePrintedRange('−2.5~−1.0')` with U+2212 MINUS SIGN → `null`. Safe (defers), but a known gap worth a line in the measurement record.

Add these five as a test in `recognition-2026-07-28.test.ts` or `lib/reference.test.ts` so the behaviour is pinned, not merely observed.

---

## STEP 6 — Register the areal-density unit equivalence class

`data/unit-whitelist-audit.test.ts` fails any multi-unit `allowedUnits` whose members are not all inside one reviewed `EQUIVALENCE_GROUPS` entry. This is a *reviewed addition*, not a rebaseline — but it is a safety file, so call it out in your handoff.

Add, next to `bmi_notation`:

```ts
  // Areal bone mineral density notation: the same quantity written three ways, no magnitude
  // difference. Exactly parallel to bmi_notation. normalizeUnit does not fold the superscript,
  // so all three spellings must be listed.
  bmd_areal_notation: ['g/cm2', 'g/cm²', 'g/cm^2'],
```

**Verify:** `npx vitest run --pool=threads data/unit-whitelist-audit.test.ts lib/reference.test.ts`
The `never collapses two distinct shipped units onto one key` tripwire (`lib/reference.test.ts:323`) must stay green — I pre-checked: `g/cm2 → g/cm2`, `g/cm² → g/cm²`, `g/cm^2 → g/cm^2`, `g → g`, `SD → sd`, all distinct from every shipped unit under the O/0 and I/l fold.

---

## STEP 7 — Prove no collision was introduced

Add this block to `validation/camera-path/recognition-2026-07-28.test.ts`. You must produce **passing** assertions for every new alias and key, showing it resolves from no unintended specimen and to no unintended entry.

```ts
describe('collision proof for the bone densitometry curation', () => {
  // 1. NO BARE QUANTITY TOKEN MAY RESOLVE. T值/Z值 are statistical score names, not analytes;
  //    BMD/BMC/均值 are generic; T11/T12/L1/SD are site and unit labels. A bare one names nothing.
  it.each(['BMD', 'BMC', 'T值', 'Z值', '均值', 'T11', 'T12', 'L1', 'SD', '骨密度', '骨矿含量'])(
    'never resolves the bare token %s in any specimen context',
    (bare) => {
      for (const specimen of ['unknown', 'blood', 'urine', null] as const) {
        expect(findEntry(bare, specimen), `${bare} @ ${specimen}`).toBeNull();
      }
    },
  );

  // 2. EVERY new alias AND every new key routes to exactly its own entry, and to nothing from a
  //    blood or urine panel.
  it('routes every bone alias and key to its own entry only', () => {
    const bone = REFERENCE_LABS.filter((entry) => entry.key.startsWith('bone_'));
    for (const entry of bone) {
      for (const token of [entry.key, ...entry.aliases]) {
        expect(findEntry(token, 'unknown')?.key, token).toBe(entry.key);
        expect(findEntry(token, 'blood'), token).toBeNull();
        expect(findEntry(token, 'urine'), token).toBeNull();
      }
    }
  });

  // 3. The two new SPELLING aliases add exactly one reachable name each and change nothing else.
  it('adds the two respelled names without widening anything', () => {
    expect(findEntry('碳酸氢盐（HC03）')?.key).toBe('bicarbonate');
    expect(findEntry('碳酸氢盐(HC03)')?.key).toBe('bicarbonate');
    expect(findEntry('HC03')).toBeNull();          // scope stayed narrow: no bare abbreviation
    expect(findEntry('血清碳酸氢盐（HC03）测定', 'urine')).toBeNull();

    expect(findEntry('三碘甲状原氨酸(T3)')?.key).toBe('total_t3');
    expect(findEntry('三碘甲状原氨酸')).toBeNull();      // bare corrupted stem stays refused
    expect(findEntry('游离三碘甲状原氨酸')).toBeNull();  // the free-T3 corruption is NOT rescued
    expect(findEntry('血清游离三碘甲状腺原氨酸')?.key).toBe('free_t3');
  });
});
```

**Already-existing table-wide tripwires that must stay green** (they run over the whole table, including your new entries — do not modify them):

- `lib/reference.test.ts:59` — never collapses two different analytes onto one index token.
- `lib/reference.test.ts:230` — a `测定`/`检测` suffix never repoints a curated name to another analyte.
- `lib/reference.test.ts:323` — no two distinct shipped units collapse onto one comparison key.
- `data/reference-labs.test.ts:112` — every alias is unique across the whole table.
- `data/reference-labs.test.ts:420` — no entry declares the same property twice (source-text scan).
- `lib/tibetanInvariants.test.ts:294` (B12) — every EN reference name and every ZH reference name is unique, **and** unique under `normName`. Your 16 EN names and 16 ZH names must each be globally distinct; the shapes in §5.5 satisfy this (`bonemineraldensityt11`, `骨密度t11`, …).
- `lib/reference.test.ts:198` / `data/english-aliases.test.ts` — `钙(Ca)`, `镁(Mg)`, `铅(Pb)`, `镉(Cd)` stay unknown.

---

## STEP 8 — Inventory locks: exact current values, and the approval protocol

I ran `npx vitest run --pool=threads` at `32a882a`: **90 files, 1147 passed, 41 skipped, 0 failed.** Every value below is measured, not estimated. The "predicted" column is arithmetic you must **verify**, never assume.

### 8.1 Locks that WILL trip

| # | file:line | assertion | current | predicted |
|---|---|---|---|---|
| 1 | `lib/localizationBaseline.test.ts:17` | `REFERENCE_BASELINE.count` | `158` | `174` |
| 2 | `lib/localizationBaseline.test.ts:18` | `REFERENCE_BASELINE.en` hash | `72caadd…` | **read from test output** |
| 3 | `lib/localizationBaseline.test.ts:19` | `REFERENCE_BASELINE.zh` hash | `df60a2b…` | **read from test output** |
| 4 | `lib/localizationBaseline.test.ts:20` | `REFERENCE_BASELINE.bo` hash | `df60a2b…` | **must equal the new `zh` hash byte for byte** |
| 5 | `lib/localizedTextCorpus.test.ts:30` | `corpus.calls` | `585` | `617` (+16 name +16 definition) |
| 6 | `lib/localizedTextCorpus.test.ts:31` | `fallbackBo` | `584` | `616` |
| 7 | `lib/localizedTextCorpus.test.ts:69` | reference calls | `422` | `454` |
| 8 | `lib/localizedTextCorpus.test.ts:70` | `fields` | `{name:158, plain:106, definition:158}` | `{name:174, plain:106, definition:174}` — **`plain` must NOT move**: helper-built entries assign `plain: input.definition` and therefore contribute no `plain:` call site |
| 9 | `lib/localizedTextCorpus.test.ts:71-72` | `nameKeys` length and Set size | `158` | `174` (both) |
| 10 | `lib/referenceSourceLangs.test.ts:94,108,109,132,133` | index key count (five literals, incl. the test title) | `968` | `1034` = 968 + 16×(key + EN name + ZH name + 1 alias) + 2 OCR-spelling aliases |
| 11 | **`lib/tibetanImport.ts:516-517`** | `if (referenceCalls.length !== 422) throw` — **production source, not a test** | `422` | `454` |
| 12 | **`lib/tibetanImport.ts:533`** (+ comment at `:537`) | `if (names.length !== 158) throw` | `158` | `174` |
| 13 | `lib/tibetanImport.test.ts:295,322,323,324,418` | `packet.names` length / distinct zh / distinct en / parsed rows | `158` | `174` |
| 13a | `lib/tibetanImport.test.ts:458` | rebaseline checklist `referenceBaselineBo` hash | `df60a2b…` | **must equal the new `zh` hash byte for byte**; this failure is initially masked by the production guard at `lib/tibetanImport.ts:516` |
| 14 | `lib/tibetanImport.test.ts:426` | `expect(rows).toHaveLength(158 + 162)` | `158 + 162` | `174 + 162` |
| 15 | `lib/tibetanInvariants.test.ts:145` | `corpus.calls` | `585` | `617` |
| 16 | `lib/tibetanInvariants.test.ts:307,308,309` | reference names / en / zh | `158` | `174` |
| 17 | `lib/tibetanWellFormedness.test.ts:36` | `corpus.calls` | `585` | `617` |
| 18 | `lib/directBoAudit.test.ts:122` | `REFERENCE_LABS` length | `158` | `174` |
| 19 | `lib/directBoAudit.test.ts:125` | `5 + 30 + 6 + (158 * 3) + 1` | `158 * 3` | `174 * 3` — a latent lock, **not a separate initial red failure**: the earlier length assertion at `:122` aborts this same test before `:125` runs |
| 20 | `data/reference-labs.test.ts:33-95` | the sorted report-only key list | 58 keys | +16, inserted **contiguously between `'bmi'` and `'ca199'`**: `bone_bmc_l1, bone_bmc_mean, bone_bmc_t11, bone_bmc_t12, bone_bmd_l1, bone_bmd_mean, bone_bmd_t11, bone_bmd_t12, bone_t_score_l1, bone_t_score_mean, bone_t_score_t11, bone_t_score_t12, bone_z_score_l1, bone_z_score_mean, bone_z_score_t11, bone_z_score_t12` |
| 21 | `data/unit-whitelist-audit.test.ts` | `EQUIVALENCE_GROUPS` | — | add `bmd_areal_notation` (Step 6) |

### 8.2 Locks that must NOT move — if any of these goes red, STOP; it is a bug in the change

| file:line | assertion | value |
|---|---|---|
| `lib/localizedTextCorpus.test.ts:29` | `corpus.sourceFiles` | `15` |
| `lib/localizedTextCorpus.test.ts:32` | `corpus.curatedBo` | `0` — **safety invariant** |
| `lib/localizedTextCorpus.test.ts:33-34` | `corpus.excludedDirectBo` | `1`, reason `verbatim-ocr-echo` |
| `lib/localizedTextCorpus.test.ts:85-94` | production placeholder map | unchanged (8 entries) — **no template literals in your new strings** |
| `lib/tibetanImport.test.ts:302-303` | `GLOSSARY_TERM_COMPONENT_COUNTS` sum | `35` |
| `lib/tibetanImport.test.ts:304,419` | `packet.terms` | `34` |
| `lib/tibetanImport.test.ts:317,420` | `packet.floor` | `162` — you add no UI strings |
| `lib/tibetanImport.test.ts:330` | names with `unit === 'as reported'` | `16` — this is why §5.6 rejects the wildcard |
| `data/reference-labs.test.ts:137-140` | `unitOptional` inventory | exactly `['urine_ph','urine_specific_gravity']` |
| `data/reference-labs.test.ts:326` | pre-existing urine report-only count | `16` (yours are `'measurement'`) |
| `data/reference-labs.test.ts:8-15` | `SOURCED_REPORT_ONLY_KEYS` | unchanged — your `source` is `''` |
| `validation/goldLabelGates.test.ts:22` | `chipWrong` | `0` on every corpus |
| `validation/camera-path/cameraPath.test.ts` | 26/26 distinct camera names resolve | unchanged |

### 8.3 The protocol

1. **Commit 1** — the change, with **every** file in §8.1 left untouched.
2. Run `npx vitest run --pool=threads` and confirm the red set is **exactly** §8.1 and nothing more.
3. Produce the before/after table with the **measured** values (especially the three hashes and the index-key count) and hand it to the human. **Do not edit the locks yet.**
4. **Commit 2**, only after approval — the rebaseline, with each lock's explanatory comment updated to say *what* was added and *why*, following the existing comment style (see `lib/localizedTextCorpus.test.ts:20-28` for the model). State in the `localizationBaseline` comment that `zh` and `bo` remain byte-identical and why that matters.

---

## STEP 9 — Verification and acceptance

```bash
npx tsc --noEmit
npx vitest run --pool=threads          # forks pool fails under load — threads is required
node --import tsx validation/real-corpus/run.ts
```

**Acceptance criteria — all must hold:**

1. `npx tsc --noEmit` clean.
2. `npx vitest run --pool=threads` green, with `90 → 91` test files (your new file) and `1147 + N` passing.
3. `node --import tsx validation/real-corpus/run.ts` output is **byte-identical** to the §3 baseline, including `✓ US safety gate: 0 confidently-wrong rows`. None of the 22 target names appears in any committed corpus, so any movement is an unintended widening — investigate, do not accept.
4. **Recognition, name-level (this is what you can verify):** of the 22 frozen names, **18 newly resolve** (16 bone + `HC03` + T3), and **4 remain deliberately unresolved** with reasons recorded (`血清胱抑素`, `检测结果:DOB`, `基础代谢率`, `其他`).
5. **Recognition, row-level (report this as a prediction for the human who holds the report):** 107/129 = 82.9% → **125/129 = 96.9%**. Each of the 18 names corresponds to exactly one row. You cannot re-measure this without the report; say so rather than asserting it.
6. `validation/camera-path/cameraPath.test.ts` still resolves **26/26** distinct camera names on the CBC page.
7. Every §7 collision assertion passes.

### Step 9b — record the measurement

Add `validation/camera-path/full-report-2026-07-28.md`, following the structure of `full-report-2026-07-26.md`. State: no images or patient data committed; recognition before (107/129, 82.9%) and after (predicted 125/129, 96.9%); what was curated and why bone density is report-only and bandless; the four declined names with their reasons; and the known limitation that `parsePrintedRange` returns `null` for a range using U+2212 MINUS SIGN (safe — it defers).

---

## 10. Explicit non-goals, with reasons

- **`检测结果:DOB`** — the ¹³C urea breath test. It was **removed from the table on 2026-07-28** because it was falsely `specimen: 'blood'` (it is a breath assay) and its `DOB` abbreviation collides with "date of birth". Re-curating it needs a **`breath` specimen frame** first, which is a `lib/types.ts` change with its own blast radius. Out of scope. (Traces remain in `validation/real-corpus/gold-labels.ts:250` and `sample.ts:277`; leave them.)
- **`基础代谢率`** (basal metabolic rate) — out of scope. No frame decided; it is a derived index whose formula the row name does not identify, the same problem that made `anion_gap` report-only-with-a-citation.
- **`其他`** — a literal "other" row. Not an analyte. Curating it would be naming a table cell.
- **Any recognition work beyond GOAL A and GOAL B.** In particular, do not attempt the seven gold-high-stakes ZH names the corpus run lists as unrecognised (`钙(Ca)`, `镁(Mg)`, `铅(Pb)`, `镉(Cd)`, `a-淀粉酶`, `髓系原始细胞群`, HIV Ag/Ab) — every one of them is a **deliberate refusal** locked by `data/english-aliases.test.ts`.

---

## 11. Open questions — my recommendation, and the human's right to overturn it

Each has a default so you are never blocked. Flag them in your handoff; do not silently choose differently.

**Q1 — Explicit alias vs. extending `foldOcrConfusables` to names.**
*Recommend:* explicit alias. The unit fold is safe because the unit vocabulary is closed and its collisions are asserted empty over the whole inventory; names are an open, growing set, and folding would change behaviour for inputs *not in the index*, converting a disclosed `R1` abstention into a possible silent misroute — the dominant failure class on this table. *Overturnable by:* someone willing to own a name-level collision tripwire over all 968+ tokens **and** a policy that every future alias is reviewed under folding.
*Related, deferred:* if the human wants a bounded generalisation without an engine change, the enumerable set of digit-zero twins already in the table is `CO2/C02`, `TCO2/TC02`, `HCO3-/HC03-`, `SpO2/Sp02`, `SaO2/Sa02`, `pO2/p02`, `pCO2/pC02`. Adding those as explicit aliases is reviewable and additive. I did **not** include it: only `HCO3` has field evidence.

**Q2 — Should the bare *correct* spelling `三碘甲状腺原氨酸` also resolve?**
*Recommend:* no, not in this change. It does not resolve today while the variant `三碘甲腺原氨酸` does — a pre-existing asymmetry with a real total-vs-free ambiguity underneath it. Separate before/after change.

**Q3 — `血清胱抑素`.**
*Recommend:* leave unresolved; record the decision in `DECLINED_NAMES_2026_07_28` and pin it. The page did not print the subtype, and `lib/reference.test.ts:93` already refuses a subtype-less cystatin deliberately. *If overturned:* the narrowest defensible fix is the literal alias `'血清胱抑素'` on `cystatin_c` (which leaves bare `胱抑素` refused, because `findExactMatch` runs before the prefix ladder) — **not** a bare `胱抑素` alias, which would require deleting an existing safety test.

**Q4 — Reuse `'measurement'` vs. a new `'densitometry'` / `'imaging'` frame.**
*Recommend:* reuse. `'measurement'` already means "not an assay of any specimen; reachable only when no specimen is printed", which is exactly right for DXA. A new frame touches `lib/types.ts`, `printedSpecimenFor`, the `guard.ts` measurement branch and the `reference-labs.test.ts` key/specimen assertion for zero safety gain.

**Q5 — 16 entries vs. 4 site-agnostic entries. (A genuine design call.)**
*Recommend:* 16. Both are equally safe against bare-token collisions, because the aliases are enumerated either way. 16 wins on fidelity: `均值` is a derived aggregate and must not render the same name as a single-site measurement. The cost is real — 16 entries move nine lock files and add 16 rows to the Tibetan reviewer packet. *If the human prefers 4*, the definitions must drop the site clause entirely and say only what the quantity is; the aliases stay identical.

**Q6 — Unit for T值/Z值: `'SD'` vs `'as reported'`.**
*Recommend:* `'SD'`. A T-score is by definition expressed in standard deviations; its unit is absent, not variable, and `'as reported'` is documented as the wildcard for genuinely varying units. `'SD'` keeps the measurement unit-contradiction guard live and leaves the locked `'as reported'` count at 16. *If overturned to `'as reported'`:* that lock moves 16 → 24, and the guard is switched off for those rows — say so explicitly in the rebaseline comment.

**Q7 — `highStakes` on the bone entries.**
*Recommend:* `false` on all 16. On a report-only entry this is the **only** thing routing a row to confirmation, so it is a deliberate choice, not a default. A bone density value demands no prompt action the way potassium or troponin does; a densitometry page prints 16 of these at once, so mandatory-confirm would flood one screen; and the reading risk that actually matters here (a dropped minus sign on a T值) is already covered by R5 for low-confidence rows. *The counter-argument, honestly stated:* a sign misread on a T值 flips the chip direction, and the T-score is the quantity a clinician acts on. If a field measurement ever shows sign misreads, revisit `bone_t_score_*` and `bone_z_score_*` specifically — not the BMD/BMC rows.

**Q8 — Chinese wording of the 16 definitions.**
*Recommend:* have a native reader check them before the rebaseline commit. They are drafted direction-neutral and role-free, but this table has a history of definitions being corrected for claims they could not support.

---

## Summary of the plan's key decisions and open questions

**Decisions I am confident in (verified against the code, not assumed):**

1. **The three GOAL B diagnoses are exact, and one of them is a finding, not a fix.** `血清碳酸氢盐（HC03）测定` fails purely on digit-zero-vs-letter-O; `血清三碘甲状原氨酸(T3)` on the dropped `腺`; and `血清胱抑素` is *already deliberately refused* by `lib/reference.test.ts:93-96` because cystatins A/B/C are distinct proteins and the page printed no subtype. I recommend **not** adding that alias, and instead recording the refusal with its reason so it stops looking like a gap.
2. **Explicit aliases, not name folding.** The unit fold in `foldOcrConfusables` is safe because the unit vocabulary is closed and exhaustively collision-checked; names are open and growing, and folding would change behaviour for inputs *not in the index* — turning a disclosed `R1` abstention into a possible silent misroute, the dominant failure class here.
3. **Bone density reuses the existing `'measurement'` specimen frame**, `interpretation: 'report-only'`, no band, `source: ''` (the documented convention for a bandless entry), `highStakes: false`.
4. **A bare `T值` cannot become a confident match** by three independent structural means: every alias is the full printed cell (`'T11 T值'`), every key carries a `bone_` prefix (because the key is indexed too — the `pct` defect), and the `'measurement'` frame makes the entries unreachable whenever a specimen is printed.
5. **`unit: 'SD'` for the scores, not `'as reported'`** — the wildcard is for units that genuinely vary, and using it would switch off the measurement unit guard and move a lock for no reason.
6. **I enumerated every lock that trips, with measured current values** (158/585/584/968/422 and the three hashes), separated them from the locks that must *not* move (`curatedBo === 0`, `sourceFiles 15`, `plain 106`, `'as reported' 16`, `floor 162`, `terms 34`, `unitOptional` inventory), and specified a two-commit STOP-AND-ASK protocol. Two of the trip points are in **production source** (`lib/tibetanImport.ts:516,533`) and throw, not fail.
7. **The corpus run must be byte-identical after the change** — none of the 22 names appears in MedRepBench, MIMIC or the Lhasa field sample, so any movement is an unintended widening. I captured the full baseline output for the diff.
8. **Negative T-scores are already safe** and I traced why: report-only rows return from `evaluateRow` before `structurallySuspicious`; `parsePrintedRange('-2.5--1.0')` correctly returns `null` rather than inverting; `'-2.5~-1.0'` parses correctly. Pin all five cases as tests.

**Open questions handed to the human, each with a default:** name-folding vs alias (Q1); whether the bare correct T3 spelling should also resolve (Q2); whether to overturn the cystatin refusal, and if so via the narrow `血清胱抑素` literal alias rather than a bare one (Q3); reuse `'measurement'` vs a new frame (Q4); **16 entries vs 4** — the genuine design call, where I chose fidelity for the `均值` aggregate over lock churn (Q5); `'SD'` vs `'as reported'` (Q6); **`highStakes` on the T/Z score rows**, where the honest counter-argument is that a sign misread flips the chip on the quantity clinicians act on (Q7); and a native-reader pass on the Chinese definitions (Q8).

**Expected outcome:** 18 of the 22 frozen names newly resolve; 4 stay unresolved *with recorded reasons*; row-level recognition on that report is predicted to move 107/129 (82.9%) → 125/129 (96.9%), which only the holder of the report can confirm.

### Critical files for implementation
- `/Users/likerun/Desktop/health-translator/data/reference-labs.ts`
- `/Users/likerun/Desktop/health-translator/lib/reference.ts`
- `/Users/likerun/Desktop/health-translator/lib/tibetanImport.ts`
- `/Users/likerun/Desktop/health-translator/lib/localizationBaseline.test.ts`
- `/Users/likerun/Desktop/health-translator/data/reference-labs.test.ts`
