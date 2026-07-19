import { describe, it, expect } from 'vitest';
import {
  toGray,
  laplacianVariance,
  inkCoverage,
  assessQuality,
  escalateConfirm,
  QUALITY_THRESHOLDS,
  RETAKE_GUIDANCE,
  LOW_QUALITY_FLAG,
  type GrayImage,
} from './imageQuality';
import { groundExtraction } from './grounding';
import { resolveText } from '@/lib/i18n';

function uniform(w: number, h: number, v: number): GrayImage {
  return { data: new Array(w * h).fill(v), width: w, height: h };
}
// Alternating midtone values → sharp (high Laplacian) + contrasty + midtone-covered.
function midtoneCheckerboard(w: number, h: number): GrayImage {
  const d = new Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = (x + y) % 2 === 0 ? 100 : 180;
  return { data: d, width: w, height: h };
}
// Pure black/white checkerboard → sharp but NO midtone coverage.
function bwCheckerboard(w: number, h: number): GrayImage {
  const d = new Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = (x + y) % 2 === 0 ? 0 : 255;
  return { data: d, width: w, height: h };
}

describe('imageQuality', () => {
  it('toGray converts RGBA to luma', () => {
    // one white pixel, one black pixel
    const rgba = [255, 255, 255, 255, 0, 0, 0, 255];
    const g = toGray(rgba, 2, 1);
    expect(g.data[0]).toBeCloseTo(255, 0);
    expect(g.data[1]).toBeCloseTo(0, 0);
  });

  it('laplacianVariance ~0 for a uniform (blank/blurry) image, large for a sharp pattern', () => {
    expect(laplacianVariance(uniform(20, 20, 128))).toBeLessThan(1);
    expect(laplacianVariance(midtoneCheckerboard(20, 20))).toBeGreaterThan(1000);
  });

  // THE REGRESSION THIS FILE USED TO LOCK IN. The old midtoneCoverage counted pixels in
  // [30,225] as "good coverage", so this same pair asserted the exact inverse: featureless
  // grey scored 1 and a max-contrast black/white checkerboard — which is what crisp text on
  // paper looks like — scored 0. A real lab-report photo scored 0.018 and was refused with
  // "Move closer so the report fills the frame", while a photo blurry enough to smear its
  // text into grey sailed through. Ink coverage inverts both.
  it('inkCoverage: text-like B/W checkerboard is high, featureless grey is 0', () => {
    expect(inkCoverage(bwCheckerboard(10, 10))).toBeGreaterThan(0.4);
    expect(inkCoverage(uniform(10, 10, 128))).toBe(0);
  });

  it('inkCoverage is relative to the frame’s own paper level, so lighting does not decide it', () => {
    // The same document photographed dim (paper 120) and bright (paper 250) must score alike.
    // An absolute cutoff — which is what the old metric effectively used — cannot do this.
    const doc = (paper: number, ink: number) => {
      const w = 20, h = 20;
      const d = new Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = y % 5 === 0 ? ink : paper;
      return { data: d, width: w, height: h };
    };
    expect(inkCoverage(doc(250, 20))).toBeCloseTo(0.2, 5);
    expect(inkCoverage(doc(120, 10))).toBeCloseTo(0.2, 5);
  });

  it('inkCoverage ignores a single specular highlight when picking the paper level', () => {
    // Glare off a phone flash must not define "paper" and drag the ink cutoff up with it;
    // that is why the paper level is the 95th percentile rather than the max.
    const w = 20, h = 20;
    const d = new Array(w * h).fill(200);
    for (let y = 0; y < h; y++) for (let x = 0; x < 4; x++) d[y * w + x] = 20;  // 20% ink
    d[0] = 255;                                                                 // one blown-out pixel
    expect(inkCoverage({ data: d, width: w, height: h })).toBeGreaterThan(0.15);
  });

  it('assessQuality flags a blank/blurry frame with specific reasons', () => {
    const v = assessQuality(uniform(20, 20, 128));
    expect(v.ok).toBe(false);
    expect(v.reasons).toContain('blurry');
    expect(v.reasons).toContain('no-text-found'); // no pixel is dark enough to count as ink either
  });

  it('keeps reviewed EN/ZH retake copy and explicitly falls Tibetan back to unverified Chinese', () => {
    expect(resolveText(RETAKE_GUIDANCE.blurry, 'en')).toMatchObject({
      text: 'The photo looks blurry — hold the phone steady and tap the report to focus.',
      review: 'reviewed',
    });
    expect(resolveText(RETAKE_GUIDANCE.blurry, 'zh')).toMatchObject({
      text: '照片有点模糊——请拿稳手机，点击报告对焦。',
      review: 'reviewed',
    });
    expect(resolveText(RETAKE_GUIDANCE.blurry, 'bo')).toMatchObject({
      text: '照片有点模糊——请拿稳手机，点击报告对焦。',
      resolvedLang: 'zh',
      review: 'unverified',
      usedFallback: true,
    });
    expect(resolveText(LOW_QUALITY_FLAG.message, 'bo').text).toBe(
      resolveText(LOW_QUALITY_FLAG.message, 'zh').text,
    );
  });

  it('assessQuality passes a sharp, contrasty image with ink on it', () => {
    const v = assessQuality(midtoneCheckerboard(30, 30));
    expect(v.ok).toBe(true);
    expect(v.reasons).toHaveLength(0);
  });

  // THE USER-REPORTED BUG, as a test. A well-lit lab report is bimodal — white paper, black
  // ink, little between — and the old gate refused exactly that.
  it('assessQuality PASSES a realistic well-lit lab report (was the false positive)', () => {
    const w = 200, h = 150;
    const d = new Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const textRow = y % 20 < 4;
        d[y * w + x] = textRow && (x * 7 + y) % 11 < 6 ? 18 : 246;
      }
    const v = assessQuality({ data: d, width: w, height: h });
    expect(v.reasons, `a crisp report must not be refused (ink=${v.ink})`).toHaveLength(0);
    expect(v.ok).toBe(true);
  });

  // A SECOND, DISTINCT false positive found while investigating the first: a `contrastStdDev`
  // check (global stddev of the WHOLE frame) used to sit alongside inkCoverage, and it broke on
  // realistic text density even after the coverage fix above shipped. The "good report" pattern
  // this file already used (line ~99) has ~11% of pixels as ink — far denser than real printed
  // text, so it never exercised the bug. A canvas-rendered phone-photo simulation (gradient
  // lighting, grey ink, mild blur, JPEG re-compression) measured ink at 0.6-0.8% of the frame —
  // and at that realistic density, contrastStdDev computed ~14, below the threshold of 18, and
  // the photo was refused as "washed out" though it was a normal, legible document. This test
  // pins that same realistic sparsity (text confined to a thin band, most of the frame pure
  // paper) and requires a PASS, so a global-variance-style check cannot silently return.
  it('assessQuality passes REALISTIC sparse text density (thin text band in a large frame)', () => {
    const w = 300, h = 400; // most of the frame is paper; only a few rows carry text
    const d = new Array(w * h).fill(246);
    for (let y = 20; y < 36; y++) {
      // one printed line: alternating ink/paper within the row only, like real glyph strokes
      for (let x = 0; x < w; x++) if (x % 3 === 0) d[y * w + x] = 20;
    }
    const img = { data: d, width: w, height: h };
    const totalPx = w * h;
    const inkPx = d.filter((v) => v < 100).length;
    expect(inkPx / totalPx, 'sanity: this must actually be sparse, not dense').toBeLessThan(0.02);
    const v = assessQuality(img);
    expect(v.reasons, `a sparse-but-legible document must not be refused (blur=${v.blur}, ink=${v.ink})`).toHaveLength(0);
  });

  // THE THIRD FALSE POSITIVE, and the one that survived two prior fixes. Real body text on an
  // A4 report is ~9-11px; after the 400px analysis downscale a stroke is ~3px and antialiasing
  // averages it toward the paper. Under the old INK_RATIO 0.6 those pixels fell just short of
  // the cutoff, so ink coverage collapsed to ~0.001-0.002 on a SHARP, perfectly readable page
  // and it was refused as "no printed text". This fixture reproduces that geometry: thin
  // strokes whose downscaled value sits between 0.6*paper and 0.75*paper — invisible to the
  // old cutoff, counted by the new one.
  it('assessQuality passes text whose strokes are ANTIALIASED toward paper (downscale case)', () => {
    const w = 300, h = 400;
    const paper = 245;
    const d = new Array(w * h).fill(paper);
    // Value 160 sits above 0.6*245 (=147) but below 0.75*245 (=184): the exact band that a
    // downscaled, antialiased text stroke lands in. Under INK_RATIO 0.6 this is NOT ink.
    for (let y = 30; y < 46; y++) for (let x = 0; x < w; x++) if (x % 3 === 0) d[y * w + x] = 160;
    const v = assessQuality({ data: d, width: w, height: h });
    expect(v.ink, 'antialiased strokes must register as ink').toBeGreaterThan(QUALITY_THRESHOLDS.ink);
    expect(v.reasons).not.toContain('no-text-found');
  });

  it('the ink threshold still separates cleanly — negatives measure exactly zero', () => {
    // The basis for setting the threshold low: with no document present, nothing can be 25%
    // darker than the frame's own paper level, so these are 0 by construction, not by tuning.
    for (const [label, img] of [
      ['blank white', uniform(30, 30, 250)],
      ['flat grey', uniform(30, 30, 128)],
      ['dark/underexposed', uniform(30, 30, 58)],
    ] as const) {
      expect(inkCoverage(img), `${label} must have no ink`).toBe(0);
      expect(assessQuality(img).reasons).toContain('no-text-found');
    }
  });

  it('assessQuality still refuses a frame with no document in it', () => {
    // The check's real job: blank wall, finger over the lens, report out of shot.
    const blank = assessQuality(uniform(30, 30, 250));
    expect(blank.ok).toBe(false);
    expect(blank.reasons).toContain('no-text-found');
  });

  // END-TO-END from the byte layout the browser actually supplies. In the app the input is a
  // Uint8ClampedArray of RGBA from canvas getImageData, and toGray emits FLOATS (luma), not the
  // integers the other tests hand-build — so this exercises the real types through to a verdict.
  it('a canvas-shaped RGBA lab report survives toGray → assessQuality', () => {
    const w = 200, h = 150;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const textRow = y % 20 < 4;
        const v = textRow && (x * 7 + y) % 11 < 6 ? 18 : 246;
        const i = (y * w + x) * 4;
        rgba[i] = v; rgba[i + 1] = v; rgba[i + 2] = v; rgba[i + 3] = 255;
      }
    const v = assessQuality(toGray(rgba, w, h));
    expect(v.ok, `crisp report refused: ${v.reasons.join(',')} (ink=${v.ink})`).toBe(true);
  });

  it('escalateConfirm routes every emitted row to confirm with a low-quality flag', () => {
    // total_cholesterol 4.5 mmol/L is normal + not high-stakes → normally no confirm.
    const report = groundExtraction(
      { rows: [{ name: '总胆固醇', value: '4.5', unit: 'mmol/L', printedRange: null, confidence: 'high' }] },
      'unknown',
    );
    expect(report.rows[0].needsConfirm).toBe(false);
    const esc = escalateConfirm(report);
    expect(esc.rows[0].needsConfirm).toBe(true);
    expect(esc.rows[0].flags.some((f) => f.id === 'H4-LOW-QUALITY-OVERRIDE')).toBe(true);
  });
});
