import { describe, it, expect } from 'vitest';
import {
  toGray,
  laplacianVariance,
  contrastStdDev,
  inkCoverage,
  assessQuality,
  escalateConfirm,
  type GrayImage,
} from './imageQuality';
import { groundExtraction } from './grounding';

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

  it('contrastStdDev is 0 for uniform, high for a checkerboard', () => {
    expect(contrastStdDev(uniform(10, 10, 128))).toBeCloseTo(0, 5);
    expect(contrastStdDev(midtoneCheckerboard(10, 10))).toBeGreaterThan(30);
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
    expect(v.reasons).toContain('low-contrast');
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
