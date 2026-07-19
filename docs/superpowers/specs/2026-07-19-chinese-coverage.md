# Chinese coverage — plan

Status: **NOT STARTED.** Written for implementation by Codex.

The advisor confirmed the lab-report **source language is Chinese**. That inverts the coverage
priority: recent curation was tuned for the US corpus — `validation/real-corpus/run.ts` still labels
MIMIC the **BEACHHEAD** — but MedRepBench is now the target corpus, and it is the weaker of the two.

Verified, from `npx tsx validation/real-corpus/run.ts`:

| Metric | MedRepBench (Chinese — NOW PRIMARY) | MIMIC (US) |
| --- | --- | --- |
| Chip coverage | 72.0% (103 reproduced / 40 defer of 143 rows) | — |
| R6-gold (high-stakes rows reaching the confirm gate) | **54.1% (20/37)** | 42.0% (89/212) |

Nearly half the high-stakes rows on a Chinese report reach **no confirm gate at all**.

The corpus contains 80 unrecognised distinct names; 11 are gold-labelled high-stakes. Unit and panel
are printed below because they are what settles each classification — not the name alone:

```
淋巴细胞数                 n=2  units=[10^9/L]  panel=[CBC | CBC differential]
中性细胞值                 n=1  units=[10^9/L]  panel=[CBC differential]
红蛋白                    n=1  units=[g/L]     panel=[CBC]
PT%                      n=1  units=[%]       panel=[coagulation]
a-淀粉酶                  n=1  units=[]        panel=[amylase (single, no unit)]
人类免疫缺陷病毒抗体/抗原(P24)  n=1  units=[S/CO]   panel=[infectious serology]
钙(Ca)                   n=1  units=[μg/ml]   panel=[heavy metals / trace elements]
镁(Mg)                   n=1  units=[ug/ml]   panel=[heavy metals / trace elements]
铅(Pb)                   n=1  units=[μg/L]    panel=[heavy metals / trace elements]
镉(Cd)                   n=1  units=[μg/L]    panel=[heavy metals / trace elements]
髓系原始细胞群              n=1  units=[%]       panel=[flow cytometry (research %)]
```

**Only three of these eleven names get an alias in this pass.** The other eight are the point of the
spec as much as the three are.

---

## 1. The four buckets

### A. Safe aliases — do these three

Unit **and** panel both corroborate the target entry, and the target entry already exists:

| corpus name | → entry | why it is safe |
| --- | --- | --- |
| `淋巴细胞数` | `lymphocyte_abs` | `10^9/L` is the entry's canonical unit; CBC differential is the right panel. Entry already carries `淋巴细胞计数`, `淋巴细胞绝对值`, `淋巴细胞绝对数` — this is the fourth vendor spelling of the same quantity. |
| `中性细胞值` | `neutrophil_abs` | Same unit, same panel. Entry already carries `中性粒细胞数`; `中性细胞值` drops 粒 and writes 值 for 数 — a distinct printed variant, not a duplicate. |
| `红蛋白` | `hemoglobin` | `g/L` matches the entry's canonical unit; CBC panel. An OCR truncation of `血红蛋白`, which is already an alias. `validation/real-corpus/gold-labels.ts:164` independently labels this row `Hemoglobin`. |

`红蛋白` is one character away from `血红蛋白` (hemoglobin) **and** from `肌红蛋白` (myoglobin).
It is safe only because `lib/reference.ts` matches on exact normalised strings, never substrings.
That is a precondition of this change, not a coincidence — see §5.

### B. MUST STAY unrecognised — the panel is decisive

`钙(Ca)` and `镁(Mg)` appear under a panel literally labelled **"heavy metals / trace elements"**, in
**μg/ml**. Serum calcium and serum magnesium are both reported in mmol/L. These are whole-blood
trace-element measurements, not serum minerals. Aliasing them to `calcium_total` / `magnesium` would
ground a trace-element value against a serum band — a confidently wrong reading, which is the single
failure mode this product exists to avoid. `铅(Pb)` and `镉(Cd)` have no entries and correctly stay
unrecognised.

This repo has shipped this exact class of bug twice — urine `RBC` → blood `rbc_count`
(`2026-07-19-urinalysis-coverage.md`, Defect 1), and a proposed `a-淀粉酶` → serum amylase that is
actually a urine assay. Twice is a pattern, so these four names must be **locked by tests**, in the
style of the `describe('US English aliases — specimen-ambiguous names must STAY unknown')` block at
`data/english-aliases.test.ts:44`.

