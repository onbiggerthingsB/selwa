import { describe, it, expect } from 'vitest';
import { NEGATION_MARKERS, DOSE_UNITS, FREQUENCY_TOKENS, KNOWN_DRUGS, HIGH_RISK_PAIRS } from './medical-lexicon';

describe('medical lexicon', () => {
  it('has EN and ZH negation/uncertainty markers with strength ranks', () => {
    expect(NEGATION_MARKERS.length).toBeGreaterThan(30);
    const wujian = NEGATION_MARKERS.find((m) => m.marker === '未见')!;
    expect(wujian.polarity).toBe('absent');
    const cannot = NEGATION_MARKERS.find((m) => m.marker === 'cannot exclude')!;
    expect(cannot.polarity).toBe('uncertain');
    expect(cannot.strength).toBeGreaterThan(0);
  });
  it('treats mg and 毫克 as the same dose-unit dimension', () => {
    const mg = DOSE_UNITS.find((u) => u.token === 'mg')!;
    const haoke = DOSE_UNITS.find((u) => u.token === '毫克')!;
    expect(mg.dim).toBe(haoke.dim);
  });
  it('shares the count-unit dim across ZH and EN tokens (片≡tablet, 粒≡capsule…)', () => {
    const dimOf = (tok: string) => DOSE_UNITS.find((u) => u.token === tok)?.dim;
    // EN count-unit tokens exist and share the ZH counterpart's dim.
    expect(dimOf('tablet')).toBe('tablet');
    expect(dimOf('tablets')).toBe('tablet');
    expect(dimOf('tab')).toBe('tablet');
    expect(dimOf('tabs')).toBe('tablet');
    expect(dimOf('tablet')).toBe(dimOf('片'));
    expect(dimOf('capsule')).toBe(dimOf('粒'));
    expect(dimOf('capsules')).toBe('capsule');
    expect(dimOf('cap')).toBe('capsule');
    expect(dimOf('caps')).toBe('capsule');
    expect(dimOf('pill')).toBe(dimOf('丸'));
    expect(dimOf('pills')).toBe('pill');
    expect(dimOf('drop')).toBe(dimOf('滴'));
    expect(dimOf('drops')).toBe('drop');
    expect(dimOf('spray')).toBe(dimOf('喷'));
    expect(dimOf('sprays')).toBe('spray');
    expect(dimOf('patch')).toBe(dimOf('贴'));
    expect(dimOf('patches')).toBe('patch');
  });
  it('maps known drugs by generic/zh/pinyin/brand to one canonical id', () => {
    const metf = KNOWN_DRUGS.find((d) => d.id === 'metformin')!;
    expect(metf.forms).toEqual(expect.arrayContaining(['metformin', '二甲双胍', 'glucophage', '格华止']));
  });
  it('flags the benign/malignant and positive/negative high-risk pairs', () => {
    const keys = HIGH_RISK_PAIRS.flatMap((p) => [p.zh]);
    expect(keys).toEqual(expect.arrayContaining(['良性', '恶性', '阳性', '阴性']));
  });
});

// Sanity: FREQUENCY_TOKENS is exported and populated (used by notesDetect).
describe('frequency tokens', () => {
  it('is a non-empty list', () => {
    expect(FREQUENCY_TOKENS.length).toBeGreaterThan(0);
  });
});
