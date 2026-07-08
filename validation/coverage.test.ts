import { describe, it, expect } from 'vitest';
import { riskCoveragePoint, riskCoverageCurve, aurc, type SelectiveCase, type ScoredSelectiveCase } from './coverage';

describe('risk-coverage', () => {
  it('point: coverage = emitted/N, selectiveRisk = errors/emitted', () => {
    const cases: SelectiveCase[] = [
      { emitted: true, error: false },
      { emitted: true, error: true },
      { emitted: false, error: false }, // abstained → not covered, not an emitted error
      { emitted: true, error: false },
    ];
    const p = riskCoveragePoint(cases);
    expect(p.coverage).toBeCloseTo(3 / 4, 6);
    expect(p.selectiveRisk).toBeCloseTo(1 / 3, 6);
  });

  it('point: nothing emitted → coverage 0, selectiveRisk NaN', () => {
    const p = riskCoveragePoint([{ emitted: false, error: false }]);
    expect(p.coverage).toBe(0);
    expect(Number.isNaN(p.selectiveRisk)).toBe(true);
  });

  it('curve: abstaining the lowest-confidence errors first lowers risk as coverage falls', () => {
    // Higher score = more trustworthy. Errors sit at the low-score end.
    const cases: ScoredSelectiveCase[] = [
      { score: 0.1, error: true },
      { score: 0.2, error: true },
      { score: 0.8, error: false },
      { score: 0.9, error: false },
    ];
    const curve = riskCoverageCurve(cases);
    expect(curve[curve.length - 1].coverage).toBeCloseTo(1, 6);   // cover everything
    expect(curve[curve.length - 1].risk).toBeCloseTo(0.5, 6);     // 2/4 errors
    // At 50% coverage (keep the two highest scores) risk should be 0.
    const half = curve.find((pt) => Math.abs(pt.coverage - 0.5) < 1e-9)!;
    expect(half.risk).toBeCloseTo(0, 6);
    // A perfectly-ordered signal has AURC < the flat-risk rectangle (0.5).
    expect(aurc(curve)).toBeLessThan(0.5);
  });
});
