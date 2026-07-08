import { describe, it, expect } from 'vitest';
import { findEntry, normalizeUnit, unitMatches, resolveBounds } from './reference';

describe('findEntry', () => {
  it('matches Chinese name', () => {
    expect(findEntry('空腹血糖')?.key).toBe('fasting_glucose');
  });
  it('matches an English abbreviation case-insensitively', () => {
    expect(findEntry('glu')?.key).toBe('fasting_glucose');
    expect(findEntry('LDL-C')?.key).toBe('ldl_cholesterol');
  });
  it('matches the canonical English name', () => {
    expect(findEntry('Potassium')?.key).toBe('potassium');
  });
  it('tolerates surrounding punctuation/whitespace', () => {
    expect(findEntry('  K+ ')?.key).toBe('potassium');
  });
  it('returns null for an unknown analyte', () => {
    expect(findEntry('ceruloplasmin')).toBeNull();
  });
});

describe('unit matching', () => {
  it('normalizes micro sign variants', () => {
    expect(normalizeUnit('µmol/L')).toBe(normalizeUnit('umol/L'));
    expect(normalizeUnit('μmol/L')).toBe(normalizeUnit('umol/L'));
  });
  it('accepts an allowed equivalent unit', () => {
    const k = findEntry('potassium')!;
    expect(unitMatches('mEq/L', k)).toBe(true);
    expect(unitMatches('mmol/L', k)).toBe(true);
  });
  it('rejects a non-equivalent unit (no auto-conversion in v0)', () => {
    const glu = findEntry('fasting_glucose')!;
    expect(unitMatches('mg/dL', glu)).toBe(false);
  });
  it('treats a missing unit as not matching', () => {
    const glu = findEntry('fasting_glucose')!;
    expect(unitMatches(null, glu)).toBe(false);
  });
});

describe('resolveBounds', () => {
  it('uses sex-specific bounds when sex is known', () => {
    const hgb = findEntry('hemoglobin')!;
    expect(resolveBounds(hgb, 'female')).toEqual({ low: 115, high: 150, usedUnion: false });
    expect(resolveBounds(hgb, 'male')).toEqual({ low: 130, high: 175, usedUnion: false });
  });
  it('falls back to the wider union band when sex is unknown', () => {
    const hgb = findEntry('hemoglobin')!;
    expect(resolveBounds(hgb, 'unknown')).toEqual({ low: 115, high: 175, usedUnion: true });
  });
  it('passes through scalar bounds without a union flag', () => {
    const k = findEntry('potassium')!;
    expect(resolveBounds(k, 'unknown')).toEqual({ low: 3.5, high: 5.3, usedUnion: false });
  });
});

describe('resolveBounds with age bands', () => {
  // Synthetic entry with age bands for the test (independent of the data file).
  const banded = {
    ...findEntry('creatinine')!,
    ageBands: [
      { ageMin: 0, ageMax: 17, refLow: 20, refHigh: 60 },
      { ageMin: 18, ageMax: 200, refLow: { male: 59, female: 45 }, refHigh: { male: 104, female: 84 } },
    ],
  };

  it('picks the matching age band, then resolves sex within it', () => {
    expect(resolveBounds(banded, 'male', 40)).toEqual({ low: 59, high: 104, usedUnion: false });
    expect(resolveBounds(banded, 'female', 10)).toEqual({ low: 20, high: 60, usedUnion: false });
  });
  it('with age bands present but no age supplied, widens across bands AND sex, flags union', () => {
    const r = resolveBounds(banded, 'unknown');
    expect(r.usedUnion).toBe(true);
    expect(r.low).toBe(20);   // min across all bands + sexes
    expect(r.high).toBe(104); // max across all bands + sexes
  });
  it('entries without age bands behave exactly as before', () => {
    const k = findEntry('potassium')!;
    expect(resolveBounds(k, 'unknown')).toEqual({ low: 3.5, high: 5.3, usedUnion: false });
  });
});

describe('absolute plausibility bounds (R13 data)', () => {
  it('potassium carries conservatively-wide absolute bounds (wider than the critical band)', () => {
    const k = findEntry('钾')!;
    expect(k.absoluteLow).toBe(1.0);
    expect(k.absoluteHigh).toBe(15);
    expect(k.absoluteHigh).toBeGreaterThan(k.criticalHigh ?? 0);
  });

  it('qualitative urine fields have null bounds (R13 does not apply)', () => {
    const up = findEntry('urine_protein');
    if (up) {
      expect(up.absoluteLow).toBeNull();
      expect(up.absoluteHigh).toBeNull();
    }
  });
});
