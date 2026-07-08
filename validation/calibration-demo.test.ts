import { describe, it, expect } from 'vitest';
import { CALIBRATION_DEMO } from './calibration-demo';
import { expectedCalibrationError } from './calibration';

describe('CALIBRATION_DEMO', () => {
  it('is a labelled advisory-signal set with scores in [0,1]', () => {
    expect(CALIBRATION_DEMO.length).toBeGreaterThanOrEqual(10);
    for (const c of CALIBRATION_DEMO) {
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(1);
      expect(typeof c.correct).toBe('boolean');
    }
  });
  it('is intentionally miscalibrated (overconfident) to exercise ECE > 0', () => {
    expect(expectedCalibrationError(CALIBRATION_DEMO, 10)).toBeGreaterThan(0);
  });
});
