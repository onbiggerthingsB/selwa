import { describe, it, expect } from 'vitest';
import { REFERENCE_LABS } from './reference-labs';
import { findEntry } from '@/lib/reference';
import { LANGS, resolveText } from '@/lib/i18n';

describe('reference table integrity', () => {
  it('has at least 25 analytes', () => {
    expect(REFERENCE_LABS.length).toBeGreaterThanOrEqual(25);
  });

  it('has at least 80 analytes', () => {
    expect(REFERENCE_LABS.length).toBeGreaterThanOrEqual(80);
  });

  it('declares the complete report-only set and keeps every member bandless', () => {
    const reportOnly = REFERENCE_LABS.filter(
      (entry) => entry.interpretation === 'report-only',
    );

    expect(reportOnly.map((entry) => entry.key).sort()).toEqual([
      'prothrombin_activity',
      'urine_amorphous_deposits',
      'urine_appearance',
      'urine_bacteria',
      'urine_bilirubin',
      'urine_casts',
      'urine_color',
      'urine_crystals',
      'urine_epithelial_cells',
      'urine_mucus',
      'urine_nitrite',
      'urine_rbc_microscopy',
      'urine_urobilinogen',
      'urine_wbc_microscopy',
      'urine_yeast_cells',
    ]);

    for (const entry of reportOnly) {
      expect(
        [
          entry.refLow,
          entry.refHigh,
          entry.criticalLow,
          entry.criticalHigh,
          entry.absoluteLow,
          entry.absoluteHigh,
        ],
        `${entry.key} must remain report-only with no owned band`,
      ).toEqual([null, null, null, null, null, null]);
    }
  });

  it('every alias is unique across the whole table (no analyte collisions)', () => {
    const seen = new Map<string, string>();
    for (const e of REFERENCE_LABS) {
      for (const a of [resolveText(e.name, 'zh').text, ...e.aliases]) {
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

  it('accepts a blank unit only for quantities that have no physical unit at all', () => {
    // Never add a quantity here merely because one report happened to omit its unit.
    expect(REFERENCE_LABS.filter((e) => e.unitOptional).map((e) => e.key)).toEqual([
      'urine_ph',
      'urine_specific_gravity',
    ]);
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

  it('defines PT activity as sourced report-only context with no invented band', () => {
    const entry = findEntry('PT%');
    expect(entry?.key).toBe('prothrombin_activity');
    expect(entry?.interpretation).toBe('report-only');
    expect(entry?.specimen).toBe('blood');
    expect(entry?.unit).toBe('%');
    expect(entry?.allowedUnits).toEqual(['%']);
    expect([
      entry?.refLow,
      entry?.refHigh,
      entry?.criticalLow,
      entry?.criticalHigh,
      entry?.absoluteLow,
      entry?.absoluteHigh,
    ]).toEqual([null, null, null, null, null, null]);
    expect(entry?.highStakes).toBe(true);

    for (const alias of [
      'PT%',
      'PTA',
      '凝血酶原活动度',
      'PT活动度',
      '凝血酶原活性',
    ]) {
      expect(findEntry(alias)?.key, alias).toBe('prothrombin_activity');
    }
    expect(findEntry('PT')?.key).toBe('prothrombin_time');
  });

  it('locks the inverse PT-activity direction and the no-harmonised-band rationale', () => {
    const entry = findEntry('PT%')!;
    expect(resolveText(entry.plain, 'en').text).toMatch(
      /lower percentages mean blood clots more slowly.*opposite direction.*prothrombin time/i,
    );
    expect(resolveText(entry.plain, 'zh').text).toMatch(
      /百分比越低表示凝血越慢.*与以秒计量的凝血酶原时间方向相反/,
    );
    expect(entry.source).toMatch(
      /No harmonised reference interval exists.*Low percent indicates impaired clotting.*opposite direction from prothrombin time in seconds/i,
    );
  });

  it('keeps every pre-existing report-only entry non-high-stakes', () => {
    const preExisting = REFERENCE_LABS.filter(
      (entry) =>
        entry.interpretation === 'report-only' &&
        entry.key !== 'prothrombin_activity',
    );
    expect(preExisting).toHaveLength(14);
    expect(preExisting.every((entry) => entry.highStakes === false)).toBe(true);
  });

  it('every entry has unique key and required fields', () => {
    const keys = new Set<string>();
    for (const e of REFERENCE_LABS) {
      expect(e.key).toMatch(/^[a-z0-9_]+$/);
      expect(keys.has(e.key)).toBe(false);
      keys.add(e.key);
      expect(e.specimen).toBe(e.key.startsWith('urine_') ? 'urine' : 'blood');
      expect(['ours', 'report-only']).toContain(e.interpretation);
      expect(e.unit.length).toBeGreaterThan(0);
      expect(e.allowedUnits).toContain(e.unit);
      for (const lang of LANGS) {
        expect(resolveText(e.name, lang).text.length).toBeGreaterThan(0);
        expect(resolveText(e.plain, lang).text.length).toBeGreaterThan(0);
        expect(resolveText(e.definition, lang).text.length).toBeGreaterThan(0);
      }
      expect(e.name.bo).toEqual({ fallback: 'zh' });
      expect(e.plain.bo).toEqual({ fallback: 'zh' });
      expect(e.definition.bo).toEqual({ fallback: 'zh' });
      // B1 card definition (Codex blocker #2): every entry carries a direction-neutral definition.
      if (e.interpretation === 'ours') {
        expect(e.source.length).toBeGreaterThan(0);
        expect(e.refLow !== null || e.refHigh !== null).toBe(true);
      } else {
        if (e.key === 'prothrombin_activity') {
          expect(e.source.length).toBeGreaterThan(0);
        } else {
          expect(e.source).toBe('');
        }
        expect([
          e.refLow,
          e.refHigh,
          e.criticalLow,
          e.criticalHigh,
          e.absoluteLow,
          e.absoluteHigh,
        ]).toEqual([null, null, null, null, null, null]);
      }
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
