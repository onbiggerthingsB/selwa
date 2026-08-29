import { describe, expect, it } from 'vitest';
import { REFERENCE_LABS } from '@/data/reference-labs';
import { UNIT_CONVERSIONS } from '@/data/unit-conversions';
import {
  extractLocalizedTextCorpus,
  extractLocalizedTextFromSource,
  staticTextTemplates,
  type LocalizedTextCall,
  type StaticTextTemplate,
} from '@/lib/localizedTextCorpus';
import { normName, normalizeUnit } from '@/lib/reference';
import {
  clauseInvariantFindings,
  hashTibetanSource,
  intervalInvariantFindings,
  latinTokenInvariantFindings,
  nameCollisionFindings,
  numberInvariantFindings,
  placeholderInvariantFindings,
  sourceDriftFindings,
  unitInvariantFindings,
  type NamedText,
  type SourceLockedText,
  type TibetanInvariantFinding,
} from '@/lib/tibetanInvariants';

const REVIEWED_BO_ZH_SHA256 = {} as const satisfies Readonly<Record<string, string>>;

const UNIT_VOCABULARY = [
  ...new Set(
    REFERENCE_LABS
      .flatMap((entry) => [entry.unit, ...entry.allowedUnits])
      .concat(
        UNIT_CONVERSIONS.flatMap(({ conventionalUnit, siUnit }) => [
          conventionalUnit,
          siUnit,
        ]),
      )
      .flatMap((unit) => [unit, normalizeUnit(unit)])
      .filter((unit) => unit.length > 0),
  ),
].sort((left, right) => right.length - left.length || left.localeCompare(right));

interface PairedTemplate {
  id: string;
  source: StaticTextTemplate;
  target: StaticTextTemplate;
}

function pairedCuratedTemplates(): {
  pairs: PairedTemplate[];
  unsupported: string[];
} {
  const pairs: PairedTemplate[] = [];
  const unsupported: string[] = [];

  for (const entry of extractLocalizedTextCorpus().curatedBo) {
    const sourceVariant = entry.variants.zh;
    const targetVariant = entry.variants.bo;
    if (sourceVariant.kind !== 'direct' || targetVariant.kind !== 'direct') {
      unsupported.push(`${entry.id}: direct ZH and BO variants are required`);
      continue;
    }
    const source = staticTextTemplates(sourceVariant.expression);
    const target = staticTextTemplates(targetVariant.expression);
    if (source.length === 0 || target.length === 0 || source.length !== target.length) {
      unsupported.push(
        `${entry.id}: static alternative count differs (${source.length} vs ${target.length})`,
      );
      continue;
    }
    source.forEach((sourceTemplate, index) => {
      pairs.push({
        id: `${entry.id}#${index}`,
        source: sourceTemplate,
        target: target[index],
      });
    });
  }

  return { pairs, unsupported };
}

function staticNameRecords(
  entries: readonly LocalizedTextCall[],
  lang: 'en' | 'zh' | 'bo',
): NamedText[] {
  return entries.flatMap((entry) => {
    const variant = entry.variants[lang];
    expect(variant.kind, `${entry.id}.${lang} must be direct`).toBe('direct');
    if (variant.kind !== 'direct') return [];
    const templates = staticTextTemplates(variant.expression);
    expect(templates, `${entry.id}.${lang} must have exactly one static form`).toHaveLength(1);
    return [{ id: entry.id, text: templates[0].literalText }];
  });
}

function canonicalTemplates(templates: readonly StaticTextTemplate[]): string {
  return JSON.stringify(
    templates.map(({ segments, placeholders }) => ({ segments, placeholders })),
  );
}

function sourceLockedRecords(entries: readonly LocalizedTextCall[]): SourceLockedText[] {
  return entries.flatMap((entry) => {
    const variant = entry.variants.zh;
    if (variant.kind !== 'direct') return [];
    const templates = staticTextTemplates(variant.expression);
    if (templates.length === 0) return [];
    return [{ id: entry.id, source: canonicalTemplates(templates) }];
  });
}

function syntheticReferenceNames(boOne: string, boTwo: string): LocalizedTextCall[] {
  return [...extractLocalizedTextFromSource(
    'data/reference-labs.ts',
    [
      "import { defineText, reviewed } from '@/lib/i18n';",
      'const REFERENCE_LABS = [',
      `  { key: 'one', name: defineText({ en: reviewed('One'), zh: reviewed('甲'), bo: reviewed('${boOne}') }) },`,
      `  { key: 'two', name: defineText({ en: reviewed('Two'), zh: reviewed('乙'), bo: reviewed('${boTwo}') }) },`,
      '];',
    ].join('\n'),
  )];
}

