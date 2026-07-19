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

// How dark a pixel must be, RELATIVE to this frame's own paper level, to count as ink.
// Relative rather than absolute so the check survives dim light (paper at 120) and bright
// light (paper at 250) alike — an absolute cutoff mis-reads one end or the other.
//
// 0.75, NOT 0.6. The stricter 0.6 was calibrated against synthetic text ~11% of the frame,
// far denser than real print, and it rejected legitimate photos of ordinary A4 reports. The
// cause is the 400px analysis downscale in components/CaptureCard.tsx: 9-11px body text
// becomes a ~3px stroke, and antialiasing averages each stroke pixel toward the paper. A
// stroke covering ~40% of a downscaled pixel lands near 155 against paper 245 — just above a
// 0.6 cutoff (147), so it was not counted, and ink coverage collapsed to ~0.001 on a sharp,
// perfectly readable page. Measured at 400px: 9px text at 0.6 -> 0.0023 (REJECTED) vs 0.75 ->
// 0.0149 (passes). Raising the analysis resolution instead would also work but costs CPU on
// the low-end phones this gate is meant to protect.
const INK_RATIO = 0.75;

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

export type QualityReason = 'blurry' | 'no-text-found';

export interface QualityVerdict {
  ok: boolean;
  blur: number;
  ink: number;
  reasons: QualityReason[];
}

export interface QualityThresholds {
  blur: number;
  ink: number;
}

// Heuristic defaults — still to be tuned against a corpus of real phone photos (H4 caveat).
// `ink` is deliberately LOW. Its job is to catch "there is no document in this frame at all"
// (blank wall, finger over the lens, report out of shot), which scores exactly 0; it is not
// meant to judge how much text a report has, since a short report is legitimately sparse.
//
// THERE IS NO SEPARATE CONTRAST THRESHOLD, DELIBERATELY. A `low-contrast` check (global stddev
// of the whole frame) used to sit alongside this one, and it was a second, independent source of
// false rejections on real photos: any document with normal margins and line spacing — i.e.
// every real document — has text occupying a small minority of pixels, so full-frame variance is
// dominated by the paper and reads "washed out" regardless of how legible the text is. A phone
// photo with mild gradient lighting, grey (not pure-black) ink, slight blur, and JPEG compression
// scored contrast 14.1 against a threshold of 18 — REJECTED — despite being a normal photo.
//
// It is also mathematically redundant with `ink`, not just wrong: inkCoverage only counts a pixel
// once it is at least (1 - INK_RATIO) = 40% darker than the frame's own paper level. So whenever
// ink coverage passes at all, the qualifying pixels are, by construction, at least 0.4×paper below
// paper — a large paper-vs-ink gap is GUARANTEED. There is no real "ink is present but too close
// to paper to read" state left for a contrast check to catch that ink coverage does not already
// rule out. Verified: on a blank frame, a glare-washed frame, a flat-grey frame, and a frame with
// genuinely faint/washed-out ink, ink coverage independently and correctly returns 0 in every
// case (`no-text-found`), so removing contrast loses no actual protection.
// `ink` is 0.002 rather than 0.005 because the separation is TOTAL, not marginal. With no
// document in frame, no pixel can be 25% darker than that frame's own paper level, so every
// negative case measures EXACTLY 0.0000 — verified across blank, flat-grey, glare-washed,
// dark/underexposed, and faint-toner frames. Any positive threshold therefore separates them,
// which means the number's only real job is immunity to sensor/JPEG noise. Setting it low
// buys margin for faint-but-legible real photos at zero cost to rejection. Worst legitimate
// case measured (9px text, 1px blur, gradient lighting, JPEG q85): 0.0112 — 5.6x this bound.
export const QUALITY_THRESHOLDS: QualityThresholds = { blur: 100, ink: 0.002 };

export function assessQuality(img: GrayImage, t: QualityThresholds = QUALITY_THRESHOLDS): QualityVerdict {
  const blur = laplacianVariance(img);
  const ink = inkCoverage(img);
  const reasons: QualityReason[] = [];
  if (blur < t.blur) reasons.push('blurry');
  if (ink < t.ink) reasons.push('no-text-found');
  return { ok: reasons.length === 0, blur, ink, reasons };
}

/** Specific, actionable retake guidance per failed check (EN + ZH). */
export const RETAKE_GUIDANCE: Record<QualityReason, { en: string; zh: string }> = {
  blurry: {
    en: 'The photo looks blurry — hold the phone steady and tap the report to focus.',
    zh: '照片有点模糊——请拿稳手机，点击报告对焦。',
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
