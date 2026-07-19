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

// How dark a pixel must be, RELATIVE to this frame's own paper level, to count as ink.
// Relative rather than absolute so the check survives dim light (paper at 120) and bright
// light (paper at 250) alike — an absolute cutoff mis-reads one end or the other.
const INK_RATIO = 0.6;

/**
 * Fraction of pixels dark enough to be printed text, measured against the frame's own
 * paper level. This is the "is there actually a document here?" check: a blank wall, a
 * finger over the lens, or an out-of-frame report all yield ~0.
 *
 * REPLACES a midtone-coverage metric that was INVERTED for documents. That version counted
 * pixels in [30,225] as good, reasoning they indicated "a flat, evenly-lit document with
 * text". But a well-lit lab report is BIMODAL — white paper above 225, black ink below 30,
 * almost nothing between — so a crisp photo scored ~0.02 and was rejected as "poor
 * coverage", while a blurry one whose text had smeared into grey scored 1.00 and passed.
 * Measured on synthetic frames: good report 0.018 (FAIL), smeared report 1.000 (PASS). The
 * sharper the photo, the more likely it was refused — the user-reported false positive.
 * Raising the old threshold would only have disabled the check; the metric had to change.
 */
export function inkCoverage(img: GrayImage): number {
  const { data } = img;
  const n = (data as ArrayLike<number>).length;
  if (n === 0) return 0;
  // Histogram rather than a sort: O(n) and allocation-free on a low-end phone.
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < n; i++) {
    const v = data[i];
    hist[v < 0 ? 0 : v > 255 ? 255 : Math.round(v)] += 1;
  }
  // The 95th percentile stands in for the paper/background level. Using the max instead
  // would let a single specular highlight (glare off a phone flash) define "paper" and
  // drag the ink threshold up with it.
  const target = n * 0.95;
  let seen = 0;
  let paper = 255;
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen >= target) {
      paper = v;
      break;
    }
  }
  const cutoff = paper * INK_RATIO;
  let ink = 0;
  for (let v = 0; v < 256 && v < cutoff; v++) ink += hist[v];
  return ink / n;
}

export type QualityReason = 'blurry' | 'low-contrast' | 'no-text-found';

export interface QualityVerdict {
  ok: boolean;
  blur: number;
  contrast: number;
  ink: number;
  reasons: QualityReason[];
}

export interface QualityThresholds {
  blur: number;
  contrast: number;
  ink: number;
}

// Heuristic defaults — still to be tuned against a corpus of real phone photos (H4 caveat).
// `ink` is deliberately LOW. Its job is to catch "there is no document in this frame at all"
// (blank wall, finger over the lens, report out of shot), which scores exactly 0; it is not
// meant to judge how much text a report has, since a short report is legitimately sparse.
// Blur and contrast do the work of catching a degraded-but-present document, and they are
// unchanged — the user-reported false positive came only from the coverage check.
export const QUALITY_THRESHOLDS: QualityThresholds = { blur: 100, contrast: 18, ink: 0.005 };

export function assessQuality(img: GrayImage, t: QualityThresholds = QUALITY_THRESHOLDS): QualityVerdict {
  const blur = laplacianVariance(img);
  const contrast = contrastStdDev(img);
  const ink = inkCoverage(img);
  const reasons: QualityReason[] = [];
  if (blur < t.blur) reasons.push('blurry');
  if (contrast < t.contrast) reasons.push('low-contrast');
  if (ink < t.ink) reasons.push('no-text-found');
  return { ok: reasons.length === 0, blur, contrast, ink, reasons };
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
  // Reworded with the metric: the old copy ("move closer so the report fills the frame") was
  // advice for a framing problem, but the check now fires only when NO printed text is found
  // at all — so the useful instruction is to point the camera at the report, not to zoom in.
  'no-text-found': {
    en: 'We couldn’t find printed text — make sure the report is in the frame and in focus.',
    zh: '未能识别到打印文字——请确保报告在画面内并已对焦。',
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
