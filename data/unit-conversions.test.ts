import { describe, it, expect } from 'vitest';
import { UNIT_CONVERSIONS } from './unit-conversions';

describe('unit conversions integrity', () => {
  it('each conversion round-trips within 1%', () => {
    for (const c of UNIT_CONVERSIONS) {
      const round = 100 * c.factorConvToSI * c.factorSIToConv;
      expect(Math.abs(round - 100)).toBeLessThan(1); // factors are reciprocals
    }
  });
  it('covers glucose and creatinine with the documented factors', () => {
    const glu = UNIT_CONVERSIONS.find((c) => c.analyteKey === 'fasting_glucose')!;
    expect(glu.conventionalUnit).toBe('mg/dL');
    expect(glu.siUnit).toBe('mmol/L');
    expect(glu.factorConvToSI).toBeCloseTo(0.0555, 4);
    const cr = UNIT_CONVERSIONS.find((c) => c.analyteKey === 'creatinine')!;
    expect(cr.siUnit).toBe('umol/L'); // NOT mmol/L — the 1000x trap
    expect(cr.factorConvToSI).toBeCloseTo(88.42, 2);
  });
  it('every conversion carries a source', () => {
    for (const c of UNIT_CONVERSIONS) expect(c.source.length).toBeGreaterThan(0);
  });
});
