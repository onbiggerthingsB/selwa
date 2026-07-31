# Camera path — real OCR measurements

Two records live here:

- **This file** — the first measurement (2026-07-25): one CBC page, three runs, graded against a
  hand transcription. Found two reproducible value errors that `chipWrong` cannot see.
- **`full-report-2026-07-26.md`** — a whole 32-page health check, 31 pages, self-consistency across
  three runs. Found values perfectly stable on lab tables, but unit and name reading unstable enough
  to flip a row between explained and withheld.

They are complementary: the first has ground truth and can measure accuracy on one page; the second
has no ground truth but covers a whole real document and many page types. The second method would
have MISSED the first's finding, because that error reproduced identically in all three runs.

---

## First measurement (2026-07-25)

Everything else in this repo validates the **deterministic middle** against hand-transcribed rows.
This directory is the only place that records what the vision model actually read off a
**photograph**. Until this run, the camera→OCR step — the first and most critical step in the
product — had never been executed.

## What was run

| | |
|---|---|
| Source | Page 1 of a real Lhasa tertiary-hospital CBC report (患者 consent obtained 2026-07-22) |
| Path | `claude-opus-4-8` + `EXTRACTION_PROMPT` from `lib/extractionSchema.ts` + the same forced-tool output shape as `app/api/extract/route.ts` |
| Preprocessing | Downscaled to ~0.26 MB JPEG, mirroring the client's `downscaleToJpeg` |
| Ground truth | The hand transcription frozen in `validation/real-corpus/field-lhasa.ts` |
| Runs | 3 independent |

**No image is committed.** The photo carries the patient's name, medical-record number, sample
barcode and doctor signatures. Only de-identified analyte rows are stored, in
`runs-2026-07-25.ts`. Do not commit the source photograph.

Conditions were **favourable**: flat, well-lit, in focus, no glare or tilt. Field photographs
should be expected to perform worse, not better.

## Result

**Rows: 25/25 in every run. Nothing dropped.** Partial omission — the failure mode the
completeness gate (`components/RowManifest.tsx`) exists for — did not occur on this report.

**Printed ranges: 25/25 exact.** This matters more than it looks: the status chip is pure
arithmetic on the printed value against the printed range, so a range error would produce a wrong
displayed direction.

**Units: faithful**, including the leading asterisk the page prints (`*10^9/L`). The transcription
in `field-lhasa.ts` dropped that asterisk; the OCR did not.

**Analyte names: read as printed** — in five cases *more* faithfully than the transcription
(the page prints 平均血红蛋白含量, 红细胞分布宽度标准差, 红细胞分布宽度变异系数, 血小板, 大血小板数目;
the fixture recorded 平均血红蛋白量, …SD, …CV, 血小板计数, 大血小板计数).

**Values: 23/25 correct. Two wrong, in every run.**

| row | printed | run 1 | run 2 | run 3 |
|---|---|---|---|---|
| 嗜碱性粒细胞绝对值 (BASO#) | **0.02** | 0.01 | 0.01 | 0.00 |
| 嗜碱性粒细胞百分比 (BASO%) | **0.30** | 0.10 | 0.10 | 0.10 |

### Failure signature

Both rows sit **directly beneath a flagged-abnormal row**: EO and EO% each carry a printed `*` and
`↓`. BASO% was read as `0.10` — *exactly the EO% value on the line above it*. The value bled
upward from the adjacent row. BASO% was wrong identically in all three runs (systematic); BASO#
was wrong in all three and not even stable (0.01 / 0.01 / 0.00).

This is a **row-association** failure near flag glyphs, not general digit misreading — the other
23 values, including six-character decimals like `337.00` and `0.108-0.282`, were exact every time.

## Why this is the important finding

Both misread values still fall **inside** their printed ranges. So the deterministic guard emits
the same chip it would for the correct value:

```
TRUTH  0.02 → "Within your report's range"
OCR    0.01 → "Within your report's range"    ← identical
TRUTH  0.30 → "Within your report's range"
OCR    0.10 → "Within your report's range"    ← identical
```

**`chipWrong` stays 0 while two displayed numbers are factually wrong.**

A user who cannot read their own report — the entire target population — would be shown two
incorrect values under a reassuring label, and nothing in the system would flag it. This confirms,
by measurement rather than argument, that `chipWrong === 0` is **necessary but not sufficient**:
it verifies that our displayed comparison does not contradict the row we were given, not that the
row is what the page says.

### These two errors are arithmetically invisible (measured 2026-07-31)

The obvious guard for a five-part differential is coherence: absolute ≈ percentage × WBC / 100, and
the five percentages sum to ~100. Tested against these exact rows, with WBC 6.84:

| | BASO abs | BASO pct | implied abs | deviation | pct sum |
|---|---|---|---|---|---|
| truth | 0.02 | 0.30 | 0.0205 | 0.0005 | 100.30 |
| OCR | 0.01 | 0.10 | 0.0068 | **0.0032** | **100.10** |

**Neither check fires.** The OCR deviation of 0.0032 is *identical* to EO's deviation in the TRUTH
data, so it is indistinguishable from normal rounding. And the percentage sum moves from 100.30 to
100.10 — i.e. *closer* to 100, so a sum check would read the corrupted report as marginally
healthier than the correct one.

Two reasons, both structural: BASO# and BASO% were misread **together and coherently** (0.10% really
does imply ~0.01), and basophils are 0.3% of the differential, too small a term to move any sum.

A differential-coherence check was therefore NOT added. It would catch large digit errors — none of
which this measurement observed — while leaving the failure mode we did observe uncaught, and a
control that reads as coverage without providing it is a failure pattern this project has already
hit three times (alias refusal that bounded nothing; a banner that did not suppress; chipWrong === 0).

The finding is evidence for the architecture argument in `docs/PLAN-on-device-extraction.md`:
row-association errors need a **geometric** fix — binding computed from cell coordinates in our own
code, and verifiable by reconstructing the table — because no arithmetic over the extracted values
can see them.

`cameraPath.test.ts` pins all of the above, including a deterministic demonstration of the
chip blindness. The two errors are asserted **as errors**: do not "fix" the frozen rows.

## Limits of this record

- **n = 1 report, 3 runs.** This is a data point, not an error rate. It cannot tell you whether
  BASO-style misreads occur in 1% or 30% of reports.
- Page 2 (C反应蛋白, 超敏C反应蛋白) was not photographed, so 2 of the fixture's 27 rows are untested.
- One layout, one hospital, one camera, one lighting condition.

## What it implies

1. **Value corroboration is an open gap**, distinct from the completeness gap already addressed.
   The manifest shows name + value; digits are legible even to someone who cannot read Chinese
   medical terminology, so surfacing values prominently there is the cheapest available mitigation.
2. **Do not report a green gold-set run as evidence the numbers are right.** Pair `chipWrong` with
   value exactness measured against the page.
3. The next honest step is breadth: 20–30 de-identified reports across layouts, phones, lighting,
   glare and tilt, to turn this signature into a rate.

## Reproducing

The runner is not committed (it reads a local photograph and needs `ANTHROPIC_API_KEY`). To repeat:
load a report image, send it with `EXTRACTION_PROMPT` and the `LabExtractionSchema` shape to
`claude-opus-4-8`, and diff the rows positionally against a hand transcription. Grade **values,
units, ranges and row order separately** — a name-keyed diff hides row-association errors, which is
exactly the failure found here.
