import { describe, it, expect } from 'vitest';
import {
  findEntry,
  findEntryMatch,
  normName,
  normalizeUnit,
  unitComparisonKeyCollisions,
  unitMatches,
  resolveBounds,
  parsePrintedRange,
} from './reference';
import { REFERENCE_LABS } from '@/data/reference-labs';
import { UNIT_CONVERSIONS } from '@/data/unit-conversions';
import { SOURCE_LANGS, resolveText } from '@/lib/i18n';

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

  // Measured on a real report (validation/camera-path/full-report-2026-07-26.md): the page prints
  // 血清γ-谷氨酰基转移酶 and the OCR rendered the Greek gamma as a Latin y on some runs. Neither
  // spelling matched, so a routine liver enzyme was silently unrecognised.
  it.each([
    '血清γ-谷氨酰基转移酶', // exactly as the report prints it
    '血清y-谷氨酰基转移酶', // exactly as the OCR read it
    'γ-谷氨酰基转移酶',
    'y-谷氨酰基转移酶',
    '谷氨酰基转移酶', // the 基-infixed variant
    'γ-GT',
    'GGT',
  ])('resolves GGT written as %s', (spelling) => {
    expect(findEntry(spelling, 'blood')?.key).toBe('ggt');
  });

  // TRIPWIRE for the γ→y fold in normName. Safe only while it merges no two analytes onto one
  // index token. If this goes red, shrink the fold rather than renaming an analyte around it.
  it('never collapses two different analytes onto one index token', () => {
    const byToken = new Map<string, Set<string>>();
    for (const entry of REFERENCE_LABS) {
      const names = SOURCE_LANGS.map((lang) => resolveText(entry.name, lang).text);
      for (const token of [entry.key, ...names, ...entry.aliases]) {
        if (!token) continue;
        const key = normName(token);
        if (!byToken.has(key)) byToken.set(key, new Set());
        byToken.get(key)!.add(entry.key);
      }
    }
    const collisions = [...byToken.entries()]
      .filter(([, keys]) => keys.size > 1)
      .map(([token, keys]) => `${token} -> ${[...keys].sort().join(', ')}`);
    expect(collisions, collisions.join('\n')).toEqual([]);
  });
  // Names a real 32-page report printed that the table already covered under a different spelling.
  // Reviewed by an independent model before adding: each is the SAME measurand, not a near neighbour.
  it.each([
    ['嗜碱性粒细胞百分比', 'basophil_pct'],
    ['平均血红蛋白含量', 'mch'], // MCH, not MCHC — the printed pg unit corroborates it
    ['丙氨酸氨基转氨酶', 'alt'], // 转氨酶 / 转移酶 both standard for transaminase
    ['天门冬氨酸氨基转移酶', 'ast'], // 天门冬 / 天冬 both standard for aspartate
    ['非高密度脂蛋白', 'non_hdl_cholesterol'],
    ['甲状腺过氧化物酶抗体', 'tpo_antibody'],
    ['碳酸氢盐', 'bicarbonate'],
    ['Vita25-羟基维生素D', 'vitamin_d_25oh'], // 'Vita' is vendor formatting; the analyte is explicit
  ])('resolves the printed spelling %s to %s', (printed, key) => {
    expect(findEntry(printed, 'blood')?.key).toBe(key);
  });

  // DELIBERATELY NOT AN ALIAS. Cystatins A, B and C are distinct proteins; only cystatin C is the
  // kidney assay this entry curates, so a bare 胱抑素 that dropped the subtype must keep abstaining
  // rather than silently resolve to cystatin C.
  it('refuses a cystatin name that has lost its subtype', () => {
    expect(findEntry('胱抑素', 'blood')).toBeNull();
    expect(findEntry('胱抑素C', 'blood')?.key).toBe('cystatin_c');
  });

  // The differential-percentage family drifted: four of five siblings carried 百分比 and one did
  // not, which is how an abnormal basophil result went unexplained. Pin the whole matrix so the
  // class cannot recur one missing string at a time.
  it('covers every differential percentage in every printed spelling', () => {
    const family = [
      ['中性粒细胞', 'neutrophil_pct'],
      ['淋巴细胞', 'lymphocyte_pct'],
      ['单核细胞', 'monocyte_pct'],
      ['嗜酸性粒细胞', 'eosinophil_pct'],
      ['嗜碱性粒细胞', 'basophil_pct'],
    ] as const;
    const missing: string[] = [];
    for (const [stem, key] of family) {
      for (const suffix of ['百分比', '百分数']) {
        if (findEntry(`${stem}${suffix}`, 'blood')?.key !== key) missing.push(`${stem}${suffix}`);
      }
    }
    expect(missing, `unmatched differential spellings:\n${missing.join('\n')}`).toEqual([]);
  });

  // Real reports qualify analytes with the specimen: the 32-page health check printed 血清总胆固醇,
  // 血清甘油三酯, 血清尿酸 and nine more, none of which matched the table's bare names. Twelve
  // analytes — the whole lipid panel among them — went silently unexplained.
  describe('specimen-bearing name prefixes', () => {
    it.each([
      ['血清总胆固醇', 'total_cholesterol'],
      ['血清甘油三酯', 'triglycerides'],
      ['血清低密度脂蛋白胆固醇', 'ldl_cholesterol'],
      ['血清高密度脂蛋白胆固醇', 'hdl_cholesterol'],
      ['血清尿酸', 'uric_acid'],
      ['血清总胆红素', 'total_bilirubin'],
      ['血清直接胆红素', 'direct_bilirubin'],
      ['血清间接胆红素', 'indirect_bilirubin'],
      ['血清碱性磷酸酶', 'alkaline_phosphatase'],
      ['血清总胆汁酸', 'total_bile_acids'],
      ['血清游离三碘甲状腺原氨酸', 'free_t3'],
      ['血清游离甲状腺素', 'free_t4'],
    ])('resolves %s to %s', (printed, key) => {
      expect(findEntry(printed)?.key).toBe(key);
    });

    it.each(['血浆葡萄糖', '全血葡萄糖'])('accepts the plasma/whole-blood prefix %s', (printed) => {
      expect(findEntry(printed)?.key).toBe('fasting_glucose');
    });

    // The prefix is consumed as EVIDENCE, not deleted. 葡萄糖 alone is deliberately ambiguous
    // between blood and urine; 血清葡萄糖 is not, so the prefix makes it MORE resolvable.
    it('uses the prefix to disambiguate a name that is unresolvable without it', () => {
      expect(findEntry('葡萄糖')).toBeNull();
      const m = findEntryMatch('血清葡萄糖');
      expect(m.entry?.key).toBe('fasting_glucose');
      expect(m.matchedVia).toBe('specimen-scoped');
    });

    // THE TRAP THIS RULE MUST NOT FALL INTO. 尿酸 and 尿素 are BLOOD analytes whose names merely
    // begin with the character for urine. A urine-prefix rule would mis-specimen them, which is why
    // only blood prefixes exist. These must keep resolving exactly as before.
    it.each([
      ['尿酸', 'uric_acid'],
      ['尿素', 'urea'],
      ['尿素氮', 'urea'],
    ])('leaves the blood analyte %s alone despite its 尿 initial', (printed, key) => {
      expect(findEntry(printed)?.key).toBe(key);
    });

    // A printed panel heading contradicting the name's own prefix is a conflict, not a hint.
    // Specimen decides which band a number is read against, so guessing would be guessing meaning.
    it('refuses when a printed specimen contradicts the name prefix', () => {
      expect(findEntry('血清总胆固醇', 'blood')?.key).toBe('total_cholesterol');
      expect(findEntry('血清总胆固醇', 'urine')).toBeNull();
    });

    it('is purely additive — a bare name still resolves exactly as before', () => {
      expect(findEntry('总胆固醇')?.key).toBe('total_cholesterol');
      expect(findEntry('血清')).toBeNull(); // prefix alone is not an analyte
    });
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