### C. Sensitive — deliberately not interpreted

`人类免疫缺陷病毒抗体/抗原(P24)` — HIV Ag/Ab, S/CO, infectious serology. Surfacing a position on an
HIV result is a privacy and product harm, not a translation win. Stays unrecognised, and gets a lock
of its own so a future bulk-alias pass cannot quietly pick it up.

### D. Needs curation, not an alias

| name | why an alias is the wrong instrument |
| --- | --- |
| `PT%` | Prothrombin **activity percentage** — a third representation of prothrombin alongside the existing `prothrombin_time` (seconds) and `inr` (ratio). Different quantity, different units. It needs its own curated entry with a sourced band. Aliasing it onto either existing entry would compare a percentage against a seconds or ratio band. **Scope it; do not band it in this pass.** |
| `a-淀粉酶` | No unit, single-item panel. An earlier adversarial review found this string is the canonical name of a **urine** amylase assay in Chinese lab catalogs. With no unit and no panel context there is nothing to disambiguate on. Stays unrecognised; revisit only if specimen context becomes available for this row. |
| `髓系原始细胞群` | Myeloid blast population, %, research flow cytometry. Qualitative/research; out of scope for interpretation. Stays unrecognised. |

---

## 2. The work

1. Add the three bucket-A aliases to `data/reference-labs.ts`.
2. Add a `describe` block to `data/english-aliases.test.ts` (or a Chinese sibling) locking bucket B
   and bucket C to `null`: `findEntry('钙(Ca)')`, `findEntry('镁(Mg)')`, `findEntry('铅(Pb)')`,
   `findEntry('镉(Cd)')`, `findEntry('人类免疫缺陷病毒抗体/抗原(P24)')` — each with the panel/unit
   reasoning in the test name, so the next reader learns *why* and not just *what*.
3. Re-run the harness and report the numbers per §3.

That is the whole change. Three aliases and five locks. If the diff grows past that, something has
drifted out of scope.

---

## 3. Pre-registered prediction — state it before, verify it after

Bucket A covers **4 corpus rows** (`淋巴细胞数` ×2, `中性细胞值` ×1, `红蛋白` ×1). If all four become
recognised **and** reach the confirm gate:

> **PREDICTION: R6-gold on MedRepBench moves 20/37 (54.1%) → 24/37 (64.9%).**

This is a hypothesis to be tested, not a target to be reached. The implementer **must report the
actual number**. If it lands materially below 24/37, something did not wire through — that is a
finding to investigate and write up, not a rounding error.

House precedent for why this discipline exists: R6 coverage read **80.0% (56/70)** self-graded and
**27.4% (58/212)** once independently graded against `gold-labels.ts`. A number stated in advance is
how that gets caught early.

### 3.1 One mechanism that could make it miss — verified at write time, check it first

`lymphocyte_abs` in `data/reference-labs.ts` carries `highStakes: false`. The gold label at
`validation/real-corpus/gold-labels.ts:99` carries `highStakes: true`. The R6-gold **denominator**
comes from the gold label; the **numerator** is `row.needsConfirm`, and `lib/guard.ts:345` sets
`needsConfirm` from `entry.highStakes || classification === 'critical'`.

So `淋巴细胞数` (×2 rows) may become recognised and still not reach the confirm gate, landing the
result at **22/37** rather than 24/37 through a mechanism that has nothing to do with the aliases.

Check this before running, and report which of the two it is. **Do not flip
`lymphocyte_abs.highStakes` to `true` in order to make the number hit.** Whether absolute
lymphocyte count is high-stakes is a clinical curation judgement needing a source, and changing a
safety flag to satisfy a pre-registered prediction is precisely the failure the prediction exists to
detect. If the flag looks wrong, say so and scope it alongside `PT%`.

---

## 4. Files to touch

| file | change |
| --- | --- |
| `data/reference-labs.ts` | 3 aliases: `淋巴细胞数` → `lymphocyte_abs`, `中性细胞值` → `neutrophil_abs`, `红蛋白` → `hemoglobin` |
| `data/english-aliases.test.ts` | new locks for bucket B (4 names) and bucket C (1 name) |

No `lib/` changes. No guard changes. No new entries.

---

## 5. The normalisation tripwire

`normName` in `lib/reference.ts` strips parentheses. `钙(Ca)` normalises to `钙ca`, which matches
nothing — verified:

```
钙       → calcium_total     钙(Ca)  → NULL
Ca      → calcium_total      镁(Mg)  → NULL
镁       → magnesium          铅(Pb)  → NULL / 镉(Cd) → NULL
```

