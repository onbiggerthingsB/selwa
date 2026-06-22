import { describe, it, expect } from 'vitest';
import { REFERENCE_LABS } from './reference-labs';
import { findEntry } from '@/lib/reference';

describe('reference table integrity', () => {
  it('has at least 25 analytes', () => {
    expect(REFERENCE_LABS.length).toBeGreaterThanOrEqual(25);
  });

  it('has at least 80 analytes', () => {
    expect(REFERENCE_LABS.length).toBeGreaterThanOrEqual(80);
  });

  it('every alias is unique across the whole table (no analyte collisions)', () => {
    const seen = new Map<string, string>();
    for (const e of REFERENCE_LABS) {
      for (const a of [e.nameZh, ...e.aliases]) {
        const key = a.trim().toLowerCase();
        if (seen.has(key) && seen.get(key) !== e.key) {
          throw new Error(`alias "${a}" maps to both ${seen.get(key)} and ${e.key}`);
        }
        seen.set(key, e.key);
      }
    }
  });

  it('age-banded entries are well-formed', () => {
    for (const e of REFERENCE_LABS) {
      if (!e.ageBands) continue;
      for (const b of e.ageBands) {
        expect(b.ageMin).toBeLessThanOrEqual(b.ageMax);
        expect(b.refLow !== null || b.refHigh !== null).toBe(true);
      }
    }
  });

  it('resolves new analytes by EN abbrev and ZH name', () => {
    expect(findEntry('ALP')?.key).toBe('alkaline_phosphatase');
    expect(findEntry('钙')?.key).toBe('calcium_total');
    expect(findEntry('D-dimer')?.key).toBe('d_dimer');
    expect(findEntry('铁蛋白')?.key).toBe('ferritin');
  });

  it('every entry has unique key and required fields', () => {
    const keys = new Set<string>();
    for (const e of REFERENCE_LABS) {
      expect(e.key).toMatch(/^[a-z0-9_]+$/);
      expect(keys.has(e.key)).toBe(false);
      keys.add(e.key);
      expect(e.unit.length).toBeGreaterThan(0);
      expect(e.allowedUnits).toContain(e.unit);
      expect(e.plainEn.length).toBeGreaterThan(0);
      expect(e.plainZh.length).toBeGreaterThan(0);
      expect(e.source.length).toBeGreaterThan(0);
      // at least one bound exists
      expect(e.refLow !== null || e.refHigh !== null).toBe(true);
    }
  });

  it('flags the five high-stakes analytes', () => {
    const hs = REFERENCE_LABS.filter((e) => e.highStakes).map((e) => e.key);
    for (const k of ['fasting_glucose', 'potassium', 'creatinine', 'ldl_cholesterol', 'hemoglobin']) {
      expect(hs).toContain(k);
    }
  });

  it('critical bounds, when present, are outside the reference band', () => {
    for (const e of REFERENCE_LABS) {
      const low = typeof e.refLow === 'number' ? e.refLow : e.refLow?.female ?? null;
      const high = typeof e.refHigh === 'number' ? e.refHigh : e.refHigh?.male ?? null;
      if (e.criticalLow !== null && low !== null) expect(e.criticalLow).toBeLessThanOrEqual(low);
      if (e.criticalHigh !== null && high !== null) expect(e.criticalHigh).toBeGreaterThanOrEqual(high);
    }
  });
});
