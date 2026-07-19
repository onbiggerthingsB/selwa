# Urinalysis coverage — plan

Status: **NOT STARTED.** Written for implementation by Codex.

Motivating artefact: a real "Urine Complete Analysis" report (Aster Medical Centre, 19 rows) run
through the shipped app. Most rows rendered *"This test is not in our reference set."* Feeding the
report's rows verbatim through `groundExtraction` with `specimen: 'urine'` produced this — read it
before designing anything, because the rows fail for **five different reasons**, not one:

```
Color              "Pale Yellow" → NONE                     unmatched        abstain  R1
Appearance         "Clear"       → NONE                     unmatched        abstain  R1
pH                 "5"           → urine_ph                 specimen-scoped  classify  ✅
Specific Gravity   "1.005"       → urine_specific_gravity   specimen-scoped  abstain  R2 unit
Glucose            "Absent"      → urine_glucose            specimen-scoped  abstain  R18
Protein            "Absent"      → urine_protein            specimen-scoped  abstain  R18
Ketones            "Absent"      → urine_ketones            specimen-scoped  abstain  R18
Bilirubin          "Absent"      → NONE                     unmatched        abstain  R1
Urobilinogen       "Absent"      → NONE                     unmatched        abstain  R1
Nitrite            "Negative"    → NONE                     unmatched        abstain  R1
RBC                "0-2"         → rbc_count  ⚠️ BLOOD      exact            abstain  R2 unit
Pus Cells          "0-1"         → NONE                     unmatched        abstain  R1
Epithelial Cells   "0 - 1"       → NONE                     unmatched        abstain  R1
Casts / Crystals / Bacteria      → NONE                     unmatched        abstain  R1
```

Only **one row of nineteen** works.

---

## Defect 1 (P0, SAFETY) — blood entries capture urine rows regardless of specimen

Audited every urinalysis row name against the unscoped index:

```
⚠ "RBC"                → rbc_count  (10^12/L)  — a BLOOD entry
⚠ "Red Blood Cells"    → rbc_count  (10^12/L)  — a BLOOD entry
⚠ "WBC"                → wbc_count  (10^9/L)   — a BLOOD entry
⚠ "White Blood Cells"  → wbc_count  (10^9/L)   — a BLOOD entry
```

A urine microscopic RBC of `0-2 /hpf` resolves to the **blood** red-cell count (reference
4.3-5.8 ×10¹²/L). In the user's screenshot the row is even relabelled **"Red blood cell count /
红细胞计数"** — a blood test name printed over a urine microscopy result.

Today it abstains only because `hpf` ≠ `10^12/L` trips R2. **That is incidental protection, not
designed protection.** Any of these removes it: a report that omits the unit, a future
`unitOptional` extension, or a unit we later accept.

`data/english-aliases.test.ts` currently *locks* this behaviour:

```ts
expect(findEntry('Red Blood Cells')?.key).toBe('rbc_count'); // MIMIC: Blood only
```

The comment is the bug. "Blood only" was true of the MIMIC corpus; this real report falsifies it.
The lock encodes a corpus artefact as a safety fact.

### Fix

Give every entry an explicit specimen and refuse cross-specimen matches when the row's specimen is
known.

`lib/types.ts` — add a **required** field to `ReferenceEntry`:

```ts
specimen: 'blood' | 'urine';
```

Required, not optional: a new entry must state its specimen rather than inherit a silent default.
Backfill with a codemod — `urine_*` keys → `'urine'`, every other entry → `'blood'` — and add a test
asserting every entry declares one.

`lib/reference.ts` — in `findEntry(name, specimen)`, after a candidate is found by either index:

```
if (specimen is 'urine' or 'blood') and candidate.specimen !== specimen  →  return null
if specimen is 'unknown'/null                                            →  no filtering (legacy)
```

`specimen: 'unknown'` **must** stay byte-identical to today's behaviour. That is what keeps this
change additive and keeps the four existing ambiguity locks passing.

Then **update the two `rbc_count` / `wbc_count` assertions** in `data/english-aliases.test.ts` — they
are wrong as written. Replace with: unscoped still resolves (legacy), `specimen: 'blood'` resolves,
and `specimen: 'urine'` does **not**.

---

## Defect 2 (P0) — R18 now blocks every qualitative urinalysis row

`Glucose`, `Protein` and `Ketones` all resolve correctly and are then **abstained by R18**, the rule
added hours earlier in `2026-07-19-specimen-context-capture.md`.

