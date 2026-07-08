// H4: client-side photo-quality pre-gate. Pure scoring functions (no DOM) run on
// the POST-downscale image actually sent to Claude. Below threshold → prompt a
// specific retake instead of extracting from a degraded image, because models
// fabricate digits on inputs they cannot perceive and no downstream confidence
// signal reliably catches that. Overridable by the user. Thresholds are heuristic
// starting points and need tuning against real phone photos (see H4 caveats).

import type { GroundedReport, GuardFlag } from '@/lib/types';

export interface GrayImage {
  data: ArrayLike<number>; // grayscale 0-255, row-major, length width*height
  width: number;
  height: number;
}

/** Convert RGBA pixel data (canvas getImageData) to grayscale luma. */
export function toGray(rgba: ArrayLike<number>, width: number, height: number): GrayImage {
  const n = width * height;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    out[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return { data: out, width, height };
}

function variance(a: number[]): number {
  if (a.length === 0) return 0;
  let sum = 0;
  for (const v of a) sum += v;
  const m = sum / a.length;
  let s = 0;
  for (const v of a) s += (v - m) * (v - m);
  return s / a.length;
}

/** Variance of the Laplacian — the standard blur metric (higher = sharper). */
export function laplacianVariance(img: GrayImage): number {
  const { data, width: w, height: h } = img;
  if (w < 3 || h < 3) return 0;
  const vals: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = data[y * w + x];
      const lap = data[(y - 1) * w + x] + data[(y + 1) * w + x] + data[y * w + (x - 1)] + data[y * w + (x + 1)] - 4 * c;
      vals.push(lap);
    }
  }
  return variance(vals);
}

/** Global contrast (stddev of intensities); very low → washed out / glare / blank. */
export function contrastStdDev(img: GrayImage): number {
  const a = Array.from(img.data as ArrayLike<number>, (v) => v as number);
  return Math.sqrt(variance(a));
}

/**
 * Fraction of pixels that are neither near-black nor near-white — a proxy for a
 * flat, evenly-lit document with text vs a blank / over- or under-exposed frame.
 */
export function midtoneCoverage(img: GrayImage): number {
  const { data } = img;
  const n = (data as ArrayLike<number>).length;
  if (n === 0) return 0;
  let c = 0;
  for (let i = 0; i < n; i++) {
    const v = data[i];
    if (v >= 30 && v <= 225) c += 1;
  }
  return c / n;
}

export type QualityReason = 'blurry' | 'low-contrast' | 'poor-coverage';

export interface QualityVerdict {
  ok: boolean;
  blur: number;
  contrast: number;
  coverage: number;
  reasons: QualityReason[];
}

export interface QualityThresholds {
  blur: number;
  contrast: number;
  coverage: number;
}

// Heuristic defaults — MUST be tuned against real phone photos of lab reports
// (H4 caveat). Set to catch obviously-degraded frames without over-rejecting.
export const QUALITY_THRESHOLDS: QualityThresholds = { blur: 100, contrast: 18, coverage: 0.2 };

export function assessQuality(img: GrayImage, t: QualityThresholds = QUALITY_THRESHOLDS): QualityVerdict {
  const blur = laplacianVariance(img);
  const contrast = contrastStdDev(img);
  const coverage = midtoneCoverage(img);
  const reasons: QualityReason[] = [];
  if (blur < t.blur) reasons.push('blurry');
  if (contrast < t.contrast) reasons.push('low-contrast');
  if (coverage < t.coverage) reasons.push('poor-coverage');
  return { ok: reasons.length === 0, blur, contrast, coverage, reasons };
}

/** Specific, actionable retake guidance per failed check (EN + ZH). */
export const RETAKE_GUIDANCE: Record<QualityReason, { en: string; zh: string }> = {
  blurry: {
    en: 'The photo looks blurry — hold the phone steady and tap the report to focus.',
    zh: '照片有点模糊——请拿稳手机，点击报告对焦。',
  },
  'low-contrast': {
    en: 'The photo looks washed out — reduce glare and use even, bright light.',
    zh: '照片对比度过低——请减少反光，使用均匀明亮的光线。',
  },
  'poor-coverage': {
    en: 'Move closer so the report fills the frame and lies flat.',
    zh: '请靠近一些，让报告铺满画面并保持平整。',
  },
};

export const LOW_QUALITY_FLAG: GuardFlag = {
  id: 'H4-LOW-QUALITY-OVERRIDE',
  severity: 'caution',
  messageEn: 'This photo was hard to read, so please double-check every value against your report.',
  messageZh: '这张照片不太清晰，请逐一核对每个数值与您的报告是否一致。',
};

/**
 * When the user OVERRIDES a failed photo-quality gate, escalate: every emitted row
 * is routed through the confirm-the-values step (a degraded photo raises misread
 * risk for the whole report). Abstained rows are left as-is (already suppressed).
 * This is the "override escalates the confirm gate" behavior — the override never
 * bypasses safety, it strengthens it.
 */
export function escalateConfirm(report: GroundedReport): GroundedReport {
  return {
    ...report,
    rows: report.rows.map((r) =>
      r.action === 'abstain'
        ? r
        : {
            ...r,
            needsConfirm: true,
            flags: r.flags.some((f) => f.id === LOW_QUALITY_FLAG.id) ? r.flags : [...r.flags, LOW_QUALITY_FLAG],
          },
    ),
  };
}
