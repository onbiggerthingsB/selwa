// GATES ON THE INDEPENDENT-LABEL METRICS (Codex should-fix #7).
//
// These lock the two properties that make the measurement honest. They are not about any single
// analyte — they are about the METRIC not sliding back into grading itself, which is how the
// 80%-vs-27% illusion survived this long.

import { describe, it, expect } from 'vitest';
import { scoreRealCorpus } from './real-corpus/realContentBench';
import { GOLD_LABELS, goldFor } from './real-corpus/gold-labels';
import { MIMIC_US_SAMPLE } from './real-corpus/us-sample';
import { MEDREPBENCH_SAMPLE } from './real-corpus/sample';

const US = scoreRealCorpus(MIMIC_US_SAMPLE);
const ZH = scoreRealCorpus(MEDREPBENCH_SAMPLE);

describe('chip vs the report’s own flag — an independent label', () => {
  // The chip claims to reproduce the report's own comparison. `is_abnormal` IS the report's own
  // comparison, and it is externally authored, so this is a real correctness gate rather than a
  // restatement of our own table. A contradiction here is a user-visible wrong assertion.
  for (const [name, s] of [['MIMIC (US beachhead)', US], ['MedRepBench (ZH)', ZH]] as const) {
    it(`${name}: no chip contradicts the report’s own flag`, () => {
      expect(s.chipWrong, `chip contradicts the report:\n${s.chipWrongDetail.join('\n')}`).toBe(0);
    });
    it(`${name}: the independent chip metric actually scores rows`, () => {
      expect(s.chipScorable).toBeGreaterThan(50); // a gate that scores nothing proves nothing
    });
  }

  it('accuracy is over ALL answerable rows, so abstaining cannot inflate it', () => {
    // The defining anti-gaming property: correct + wrong + abstained must exhaust the scorable set.
    // If a future refactor divided by "rows we chose to answer", deferring would raise the score
    // and this identity would break.
    for (const s of [US, ZH]) {
      expect(s.chipCorrect + s.chipWrong + s.chipAbstained).toBe(s.chipScorable);
      expect(s.chipAccuracy).toBeCloseTo(s.chipCorrect / s.chipScorable, 10);
    }
  });
});

describe('analyte-confirm coverage is graded against labels we do not control', () => {
  it('gold labels cover every row name in both corpora', () => {
    const missing = new Set<string>();
    for (const corpus of [MIMIC_US_SAMPLE, MEDREPBENCH_SAMPLE])
      for (const rep of corpus)
        for (const it of rep.items) if (!goldFor(it.item_name)) missing.add(it.item_name.trim());
    // An unlabelled row silently leaves the gold denominator — the exact failure mode being fixed.
    expect([...missing], `rows with no gold label:\n${[...missing].join('\n')}`).toEqual([]);
  });

  it('the gold denominator is not our own table in disguise', () => {
    // The whole point: unrecognised high-stakes rows must STAY in the denominator. If the gold
    // denominator ever collapses to the self-graded one, independence has been lost.
    expect(US.goldHighStakesRows).toBeGreaterThan(US.recognizedHighStakesRows);
    expect(ZH.goldHighStakesRows).toBeGreaterThan(ZH.recognizedHighStakesRows);
  });

  it('reports the unprotected high-stakes analytes as an actionable work list', () => {
    // This list is currently NON-EMPTY and that is the honest state of the system — it is the
    // finding, not a failure. The gate is that the list is actually computed and that every entry
    // is genuinely unrecognised, so it can't quietly become decorative.
    expect(US.goldHighStakesUnrecognized.length).toBeGreaterThan(0);
    for (const n of US.goldHighStakesUnrecognized) {
      const g = goldFor(n);
      expect(g?.kind).toBe('analyte');
      expect(g?.highStakes).toBe(true);
    }
  });

  it('separates non-analytes so declining them is not scored as a coverage miss', () => {
    // Ventilator settings, specimen metadata and opaque codes are not lab results; abstaining on
    // them is correct behaviour and must not be counted against coverage.
    expect(US.goldNonAnalyteRows).toBeGreaterThan(0);
    expect(GOLD_LABELS.some((g) => g.kind === 'non-analyte')).toBe(true);
    for (const g of GOLD_LABELS) if (g.kind === 'non-analyte') expect(g.highStakes).toBe(false);
  });
});
