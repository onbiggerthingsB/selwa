import { describe, expect, it } from 'vitest';
import { checkCandidate, checkModel } from './mechanicalCheck';
import { STUDY_SAMPLE } from './sample';

// Structurally-valid Tibetan building blocks (meaning is irrelevant here — these tests
// prove the CHECKER catches structural failures, not that any translation is good).
const KA = String.fromCodePoint(0x0f40);
const KHA = String.fromCodePoint(0x0f41);
const GA = String.fromCodePoint(0x0f42);
const TSHEG = String.fromCodePoint(0x0f0b);
const SHAD = String.fromCodePoint(0x0f0d);
const WORD = `${KA}${TSHEG}${KHA}`;
const WORD2 = `${GA}${TSHEG}${KA}`;

describe('ZH->BO mechanical fidelity checker', () => {
  it('passes a well-formed candidate that preserves numbers, units, and Latin tokens', () => {
    const zh = '空腹血糖 3.9-6.1 mmol/L，HbA1c 参考。';
    const bo = `${WORD} 3.9-6.1 mmol/L${TSHEG}HbA1c ${WORD2}${SHAD}`;
    const result = checkCandidate('good', zh, bo);
    expect(result.pass, JSON.stringify(result.findings)).toBe(true);
  });

  it('FAILS when a number is dropped (B1)', () => {
    const zh = '参考区间 3.9-6.1 mmol/L。';
    const bo = `${WORD} 3.9 mmol/L${SHAD}`; // 6.1 dropped
    const result = checkCandidate('drop-number', zh, bo);
    expect(result.pass).toBe(false);
    expect(result.findings.some((f) => f.check === 'B1')).toBe(true);
  });

  it('FAILS when a unit is altered (B5)', () => {
    const zh = '血糖 5.0 mmol/L。';
    const bo = `${WORD} 5.0 mg/dL${SHAD}`; // mmol/L -> mg/dL
    const result = checkCandidate('flip-unit', zh, bo);
    expect(result.pass).toBe(false);
    expect(result.findings.some((f) => f.check === 'B5')).toBe(true);
  });

  it('FAILS when Chinese characters are left in the Tibetan (A2)', () => {
    const zh = '血红蛋白。';
    const bo = `${WORD}血红蛋白${SHAD}`; // CJK stranded
    const result = checkCandidate('cjk-left', zh, bo);
    expect(result.pass).toBe(false);
    expect(result.findings.some((f) => f.check === 'A2')).toBe(true);
  });

  it('FAILS a Latin token that was corrupted (B4)', () => {
    const zh = 'D-二聚体 与 TSH。';
    const bo = `${WORD} TSH${SHAD}`; // D-dimer's "D" Latin token dropped
    const result = checkCandidate('drop-latin', zh, bo);
    expect(result.pass).toBe(false);
    expect(result.findings.some((f) => f.check === 'B4')).toBe(true);
  });

  it('reports an empty candidate as not-passed rather than silently passing', () => {
    const result = checkCandidate('empty', '血糖。', '   ');
    expect(result.pass).toBe(false);
    expect(result.findings[0].check).toBe('EMPTY');
  });

  it('checkModel aggregates pass/fail/empty over a candidate column', () => {
    const candidates = [
      { id: 'a', zh: '甲 1 mmol/L。', bo: `${WORD} 1 mmol/L${SHAD}` },
      { id: 'b', zh: '乙 2。', bo: `${WORD} 3${SHAD}` }, // wrong number -> fail
      { id: 'c', zh: '丙。', bo: '' }, // empty
    ];
    const report = checkModel('demo', candidates);
    expect(report.total).toBe(3);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(2);
    expect(report.empty).toBe(1);
  });

  it('the frozen sample is the pre-registered size and shape', () => {
    expect(STUDY_SAMPLE).toHaveLength(36);
    expect(STUDY_SAMPLE.filter((i) => i.kind === 'name')).toHaveLength(20);
    expect(STUDY_SAMPLE.filter((i) => i.kind === 'definition')).toHaveLength(10);
    expect(STUDY_SAMPLE.filter((i) => i.kind === 'note')).toHaveLength(6);
    // every source item is Chinese and non-empty
    expect(STUDY_SAMPLE.every((i) => i.zh.trim().length > 0)).toBe(true);
  });
});
