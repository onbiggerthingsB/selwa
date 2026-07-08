import { describe, it, expect } from 'vitest';
import { severityWeightedFidelity, SEVERITY_WEIGHTS, type SeverityEntry } from './severity';
import type { CorpusCase } from './types';

function caseWith(immutables: CorpusCase['immutables'], highStakes = false): CorpusCase {
  return {
    id: 'c', lang: 'en', kind: 'notes', sourceText: 's', goldTranslation: 'g',
    immutables, shouldAbstain: false, highStakes,
  };
}

const NEG = (n: string) => ({ negations: [n], dosages: [], drugs: [], numbers: [] });

describe('severityWeightedFidelity', () => {
  it('is 1.0 when every immutable survives', () => {
    const c = caseWith(NEG('未见 积液'));
    const entries: SeverityEntry[] = [{ case: c, emitted: true, candidate: 'no effusion' }];
    expect(severityWeightedFidelity(entries)).toBeCloseTo(1.0, 6);
  });

  it('collapses toward 0 when a Critical immutable (negation) is dropped', () => {
    const c = caseWith(NEG('未见 积液'));
    const entries: SeverityEntry[] = [{ case: c, emitted: true, candidate: 'effusion present' }];
    expect(severityWeightedFidelity(entries)).toBe(0);
  });

  it('weights a dropped non-high-stakes number (Major) far less than a dropped negation', () => {
    const negCase = caseWith(NEG('未见 积液'));
    const numCase = caseWith({ negations: [], dosages: [], drugs: [], numbers: [{ value: '7', unit: '' }] }, false);
    const dropNeg = severityWeightedFidelity([{ case: negCase, emitted: true, candidate: 'effusion' }]);
    const dropNum = severityWeightedFidelity([{ case: numCase, emitted: true, candidate: 'nothing here' }]);
    const mixed = caseWith({ negations: ['未见 积液'], dosages: [], drugs: [], numbers: [{ value: '7', unit: '' }] }, false);
    const dropNumKeepNeg = severityWeightedFidelity([{ case: mixed, emitted: true, candidate: 'no effusion' }]); // neg survives, number dropped
    const dropNegKeepNum = severityWeightedFidelity([{ case: mixed, emitted: true, candidate: 'effusion, 7' }]); // number survives, neg dropped
    expect(dropNumKeepNeg).toBeGreaterThan(dropNegKeepNum); // losing the number hurts less than losing the negation
    expect(dropNeg).toBe(0);
    expect(dropNum).toBe(0);
  });

  it('excludes non-emitted cases and cases with no immutables; empty → NaN', () => {
    const empty = caseWith({ negations: [], dosages: [], drugs: [], numbers: [] });
    expect(Number.isNaN(severityWeightedFidelity([{ case: empty, emitted: true, candidate: 'x' }]))).toBe(true);
    expect(Number.isNaN(severityWeightedFidelity([{ case: caseWith(NEG('未见 积液')), emitted: false, candidate: '' }]))).toBe(true);
  });

  it('exposes the weight policy', () => {
    expect(SEVERITY_WEIGHTS.negations).toBe(25);
    expect(SEVERITY_WEIGHTS.numberHighStakes).toBe(25);
    expect(SEVERITY_WEIGHTS.numberDefault).toBe(5);
  });
});
