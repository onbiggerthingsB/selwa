// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { rectFromDrag, isMeaningful, toPixelRects, applyRedactions } from './redact';

// FAIL-CLOSED (Codex blocker #3). applyRedactions used to `return src` on ANY failure —
// canvas unavailable, decode error, encode error. The caller then renamed that blob 'lab.jpg',
// cleared the boxes, and could SEND IT: the un-redacted original leaving the device while the
// consent screen promised "only the covered version leaves your phone". A redaction primitive
// must never hand back the bytes it was asked to destroy.
describe('redact — fails CLOSED, never returns the un-redacted original', () => {
  const box = [{ x: 0.1, y: 0.1, w: 0.5, h: 0.2 }];
  const src = new Blob(['not-a-real-image'], { type: 'image/jpeg' });

  it('returns an ERROR (not the source) when redaction cannot be performed', async () => {
    // jsdom has no canvas backend → the real failure path.
    const res = await applyRedactions(src, box);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBeTruthy();
    // the crucial property: no path yields the original bytes while boxes were requested
    expect((res as { blob?: Blob }).blob).toBeUndefined();
  });

  it('when NOTHING was asked to be covered, passing the source through is correct', async () => {
    const res = await applyRedactions(src, []);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.blob).toBe(src);
  });

  it('an accidental tap is not a redaction request — source passes through', async () => {
    const res = await applyRedactions(src, [{ x: 0.5, y: 0.5, w: 0.001, h: 0.001 }]);
    expect(res.ok).toBe(true);
  });
});

// Rects are floats, so compare field-wise with tolerance.
const expectRect = (r: { x: number; y: number; w: number; h: number }, x: number, y: number, w: number, h: number) => {
  expect(r.x).toBeCloseTo(x, 6);
  expect(r.y).toBeCloseTo(y, 6);
  expect(r.w).toBeCloseTo(w, 6);
  expect(r.h).toBeCloseTo(h, 6);
};

describe('redact — drag → normalized rect', () => {
  it('normalizes a top-left → bottom-right drag against the display box', () => {
    // x 50→150 of 200 = 0.25 wide→0.75; y 20→60 of 100 = 0.2→0.6
    expectRect(rectFromDrag(50, 20, 150, 60, 200, 100), 0.25, 0.2, 0.5, 0.4);
  });

  it('handles a REVERSED drag (bottom-right → top-left) identically', () => {
    expectRect(rectFromDrag(150, 60, 50, 20, 200, 100), 0.25, 0.2, 0.5, 0.4);
  });

  it('clamps a drag that runs off the edges', () => {
    const r = rectFromDrag(-40, -10, 400, 300, 200, 100);
    expect(r).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('is safe against a zero-sized display box', () => {
    expect(rectFromDrag(0, 0, 10, 10, 0, 0)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe('redact — meaningfulness + pixel mapping', () => {
  it('an accidental tap is not a redaction; a real box is', () => {
    expect(isMeaningful({ x: 0.5, y: 0.5, w: 0.001, h: 0.001 })).toBe(false);
    expect(isMeaningful({ x: 0.1, y: 0.1, w: 0.3, h: 0.05 })).toBe(true);
  });

  it('maps normalized rects onto the real image size (survives display scaling)', () => {
    expect(toPixelRects([{ x: 0.25, y: 0.2, w: 0.5, h: 0.2 }], 1000, 500)).toEqual([
      { x: 250, y: 100, w: 500, h: 100 },
    ]);
  });
});
