// On-device redaction — data minimization before the transfer (beachhead memo: "strip the
// patient name/MRN from the payload before sending the image for OCR where feasible").
//
// WHY USER-GUIDED, not automatic: finding the name automatically would require OCR-ing the
// image — the very cloud call we are trying to minimize. On-device OCR is a large lift with
// poor Chinese accuracy, so the honest feasible version is to let the person cover their own
// identifiers. The boxes are burned into the PIXELS here, on-device, so the un-redacted
// original never leaves the phone.
//
// Serves both the US minimization duty (CCPA/WA MHMDA) and the convergent PIPL path
// (de-identify before any US call). Optional by design — consent already covers the transfer.

/** A redaction box in NORMALIZED image coords (0..1), so it survives display scaling. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Build a normalized rect from a drag between two points inside a box of the given size.
 * Handles a drag in ANY direction (up-left, down-right, …) and clamps to the image, so a
 * drag that runs off the edge still yields a valid box.
 */
export function rectFromDrag(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  boxW: number,
  boxH: number,
): Rect {
  if (boxW <= 0 || boxH <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const x1 = clamp01(Math.min(ax, bx) / boxW);
  const y1 = clamp01(Math.min(ay, by) / boxH);
  const x2 = clamp01(Math.max(ax, bx) / boxW);
  const y2 = clamp01(Math.max(ay, by) / boxH);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Ignore accidental taps — a box must cover a meaningful area to count as a redaction. */
export function isMeaningful(r: Rect): boolean {
  return r.w > 0.01 && r.h > 0.01;
}

/** Convert normalized rects to pixel rects against a real image size. */
export function toPixelRects(rects: Rect[], width: number, height: number): Rect[] {
  return rects.map((r) => ({ x: r.x * width, y: r.y * height, w: r.w * width, h: r.h * height }));
}

/** Discriminated so the caller CANNOT accidentally treat a failure as a redacted image. */
export type RedactResult = { ok: true; blob: Blob } | { ok: false; reason: 'no-canvas' | 'decode-failed' | 'encode-failed' };

/**
 * Burn opaque black boxes into the image and return a NEW blob. The redacted pixels are
 * DESTROYED (not an overlay), so what is sent cannot be un-redacted.
 *
 * FAILS CLOSED. This used to `return src` on any failure — "never block the user on a redaction
 * failure" — which was exactly backwards: the caller then treated the ORIGINAL as redacted,
 * cleared the boxes, and could transmit it, while the consent screen promised "only the covered
 * version leaves your phone". A redaction primitive must never hand back the bytes it was asked
 * to destroy. If boxes were requested and we cannot burn them in, that is an ERROR — the caller
 * must keep the user on the redaction screen, not send the original.
 *
 * Passing the source through is correct ONLY when nothing meaningful was asked to be covered.
 */
export async function applyRedactions(src: Blob, rects: Rect[]): Promise<RedactResult> {
  const boxes = rects.filter(isMeaningful);
  if (boxes.length === 0) return { ok: true, blob: src }; // nothing requested — src is untouched by design
  try {
    const bitmap = await createImageBitmap(src);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, reason: 'no-canvas' };
    ctx.drawImage(bitmap, 0, 0);
    ctx.fillStyle = '#000';
    for (const r of toPixelRects(boxes, bitmap.width, bitmap.height)) ctx.fillRect(r.x, r.y, r.w, r.h);
    const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
    if (!out) return { ok: false, reason: 'encode-failed' };
    return { ok: true, blob: out };
  } catch {
    return { ok: false, reason: 'decode-failed' };
  }
}
