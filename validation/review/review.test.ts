import { describe, it, expect } from 'vitest';
import { toReviewRows, toReviewCsv, toReviewJson } from './export';
import { applyVerdicts, parseVerdictJson } from './import';
import type { CorpusCase } from '../types';

const CASES: CorpusCase[] = [
  {
    id: 'rv-1',
    lang: 'zh',
    kind: 'notes',
    sourceText: '未见占位, 需要复查',
    goldTranslation: 'No mass seen; follow-up needed.',
    immutables: { negations: ['未见 占位'], dosages: [], drugs: [], numbers: [] },
    shouldAbstain: false,
    highStakes: false,
  },
];

describe('review export', () => {
  it('exports rows a reviewer can label', () => {
    const rows = toReviewRows(CASES);
    expect(rows[0].id).toBe('rv-1');
    expect(rows[0].shouldAbstain).toBe('false');
  });

  it('CSV-escapes fields with commas/quotes', () => {
    const csv = toReviewCsv(CASES);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('id,lang,kind,sourceText');
    // sourceText contains a comma → must be quoted.
    expect(lines[1]).toContain('"未见占位, 需要复查"');
  });

  it('round-trips through JSON', () => {
    const json = toReviewJson(CASES);
    const parsed = parseVerdictJson(json);
    expect(parsed[0].id).toBe('rv-1');
  });
});

describe('review import (fold verdicts back)', () => {
  it('overrides shouldAbstain/highStakes/abstainReason from a verdict', () => {
    const verdicts = [
      {
        id: 'rv-1',
        lang: 'zh',
        kind: 'notes',
        sourceText: '未见占位, 需要复查',
        goldTranslation: 'No space-occupying lesion seen; repeat imaging advised.',
        shouldAbstain: 'true',
        highStakes: 'true',
        abstainReason: 'dropped_negation',
      },
    ];
    const updated = applyVerdicts(CASES, verdicts);
    expect(updated[0].shouldAbstain).toBe(true);
    expect(updated[0].highStakes).toBe(true);
    expect(updated[0].abstainReason).toBe('dropped_negation');
    expect(updated[0].goldTranslation).toContain('repeat imaging');
  });

  it('clears abstainReason when a verdict sets shouldAbstain=false', () => {
    const verdicts = [
      {
        id: 'rv-1',
        lang: 'zh',
        kind: 'notes',
        sourceText: '未见占位, 需要复查',
        goldTranslation: '',
        shouldAbstain: 'false',
        highStakes: 'false',
        abstainReason: 'dropped_negation', // ignored because shouldAbstain=false
      },
    ];
    const updated = applyVerdicts(CASES, verdicts);
    expect(updated[0].shouldAbstain).toBe(false);
    expect(updated[0].abstainReason).toBeUndefined();
  });

  it('passes cases through unchanged when no verdict matches', () => {
    const updated = applyVerdicts(CASES, []);
    expect(updated[0]).toEqual(CASES[0]);
  });

  it('ignores an invalid abstainReason value', () => {
    const verdicts = [
      {
        id: 'rv-1',
        lang: 'zh',
        kind: 'notes',
        sourceText: '未见占位, 需要复查',
        goldTranslation: 'x',
        shouldAbstain: 'true',
        highStakes: 'false',
        abstainReason: 'not_a_real_reason',
      },
    ];
    const updated = applyVerdicts(CASES, verdicts);
    // Falls back to the existing reason (undefined here), never crashes.
    expect(updated[0].abstainReason).toBeUndefined();
  });
});
