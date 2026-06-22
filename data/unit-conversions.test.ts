import { describe, it, expect } from 'vitest';
import { UNIT_CONVERSIONS } from './unit-conversions';
import { REFERENCE_LABS } from './reference-labs';

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

  it('every conversion targets a real analyte and its actual canonical SI unit', () => {
    // JOIN UNIT_CONVERSIONS → REFERENCE_LABS. A conversion factor is only safe if
    // it (a) names an analyte that exists in the reference table and (b) targets
    // that analyte's ACTUAL canonical SI unit. Otherwise a correct factor could be
    // applied for the wrong target — silent unit drift (the 1000× class of error).
    const byKey = new Map(REFERENCE_LABS.map((e) => [e.key, e]));
    for (const c of UNIT_CONVERSIONS) {
      const entry = byKey.get(c.analyteKey);
      expect(entry, `conversion analyteKey '${c.analyteKey}' must exist in REFERENCE_LABS`).toBeDefined();
      expect(
        c.siUnit,
        `conversion siUnit for '${c.analyteKey}' must equal the analyte's canonical unit`,
      ).toBe(entry!.unit);
    }
  });
});
