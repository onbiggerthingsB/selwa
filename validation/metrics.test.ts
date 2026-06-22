import { describe, it, expect } from 'vitest';
import { medicalTermFidelity, abstentionPrecision, abstentionRecall } from './metrics';

// 3 cases, gold shouldAbstain = [true, true, false]
const gold = [
  { id: '1', shouldAbstain: true, highStakes: true, immutables: 2 },
  { id: '2', shouldAbstain: true, highStakes: true, immutables: 3 },
  { id: '3', shouldAbstain: false, highStakes: false, immutables: 1 },
];

describe('abstention metrics (ours vs baseline)', () => {
  it('ours: abstains on 1 and 2, emits 3 → precision 1.0, recall 1.0', () => {
    const ours = [
      { id: '1', abstained: true, matchedImmutables: 0, emitted: false },
      { id: '2', abstained: true, matchedImmutables: 0, emitted: false },
      { id: '3', abstained: false, matchedImmutables: 1, emitted: true },
    ];
    expect(abstentionPrecision(ours, gold)).toBe(1);
    expect(abstentionRecall(ours, gold)).toBe(1);
    expect(medicalTermFidelity(ours, gold)).toBe(1); // term-weighted over emitted cases (case 3): 1/1
  });

  it('baseline emits everything → recall 0.0, fidelity 5/6 ≈ 0.83', () => {
    const base = [
      { id: '1', abstained: false, matchedImmutables: 1, emitted: true }, // dropped negation: 1/2
      { id: '2', abstained: false, matchedImmutables: 3, emitted: true },
      { id: '3', abstained: false, matchedImmutables: 1, emitted: true },
    ];
    expect(abstentionRecall(base, gold)).toBe(0);
    expect(medicalTermFidelity(base, gold)).toBeCloseTo(5 / 6, 3);
  });
});

describe('undefined denominators report NaN, never 1.0', () => {
  it('precision is NaN when nothing abstained (|A| = 0)', () => {
    const none = [
      { id: '1', abstained: false, matchedImmutables: 1, emitted: true },
      { id: '3', abstained: false, matchedImmutables: 1, emitted: true },
    ];
    expect(Number.isNaN(abstentionPrecision(none, gold))).toBe(true);
  });

  it('recall is NaN when no case should abstain (|G| = 0)', () => {
    const goldNoneAbstain = [{ id: '3', shouldAbstain: false, highStakes: false, immutables: 1 }];
    const results = [{ id: '3', abstained: false, matchedImmutables: 1, emitted: true }];
    expect(Number.isNaN(abstentionRecall(results, goldNoneAbstain))).toBe(true);
  });

  it('fidelity is NaN when no case was emitted', () => {
    const allAbstain = [
      { id: '1', abstained: true, matchedImmutables: 0, emitted: false },
      { id: '2', abstained: true, matchedImmutables: 0, emitted: false },
    ];
    expect(Number.isNaN(medicalTermFidelity(allAbstain, gold))).toBe(true);
  });
});

describe('high-stakes recall is reported separately', () => {
  it('a missed abstention on a highStakes case drops highStakes recall below 1.0', () => {
    const gold2 = [
      { id: '1', shouldAbstain: true, highStakes: true, immutables: 2 },
      { id: '2', shouldAbstain: true, highStakes: false, immutables: 3 },
    ];
    const results = [
      { id: '1', abstained: false, matchedImmutables: 1, emitted: true }, // MISSED highStakes
      { id: '2', abstained: true, matchedImmutables: 0, emitted: false },
    ];
    // Overall recall: 1 of 2 gold-abstain caught = 0.5
    expect(abstentionRecall(results, gold2)).toBe(0.5);
    // High-stakes recall: 0 of 1 highStakes gold-abstain caught = 0.0 (release blocker)
    expect(abstentionRecall(results, gold2, { highStakesOnly: true })).toBe(0);
  });

  it('highStakes recall is NaN when there are no highStakes gold-abstain cases', () => {
    const gold2 = [{ id: '2', shouldAbstain: true, highStakes: false, immutables: 3 }];
    const results = [{ id: '2', abstained: true, matchedImmutables: 0, emitted: false }];
    expect(Number.isNaN(abstentionRecall(results, gold2, { highStakesOnly: true }))).toBe(true);
  });
});

describe('medical-term fidelity excludes |I_src| = 0 cases', () => {
  it('a case with zero immutables is not counted in the denominator', () => {
    const gold2 = [
      { id: '1', shouldAbstain: false, highStakes: false, immutables: 0 }, // excluded
      { id: '2', shouldAbstain: false, highStakes: false, immutables: 4 },
    ];
    const results = [
      { id: '1', abstained: false, matchedImmutables: 0, emitted: true },
      { id: '2', abstained: false, matchedImmutables: 2, emitted: true }, // 2/4
    ];
    // Only case 2 counts: 2 matched / 4 total = 0.5
    expect(medicalTermFidelity(results, gold2)).toBe(0.5);
  });
});
