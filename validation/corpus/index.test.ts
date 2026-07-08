import { describe, it, expect } from 'vitest';
import { CORPUS } from './index';

describe('corpus enrichment', () => {
  it('includes the adversarial trap families with unique ids', () => {
    const ids = CORPUS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((i) => i.startsWith('unit-trap-'))).toBe(true);
    expect(ids.some((i) => i.startsWith('unknown-analyte-'))).toBe(true);
  });

  it('every new trap case is gold-abstain', () => {
    const traps = CORPUS.filter((c) => c.id.startsWith('unit-trap-') || c.id.startsWith('unknown-analyte-'));
    expect(traps.length).toBeGreaterThan(0);
    for (const c of traps) expect(c.shouldAbstain).toBe(true);
  });
});
