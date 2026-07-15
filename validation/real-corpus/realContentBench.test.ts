import { describe, it, expect } from 'vitest';
import { MEDREPBENCH_SAMPLE } from './sample';
import { splitCorpus } from './corpus';
import { scoreRealCorpus } from './realContentBench';

describe('real-content grounding harness', () => {
  it('scores the committed sample and returns sane numbers', () => {
    const s = scoreRealCorpus(MEDREPBENCH_SAMPLE);
    expect(s.items).toBeGreaterThan(100);
    expect(s.abstainRate).toBeGreaterThan(0);
    expect(s.abstainRate).toBeLessThanOrEqual(1);
    expect(s.classified).toBeGreaterThan(0);
    // abstained + classified partition all rows
    expect(s.abstained + s.classified).toBe(s.items);
    // agreement is a real fraction over a non-empty scored set
    expect(s.agreementScored).toBeGreaterThan(0);
    expect(s.agreement).toBeGreaterThanOrEqual(0);
    expect(s.agreement).toBeLessThanOrEqual(1);
  });

  it('split is deterministic, disjoint, and total', () => {
    const a = splitCorpus(MEDREPBENCH_SAMPLE);
    const b = splitCorpus(MEDREPBENCH_SAMPLE);
    expect(a.train.map((r) => r.image)).toEqual(b.train.map((r) => r.image)); // reproducible
    expect(a.train.length + a.heldout.length).toBe(MEDREPBENCH_SAMPLE.length); // total
    const heldoutSet = new Set(a.heldout.map((r) => r.image));
    expect(a.train.some((r) => heldoutSet.has(r.image))).toBe(false); // disjoint
    expect(a.heldout.length).toBeGreaterThan(0);
  });

  it('the AST band disagreement is confirm-flagged (safe), not a silent wrong call', () => {
    // 谷草转氨酶 11 U/L printed 2-40: our band floor > 11 → we say low; R11 must route to confirm.
    const s = scoreRealCorpus([
      { image: 'ast-probe', kind: 'probe', items: [{ item_name: '谷草转氨酶', item_value: '11', item_unit: 'U/L', item_range: '2-40', is_abnormal: '0' }] },
    ]);
    expect(s.classified).toBe(1);
    expect(s.confirmRate).toBe(1); // the disagreeing row is sent to confirm
  });
});
