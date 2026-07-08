import { describe, it, expect } from 'vitest';
import { countMatchedByCategory } from './score';
import type { CorpusCase } from './types';

function labCase(over: Partial<CorpusCase> = {}): CorpusCase {
  return {
    id: 't', lang: 'en', kind: 'notes',
    sourceText: 'no effusion; metformin 850mg; K 4.2',
    goldTranslation: 'no effusion; metformin 850mg; K 4.2',
    immutables: {
      negations: ['未见 积液'],
      dosages: ['850mg'],
      drugs: [{ surface: 'metformin', canonicalId: 'metformin' }],
      numbers: [{ value: '4.2', unit: 'mmol/L' }],
    },
    shouldAbstain: false, highStakes: false, ...over,
  };
}

describe('countMatchedByCategory', () => {
  it('counts survivors per category against a candidate', () => {
    const c = labCase();
    const got = countMatchedByCategory(c, 'no effusion, metformin 850mg, potassium 4.2');
    expect(got).toEqual({ negations: 1, dosages: 1, drugs: 1, numbers: 1 });
  });

  it('reports a dropped drug and dropped negation', () => {
    const c = labCase();
    const got = countMatchedByCategory(c, 'potassium 4.2 with 850mg'); // no "effusion", no "metformin"
    expect(got.negations).toBe(0);
    expect(got.drugs).toBe(0);
    expect(got.dosages).toBe(1);
    expect(got.numbers).toBe(1);
  });

  it('returns all-zero for an empty candidate', () => {
    expect(countMatchedByCategory(labCase(), '')).toEqual({
      negations: 0, dosages: 0, drugs: 0, numbers: 0,
    });
  });
});
