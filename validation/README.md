# Validation harness (M4)

Measures the **safety / comprehension delta** of our guarded translation pipeline
against a pluggable machine-translation baseline on a shared corpus.

> **Not shipped in the app bundle.** Nothing under `app/` or `lib/` imports
> `validation/`. It is run only by Vitest and `npm run validate` (tsx).

## Run it

```bash
npm run validate            # offline baseline, no API key required
VALIDATE_BASELINE=google npm run validate          # + Google (needs GOOGLE_TRANSLATE_API_KEY)
VALIDATE_BASELINE=unguarded-llm npm run validate   # + unguarded Claude (needs ANTHROPIC_API_KEY)
```

Outputs `validation/report.md` and `validation/report.json` (gitignored). The run
exits **non-zero** when OURS misses any high-stakes gold-abstain case (a release
blocker).

## The three metrics (`metrics.ts`)

- **Medical-term fidelity** — term-weighted over EMITTED cases only:
  `Σ matchedImmutables / Σ |I_src|`. A case with `|I_src| = 0` is excluded.
- **Abstention precision** — `|A ∩ G| / |A|`. `|A| = 0` → N/A (never 1.0).
- **Abstention recall** — `|A ∩ G| / |G|`. `|G| = 0` → N/A. The **high-stakes
  subset** recall is reported separately; a miss there blocks release.

## Pieces

| File | Role |
| --- | --- |
| `types.ts` | `CorpusCaseSchema` + `totalImmutables`. |
| `corpus/` | Schema-validated seed cases (synthetic / public-style). See `corpus/README.md` for the real-data drop-in slot. |
| `baseline/` | `MtBaseline` interface + `offline` / `google` / `unguarded-llm` adapters. |
| `metrics.ts` | The three formulas (the validated core). |
| `score.ts` | `countMatchedImmutables` — deterministic immutable-survival scoring. |
| `run.ts` | Runner: OURS vs each baseline → report + release gate. |
| `review/` | `export.ts` (emit cases for clinician verdicts as CSV/JSON) + `import.ts` (fold verdicts back). |

## Clinician review workflow

1. `export.toReviewCsv(cases)` / `toReviewJson(cases)` → hand to a clinician or
   bilingual reviewer.
2. Reviewer fills `goldTranslation`, `shouldAbstain`, `highStakes`,
   `abstainReason`.
3. `import.applyVerdicts(cases, verdicts)` folds the verdicts back onto the
   corpus. Use this when adding real de-identified reports (see
   `corpus/README.md`).
