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

  it('every specimen-scoped alias resolves to its declared entry', () => {
    for (const e of REFERENCE_LABS) {
      for (const specimen of ['urine', 'blood'] as const) {
        for (const alias of e.specimenAliases?.[specimen] ?? []) {
          expect(findEntry(alias, specimen)?.key, `${specimen}:${alias}`).toBe(e.key);
        }
      }
    }
  });

  it('keeps missing-unit acceptance narrowly curated to dimensionless urine pH', () => {
    expect(REFERENCE_LABS.filter((e) => e.unitOptional).map((e) => e.key)).toEqual(['urine_ph']);
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
      expect(e.specimen).toBe(e.key.startsWith('urine_') ? 'urine' : 'blood');
      expect(e.unit.length).toBeGreaterThan(0);
      expect(e.allowedUnits).toContain(e.unit);
      expect(e.plainEn.length).toBeGreaterThan(0);
      expect(e.plainZh.length).toBeGreaterThan(0);
      // B1 card definition (Codex blocker #2): every entry carries a direction-neutral definition.
      expect(e.definitionEn.length).toBeGreaterThan(0);
      expect(e.definitionZh.length).toBeGreaterThan(0);
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

  it('R13 absolute bounds are well-formed and NEVER clip the reference/critical band', () => {
    for (const e of REFERENCE_LABS) {
      expect(e.absoluteLow === null || typeof e.absoluteLow === 'number').toBe(true);
      expect(e.absoluteHigh === null || typeof e.absoluteHigh === 'number').toBe(true);
      if (e.absoluteLow !== null && e.absoluteHigh !== null) {
        expect(e.absoluteHigh).toBeGreaterThan(e.absoluteLow);
      }
      // The bound must sit OUTSIDE every reference/critical value so a real
      // survivable/critical result is never suppressed by R13.
      const refLoMin =
        typeof e.refLow === 'number' ? e.refLow : e.refLow ? Math.min(e.refLow.male, e.refLow.female) : null;
      const refHiMax =
        typeof e.refHigh === 'number' ? e.refHigh : e.refHigh ? Math.max(e.refHigh.male, e.refHigh.female) : null;
      if (e.absoluteLow !== null && refLoMin !== null) expect(e.absoluteLow).toBeLessThanOrEqual(refLoMin);
      if (e.absoluteHigh !== null && refHiMax !== null) expect(e.absoluteHigh).toBeGreaterThanOrEqual(refHiMax);
      if (e.absoluteLow !== null && e.criticalLow !== null) expect(e.absoluteLow).toBeLessThanOrEqual(e.criticalLow);
      if (e.absoluteHigh !== null && e.criticalHigh !== null) expect(e.absoluteHigh).toBeGreaterThanOrEqual(e.criticalHigh);
    }
  });
});
