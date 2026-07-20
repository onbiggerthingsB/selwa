import { describe, it, expect } from 'vitest';
import { MEDREPBENCH_SAMPLE } from './sample';
import { MIMIC_US_SAMPLE } from './us-sample';
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

  it('SAFETY GATE: no confidently-wrong row on real content (a disagreement must be protected, never silent)', () => {
    // This is the gate for coverage work: widening recognition may raise the abstain-rate
    // floor and add protected disagreements, but must NEVER produce a row we present
    // confidently (neither confirmation nor internal review) that disagrees with the report.
    const s = scoreRealCorpus(MEDREPBENCH_SAMPLE);
    expect(s.confidentlyWrong).toHaveLength(0);
    expect(s.confidentAgreement).toBe(1);
  });

  it('SAFETY GATE (US beachhead / MIMIC-IV demo): no confidently-wrong row on real US content', () => {
    const s = scoreRealCorpus(MIMIC_US_SAMPLE);
    expect(s.items).toBeGreaterThan(200);
    expect(s.confidentlyWrong).toHaveLength(0);
    expect(s.confidentAgreement).toBe(1);
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

  it('the AST band disagreement is internally reviewed (safe), not a silent wrong call', () => {
    // 谷草转氨酶 11 U/L printed 2-40: our band floor > 11 → we say low; R11 must route to review
    // without adding an editable field to the OCR-framed user confirmation screen.
    const s = scoreRealCorpus([
      { image: 'ast-probe', kind: 'probe', items: [{ item_name: '谷草转氨酶', item_value: '11', item_unit: 'U/L', item_range: '2-40', is_abnormal: '0' }] },
    ]);
    expect(s.classified).toBe(1);
    expect(s.confirmRate).toBe(0);
    expect(s.classifiedDetail[0].needsConfirm).toBe(false);
    expect(s.classifiedDetail[0].needsReview).toBe(true);
    expect(s.confidentlyWrong).toHaveLength(0);
  });
});
