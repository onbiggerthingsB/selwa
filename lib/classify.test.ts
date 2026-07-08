import { describe, it, expect } from 'vitest';
import { parseValue, classify, classifyAgainstBounds } from './classify';
import { findEntry } from './reference';

describe('parseValue', () => {
  it('parses clean decimals', () => {
    expect(parseValue('5.5')).toBe(5.5);
    expect(parseValue(' 140 ')).toBe(140);
  });
  it('rejects comparators, ranges, and junk (returns null)', () => {
    expect(parseValue('<0.5')).toBeNull();
    expect(parseValue('3.5-5.1')).toBeNull();
    expect(parseValue('positive')).toBeNull();
    expect(parseValue(null)).toBeNull();
    expect(parseValue('')).toBeNull();
  });
});

describe('classify', () => {
  const glu = findEntry('fasting_glucose')!;
  const k = findEntry('potassium')!;
  const hgb = findEntry('hemoglobin')!;

  it('returns normal inside the band (bounds inclusive)', () => {
    expect(classify(5.5, glu, 'unknown')).toBe('normal');
    expect(classify(6.1, glu, 'unknown')).toBe('normal');
  });
  it('returns high above the band', () => {
    expect(classify(7.5, glu, 'unknown')).toBe('high');
  });
  it('returns low below the band', () => {
    expect(classify(3.0, glu, 'unknown')).toBe('low');
  });
  it('returns critical inside a panic band, taking precedence over high/low', () => {
    expect(classify(25, glu, 'unknown')).toBe('critical');
    expect(classify(2.0, glu, 'unknown')).toBe('critical');
    expect(classify(6.8, k, 'unknown')).toBe('critical');
  });
  it('uses sex-specific bounds for hemoglobin', () => {
    expect(classify(120, hgb, 'female')).toBe('normal'); // 115–150
    expect(classify(120, hgb, 'male')).toBe('low'); // 130–175
  });
  it('classifies high-only analytes (no refLow) correctly', () => {
    const ldl = findEntry('ldl_cholesterol')!;
    expect(classify(2.0, ldl, 'unknown')).toBe('normal'); // only upper bound 3.4
    expect(classify(4.0, ldl, 'unknown')).toBe('high');
  });
  it('returns unclassified when value is null', () => {
    expect(classify(null, glu, 'unknown')).toBe('unclassified');
  });
  it('uses an age band when age is provided', () => {
    const banded = {
      ...findEntry('creatinine')!,
      ageBands: [
        { ageMin: 0, ageMax: 17, refLow: 20, refHigh: 60 },
        { ageMin: 18, ageMax: 200, refLow: { male: 59, female: 45 }, refHigh: { male: 104, female: 84 } },
      ],
    };
    expect(classify(70, banded, 'female', 10)).toBe('high');   // child band 20–60
    expect(classify(70, banded, 'female', 40)).toBe('normal'); // adult female 45–84
  });
});

describe('classifyAgainstBounds', () => {
  it('classifies on the low/normal/high scale against arbitrary bounds', () => {
    expect(classifyAgainstBounds(5.5, 3.9, 6.1)).toBe('normal');
    expect(classifyAgainstBounds(6.5, 3.9, 6.1)).toBe('high');
    expect(classifyAgainstBounds(3.0, 3.9, 6.1)).toBe('low');
  });
  it('handles one-sided bounds (null low or high)', () => {
    expect(classifyAgainstBounds(10, null, 5.2)).toBe('high');
    expect(classifyAgainstBounds(3, null, 5.2)).toBe('normal');
    expect(classifyAgainstBounds(50, 90, null)).toBe('low');
  });
});