Both `钙` and `Ca` are **already** aliases of `calcium_total`; `镁` is already an alias of
`magnesium`. The trace-element rows are therefore one normalisation rule away from matching. Any
future step that strips a parenthetical suffix — a tempting generic fix, since all four bucket-B
names use the `中文(元素符号)` form — would silently turn a whole-blood lead-panel calcium into serum
calcium. The bucket-B locks in §2 are what stands between that change and a shipped defect.

Two matching properties this pass depends on and must not alter:

- **Exact normalised match only.** No substring, prefix, or fuzzy matching. `红蛋白` is only safe
  under exact matching (it is a substring of `血红蛋白`, `糖化血红蛋白`, `肌红蛋白`).
- **Alias uniqueness.** `data/reference-labs.test.ts:39` asserts every alias is unique across the
  table. None of the three new aliases may collide; if that test fails, the alias is wrong, not the test.

---

## 6. Explicitly OUT of scope

- **Do not alias `钙(Ca)` / `镁(Mg)` / `铅(Pb)` / `镉(Cd)`** — bucket B. Add the locks instead.
- **Do not alias the HIV serology row** — bucket C.
- **Do not alias `a-淀粉酶` or `髓系原始细胞群`** — bucket D.
- **Do not invent a band for `PT%`.** Scope it; do not guess it. A fabricated band is worse than no
  entry.
- **Do not add any new reference entry** in this pass. ~111 entries in, ~111 entries out.
- **Do not touch the Tibetan/i18n layer, the rate limiter, or `lib/guard.ts`.** The 16 numbered
  guard rules (R1–R9, R11–R13, R15–R18) and ~30 flag IDs are unchanged by this work.
- **Do not weaken any existing "must stay unknown" lock**, in either the English or the new block.
- **Do not relax `normName`** to strip parenthetical suffixes (see §5).

---

## 7. Acceptance criteria

New recognition:

- [ ] `findEntry('淋巴细胞数')?.key === 'lymphocyte_abs'`
- [ ] `findEntry('中性细胞值')?.key === 'neutrophil_abs'`
- [ ] `findEntry('红蛋白')?.key === 'hemoglobin'`

Locks (each must be a test with the panel/unit reasoning in its name):

- [ ] `findEntry('钙(Ca)')` → `null` — trace-element panel, μg/ml, not serum calcium
- [ ] `findEntry('镁(Mg)')` → `null` — trace-element panel, ug/ml, not serum magnesium
- [ ] `findEntry('铅(Pb)')` → `null` and `findEntry('镉(Cd)')` → `null` — no entries exist
- [ ] `findEntry('人类免疫缺陷病毒抗体/抗原(P24)')` → `null` — sensitive, deliberately uninterpreted
- [ ] `findEntry('a-淀粉酶')` → `null` and `findEntry('髓系原始细胞群')` → `null` remain true
- [ ] The existing specimen-ambiguity locks in `data/english-aliases.test.ts` pass **unmodified**

Regression:

- [ ] `npx tsc --noEmit` clean.
- [ ] `npx vitest run --pool=threads` green — ≥631 tests, none deleted or weakened to pass.
- [ ] `validation/b1VerdictLeakage.test.ts`, `validation/chipFidelity.test.ts` and
      `validation/silentAssertion.test.ts` all pass.

Measurement — report all of these in the PR description:

- [ ] `npx tsx validation/real-corpus/run.ts`, before and after, both corpora.
- [ ] **R6-gold on MedRepBench: predicted 20/37 → 24/37. Report the actual.** If it is not 24/37,
      state which rows fell short and why (start with §3.1).
- [ ] Chip coverage on MedRepBench, before and after (baseline 72.0%).
- [ ] **`chipWrong` must remain 0 on BOTH corpora.** This is a hard gate, not a metric.
- [ ] The three aliased names must no longer appear in `goldHighStakesUnrecognized`.

---

## 8. Risk

The risk here is not that the three aliases are wrong. It is that a coverage number applies pressure
in exactly one direction — up — and every remaining item on the unrecognised list looks like it would
help it. Four trace-element rows, an HIV serology, a urine assay and a research flow-cytometry
percentage would together lift the visible denominator, and all seven would be wrong to take.

The prediction in §3 is stated so that a shortfall reads as *a thing to investigate*, rather than as
pressure to widen the alias list until the number arrives. If the result is 22/37 for the reason in
§3.1, the correct outcome of this pass is 22/37 and a written finding.