function syntheticSourceLock(zh: string): LocalizedTextCall {
  return extractLocalizedTextFromSource(
    'data/reference-labs.ts',
    [
      "import { defineText, reviewed } from '@/lib/i18n';",
      'const REFERENCE_LABS = [{',
      "  key: 'fixture',",
      `  name: defineText({ en: reviewed('Fixture'), zh: reviewed('${zh}'), bo: reviewed('མིང་') }),`,
      '}];',
    ].join('\n'),
  )[0];
}

describe('Tibetan Class B source-output invariants', () => {
  const { pairs, unsupported } = pairedCuratedTemplates();

  it('reports the empty curated corpus and no unsupported authored forms', () => {
    const corpus = extractLocalizedTextCorpus();
    // Rebaselined 2026-07-28 for 16 bone densitometry entries (report-only, bandless,
    // 'measurement' frame) plus two OCR-spelling aliases: entries add 32 calls; aliases add none.
    expect(corpus.calls).toHaveLength(619); // curatedBo===0 below remains the safety check
    expect(corpus.curatedBo).toHaveLength(0);
    expect(corpus.excludedDirectBo).toHaveLength(1);
    expect(pairs).toHaveLength(0);
    expect(unsupported).toEqual([]);
  });

  it.each([
    {
      check: 'B1',
      audit: ({ source, target }: PairedTemplate) =>
        numberInvariantFindings(source.literalText, target.literalText),
    },
    {
      check: 'B2',
      audit: ({ source, target }: PairedTemplate) =>
        intervalInvariantFindings(source.literalText, target.literalText),
    },
    {
      check: 'B4',
      audit: ({ source, target }: PairedTemplate) =>
        latinTokenInvariantFindings(source.literalText, target.literalText),
    },
    {
      check: 'B5',
      audit: ({ source, target }: PairedTemplate) =>
        unitInvariantFindings(source.literalText, target.literalText, UNIT_VOCABULARY),
    },
    {
      check: 'B7',
      audit: ({ source, target }: PairedTemplate) =>
        clauseInvariantFindings(source.literalText, target.literalText),
    },
    {
      check: 'B10',
      audit: ({ source, target }: PairedTemplate) =>
        placeholderInvariantFindings(source.placeholders, target.placeholders),
    },
  ])('$check reports zero findings over the measured corpus', ({ audit }) => {
    const findings = pairs.flatMap((pair) => audit(pair));
    expect(findings).toEqual([]);
  });

  it('B1 positive control rejects an altered number multiset', () => {
    const findings = numberInvariantFindings(
      '随机值达到11.1及以上',
      'གྲངས་ཐང་ 11.7 དང་དེ་ཡན་',
    );
    expect(findings.some(({ check }) => check === 'B1')).toBe(true);
  });

  it('B1 positive control normalizes but still rejects Tibetan digits', () => {
    const findings = numberInvariantFindings(
      '随机值达到11.1及以上',
      `གྲངས་ཐང་ ${String.fromCodePoint(0x0f21, 0x0f21)}.${String.fromCodePoint(0x0f21)}`,
    );
    expect(findings).toEqual([
      {
        check: 'B1',
        reason: 'Tibetan digits are not permitted in immutable numeric values.',
        source: [],
        target: [
          String.fromCodePoint(0x0f21),
          String.fromCodePoint(0x0f21),
          String.fromCodePoint(0x0f21),
        ],
      },
    ]);
  });

  it('B2 positive control rejects a reversed interval with the same numbers', () => {
    expect(
      intervalInvariantFindings(
        '未服抗凝药者约为0.8-1.2',
        'ཧ་ལམ་ 1.2-0.8',
      ).some(({ check }) => check === 'B2'),
    ).toBe(true);
  });

  it('B4 positive control rejects a changed Latin token', () => {
    expect(
      latinTokenInvariantFindings(
        '检查TSH',
        'Tsh བརྟག་དཔྱད་',
      ).some(({ check }) => check === 'B4'),
    ).toBe(true);
  });

  it('B5 positive control rejects a normalized-but-not-verbatim unit change', () => {
    expect(
      unitInvariantFindings(
        '结果为4.0 µmol/L。',
        'གྲུབ་འབྲས་ 4.0 umol/L',
        UNIT_VOCABULARY,
      ).some(({ check }) => check === 'B5'),
    ).toBe(true);
  });

  it('B5 positive control rejects an FEU-to-DDU basis change in a composite unit', () => {
    expect(UNIT_VOCABULARY).toContain('ng/mL FEU');
    expect(
      unitInvariantFindings(
        '结果为480 ng/mL FEU。',
        'གྲུབ་འབྲས་ 480 ng/mL DDU',
        UNIT_VOCABULARY,
      ).some(({ check }) => check === 'B5'),
    ).toBe(true);
  });

  it('B5 includes reviewed conventional-unit endpoints such as g/dL', () => {
    expect(UNIT_VOCABULARY).toContain('g/dL');
    expect(
      unitInvariantFindings(
        '结果为7.0 g/dL。',
        'གྲུབ་འབྲས་ 7.0 mg/dL',
        UNIT_VOCABULARY,
      ).some(({ check }) => check === 'B5'),
    ).toBe(true);
  });

  it('B7 positive control rejects a dropped clause', () => {
    expect(
      clauseInvariantFindings(
        '第一句；第二句。',
        'དོན་ཚན་གཅིག།',
      ).some(({ check }) => check === 'B7'),
    ).toBe(true);
  });

  // B7 is one-sided ON PURPOSE. These three lock the direction, because the obvious "tidy-up"
  // is to restore equality, and equality refused 15 of the first 19 rows a Tibetan reviewer
  // returned. See the rationale on clauseInvariantFindings.
  it('B7 accepts a shad on a label whose Chinese has no clause separator', () => {
    // 44 of the 109 UI strings look like this. The reviewer's stated rule is that Tibetan
    // grammar requires the shad on a button label exactly as on prose; equality demanded none.
    expect(clauseInvariantFindings('重试', 'དང་པོ།')).toEqual([]);
  });

  it('B7 accepts surplus shad where Chinese uses a comma Tibetan closes with a shad', () => {
    expect(
      clauseInvariantFindings(
        // one 。 in the source, TWO shad in a faithful rendering — the Chinese comma is a
        // clause boundary Tibetan closes with a shad, and equality refused exactly this.
        '发送照片进行读取前，请再次确认您的同意。',
        'དང་པོ། གཉིས་པ།',
      ),
    ).toEqual([]);
  });

  it('B7 does not count a colon that only labels a parenthetical value', () => {
    // （原文：{original}） appears on five UI strings. The colon introduces a quoted value
    // mid-sentence; Tibetan writes no shad there, and counting it refused reviewed rows.
    expect(
      clauseInvariantFindings(
        '剂量与原文不一致（原文：{original}）。请与您的医生确认。',
        'དང་པོ། ({original}) གཉིས་པ།',
      ),
    ).toEqual([]);
  });

  it('B7 counts a space between Tibetan runs as a boundary, not only a shad', () => {
    // Orthography drops the shad after certain letters, and the reviewer writes the boundary as a
    // bare space there. Shad-only counting refused this correct row.
    expect(
      clauseInvariantFindings(
        // First clause ends in ག with NO shad — orthography drops it there — and the boundary
        // is carried by the space alone. Shad-only counting refused this correct shape.
        '译文中遗漏了原文药名中的信息。请与您的医生确认。',
        'དང་པོ་འདུག གཉིས་པ།',
      ),
    ).toEqual([]);
    // A shad already followed by a space is ONE boundary, not two.
    expect(clauseInvariantFindings('甲。乙。丙。', 'ཀ། ཁ།')).toHaveLength(1);
  });

  it('B7 no longer accepts a deletion it once preferred over the faithful string', () => {
    // The inversion equality produced on that same row: correct text refused (2 !== 1),
    // clause-deleted text accepted (1 === 1). Both directions must now come out right.
    const source = '发送照片进行读取前，请再次确认您的同意。';
    expect(clauseInvariantFindings(source, 'དང་པོ།')).toEqual([]);
    expect(clauseInvariantFindings('甲。乙。', 'གཅིག')).toHaveLength(1);
  });

  it('B10 positive control rejects reordered placeholders', () => {
    expect(
      placeholderInvariantFindings(
        ['unit', 'original'],
        ['original', 'unit'],
      ).some(({ check }) => check === 'B10'),
    ).toBe(true);
  });

  it('accepts faithful controls for every paired-string invariant', () => {
    const findings: TibetanInvariantFinding[] = [
      ...numberInvariantFindings('数值-5和-2', 'གྲངས་ཐང་ -5 དང་ -2'),
      ...intervalInvariantFindings('范围为-5--2', 'ཁྱབ་ཚད་ -5–-2'),
      ...latinTokenInvariantFindings('检查TSH和HbA1c', 'TSH དང་ HbA1c'),
      ...unitInvariantFindings('结果为4.0 µmol/L。', '4.0 µmol/L', UNIT_VOCABULARY),
      ...clauseInvariantFindings('第一句；第二句。', 'དང་པོ། གཉིས་པ།'),
      ...placeholderInvariantFindings(['unit', 'original'], ['unit', 'original']),
    ];
    expect(findings).toEqual([]);
  });

  it('B12 keeps EN and ZH reference names distinct without resolving BO fallbacks', () => {
    const corpus = extractLocalizedTextCorpus();
    const referenceNames = corpus.calls.filter(
      (entry) => entry.reference?.field === 'name',
    );
    const en = staticNameRecords(referenceNames, 'en');
    const zh = staticNameRecords(referenceNames, 'zh');
    const directBo = staticNameRecords(
      corpus.curatedBo.filter((entry) => entry.reference?.field === 'name'),
      'bo',
    );

    // The same 16-entry plus two-alias rebaseline adds 16 distinct EN/ZH names; aliases add none.
    expect(referenceNames).toHaveLength(175);
    expect(en).toHaveLength(175);
    expect(zh).toHaveLength(175);
    expect(nameCollisionFindings(en)).toEqual([]);
    expect(nameCollisionFindings(zh)).toEqual([]);
    expect(
      nameCollisionFindings(en.map(({ id, text }) => ({ id, text: normName(text) }))),
    ).toEqual([]);
    expect(
      nameCollisionFindings(zh.map(({ id, text }) => ({ id, text: normName(text) }))),
    ).toEqual([]);
    expect(directBo).toHaveLength(0);
    expect(nameCollisionFindings(directBo)).toEqual([]);
  });

  it('B12 positive control rejects two extracted direct BO names that collide', () => {
    const duplicate = 'མིང་།';
    const entries = syntheticReferenceNames(duplicate, duplicate);
    const names = staticNameRecords(entries, 'bo');

    expect(nameCollisionFindings(names)).toEqual([
      {
        text: duplicate,
        ids: ['REFERENCE_LABS.one.name', 'REFERENCE_LABS.two.name'],
      },
    ]);
    expect(
      nameCollisionFindings(
        staticNameRecords(syntheticReferenceNames('མིང་གཅིག་', 'མིང་གཉིས་'), 'bo'),
      ),
    ).toEqual([]);
  });

  it('B13 pins the ZH source for every reviewed direct BO entry', () => {
    const curated = extractLocalizedTextCorpus().curatedBo;
    const records = sourceLockedRecords(curated);

    expect(Object.keys(REVIEWED_BO_ZH_SHA256).sort()).toEqual(
      curated.map(({ id }) => id).sort(),
    );
    expect(records).toHaveLength(0);
    expect(sourceDriftFindings(records, REVIEWED_BO_ZH_SHA256)).toEqual([]);
  });

  it('B13 positive controls reject a changed or missing source lock', () => {
    const original = sourceLockedRecords([syntheticSourceLock('原始来源')]);
    const changed = sourceLockedRecords([syntheticSourceLock('来源已变')]);
    const expected = {
      [original[0].id]: hashTibetanSource(original[0].source),
    };

    expect(sourceDriftFindings(original, expected)).toEqual([]);
    expect(sourceDriftFindings(changed, expected)).toEqual([
      {
        id: original[0].id,
        kind: 'source-drift',
        expected: expected[original[0].id],
        actual: hashTibetanSource(changed[0].source),
      },
    ]);
    expect(sourceDriftFindings(original, {})).toEqual([
      { id: original[0].id, kind: 'missing-source-lock' },
    ]);
    expect(sourceDriftFindings([], expected)).toEqual([
      { id: original[0].id, kind: 'orphan-source-lock' },
    ]);
  });
});
