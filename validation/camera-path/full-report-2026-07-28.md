# Full-report recognition follow-up (2026-07-28)

This is a recognition follow-up on the comprehensive Lhasa health check described in
`full-report-2026-07-26.md`. The report holder replayed 129 printed rows through `findEntry`; 107
resolved and 22 distinct printed names did not.

**No images and no patient data are committed.** The frozen evidence in
`unresolved-names-2026-07-28.ts` contains only printed row labels, which carry no identifying
information.

## Before and after

| measurement | recognised rows | recognition |
|---|---:|---:|
| Before curation, measured by the report holder | 107 / 129 | 82.9% |
| After curation, predicted from the frozen name list | 125 / 129 | 96.9% |

The after figure is a **prediction, not a re-measurement**: 18 frozen names now resolve and each
occurred once in the report, but the original report is not committed and was not available for
this pass. The holder of the report must confirm the row-level result.

## What was curated

Sixteen bone-densitometry rows now resolve: BMD, BMC, T值 and Z值 at T11, T12, L1 and the row
labelled 均值. Each is a separate `bone_`-prefixed entry so the site or aggregate label printed on
the page remains visible. Every alias is the full printed cell; generic tokens such as `BMD`,
`T值`, `L1` and `均值` remain unresolved.

These entries reuse the `measurement` frame because DXA measures the body rather than a blood or
urine specimen. They are `report-only`, have no curated band, and have an empty citation field.
This adds deterministic names and direction-neutral definitions without inventing
equipment-, population- or reference-cohort-dependent thresholds. Position still comes only from
the value and range printed on the report.

Two field-evidenced spellings also now resolve narrowly:

- `血清碳酸氢盐（HC03）测定`, where the printed `HC03` contains a digit zero, routes to
  `bicarbonate` through one explicit parenthesised alias. Bare `HC03` remains unresolved.
- `血清三碘甲状原氨酸(T3)`, where `腺` was dropped, routes to `total_t3` because the retained
  `(T3)` suffix pins it to total T3. The bare corrupted stem and the free-T3 corruption remain
  unresolved.

## Deliberately declined

- `血清胱抑素`: the printed label does not identify cystatin A, B or C. Resolving it to
  `cystatin_c` would assert a subtype the page does not show.
- `检测结果:DOB`: this is a ¹³C urea breath-test row, not a blood analyte, and `DOB` also collides
  with date of birth. It needs a breath specimen frame before curation.
- `基础代谢率`: basal metabolic rate is a derived measurement whose formula is not identified by
  the row label. Its frame remains undecided.
- `其他`: a literal “other” table row is not an analyte.

The table-independent printed-range chip can still render for these rows; declining to name them
does not suppress arithmetic on the page's own value and range.

## Negative-score behaviour

Signed scalar values and unambiguous ASCII-minus ranges are already supported. For example,
`-2.5~-1.0` parses as a closed range, while `-2.5--1.0` is ambiguous and safely returns `null`
instead of guessing. A comparator such as `>-1` also parses correctly.

The known limitation is that `parsePrintedRange('−2.5~−1.0')` returns `null` when the signs are
U+2212 MINUS SIGN rather than ASCII hyphens. This is safe: the app defers and shows no directional
claim.
