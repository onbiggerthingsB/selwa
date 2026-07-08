import { describe, it, expect } from 'vitest';
import { agreementStats, type BooleanVerdictPair } from './agreement';

describe('agreementStats', () => {
  it('perfect agreement → raw 1, all coefficients 1', () => {
    const pairs: BooleanVerdictPair[] = [
      { a: true, b: true }, { a: false, b: false }, { a: true, b: true },
    ];
    const s = agreementStats(pairs);
    expect(s.rawAgreement).toBe(1);
    expect(s.cohensKappa).toBeCloseTo(1, 6);
    expect(s.gwetAC1).toBeCloseTo(1, 6);
    expect(s.pabak).toBeCloseTo(1, 6);
  });

  it('the kappa paradox: high raw agreement on a skewed class deflates kappa; AC1/PABAK stay high', () => {
    // 90 agree-negative, 2 agree-positive, 8 disagree (4 each way) over N=100.
    // Marginals aPos=bPos=6 → pA=pB=0.06 (extreme skew). Raw agreement 0.92, yet
    // Cohen's kappa collapses to ~0.291 while Gwet's AC1 (~0.910) and PABAK (0.84) hold.
    const pairs: BooleanVerdictPair[] = [
      ...Array.from({ length: 90 }, () => ({ a: false, b: false })),
      ...Array.from({ length: 2 }, () => ({ a: true, b: true })),
      ...Array.from({ length: 4 }, () => ({ a: true, b: false })),
      ...Array.from({ length: 4 }, () => ({ a: false, b: true })),
    ];
    const s = agreementStats(pairs);
    expect(s.rawAgreement).toBeCloseTo(0.92, 6);
    expect(s.cohensKappa).toBeLessThan(0.5);   // paradox: kappa ≈ 0.291, looks poor
    expect(s.gwetAC1).toBeGreaterThan(0.9);    // paradox-resistant ≈ 0.910
    expect(s.pabak).toBeCloseTo(0.84, 6);      // 2·0.92 − 1
    expect(s.prevalence).toBeCloseTo(0.06, 6); // (0.06 + 0.06) / 2
  });

  it('empty → all NaN', () => {
    const s = agreementStats([]);
    expect(Number.isNaN(s.rawAgreement)).toBe(true);
    expect(Number.isNaN(s.gwetAC1)).toBe(true);
  });
});
