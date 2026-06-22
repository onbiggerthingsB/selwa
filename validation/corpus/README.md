# Validation corpus

Shared corpus the validation harness scores **our guarded pipeline** against a
pluggable machine-translation baseline. Each case is a `CorpusCase`
(`validation/types.ts`) and is schema-validated at module load in `index.ts`.

> **All cases here are synthetic or public-style. NEVER commit real PHI.**

## What a case encodes

| Field | Meaning |
| --- | --- |
| `id` | Stable, unique case id (also the report key). |
| `lang` | Source language (`zh` / `en`). |
| `kind` | `labs` (driven by `groundExtraction`), `notes` (driven by `groundNotes`), or `mixed`. |
| `sourceText` | The clinician text / printed lab line, verbatim. |
| `goldTranslation` | The faithful reference translation (clinician-reviewed for real data). |
| `immutables` | The medical terms that **must** survive: `negations`, `dosages`, `drugs` (`{surface, canonicalId}`), `numbers` (`{value, unit}`). The sum is `|I_src|`, the fidelity denominator. |
| `shouldAbstain` | Gold verdict: should the safe pipeline refuse to emit a simplified translation? |
| `highStakes` | A missed abstention here is a **release blocker** (negation/dose/drug families). |
| `abstainReason?` | Which failure family (`dropped_negation`, `dose_mismatch`, `drug_ambiguous`, `number_unit_mismatch`, `unit_conversion_ambiguous`). |
| `candidateTranslation?` | The translation the **offline** run feeds OURS. Faithful cases use the gold; should-abstain cases use a deliberately-flawed translation that exercises the guard. The runner falls back to `goldTranslation` when omitted. |

## Failure families covered by the seed cases

- **Dropped / reversed / weakened negation** (R7) — `negation.case.ts`
- **Dose rounding / unit swap / dropped frequency / range collapse** (R8) — `dose.case.ts`
- **Drug look-alike substitution / result-polarity flip / unverifiable-drug swap** (R9) — `drug.case.ts`
- **Unit-conversion trap + safe conversion + faithful lab** (R2 / R2b) — `labs.case.ts`

Each family also includes **faithful, should-NOT-abstain** cases so the harness
measures over-abstention (a false abstention is a comprehension cost, even
though it is the safe failure direction).

## Drop-in slot for real, de-identified data

Real reports give the validation number its weight. To add them **safely**:

1. **De-identify first.** Strip every direct/indirect identifier (names, MRNs,
   dates, locations, provider names) *before* the text leaves the source system.
   The harness never touches a live PHI store.
2. **Get a clinician/bilingual gold.** A qualified reviewer writes
   `goldTranslation` and labels `immutables`, `shouldAbstain`, `highStakes`, and
   `abstainReason`. Use `validation/review/export.ts` to emit the unlabeled cases
   and `import.ts` to fold the verdicts back.
3. **Add a new `*.case.ts` file** (e.g. `real-deidentified.case.ts`) exporting a
   `CorpusCase[]`, and spread it into `RAW_CASES` in `index.ts`. The schema parse
   + duplicate-id check run automatically.
4. **Keep PHI out of git.** If a real-data file must stay local, add it to
   `.gitignore` and load it via an env-gated dynamic import; do not commit it.

The metrics, baselines, and runner are corpus-agnostic — they read whatever
`CORPUS` exports, so real cases score identically to the synthetic seeds.
