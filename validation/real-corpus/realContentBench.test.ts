import { describe, it, expect } from 'vitest';
import { groundExtraction } from '@/lib/grounding';
import { resolveText } from '@/lib/i18n';
import { buildSummary } from '@/lib/summary';
import { MEDREPBENCH_SAMPLE } from './sample';
import { MIMIC_US_SAMPLE } from './us-sample';
import { LHASA_FIELD_SAMPLE } from './field-lhasa';
import { splitCorpus } from './corpus';
import { scoreRealCorpus } from './realContentBench';

function fieldChip(itemName: string): string {
  const item = LHASA_FIELD_SAMPLE[0].items.find((candidate) => candidate.item_name === itemName);
  if (!item) throw new Error(`Missing Lhasa field fixture row: ${itemName}`);
  const report = groundExtraction(
    {
      rows: [
        {
          name: item.item_name,
          value: item.item_value,
          unit: item.item_unit,
          printedRange: item.item_range,
          confidence: 'high',
        },
      ],
    },
    'unknown',
  );
  return resolveText(buildSummary(report, 'en').sections[0].chip, 'en').text;
}

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

describe('de-identified Lhasa CBC+CRP grounding regression', () => {
  it('locks the measured field-report coverage and report-relative chip safety', () => {
    const s = scoreRealCorpus(LHASA_FIELD_SAMPLE);
    expect(s.reports).toBe(1);
    expect(s.items).toBe(27);
    // 17 -> 18 on 2026-07-26: 嗜碱性粒细胞百分比 gained a curated alias. The differential
    // percentage family carried 百分比 on four of five siblings and not on basophils, so an
    // abnormal basophil result went unexplained. The safety metrics below are unchanged, which
    // is the point: recognition went up and nothing about the displayed comparison moved.
    // 18 -> 26 on 2026-07-26: the differential absolutes and platelet indices this report prints
    // are now curated. Every safety figure below is unchanged, which is the point — recognition
    // rose and nothing about the displayed comparison moved.
    expect(s.recognized).toBe(26);
    expect(s.classified).toBe(26);
    expect(s.abstained).toBe(1);
    expect(s.chipScorable).toBe(27);
    expect(s.chipCorrect).toBe(27);
    expect(s.chipAbstained).toBe(0);
    expect(s.chipWrong).toBe(0);
    expect(s.chipWrongDetail).toEqual([]);
    expect(s.confidentlyWrong).toEqual([]);
  });

  it.each([
    ['嗜酸性粒细胞绝对值', 'Below your report’s range'],
    ['嗜酸性粒细胞百分比', 'Below your report’s range'],
    ['C反应蛋白', 'Above your report’s range'],
    ['超敏C反应蛋白', 'Above your report’s range'],
  ] as const)('%s reproduces the printed flag in the correct direction', (itemName, expectedChip) => {
    const item = LHASA_FIELD_SAMPLE[0].items.find((candidate) => candidate.item_name === itemName);
    expect(item).toBeDefined();
    const s = scoreRealCorpus([
      {
        image: `field-flag-probe-${itemName}`,
        kind: 'field-lhasa-flag-probe',
        items: [item!],
      },
    ]);
    expect(s.chipScorable).toBe(1);
    expect(s.chipCorrect).toBe(1);
    expect(s.chipAbstained).toBe(0);
    expect(s.chipWrong).toBe(0);
    expect(fieldChip(itemName)).toBe(expectedChip);
  });
});
