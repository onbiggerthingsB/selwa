import { describe, it, expect } from 'vitest';
import { convertValue } from './convert';
import { findEntry } from './reference';

describe('convertValue', () => {
  const glu = findEntry('fasting_glucose')!;   // SI mmol/L
  const cr = findEntry('creatinine')!;          // SI umol/L

  it('converts a conventional value to the canonical SI unit', () => {
    const r = convertValue(100, 'mg/dL', glu)!;
    expect(r.unit).toBe('mmol/L');
    expect(r.value).toBeCloseTo(5.55, 2);
  });
  it('returns null when already canonical (caller should not convert)', () => {
    expect(convertValue(5.5, 'mmol/L', glu)).toBeNull();
  });
  it('converts creatinine mg/dL to µmol/L (not mmol/L)', () => {
    const r = convertValue(1.0, 'mg/dL', cr)!;
    expect(r.unit).toBe('umol/L');
    expect(r.value).toBeCloseTo(88.4, 1);
  });
  it('ABSTAINS (null) on the urea/BUN ambiguity — no conversion entry exists', () => {
    const urea = findEntry('urea')!;
    expect(convertValue(14, 'mg/dL', urea)).toBeNull();
  });
  it('returns null for an unknown unit', () => {
    expect(convertValue(100, 'mg/dl-ish', glu)).toBeNull();
  });
});
