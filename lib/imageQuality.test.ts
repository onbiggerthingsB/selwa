import { describe, it, expect } from 'vitest';
import {
  toGray,
  laplacianVariance,
  contrastStdDev,
  midtoneCoverage,
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

  it('midtoneCoverage: uniform midtone = 1, pure B/W checkerboard = 0', () => {
    expect(midtoneCoverage(uniform(10, 10, 128))).toBe(1);
    expect(midtoneCoverage(bwCheckerboard(10, 10))).toBe(0);
  });

  it('assessQuality flags a blank/blurry frame with specific reasons', () => {
    const v = assessQuality(uniform(20, 20, 128));
    expect(v.ok).toBe(false);
    expect(v.reasons).toContain('blurry');
    expect(v.reasons).toContain('low-contrast');
  });

  it('assessQuality passes a sharp, contrasty, well-covered image', () => {
    const v = assessQuality(midtoneCheckerboard(30, 30));
    expect(v.ok).toBe(true);
    expect(v.reasons).toHaveLength(0);
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
