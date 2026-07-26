# Camera path, second measurement: a full 32-page health check (2026-07-26)

The first measurement (`README.md`, 2026-07-25) was one CBC page. This one is a complete
comprehensive health examination (体检报告) from a Tibetan patient at a Lhasa hospital, photographed
page by page with a phone, **with the patient's consent**. It is the first time the app's capture
path has been exercised against a whole real document rather than a single page.

**No images and no patient data are committed.** The pages carry name, registration number and
phone number. Only aggregate findings are recorded here.

## What was run

31 photographed pages, downscaled with the client's own settings (`downscaleToJpeg`, maxEdge 1600,
quality 0.85), through the production path: `claude-opus-4-8` with the `EXTRACTION_PROMPT` and
output shape from `app/api/extract/route.ts`. Every page ran once for triage; the 17 pages that
produced rows then ran twice more, three runs total.

There is **no hand transcription** for this report, so accuracy against the page cannot be scored.
The measurement is therefore **self-consistency**: any cell that differs between runs of the same
image is wrong in at least one of them. That is a lower bound on the error rate, obtainable with no
ground truth.

## Page composition

| kind | pages | behaviour |
|---|---|---|
| Narrative imaging and summaries (ultrasound, MRI, ECG, CT, 健康建议, 健康体检小结) | 14 | 0 rows, every time |
| Genuine lab tables (肝功, 肾功, 血脂, 电解质, 甲功, 呼气试验…) | 7 | 113 analyte rows |
| Mixed / advice pages with numbers (bone density, calcium score, target ranges) | 9 | extracted, but not lab panels |
| Infographic (健康警示灯 body diagram) | 1 | see below |

## Result 1: no fabrication anywhere

**All 14 narrative pages returned zero rows in every run.** Ultrasound reports, an MRI report, an
ECG waveform, CT slices, the doctor's written summary: none produced a single invented analyte.

The infographic page is the sharper test. 健康警示灯 is a drawing of a body with 32 labelled organs
and coloured severity dots, no numbers at all. The model extracted the 32 organ labels as rows, but
set **every value, unit and range to null**. It transcribed visible text and refused to invent
numbers from a picture. That is the OCR-only invariant holding under an unusual input.

## Result 2: values on real lab tables were perfectly stable

Across the 7 genuine lab-table pages: **113 analyte rows, 3 runs each, 327 name-keyed cells
compared, and zero value disagreements.** Every number was read identically every time.

This is a much stronger stability result than the first measurement suggested, and it is worth
stating plainly: on ordinary printed lab panels, the value reading was reliable.

## Result 3: recognition is NOT stable, and it changes what the user sees

All 9 disagreements were in **units** or **analyte names**, never values:

- unit present in one run, `null` in another: 脉搏, 身高, 体重, 腰围, 收缩压, 血氧饱和度, 镁测定
- `血清γ-谷氨酰基转移酶` vs `血清y-谷氨酰基转移酶` (Greek gamma read as a Latin y)
- `血清三碘甲状腺原氨酸(T3)` vs `血清三碘甲状原氨酸(T3)` (a dropped character)
- 促甲状腺激素 unit read as `uIU/mL` once and `ulU/mL` twice

That last one is not cosmetic. Capital I and lowercase l are near-identical in most fonts, and the
app's behaviour diverges on them. Verified end to end through `groundExtraction`:

| OCR'd unit | recognised | action |
|---|---|---|
| `uIU/mL` | yes, `tsh` | `classify` — the row is explained |
| `ulU/mL` | yes, `tsh` | `abstain` — the row is withheld |

Same analyte, same value, same printed range. **In 2 of 3 runs the user's TSH row would be silently
withheld** because of a font ambiguity in the unit string.

The direction is safe: the app abstains rather than asserting something wrong. But it degrades the
product's core value invisibly, it is not detectable from a single run, and it is fixable by
normalising the well-known I/l confusion pair before the unit check.

`cameraPath.test.ts` pins this as a deterministic test. If someone adds unit normalisation, that
test fails, which is the correct signal.

## Result 4: the page the patient most needs is the one the app cannot read

The 健康体检小结 (health check summary) is where the doctor lists 危急值或重大阳性结果 and
重点关注的异常结果 — the abnormal findings, in prose. For a reader who cannot interpret the raw
panels, this is the single most useful page in the document.

It contains no analyte table, so it correctly returns zero rows, and since the C6 fix the app now
responds "Could not read the report" and asks for a retake. Honest, and useless. A patient
photographing the most important page gets nothing.

This is a scope finding, not a defect: the product explains *rows*, and a 体检报告's value for a
layperson is concentrated in *prose*. Worth deciding deliberately rather than discovering in the
field.

## Limits

- One patient, one hospital, one document, one camera, one lighting condition.
- Self-consistency is a lower bound: an error reproduced identically in all three runs is invisible
  to this method. The first measurement found exactly such an error (a basophil value misread the
  same way three times), so this method would have missed it.
- No ground truth, so no accuracy figure. Only a human transcription can give that.
- Page-type classification here was done by inspection, not by an independent rater.

## What this changes

1. **Value reading on printed lab panels looks solid.** Two measurements now agree that dropped rows
   and invented numbers are not the common failure.
2. **The instability is in recognition, not extraction.** Units and names wobble; that decides
   whether a row is explained or withheld. This is the cheapest available improvement: normalise
   confusable characters (I/l, γ/y) before matching.
3. **Whole-document capture raises questions row-extraction does not answer** — what to do with
   narrative pages, imaging reports, and the summary page, which together were 14 of 31 pages here.
