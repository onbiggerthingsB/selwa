import { describe, it, expect } from 'vitest';
import {
  findEntry,
  normalizeUnit,
  unitComparisonKeyCollisions,
  unitMatches,
  resolveBounds,
  parsePrintedRange,
} from './reference';
import { REFERENCE_LABS } from '@/data/reference-labs';
import { UNIT_CONVERSIONS } from '@/data/unit-conversions';

describe('findEntry', () => {
  it('matches Chinese name', () => {
    expect(findEntry('空腹血糖')?.key).toBe('fasting_glucose');
  });
  it('matches an English abbreviation case-insensitively', () => {
    expect(findEntry('glu', 'blood')?.key).toBe('fasting_glucose');
    expect(findEntry('LDL-C')?.key).toBe('ldl_cholesterol');
  });
  it('requires explicit specimen context to resolve the GLU collision', () => {
    expect(findEntry('GLU')).toBeNull();
    expect(findEntry('GLU', 'unknown')).toBeNull();
    expect(findEntry('GLU', null)).toBeNull();
    expect(findEntry('GLU', 'urine')?.key).toBe('urine_glucose');
    expect(findEntry('GLU', 'blood')?.key).toBe('fasting_glucose');
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
  it('treats omitted, unknown, and null specimen context identically', () => {
    for (const name of [
      'Potassium',
      'GLU',
      'PRO',
      'Ketones',
      'Specific Gravity',
      'Glucose',
      'pH',
      'ceruloplasmin',
    ]) {
      expect(findEntry(name, 'unknown')).toBe(findEntry(name));
      expect(findEntry(name, null)).toBe(findEntry(name));
    }
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
  it('rejects a missing unit unless the entry has a narrow curated exception', () => {
    const glu = findEntry('fasting_glucose')!;
    expect(unitMatches(null, glu)).toBe(false);
    const urinePh = findEntry('pH', 'urine')!;
    expect(unitMatches(null, urinePh)).toBe(true);
  });

  // Measured on a real photograph (validation/camera-path/full-report-2026-07-26.md): across three
  // runs of the same page the model read TSH's unit as 'uIU/mL' once and 'ulU/mL' twice. Capital I
  // and lowercase l are near-identical in most fonts, so an exact check silently withheld the row
  // on two attempts out of three.
  it('accepts a unit whose I/l was confused by OCR', () => {
    const tsh = findEntry('促甲状腺激素')!;
    expect(unitMatches('uIU/mL', tsh)).toBe(true);
    expect(unitMatches('ulU/mL', tsh)).toBe(true); // the misread the camera path actually produced
    expect(unitMatches('μIU/mL', tsh)).toBe(true);
  });

  it('accepts a unit whose O/0 was confused by OCR', () => {
    const wbc = findEntry('白细胞')!;
    expect(unitMatches('10^9/L', wbc)).toBe(true);
    expect(unitMatches('1O^9/L', wbc)).toBe(true); // letter O misread for the digit
  });

  // THE SAFETY BOUNDARY. Folding characters weakens a control whose job is to stop a mg/dL number
  // being read against a mmol/L band. These must still be refused.
  it('still refuses units that differ in meaning, not just in glyph', () => {
    const glu = findEntry('fasting_glucose')!;
    expect(unitMatches('mg/dL', glu)).toBe(false);
    const wbc = findEntry('白细胞')!;
    expect(unitMatches('10^12/L', wbc)).toBe(false); // RBC's scale, a thousandfold out
    expect(unitMatches('mmol/L', wbc)).toBe(false); // wrong dimension entirely
    // NB 'G/L' (giga per litre) IS allowed for WBC — it equals 10^9/L. Not a counter-example.
  });

  // TRIPWIRE. The fold is only safe while no two units that mean different things collapse onto the
  // same key. Asserted over the ENTIRE shipped inventory, so adding a colliding unit fails here
  // rather than silently letting one unit be accepted for another. If this goes red, shrink the
  // fold — do not add an exception for the new unit.
  it('never collapses two distinct shipped units onto one key', () => {
    const units = new Set<string>();
    for (const entry of REFERENCE_LABS) {
      if (entry.unit) units.add(entry.unit);
      for (const allowed of entry.allowedUnits ?? []) units.add(allowed);
    }
    for (const conversion of UNIT_CONVERSIONS) {
      units.add(conversion.siUnit);
      units.add(conversion.conventionalUnit);
    }
    expect(units.size).toBeGreaterThan(50); // the scan must actually be covering the inventory

    const collisions = unitComparisonKeyCollisions([...units]);
    expect(
      collisions,
      `unit comparison key collisions:\n${collisions
        .map((c) => `${c.key} <- ${c.units.join(' , ')}`)
        .join('\n')}`,
    ).toEqual([]);
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

describe('parsePrintedRange', () => {
  // Bounds now carry STRICTNESS (see lib/parsePrintedRange.test.ts): "<5.2" excludes 5.2 while
  // "≤5.2" includes it. Collapsing the two made a value of 5.2 read as "within" a printed "<5.2".
  it('parses a two-sided range (various separators) — inclusive at both ends', () => {
    expect(parsePrintedRange('3.9-6.1')).toEqual({ low: 3.9, high: 6.1, lowInclusive: true, highInclusive: true });
    expect(parsePrintedRange('3.9 ~ 6.1')).toEqual({ low: 3.9, high: 6.1, lowInclusive: true, highInclusive: true });
    expect(parsePrintedRange('70–99')).toEqual({ low: 70, high: 99, lowInclusive: true, highInclusive: true });
  });
  it('parses a one-sided upper bound, preserving strictness', () => {
    expect(parsePrintedRange('<5.2')).toEqual({ low: null, high: 5.2, lowInclusive: true, highInclusive: false });
    expect(parsePrintedRange('≤ 90')).toEqual({ low: null, high: 90, lowInclusive: true, highInclusive: true });
  });
  it('parses a one-sided lower bound, preserving strictness', () => {
    expect(parsePrintedRange('≥90')).toEqual({ low: 90, high: null, lowInclusive: true, highInclusive: true });
    expect(parsePrintedRange('> 1.0')).toEqual({ low: 1.0, high: null, lowInclusive: false, highInclusive: true });
  });
  it('returns null for unparseable / empty input', () => {
    expect(parsePrintedRange('normal')).toBeNull();
    expect(parsePrintedRange(null)).toBeNull();
    expect(parsePrintedRange('')).toBeNull();
  });
});
