import { describe, expect, it } from 'vitest';
import { groundExtraction } from '@/lib/grounding';
import { buildSummary } from '@/lib/summary';
import { resolveText } from '@/lib/i18n';
import { LHASA_FIELD_SAMPLE } from '@/validation/real-corpus/field-lhasa';
import { CAMERA_PATH_RUNS_2026_07_25 } from './runs-2026-07-25';

// FIRST REAL CAMERA-PATH MEASUREMENT — 2026-07-25. See README.md.
//
// Everything else in this repo validates the deterministic middle against HAND-TRANSCRIBED rows.
// This is the only place that pins what the vision model actually read off a real photograph.
// These tests are a frozen record, not a target: they assert the measured behaviour, including
// the two errors, so the finding cannot quietly evaporate.

const TRUTH = LHASA_FIELD_SAMPLE[0].items;
const PAGE_ONE = TRUTH.slice(0, 25); // rows 26-27 (CRP) are printed on page 2, not photographed

/** The report prints units with a leading asterisk (*10^9/L); the transcription dropped it. */
const norm = (s: string | null | undefined) =>
  (s ?? '').replace(/[\s*]/gu, '').replace(/\^/gu, '').toLowerCase();

const numEq = (a: string | null, b: string) => a !== null && Number(a) === Number(b);

describe('camera path — what the model actually read off the page', () => {
  it.each(CAMERA_PATH_RUNS_2026_07_25.map((rows, i) => ({ run: i + 1, rows })))(
    'run $run read every printed row, with exact ranges and units',
    ({ rows }) => {
      // NO DROPPED ROWS. Partial omission — the failure the completeness gate exists for — did
      // not occur on this report. That is a measurement, not a guarantee: n=1.
      expect(rows).toHaveLength(PAGE_ONE.length);

      rows.forEach((row, i) => {
        // Ranges drive the chip arithmetic, so an error here would be a wrong displayed direction.
        expect(norm(row.printedRange), `run range row ${i + 1}`).toBe(norm(PAGE_ONE[i].item_range));
        expect(norm(row.unit), `run unit row ${i + 1}`).toBe(norm(PAGE_ONE[i].item_unit));
      });
    },
  );

  // The two errors, pinned. Both rows sit directly beneath a flagged-abnormal row (EO / EO% carry
  // a printed * and ↓), and BASO% read 0.10 — exactly the EO% value above it. The value bled up
  // from the adjacent row. BASO% was wrong identically in all three runs; BASO# was wrong in all
  // three and not even stable (0.01 / 0.01 / 0.00).
  it('misread both basophil rows in every run, never once correctly', () => {
    const BASO_ABS = 5;
    const BASO_PCT = 10;
    expect(PAGE_ONE[BASO_ABS].item_name).toBe('嗜碱性粒细胞绝对值');
    expect(PAGE_ONE[BASO_PCT].item_name).toBe('嗜碱性粒细胞百分比');

    for (const rows of CAMERA_PATH_RUNS_2026_07_25) {
      expect(numEq(rows[BASO_ABS].value, PAGE_ONE[BASO_ABS].item_value)).toBe(false);
      expect(numEq(rows[BASO_PCT].value, PAGE_ONE[BASO_PCT].item_value)).toBe(false);
      // The systematic half: BASO% is not random noise, it is the row above.
      expect(rows[BASO_PCT].value).toBe('0.10');
    }
  });

  it('read every other value correctly in every run', () => {
    for (const rows of CAMERA_PATH_RUNS_2026_07_25) {
      const wrong = rows
        .map((row, i) => (numEq(row.value, PAGE_ONE[i].item_value) ? null : i))
        .filter((i): i is number => i !== null);
      expect(wrong).toEqual([5, 10]); // exactly the two basophil rows, nothing else
    }
  });

  // THE POINT OF THIS WHOLE FILE.
  //
  // Both misreadings still land INSIDE the range printed on the page, so the deterministic guard
  // produces the same chip it would for the correct value. chipWrong stays 0 while the user is
  // shown two wrong numbers under a reassuring label, and nothing in the system notices.
  //
  // chipWrong === 0 is therefore necessary but NOT sufficient. If this test ever starts failing
  // because the chip diverges, that is good news — it would mean the display finally reacts to a
  // misread value. Until then, do not treat a green gold-set run as evidence the numbers are right.
  // SECOND MEASUREMENT, 2026-07-26 (see full-report-2026-07-26.md). Across a whole 32-page health
  // check, values on real lab tables were perfectly stable (113 rows x 3 runs, zero value
  // disagreements) — but UNITS wobbled, and that decides whether a row is explained or withheld.
  //
  // 促甲状腺激素's unit was read as 'uIU/mL' once and 'ulU/mL' twice across three runs of the same
  // image. Capital I and lowercase l are near-identical in most fonts. The app's behaviour diverges
  // on them, so the same photograph re-taken can silently withhold the row.
  //
  // FIXED 2026-07-26. lib/reference.ts now folds the I/l and O/0 OCR confusion pairs into a
  // comparison key used by unitMatches and the conversion lookup, so both spellings resolve to the
  // same unit and the row is explained either way. The fold is proven collision-free over the whole
  // shipped unit inventory by a tripwire in lib/reference.test.ts.
  //
  // This test now pins the FIX. It was originally written to assert the defect; it flipped when the
  // defect was closed, which was the intended signal.
  it('reads TSH the same whether OCR gave a capital I or a lowercase l', () => {
    const tsh = (unit: string) =>
      groundExtraction(
        {
          rows: [{
            name: '促甲状腺激素',
            value: '2.5',
            unit,
            printedRange: '0.35-4.94',
            confidence: 'high' as const,
          }],
        },
        'unknown',
      ).rows[0];

    const capitalI = tsh('uIU/mL');
    const lowercaseL = tsh('ulU/mL');

    expect(capitalI.entry?.key).toBe('tsh');
    expect(lowercaseL.entry?.key).toBe('tsh');

    // The whole point: the glyph the OCR happened to pick no longer decides whether the user is
    // told anything about their thyroid.
    expect(capitalI.action).toBe('classify');
    expect(lowercaseL.action).toBe('classify');
    expect(lowercaseL.action).toBe(capitalI.action);
  });

  it('renders an identical chip for the misread values as for the true ones', () => {
    const chipsFor = (values: readonly (readonly [string, string, string])[]) =>
      buildSummary(
        groundExtraction(
          {
            rows: values.map(([name, value, printedRange]) => ({
              name,
              value,
              unit: null,
              printedRange,
              confidence: 'high' as const,
            })),
          },
          'unknown',
        ),
        'en',
      ).sections.map((section) => resolveText(section.chip, 'en').text);

    const truthChips = chipsFor([
      ['嗜碱性粒细胞绝对值', '0.02', '0-0.06'],
      ['嗜碱性粒细胞百分比', '0.30', '0-1'],
    ]);
    const ocrChips = chipsFor([
      ['嗜碱性粒细胞绝对值', '0.01', '0-0.06'],
      ['嗜碱性粒细胞百分比', '0.10', '0-1'],
    ]);

    expect(ocrChips).toEqual(truthChips);
    expect(truthChips.every((chip) => /Within your report/u.test(chip))).toBe(true);
  });
});
