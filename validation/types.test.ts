import { describe, it, expect } from 'vitest';
import { CorpusCaseSchema, totalImmutables } from './types';
import { CORPUS } from './corpus';

describe('corpus cases', () => {
  it('every case validates against CorpusCaseSchema', () => {
    for (const c of CORPUS) {
      expect(() => CorpusCaseSchema.parse(c)).not.toThrow();
    }
  });

  it('has at least 12 cases', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(12);
  });

  it('has unique ids', () => {
    const ids = CORPUS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('highStakes covers the dropped-negation / dose / drug families', () => {
    const highStakesReasons = new Set(
      CORPUS.filter((c) => c.highStakes && c.abstainReason).map((c) => c.abstainReason),
    );
    expect(highStakesReasons).toContain('dropped_negation');
    expect(highStakesReasons).toContain('dose_mismatch');
    expect(highStakesReasons).toContain('drug_ambiguous');
  });

  it('spans every failure family + a unit-conversion trap', () => {
    const reasons = new Set(CORPUS.map((c) => c.abstainReason).filter(Boolean));
    expect(reasons).toContain('dropped_negation');
    expect(reasons).toContain('dose_mismatch');
    expect(reasons).toContain('drug_ambiguous');
    expect(reasons).toContain('number_unit_mismatch');
    expect(reasons).toContain('unit_conversion_ambiguous');
  });

  it('includes several faithful should-NOT-abstain cases', () => {
    const faithful = CORPUS.filter((c) => !c.shouldAbstain);
    expect(faithful.length).toBeGreaterThanOrEqual(4);
  });

  it('every should-abstain case carries an abstainReason', () => {
    for (const c of CORPUS) {
      if (c.shouldAbstain) expect(c.abstainReason).toBeDefined();
    }
  });

  it('totalImmutables sums every immutable family', () => {
    const c = CORPUS.find((x) => x.id === 'dose-01-magnitude-metformin')!;
    // 1 dosage + 1 drug + 1 number = 3
    expect(totalImmutables(c)).toBe(3);
  });
});
