import { describe, it, expect } from 'vitest';
import { computeTargetSize } from './downscaleImage';

describe('computeTargetSize', () => {
  it('does not upscale small images', () => {
    expect(computeTargetSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
  it('scales the long edge down to maxEdge, preserving aspect', () => {
    expect(computeTargetSize(3200, 2400, 1600)).toEqual({ width: 1600, height: 1200 });
  });
  it('handles portrait orientation', () => {
    expect(computeTargetSize(2400, 3200, 1600)).toEqual({ width: 1200, height: 1600 });
  });
});