Cause: R18 asks "does a printed range corroborate this scoped match?" and treats *no numeric range*
as *no corroboration*. On a dipstick the printed reference is the word **`Absent`**, so
`parsePrintedRange` returns null and R18 fires.

That widening was correct for the case it was written for (a mislabelled blood gas with no printed
range) and is wrong here: `Absent` **is** corroborating evidence, it is simply not numeric.

### Fix

Make corroboration multi-source. A scoped match is corroborated when **any** of these hold:

1. a numeric printed range that does not materially disagree with our band (today's rule); or
2. the printed reference is a recognised **qualitative token** (`Absent`, `Negative`, `Not
   Detected`, `Nil`, `-`, `阴性`, `未检出`) and the entry is a qualitative entry; or
3. the row's unit matches one of the entry's `allowedUnits` (e.g. `hpf` on a microscopy entry).

R18 fires only when **none** apply. Keep the existing behaviour for the blood-gas case: numeric
printed range that *disagrees* → still R18, and *no evidence of any kind* → still R18.

---

## Defect 3 — dimensionless rows abstain on unit

`Specific Gravity 1.005` resolves, then R2 abstains: *"The unit on your report differs from our
reference (we expect SG)."* The report leaves the unit cell blank because specific gravity, like pH,
is **dimensionless**.

### Fix

Extend the existing `unitOptional` exception to `urine_specific_gravity`, and update the lock in
`data/reference-labs.test.ts` that currently pins it to exactly `['urine_ph']`.

Keep that test — it is doing its job. Widen it deliberately to the curated dimensionless set and
state the criterion in a comment: **`unitOptional` is only for quantities that have no unit at all,
never for a quantity whose unit was merely omitted.**

---

## Defect 4 — the pipeline cannot read the two dominant urinalysis value shapes

Verified:

```
parseScalar("0-2")    → null      parseValue("0-2")    → null
parseScalar("0 - 1")  → null      parseValue("0 - 1")  → null
parseScalar("Absent") → null      parseValue("Absent") → null
```

So even once an entry exists, these rows cannot be interpreted. Two shapes:

- **Qualitative tokens** — `Absent`, `Present`, `Negative`, `Positive`, `Trace`, `+`, `++`, `+++`, `-`
- **Range-valued results** — `0-2`, `0 - 1` (the *result itself* is a range, matching a range reference)

### Fix

Add **separate** parsers. Do **not** loosen `parseScalar`: its rejection of `"3-15"` exists because
`Number.parseFloat("3-15")` returns `3` and silently turned a non-scalar cell into a confident
comparison. That guard stays exactly as is.

- `parseQualitative(raw): 'negative' | 'positive' | 'trace' | null` over a curated EN + ZH token list.
- `parseValueRange(raw): { low: number; high: number } | null`, whole-field anchored, mirroring the
  strictness already in `parsePrintedRange`.

Comparison, and it must stay **B1-faithful** — reproduce the report's own comparison, never invent one:

- qualitative: result token vs printed reference token → equal ⇒ *"Within your report's range"*;
  differing ⇒ *"Outside your report's range"*. If the report prints no reference, defer.
- range vs range: result range inside reference range ⇒ within; result max above reference max ⇒
  above; result min below reference min ⇒ below; partial overlap ⇒ **defer**, do not guess.

---

## Defect 5 — the missing entries, and a new entry class they need

Missing outright: `Nitrite`, urine `Bilirubin`, `Urobilinogen`, `Pus Cells` (urine WBC), `Epithelial
Cells`, `Casts`, `Crystals`, `Bacteria`, `Yeast Cells`, `Mucus Thread`, `Amorphous Deposits`, plus
`Color` and `Appearance`.

**These do not need curated reference bands, and inventing bands for them would be the wrong move.**
Microscopy references are method- and lab-specific (this report prints RBC `0-2/hpf` and pus cells
`0-5/hpf`; another lab prints different). Our value here is *translation, naming and definition* —
the report already supplies the comparison.

### Fix — a "report-referenced" entry class

`lib/types.ts` — add to `ReferenceEntry`:

```ts
/**
 * 'ours'        — we hold a curated band and may classify against it (all existing entries).
 * 'report-only' — we translate/define the test but NEVER classify it. Position comes solely
 *                 from the range printed on the report; `typicalRange` is never shown.
 */
interpretation: 'ours' | 'report-only';
```

For `report-only` entries:

- `refLow`/`refHigh`/`criticalLow`/`criticalHigh`/`absoluteLow`/`absoluteHigh` are all `null`;
- the guard never classifies — treat as an explicit non-classifying path, **not** as an abstain, so
  it must **not** emit R1 (*"not in our reference set"* would be a lie: it IS in our set);
- `summary` shows `nameEn`/`nameZh` + `definitionEn`/`definitionZh`, and the chip from the report's
  own reference; `typicalRange` and `source` stay empty.

This requires relaxing the `data/reference-labs.test.ts` invariant *"at least one bound exists"* —
scope that assertion to `interpretation === 'ours'` and add the mirror assertion that `report-only`
entries have **all** bounds null.

Add the ~13 urinalysis entries as `report-only`, with `specimen: 'urine'`, bilingual names, and
direction-neutral `definitionEn`/`definitionZh` (they render on the card, so
`validation/b1VerdictLeakage.test.ts` polices them — see `CARD_BANNED`).

---

## Suggested order

1. **Defect 1** — safety, and independent of the rest.
2. **Defect 2** — a live regression from today; unblocks three rows immediately.
3. **Defect 3** — one-line exception plus a lock update.
4. **Defect 5** — the entry class, then the entries.
5. **Defect 4** — value shapes, which the new entries need to be useful.

---

## Out of scope

- **Do not invent numeric reference bands for microscopy or dipstick rows.** That is what
  `report-only` exists to avoid. A fabricated band is worse than no band.
- **Do not enable blood `Glucose` or `Urea Nitrogen`** (see `2026-07-19-specimen-context-capture.md`).
- **Do not loosen `parseScalar`.**
- **Do not weaken the four specimen-ambiguity locks.** The `rbc_count`/`wbc_count` assertions in the
  *other* describe block are a different matter — those are wrong and must be corrected per Defect 1.
- **Do not add a `saliva`/`csf`/`stool` specimen.** Two values cover the real cases; anything else
  must land on `unknown` and abstain.

---

## Acceptance criteria

Safety (Defect 1):

- [ ] `findEntry('RBC', 'urine')` does **not** return `rbc_count`; same for `WBC`/`wbc_count`.
- [ ] `findEntry('RBC', 'blood')?.key === 'rbc_count'`; `findEntry('RBC')` (no specimen) unchanged.
- [ ] Every entry declares `specimen`; a test enforces it.
- [ ] A urine row named `RBC` with **no unit** does not classify against a blood band. (Today only
      the unit mismatch prevents this — prove it is now prevented by design.)

The real report (all 19 rows, `specimen: 'urine'`):

- [ ] `pH 5` (ref `5 - 7.5`) classifies — unchanged.
- [ ] `Specific Gravity 1.005` (ref `1.005 - 1.025`) no longer abstains on unit.
- [ ] `Glucose` / `Protein` / `Ketones` = `Absent` (ref `Absent`) no longer abstain under R18.
- [ ] `Nitrite Negative`, `Bilirubin Absent`, `Urobilinogen Absent` resolve as `report-only`
      and do **not** say *"not in our reference set"*.
- [ ] `RBC 0-2 hpf` (ref `0-2`) and `Pus Cells 0-1 hpf` (ref `0 - 5`) resolve as `report-only`
      urine microscopy, reproduce the report's comparison, and never mention a blood range.
- [ ] Report a before/after count of rows showing *"not in our reference set"*: **18/19 → target ≤ 4**
      (`Color`, `Appearance`, `Mucus Thread`, `Amorphous Deposits` may legitimately remain).

Regression:

- [ ] `validation/b1VerdictLeakage.test.ts` passes, including all new definitions.
- [ ] `validation/silentAssertion.test.ts` passes — every abstaining row still discloses.
- [ ] The mislabelled-blood-gas cases still abstain: `pH 7.1` with printed `7.35-7.45` **and** with
      no printed range at all (this is the hole closed in commit `b01e79a` — do not reopen it while
      widening R18 for Defect 2).
- [ ] `npx tsc --noEmit` clean; `npx vitest run --pool=threads` green (≥489 tests, none deleted).
- [ ] `npx tsx validation/real-corpus/run.ts` — report R6-gold and `chipWrong` before/after.
      **`chipWrong` must remain 0 on both corpora.**

---

## Risk

The R18 widening in Defect 2 and the R18 tightening from this morning pull in opposite directions,
on the same rule, for good reasons in both cases. Get the distinction explicit in code and comment:

> **absence of a numeric range is not the same as absence of evidence.** A dipstick's printed
> `Absent` is evidence. A blood gas with an empty reference column is not.

If that distinction is not encoded precisely, one of two failures returns: either qualitative rows
break again, or a mislabelled blood gas classifies as normal.
