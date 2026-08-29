import { describe, expect, it } from 'vitest';
import {
  extractLocalizedTextCorpus,
  extractLocalizedTextFromSource,
  staticTextTemplates,
  type ExtractedVariant,
} from '@/lib/localizedTextCorpus';

function placeholders(variant: ExtractedVariant): readonly (readonly string[])[] {
  if (variant.kind !== 'direct') return [];
  return staticTextTemplates(variant.expression)
    .map((template) => template.placeholders)
    .filter((values) => values.length > 0);
}

describe('static localized-text corpus', () => {
  it('finds the production topology and keeps the OCR echo exclusion explicit', () => {
    const corpus = extractLocalizedTextCorpus();
    const fallbackBo = corpus.calls.filter((entry) => entry.variants.bo.kind === 'fallback');

    // Topology tripwire. Latest move 2026-07-28: 16 bone densitometry entries (report-only,
    // bandless, 'measurement' frame) plus two OCR-spelling aliases. The entries add one name and
    // one definition each, while aliases add no localized calls: 585->617 calls, 584->616
    // fallbacks, with 15 source files unchanged.
    // Rebaseline deliberately when a feature adds strings — and
    // confirm, as the two assertions below do, that the growth is all fallback and none of it is
    // direct (unreviewed) Tibetan.
    expect(corpus.sourceFiles).toHaveLength(15);
    expect(corpus.calls).toHaveLength(619);
    expect(fallbackBo).toHaveLength(618);
    expect(corpus.curatedBo).toHaveLength(0);
    expect(corpus.excludedDirectBo).toHaveLength(1);
    expect(corpus.excludedDirectBo[0].reason).toBe('verbatim-ocr-echo');
    expect(corpus.excludedDirectBo[0].entry).toMatchObject({
      sourceFile: 'lib/summary.ts',
      ownerProperty: 'name',
      variants: {
        en: {
          kind: 'direct',
          review: 'unverified',
          expression: { kind: 'dynamic', raw: 'row.extracted.name' },
        },
        zh: {
          kind: 'direct',
          review: 'unverified',
          expression: { kind: 'dynamic', raw: 'row.extracted.name' },
        },
        bo: {
          kind: 'direct',
          review: 'unverified',
          expression: { kind: 'dynamic', raw: 'row.extracted.name' },
        },
      },
    });
  });

  it('extracts all reference roles with stable semantic identities', () => {
    const reference = extractLocalizedTextCorpus().calls.filter((entry) => entry.reference);
    const fields = reference.reduce<Record<string, number>>((counts, entry) => {
      const field = entry.reference!.field;
      counts[field] = (counts[field] ?? 0) + 1;
      return counts;
    }, {});
    const nameKeys = reference
      .filter((entry) => entry.reference?.field === 'name')
      .map((entry) => entry.reference!.key);

    // Rebaselined for the same 16 bone densitometry entries (report-only, bandless,
    // 'measurement' frame) plus two OCR-spelling aliases: each entry adds a name and definition,
    // aliases add no reference role, and helper reuse keeps plain fixed at 106.
    expect(reference).toHaveLength(456);
    expect(fields).toEqual({ name: 175, plain: 106, definition: 175 });
    expect(nameKeys).toHaveLength(175);
    expect(new Set(nameKeys)).toHaveLength(175);
  });

  it('preserves every production placeholder expression and its order', () => {
    const actual = Object.fromEntries(
      extractLocalizedTextCorpus().calls
        .map((entry) => [
          `${entry.sourceFile}:${entry.line}`,
          placeholders(entry.variants.zh),
        ] as const)
        .filter(([, values]) => values.length > 0),
    );

    expect(actual).toEqual({
      'lib/grounding.ts:83': [['converted.from', 'converted.to']],
      'lib/guard.ts:296': [['entry.unit']],
      'lib/notesGuard.ts:740': [['sd.raw']],
      'lib/notesGuard.ts:784': [['ratio.toFixed(1)', 'sd.raw']],
      'lib/notesGuard.ts:815': [['sd.raw', 'srcFreq.toUpperCase()']],
      'lib/notesGuard.ts:838': [['raw']],
      'lib/notesGuard.ts:850': [['raw']],
      'lib/notesGuard.ts:888': [['n']],
      // The saved-visit count. Was concatenated by the caller until the Tibetan reviewer's
      // rendering showed the numeral sits mid-phrase, which would have printed it twice.
      'lib/uiCopy.ts:181': [['count']],
    });
  });

  it('selects direct bo syntax without mistaking a Chinese fallback for Tibetan', () => {
    const calls = extractLocalizedTextFromSource(
      'fixture.ts',
      [
        "import { defineText as text, fallback as fb, reviewed as ok, unverified as raw } from '@/lib/i18n';",
        "const fallbackCopy = text({ en: ok('E'), zh: ok('中'), bo: fb('zh') });",
        "const directCopy = text({ en: ok('E'), zh: ok(`数值 ${value}`), bo: ok(`གྲངས་ ${value}`) });",
        "const dynamicCopy = text({ en: ok('E'), zh: ok('中'), bo: raw(runtimeValue) });",
      ].join('\n'),
    );

    expect(calls).toHaveLength(3);
    expect(calls[0].variants.bo).toEqual({
      kind: 'fallback',
      target: 'zh',
      raw: "fb('zh')",
    });
    expect(calls[1].variants.bo).toMatchObject({
      kind: 'direct',
      review: 'reviewed',
      expression: {
        kind: 'template',
        segments: ['གྲངས་ ', ''],
        placeholders: ['value'],
      },
    });
    expect(calls[2].variants.bo).toMatchObject({
      kind: 'direct',
      review: 'unverified',
      expression: { kind: 'dynamic', raw: 'runtimeValue' },
    });
  });

  it('supports namespace imports so direct BO cannot evade the scan', () => {
    const calls = extractLocalizedTextFromSource(
      'fixture.ts',
      [
        "import * as i18n from '@/lib/i18n';",
        "const copy = i18n.defineText({ en: i18n.reviewed('E'), zh: i18n.reviewed('中'), bo: i18n.reviewed('བོད་') });",
      ].join('\n'),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].variants.bo).toMatchObject({
      kind: 'direct',
      review: 'reviewed',
      expression: { kind: 'static', text: 'བོད་' },
    });
  });

  it('keeps semantic IDs stable when unrelated comments move AST offsets', () => {
    const copy =
      "const copy = text({ en: ok('E'), zh: ok('中'), bo: ok('བོད་') });";
    const imports =
      "import { defineText as text, reviewed as ok } from '@/lib/i18n';";
    const before = extractLocalizedTextFromSource(
      'fixture.ts',
      [imports, copy].join('\n'),
    )[0];
    const after = extractLocalizedTextFromSource(
      'fixture.ts',
      [imports, '// unrelated comment', copy].join('\n'),
    )[0];

    expect(after.start).not.toBe(before.start);
    expect(after.id).toBe(before.id);
    expect(after.sourceHash).toBe(before.sourceHash);
  });

  it.each([
    {
      label: 'non-object call',
      call: 'text(COPY)',
      message: 'defineText() must receive exactly one object literal',
    },
    {
      label: 'missing language',
      call: "text({ en: ok('E'), zh: ok('中') })",
      message: 'defineText() is missing bo',
    },
    {
      label: 'spread language object',
      call: "text({ en: ok('E'), zh: ok('中'), ...rest })",
      message: 'defineText() cannot use spreads or methods',
    },
    {
      label: 'computed language',
      call: "text({ en: ok('E'), zh: ok('中'), ['bo']: ok('B') })",
      message: 'computed localization properties are not supported',
    },
    {
      label: 'unsupported variant',
      call: "text({ en: ok('E'), zh: ok('中'), bo: makeText('B') })",
      message: 'localized variants must use',
    },
  ])('fails closed for a $label', ({ call, message }) => {
    const source = [
      "import { defineText as text, reviewed as ok } from '@/lib/i18n';",
      `const COPY = ${call};`,
    ].join('\n');

    expect(() => extractLocalizedTextFromSource('fixture.ts', source)).toThrow(message);
  });
});
