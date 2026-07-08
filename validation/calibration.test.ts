import { describe, it, expect } from 'vitest';
import { reliabilityBins, expectedCalibrationError, type ScoredCase } from './calibration';

describe('calibration', () => {
  it('perfect calibration → ECE 0', () => {
    // 10 cases at score 0.9 where exactly 9 are correct; one bin.
    const cases: ScoredCase[] = Array.from({ length: 10 }, (_, i) => ({ score: 0.9, correct: i < 9 }));
    expect(expectedCalibrationError(cases, 1)).toBeCloseTo(Math.abs(0.9 - 0.9), 6);
  });

  it('overconfident signal → positive ECE', () => {
    // score 0.9 but only half correct → |0.5 − 0.9| = 0.4
    const cases: ScoredCase[] = Array.from({ length: 10 }, (_, i) => ({ score: 0.9, correct: i < 5 }));
    expect(expectedCalibrationError(cases, 1)).toBeCloseTo(0.4, 6);
  });

  it('bins by score and reports accuracy + mean per bin', () => {
    const cases: ScoredCase[] = [
      { score: 0.1, correct: false },
      { score: 0.2, correct: false },
      { score: 0.9, correct: true },
      { score: 0.95, correct: true },
    ];
    const bins = reliabilityBins(cases, 10);
    const low = bins.find((b) => b.count > 0 && b.hi <= 0.3)!;
    const high = bins.find((b) => b.count > 0 && b.lo >= 0.9)!;
    expect(low.accuracy).toBe(0);
    expect(high.accuracy).toBe(1);
    expect(high.count).toBe(2);
  });

  it('empty input → ECE NaN', () => {
    expect(Number.isNaN(expectedCalibrationError([], 10))).toBe(true);
  });
});
