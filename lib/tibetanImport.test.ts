import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { REFERENCE_LABS } from '@/data/reference-labs';
import {
  GLOSSARY_TERM_COMPONENT_COUNTS,
  REVIEW_PACKET_FILES,
  SECONDS_POLICY_DECISION_ID,
  buildFloorStringRows,
  buildRebaselineChecklist,
  buildTibetanReviewPacket,
  executeTibetanImport,
  formatRebaselineChecklist,
  importReviewedPacket,
  parseCsv,
  readReviewedPacket,
  serializeCsv,
  writeTibetanReviewPacket,
  type ReviewedImportRow,
  type TibetanReviewPacket,
} from '@/lib/tibetanImport';
import {
  extractLocalizedTextCorpus,
  staticTextTemplates,
  type LocalizedTextCall,
  type LocalizedTextCorpus,
} from '@/lib/localizedTextCorpus';
import { resolveText, type LocalizedText } from '@/lib/i18n';
import { hashTibetanSource } from '@/lib/tibetanInvariants';
import type { ReferenceEntry } from '@/lib/types';

const fixtureRoots: string[] = [];
const FALLBACK_ZH_SOURCE = ['fallback', "('zh')"].join('');
const TIBETAN_WORD = String.fromCodePoint(0x0f40, 0x0f0b, 0x0f41);
const TIBETAN_WORD_TWO = String.fromCodePoint(0x0f42, 0x0f0b, 0x0f44);
const SHAD = String.fromCodePoint(0x0f0d);

function fixture(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'tibetan-import-'));
  fixtureRoots.push(root);
  for (const directory of ['app', 'components', 'data', 'lib']) {
    mkdirSync(path.join(root, directory), { recursive: true });
  }
  for (const [relativeFile, source] of Object.entries(files)) {
    const absoluteFile = path.join(root, relativeFile);
    mkdirSync(path.dirname(absoluteFile), { recursive: true });
    writeFileSync(absoluteFile, source, 'utf8');
  }
  return root;
}

function localizedSource(entries: readonly {
  owner: string;
  en: string;
  zh: string;
  bo?: string;
}[]): string {
  return [
    "import { defineText, fallback, reviewed } from '@/lib/i18n';",
    ...entries.map(({ owner, en, zh, bo }) =>
      `export const ${owner} = defineText({ en: reviewed(${en}), zh: reviewed(${zh}), bo: ${bo ?? FALLBACK_ZH_SOURCE} });`),
  ].join('\n');
}

function referenceNameSource(entries: readonly {
  key: string;
  en: string;
  zh: string;
}[]): string {
  return [
    "import { defineText, fallback, reviewed } from '@/lib/i18n';",
    'export const FIXTURE_REFERENCE = [',
    ...entries.map(({ key, en, zh }) =>
      `  { key: '${key}', name: defineText({ en: reviewed('${en}'), zh: reviewed('${zh}'), bo: ${FALLBACK_ZH_SOURCE} }) },`),
    '];',
  ].join('\n');
}

function corpus(root: string): LocalizedTextCorpus {
  return extractLocalizedTextCorpus({ repoRoot: root });
}

function fixtureLabTable(
  entries: readonly { key: string; unit: string; definitionEn: string; specimen: string; aliases: readonly string[] }[],
): readonly ReferenceEntry[] {
  return entries.map(({ key, unit, definitionEn, specimen, aliases }) => ({
    key,
    unit,
    specimen,
    aliases,
    definition: {
      en: { text: definitionEn, review: 'reviewed' },
      zh: { text: definitionEn, review: 'reviewed' },
      bo: { text: definitionEn, review: 'reviewed' },
    },
  })) as unknown as readonly ReferenceEntry[];
}

function importRow(
  entry: LocalizedTextCall,
  bo: string,
  labTable?: readonly ReferenceEntry[],
): ReviewedImportRow {
  const directDisplay = (lang: 'en' | 'zh'): string => {
    const variant = entry.variants[lang];
    if (variant.kind !== 'direct') throw new Error(`${entry.id}.${lang} is not direct.`);
    const templates = staticTextTemplates(variant.expression);
    const forms = templates.map(({ segments }) => segments.join(''));
    return forms.length === 1 ? forms[0] : JSON.stringify(forms);
  };
  const base = {
    packet: entry.reference?.field === 'name' ? 'glossary-names' as const : 'floor-strings' as const,
    id: entry.id,
    sourceHash: entry.sourceHash,
    zh: directDisplay('zh'),
    en: directDisplay('en'),
    bo,
    key: entry.reference?.key,
  };
  if (base.packet === 'glossary-names') {
    const reference = labTable?.find(({ key }) => key === entry.reference?.key);
    if (!reference) return base;
    // Mirror the importer's snapshot expectation so a name row built against the
    // same injected table passes the PACKET check by construction.
    return {
      ...base,
      unit: reference.unit,
      context: `${resolveText(reference.definition, 'en').text} Specimen: ${reference.specimen}.`,
      specimen: reference.specimen,
      aliases: JSON.stringify({
        unscoped: reference.aliases,
        ...(reference.specimenAliases ?? {}),
      }),
    };
  }
  const floor = buildFloorStringRows({
    calls: [entry],
    sourceFiles: [entry.sourceFile],
    curatedBo: [],
    excludedDirectBo: [],
  })[0];
  return {
    ...base,
    zh: floor.zh,
    en: floor.en,
    screen: floor.screen,
    leakageNote: floor.leakageNote,
    alternatives: floor.alternatives,
    placeholders: floor.placeholders,
  };
}

function simpleFixture(): { root: string; entry: LocalizedTextCall; source: string; bo: string } {
  const source = localizedSource([{
    owner: 'VALUE',
    en: "'Value 1-2 TSH mmol/L.'",
    zh: "'数值 1-2 TSH mmol/L。'",
  }]);
  const root = fixture({ 'lib/fixture.ts': source });
  const entry = corpus(root).calls[0];
  return {
    root,
    entry,
    source,
    bo: `${TIBETAN_WORD} 1-2 TSH mmol/L${SHAD}`,
  };
}

function fileFor(root: string, relativeFile = 'lib/fixture.ts'): string {
  return readFileSync(path.join(root, relativeFile), 'utf8');
}

function diagnostics(result: ReturnType<typeof executeTibetanImport>): string {
  return result.rows.flatMap((row) =>
    row.diagnostics.map((finding) => `${finding.check}: ${finding.message}`)).join('\n');
}

afterEach(() => {
  while (fixtureRoots.length > 0) {
    rmSync(fixtureRoots.pop()!, { recursive: true, force: true });
  }
});

describe('Tibetan reviewer packet export', () => {
  let packet: TibetanReviewPacket;

  beforeAll(() => {
    packet = buildTibetanReviewPacket(process.cwd());
  });

  it('locks the three measured inventories and authored component tally', () => {
    expect(packet.names).toHaveLength(116);
    expect(GLOSSARY_TERM_COMPONENT_COUNTS).toEqual({
      comparators: 6,
      coreNegators: 15,
      polarityPairs: 12,
      boilerplate: 2,
    });
    expect(Object.values(GLOSSARY_TERM_COMPONENT_COUNTS).reduce((sum, value) => sum + value, 0))
      .toBe(35);
    expect(packet.terms).toHaveLength(34);
    const measuredCategories = packet.terms
      .flatMap(({ categories }) => categories.split(' | '))
      .reduce<Record<string, number>>((counts, category) => ({
        ...counts,
        [category]: (counts[category] ?? 0) + 1,
      }), {});
    expect(measuredCategories).toEqual({
      boilerplate: 2,
      'core-negator': 15,
      comparator: 6,
      polarity: 12,
    });
    expect(packet.floor).toHaveLength(156); // 139 + 5 T2/T3 + 12 T4 safety strings; grows with every UI feature
    expect(packet.terms.find(({ term }) => term === '阴性')?.categories.split(' | ').sort())
      .toEqual(['core-negator', 'polarity']);
  });

  it('exports all 116 distinct names with definition context, specimen, aliases, and units', () => {
    expect(new Set(packet.names.map(({ zh }) => zh))).toHaveLength(116);
    expect(new Set(packet.names.map(({ en }) => en))).toHaveLength(116);
    expect(packet.names.filter(({ unit }) => unit === 'as reported')).toHaveLength(6);
    for (const row of packet.names) {
      const entry = REFERENCE_LABS.find(({ key }) => key === row.key)!;
      expect(row.context).toBe(
        `${resolveText(entry.definition, 'en').text} Specimen: ${entry.specimen}.`,
      );
      if (resolveText(entry.plain, 'en').text !== resolveText(entry.definition, 'en').text) {
        expect(row.context).not.toContain(resolveText(entry.plain, 'en').text + ' Specimen:');
      }
      expect(row.unit).not.toBe('');
      expect(JSON.parse(row.aliases)).toEqual({
        unscoped: entry.aliases,
        ...(entry.specimenAliases ?? {}),
      });
      expect(row.id).toBe(`REFERENCE_LABS.${entry.key}.name`);
      expect(row.sourceHash).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it('carries the unverified badge, all six consent strings, placeholders, and leakage notes', () => {
    expect(
      packet.floor.some(
        ({ id }) => id === 'components/LocalizedText.tsx:UNVERIFIED_TRANSLATION_LABEL:0',
      ),
    ).toBe(true);
    expect(packet.floor.filter(({ id }) => id.startsWith('lib/consentCopy.ts:')))
      .toHaveLength(6);
    const interpolated = packet.floor.filter(({ placeholders }) =>
      (JSON.parse(placeholders) as string[][]).some((values) => values.length > 0));
    expect(interpolated).toHaveLength(8);
    expect(interpolated.find(({ id }) => id === 'lib/grounding.ts:message:0')?.zh)
      .toContain('{fromUnit}');
    expect(interpolated.find(({ id }) => id === 'lib/guard.ts:function:evaluateRow:3')?.zh)
      .toContain('{unit}');

    const unknownAnalyte = packet.floor.find(
      ({ id }) => id === 'lib/guard.ts:function:evaluateRow:0',
    );
    expect(unknownAnalyte?.leakageNote).toContain('参考资料');
    expect(unknownAnalyte?.leakageNote).toContain('我们的参考范围');
    expect(unknownAnalyte?.leakageNote).toContain('leakage gate');

    const emptySentinel = packet.floor.find(({ id }) => id.includes('EMPTY_LOCALIZED_TEXT'));
    expect(emptySentinel).toMatchObject({ zh: '', en: '' });
    expect(emptySentinel?.leakageNote).toContain('Leave bo empty');
  });

  it('keeps conditional calls one row each with two review alternatives', () => {
    const conditionals = packet.floor.filter(({ alternatives }) => alternatives === '2');
    expect(conditionals.map(({ id }) => id).sort()).toEqual([
      'lib/guard.ts:function:evaluateRow:11',
      'lib/notesGuard.ts:function:evaluateNegations:2',
      'lib/notesGuard.ts:function:evaluateNegations:8',
    ]);
    for (const row of conditionals) {
      expect(JSON.parse(row.zh)).toHaveLength(2);
      expect(JSON.parse(row.en)).toHaveLength(2);
    }
  });

  it('ships no Tibetan and leaves every bo cell empty', () => {
    const allRows = [...packet.names, ...packet.terms, ...packet.floor];
    expect(allRows.every(({ bo }) => bo === '')).toBe(true);
    expect(JSON.stringify(packet)).not.toMatch(/[\u0F00-\u0FFF]/u);
  });

  it('carries the unresolved 秒 policy as a decision rather than engineering copy', () => {
    expect(packet.decisions).toEqual([
      expect.objectContaining({
        id: SECONDS_POLICY_DECISION_ID,
        status: 'unresolved',
        decision: '',
      }),
    ]);
    expect(packet.decisions[0].question).toContain('秒');
    expect(packet.decisions[0].question).toContain('no-CJK');
  });

  it('writes four parseable CSVs and imports only the two source-bound sheets', () => {
    const root = fixture({});
    const output = path.join(root, 'packet');
    writeTibetanReviewPacket(process.cwd(), output);
    const parsed = Object.fromEntries(
      Object.entries(REVIEW_PACKET_FILES).map(([kind, fileName]) => [
        kind,
        parseCsv(readFileSync(path.join(output, fileName), 'utf8')),
      ]),
    );
    expect(parsed.names.rows).toHaveLength(116);
    expect(parsed.terms.rows).toHaveLength(34);
    expect(parsed.floor.rows).toHaveLength(156);
    expect(parsed.decisions.rows).toHaveLength(1);
    for (const sheet of [parsed.names, parsed.terms, parsed.floor]) {
      expect(sheet.rows.every((row) => row.bo === '')).toBe(true);
    }
    const rows = readReviewedPacket(output);
    expect(rows).toHaveLength(116 + 156);
    expect(rows.every(({ bo }) => bo === '')).toBe(true);
  });

  it('refuses to silently discard a filled authoring-only glossary term', () => {
    const root = fixture({});
    const output = path.join(root, 'packet');
    writeTibetanReviewPacket(process.cwd(), output);
    const termsPath = path.join(output, REVIEW_PACKET_FILES.terms);
    const terms = parseCsv(readFileSync(termsPath, 'utf8'));
    writeFileSync(
      termsPath,
      serializeCsv(
        terms.columns,
        terms.rows.map((row, index) => ({ ...row, bo: index === 0 ? 'filled' : row.bo })),
      ),
      'utf8',
    );
    expect(() => readReviewedPacket(output)).toThrow(/authoring support.*Nothing was imported/u);
  });

  it('round-trips quoted commas, quotes, and newlines in CSV fields', () => {
    const csv = serializeCsv(['id', 'copy'], [{ id: 'one', copy: 'a,"b"\nc' }]);
    expect(parseCsv(csv)).toEqual({
      columns: ['id', 'copy'],
      rows: [{ id: 'one', copy: 'a,"b"\nc' }],
    });
  });

  it('recomputes the exact current bo baseline hashes without editing their lock files', () => {
    const checklist = buildRebaselineChecklist(extractLocalizedTextCorpus({ repoRoot: process.cwd() }));
    expect(checklist).toEqual({
      referenceBaselineBo: 'ec985ccea7ee893ff00abcc60caa903dcbcb968a464d71356bb449e3a51480e6',
      disclaimerBaselineBo: '26b37ac41f7ab7ca787474a8f0bd549f24937226f475fa873e7dffb3f0ccde4b',
      directContexts: [],
      expectedHashes: {},
    });
  });
});

describe('fail-closed Tibetan round-trip importer', () => {
  it('round-trips one valid synthetic well-formedness fixture and re-extracts it', () => {
    const { root, entry, bo } = simpleFixture();
    const before = corpus(root);
    const exported = buildFloorStringRows(before)[0];
    const result = executeTibetanImport({
      repoRoot: root,
      rows: [{
        ...importRow(entry, bo),
        id: exported.id,
        sourceHash: exported.sourceHash,
        zh: exported.zh,
        en: exported.en,
        screen: exported.screen,
        leakageNote: exported.leakageNote,
        alternatives: exported.alternatives,
        placeholders: exported.placeholders,
      }],
    });

    expect(result).toMatchObject({ written: 1, refused: 0, skipped: 0 });
    expect(fileFor(root)).toContain(`bo: reviewed('${bo}')`);
    const after = corpus(root);
    expect(after.curatedBo).toHaveLength(before.curatedBo.length + 1);
    expect(after.calls.filter((call) => call.variants.bo.kind === 'fallback'))
      .toHaveLength(before.calls.filter((call) => call.variants.bo.kind === 'fallback').length - 1);
    const reviewedVariant = after.calls.find(({ id }) => id === entry.id)!.variants.bo;
    expect(reviewedVariant.kind).toBe('direct');
    const extracted = reviewedVariant.kind === 'direct'
      ? staticTextTemplates(reviewedVariant.expression)[0].literalText
      : '';
    const value: LocalizedText = {
      en: { text: 'Value', review: 'reviewed' },
      zh: { text: '数值', review: 'reviewed' },
      bo: { text: extracted, review: 'reviewed' },
    };
    expect(resolveText(value, 'bo')).toMatchObject({
      text: bo,
      resolvedLang: 'bo',
      usedFallback: false,
      review: 'reviewed',
    });
    expect(result.checklist?.directContexts).toContain('lib/fixture.ts:VALUE:0');
    const zh = entry.variants.zh;
    expect(zh.kind).toBe('direct');
    const canonicalZh = zh.kind === 'direct'
      ? JSON.stringify(
        staticTextTemplates(zh.expression).map(({ segments, placeholders }) => ({
          segments,
          placeholders,
        })),
      )
      : '';
    expect(result.checklist?.expectedHashes).toEqual({
      [entry.id]: hashTibetanSource(canonicalZh),
    });
    expect(formatRebaselineChecklist(result.checklist!)).toContain('B13 expectedHashes');
  });

  it('round-trips a filled reviewer row through the actual CSV packet boundary', () => {
    const { root, bo } = simpleFixture();
    const floor = buildFloorStringRows(corpus(root))[0];
    const packetDirectory = path.join(root, 'review-packet');
    mkdirSync(packetDirectory, { recursive: true });
    writeFileSync(
      path.join(packetDirectory, REVIEW_PACKET_FILES.names),
      serializeCsv(
        ['key', 'zh', 'en', 'unit', 'context', 'specimen', 'aliases', 'id', 'sourceHash', 'bo'],
        [],
      ),
      'utf8',
    );
    writeFileSync(
      path.join(packetDirectory, REVIEW_PACKET_FILES.terms),
      serializeCsv(['term', 'categories', 'english-or-note', 'bo'], []),
      'utf8',
    );
    writeFileSync(
      path.join(packetDirectory, REVIEW_PACKET_FILES.floor),
      serializeCsv(
        [
          'id',
          'zh',
          'en',
          'screen',
          'leakage-note',
          'sourceHash',
          'alternatives',
          'placeholders',
          'bo',
        ],
        [{
          id: floor.id,
          zh: floor.zh,
          en: floor.en,
          screen: floor.screen,
          'leakage-note': floor.leakageNote,
          sourceHash: floor.sourceHash,
          alternatives: floor.alternatives,
          placeholders: floor.placeholders,
          bo,
        }],
      ),
      'utf8',
    );
    writeFileSync(
      path.join(packetDirectory, REVIEW_PACKET_FILES.decisions),
      serializeCsv(
        ['id', 'question', 'status', 'decision', 'notes'],
        [{
          id: SECONDS_POLICY_DECISION_ID,
          question: 'Fixture policy question',
          status: 'unresolved',
          decision: '',
          notes: '',
        }],
      ),
      'utf8',
    );

    const result = importReviewedPacket(root, packetDirectory);
    expect(result).toMatchObject({ written: 1, refused: 0, skipped: 0 });
    expect(fileFor(root)).toContain(`bo: reviewed('${bo}')`);
    expect(corpus(root).curatedBo).toHaveLength(1);
  });

  it('proves guard bite by refusing a CJK 钙 through the real Class A path', () => {
    const { root, entry, source } = simpleFixture();
    const result = executeTibetanImport({
      repoRoot: root,
      rows: [importRow(entry, `${TIBETAN_WORD} 钙 1-2 TSH mmol/L${SHAD}`)],
    });
    expect(result).toMatchObject({ written: 0, refused: 1 });
    expect(diagnostics(result)).toContain('A2');
    expect(diagnostics(result)).toContain('U+9499');
    expect(fileFor(root)).toBe(source);
  });

  it('escapes an apostrophe into the TS literal and re-extracts it byte-exact', () => {
    // An ASCII apostrophe is the ONE metacharacter that passes every Class A + B
    // check and reaches the writer, so singleQuoted() must escape it. This is the
    // only positive coverage of the escaping path — the stated highest risk area.
    const { root, entry } = simpleFixture();
    const bo = `${TIBETAN_WORD}' 1-2 TSH mmol/L${SHAD}`;
    const result = executeTibetanImport({
      repoRoot: root,
      rows: [importRow(entry, bo)],
    });
    expect(result).toMatchObject({ written: 1, refused: 0 });
    expect(fileFor(root)).toContain("bo: reviewed('" + bo.replace("'", "\\'") + "')");
    const after = corpus(root);
    const reviewed = after.calls.find(({ id }) => id === entry.id)!.variants.bo;
    const roundTripped = reviewed.kind === 'direct'
      ? staticTextTemplates(reviewed.expression)[0].literalText
      : '';
    expect(roundTripped).toBe(bo);
  });

  it.each([
    ['backtick', '`'],
    ['dollar-brace', '${'],
    ['backslash', '\\'],
    ['newline', '\n'],
    ['carriage-return', '\r'],
    ['line-separator', String.fromCodePoint(0x2028)],
    ['paragraph-separator', String.fromCodePoint(0x2029)],
    ['nul', String.fromCodePoint(0x00)],
  ])('refuses a bo carrying a %s and leaves the source byte-identical', (_label, payload) => {
    const { root, entry, source } = simpleFixture();
    const bo = `${TIBETAN_WORD}${payload} 1-2 TSH mmol/L${SHAD}`;
    const result = executeTibetanImport({
      repoRoot: root,
      rows: [importRow(entry, bo)],
    });
    expect(result).toMatchObject({ written: 0, refused: 1 });
    expect(fileFor(root)).toBe(source);
  });

  it('refuses source drift with hash8 guidance and leaves bytes unchanged', () => {
    const { root, entry, source, bo } = simpleFixture();
    const result = executeTibetanImport({
      repoRoot: root,
      rows: [{ ...importRow(entry, bo), sourceHash: '0'.repeat(64) }],
    });
    expect(diagnostics(result)).toContain('B13');
    expect(diagnostics(result)).toContain('Re-export and re-review');
    expect(diagnostics(result)).toContain('00000000');
    expect(diagnostics(result)).toContain(entry.sourceHash.slice(0, 8));
    expect(fileFor(root)).toBe(source);
  });

  it('refuses a tampered reviewer-visible snapshot even when node identity is current', () => {
    const { root, entry, source, bo } = simpleFixture();
    const row = importRow(entry, bo);
    const result = executeTibetanImport({
      repoRoot: root,
      rows: [{ ...row, zh: `${row.zh}（已篡改）`, screen: 'wrong screen' }],
    });
    expect(diagnostics(result)).toContain('PACKET');
    expect(diagnostics(result)).toContain('zh, screen');
    expect(diagnostics(result)).toContain('Re-export and re-review');
    expect(fileFor(root)).toBe(source);
  });

  it('refuses an absent id and leaves bytes unchanged', () => {
    const { root, entry, source, bo } = simpleFixture();
    const result = executeTibetanImport({
      repoRoot: root,
      rows: [{ ...importRow(entry, bo), id: 'lib/fixture.ts:missing:0' }],
    });
    expect(diagnostics(result)).toContain('Target id is absent');
    expect(fileFor(root)).toBe(source);
  });

  it('refuses 秒 both when kept through A2 and when dropped through B5', () => {
    const makeSeconds = () => {
      const source = localizedSource([{
        owner: 'SECONDS',
        en: "'Value 5 seconds.'",
        zh: "'数值 5 秒。'",
      }]);
      const root = fixture({ 'lib/fixture.ts': source });
      return { root, source, entry: corpus(root).calls[0] };
    };

    const kept = makeSeconds();
    const keptResult = executeTibetanImport({
      repoRoot: kept.root,
      rows: [importRow(kept.entry, `${TIBETAN_WORD} 5 秒${SHAD}`)],
    });
    expect(diagnostics(keptResult)).toContain('A2');
    expect(diagnostics(keptResult)).toContain(SECONDS_POLICY_DECISION_ID);
    expect(fileFor(kept.root)).toBe(kept.source);

    const dropped = makeSeconds();
    const droppedResult = executeTibetanImport({
      repoRoot: dropped.root,
      rows: [importRow(dropped.entry, `${TIBETAN_WORD} 5${SHAD}`)],
    });
    expect(diagnostics(droppedResult)).toContain('B5');
    expect(diagnostics(droppedResult)).toContain(SECONDS_POLICY_DECISION_ID);
    expect(fileFor(dropped.root)).toBe(dropped.source);
  });

  it('refuses an altered number through B1 without touching the file', () => {
    const { root, entry, source } = simpleFixture();
    const result = executeTibetanImport({
      repoRoot: root,
      rows: [importRow(entry, `${TIBETAN_WORD} 1-3 TSH mmol/L${SHAD}`)],
    });
    expect(diagnostics(result)).toContain('B1');
    expect(fileFor(root)).toBe(source);
  });

  it.each([
    { check: 'B2', bo: `${TIBETAN_WORD} 2-1 TSH mmol/L${SHAD}` },
    { check: 'B4', bo: `${TIBETAN_WORD} 1-2 TSI mmol/L${SHAD}` },
    { check: 'B7', bo: `${TIBETAN_WORD} 1-2 TSH mmol/L` },
  ])('proves $check is reached through the importer and leaves bytes unchanged', ({ check, bo }) => {
    const fixtureValue = simpleFixture();
    const result = executeTibetanImport({
      repoRoot: fixtureValue.root,
      rows: [importRow(fixtureValue.entry, bo)],
    });
    expect(diagnostics(result)).toContain(check);
    expect(fileFor(fixtureValue.root)).toBe(fixtureValue.source);
  });

  it('refuses a dropped stable placeholder through B10', () => {
    const source = [
      "import { defineText, fallback, reviewed } from '@/lib/i18n';",
      "const entry = { unit: 'mmol/L' };",
      `export const TEMPLATE = defineText({ en: reviewed(\`Unit \${entry.unit}.\`), zh: reviewed(\`单位 \${entry.unit}。\`), bo: ${FALLBACK_ZH_SOURCE} });`,
    ].join('\n');
    const root = fixture({ 'lib/fixture.ts': source });
    const entry = corpus(root).calls[0];
    expect(buildFloorStringRows(corpus(root))[0].zh).toContain('{unit}');
    const result = executeTibetanImport({
      repoRoot: root,
      rows: [importRow(entry, `${TIBETAN_WORD}${SHAD}`)],
    });
    expect(diagnostics(result)).toContain('B10');
    expect(fileFor(root)).toBe(source);
  });

  it('accepts a stable placeholder and restores only its fresh source expression', () => {
    const source = [
      "import { defineText, fallback, reviewed } from '@/lib/i18n';",
      "const entry = { unit: 'mmol/L' };",
      `export const TEMPLATE = defineText({ en: reviewed(\`Unit \${entry.unit}.\`), zh: reviewed(\`单位 \${entry.unit}。\`), bo: ${FALLBACK_ZH_SOURCE} });`,
    ].join('\n');
    const root = fixture({ 'lib/fixture.ts': source });
    const entry = corpus(root).calls[0];
    const bo = `${TIBETAN_WORD} {unit}${SHAD}`;
    const result = executeTibetanImport({
      repoRoot: root,
      rows: [importRow(entry, bo)],
    });
    expect(result).toMatchObject({ written: 1, refused: 0 });
    expect(fileFor(root)).toContain(
      `bo: reviewed(\`${TIBETAN_WORD} \${entry.unit}${SHAD}\`)`,
    );
  });

  it('refuses both colliding reference-name rows through B12', () => {
    const source = referenceNameSource([
      { key: 'one', en: 'One', zh: '甲。' },
      { key: 'two', en: 'Two', zh: '乙。' },
    ]);
    const root = fixture({ 'data/reference-labs.ts': source });
    const entries = corpus(root).calls;
    const labTable = fixtureLabTable([
      { key: 'one', unit: 'x', definitionEn: 'One.', specimen: 'blood', aliases: ['one-a'] },
      { key: 'two', unit: 'y', definitionEn: 'Two.', specimen: 'blood', aliases: ['two-a'] },
    ]);
    const duplicate = `${TIBETAN_WORD}${SHAD}`;
    const result = executeTibetanImport({
      repoRoot: root,
      labTable,
      rows: entries.map((entry) => importRow(entry, duplicate, labTable)),
    });
    expect(result).toMatchObject({ written: 0, refused: 2 });
    expect(result.rows.every((row) => row.diagnostics.some(({ check }) => check === 'B12')))
      .toBe(true);
    expect(fileFor(root, 'data/reference-labs.ts')).toBe(source);
  });

  it('refuses a name row whose key is absent from the reference table', () => {
    const source = referenceNameSource([{ key: 'ghost', en: 'Ghost', zh: '幽。' }]);
    const root = fixture({ 'data/reference-labs.ts': source });
    const entry = corpus(root).calls[0];
    const labTable = fixtureLabTable([
      { key: 'real', unit: 'x', definitionEn: 'Real.', specimen: 'blood', aliases: [] },
    ]);
    const result = executeTibetanImport({
      repoRoot: root,
      labTable,
      rows: [importRow(entry, `${TIBETAN_WORD}${SHAD}`, labTable)],
    });
    expect(result).toMatchObject({ written: 0, refused: 1 });
    expect(diagnostics(result)).toContain('unknown-reference-key');
    expect(fileFor(root, 'data/reference-labs.ts')).toBe(source);
  });

  it('refuses a name row whose reviewer-visible context columns were tampered', () => {
    const source = referenceNameSource([{ key: 'real', en: 'Real', zh: '甲。' }]);
    const root = fixture({ 'data/reference-labs.ts': source });
    const entry = corpus(root).calls[0];
    const labTable = fixtureLabTable([
      { key: 'real', unit: 'x', definitionEn: 'Real.', specimen: 'blood', aliases: ['a'] },
    ]);
    const tampered = {
      ...importRow(entry, `${TIBETAN_WORD}${SHAD}`, labTable),
      unit: 'TAMPERED',
    };
    const result = executeTibetanImport({ repoRoot: root, labTable, rows: [tampered] });
    expect(result).toMatchObject({ written: 0, refused: 1 });
    expect(diagnostics(result)).toContain('PACKET');
    expect(diagnostics(result)).toContain('unit');
    expect(fileFor(root, 'data/reference-labs.ts')).toBe(source);
  });

  it('refuses an ambiguous fresh id instead of allowing last-writer-wins targeting', () => {
    const source = referenceNameSource([
      { key: 'same', en: 'One', zh: '甲。' },
      { key: 'same', en: 'Two', zh: '乙。' },
    ]);
    const root = fixture({ 'data/reference-labs.ts': source });
    const entry = corpus(root).calls[0];
    const result = executeTibetanImport({
      repoRoot: root,
      rows: [importRow(entry, `${TIBETAN_WORD}${SHAD}`)],
    });
    expect(diagnostics(result)).toContain('ambiguous in the current tree (2 matches)');
    expect(fileFor(root, 'data/reference-labs.ts')).toBe(source);
  });

  it('refuses overwrite when the target is already reviewed', () => {
    const bo = `${TIBETAN_WORD} 1-2 TSH mmol/L${SHAD}`;
    const source = localizedSource([{
      owner: 'VALUE',
      en: "'Value 1-2 TSH mmol/L.'",
      zh: "'数值 1-2 TSH mmol/L。'",
      bo: `reviewed('${bo}')`,
    }]);
    const root = fixture({ 'lib/fixture.ts': source });
    const entry = corpus(root).calls[0];
    const result = executeTibetanImport({ repoRoot: root, rows: [importRow(entry, bo)] });
    expect(diagnostics(result)).toContain('OVERWRITE');
    expect(diagnostics(result)).toContain("not fallback('zh')");
    expect(fileFor(root)).toBe(source);
  });

  it('skips empty bo without a refusal or diagnostic', () => {
    const { root, entry, source } = simpleFixture();
    const result = executeTibetanImport({ repoRoot: root, rows: [importRow(entry, '   ')] });
    expect(result).toMatchObject({ written: 0, refused: 0, skipped: 1 });
    expect(result.rows[0]).toMatchObject({ status: 'skipped', diagnostics: [] });
    expect(fileFor(root)).toBe(source);
  });

  it('uses per-row semantics: validates all rows, writes the pass, leaves the refusal untouched', () => {
    const source = localizedSource([
      { owner: 'FIRST', en: "'First.'", zh: "'第一。'" },
      { owner: 'SECOND', en: "'Second.'", zh: "'第二。'" },
    ]);
    const root = fixture({ 'lib/fixture.ts': source });
    const [first, second] = corpus(root).calls;
    const passing = `${TIBETAN_WORD}${SHAD}`;
    const refused = `${TIBETAN_WORD} 钙${SHAD}`;
    const result = executeTibetanImport({
      repoRoot: root,
      rows: [importRow(first, passing), importRow(second, refused)],
    });
    expect(result).toMatchObject({ written: 1, refused: 1, skipped: 0 });
    expect(result.rows.map(({ status }) => status)).toEqual(['written', 'refused']);
    expect(fileFor(root)).toContain(`FIRST = defineText({ en: reviewed('First.'), zh: reviewed('第一。'), bo: reviewed('${passing}') })`);
    expect(fileFor(root)).toContain(`SECOND = defineText({ en: reviewed('Second.'), zh: reviewed('第二。'), bo: ${FALLBACK_ZH_SOURCE} })`);
  });

  it('applies multiple accepted rows in one file back-to-front', () => {
    const source = localizedSource([
      { owner: 'FIRST', en: "'First.'", zh: "'第一。'" },
      { owner: 'SECOND', en: "'Second.'", zh: "'第二。'" },
    ]);
    const root = fixture({ 'lib/fixture.ts': source });
    const [first, second] = corpus(root).calls;
    const firstBo = `${TIBETAN_WORD}${SHAD}`;
    const secondBo = `${TIBETAN_WORD_TWO}${SHAD}`;
    const result = executeTibetanImport({
      repoRoot: root,
      rows: [importRow(first, firstBo), importRow(second, secondBo)],
    });
    expect(result).toMatchObject({ written: 2, refused: 0 });
    expect(fileFor(root)).toContain(`FIRST = defineText({ en: reviewed('First.'), zh: reviewed('第一。'), bo: reviewed('${firstBo}') })`);
    expect(fileFor(root)).toContain(`SECOND = defineText({ en: reviewed('Second.'), zh: reviewed('第二。'), bo: reviewed('${secondBo}') })`);
  });

  it('is idempotently fail-closed: the same row refuses overwrite on its second run', () => {
    const { root, entry, bo } = simpleFixture();
    const row = importRow(entry, bo);
    expect(executeTibetanImport({ repoRoot: root, rows: [row] }).written).toBe(1);
    const afterFirst = fileFor(root);
    const second = executeTibetanImport({ repoRoot: root, rows: [row] });
    expect(second).toMatchObject({ written: 0, refused: 1 });
    expect(diagnostics(second)).toContain('OVERWRITE');
    expect(fileFor(root)).toBe(afterFirst);
  });

  it('round-trips conditional alternatives from a JSON bo cell', () => {
    const source = [
      "import { defineText, fallback, reviewed } from '@/lib/i18n';",
      'declare const flag: boolean;',
      `export const CONDITIONAL = defineText({ en: reviewed(flag ? 'One.' : 'Two.'), zh: reviewed(flag ? '甲。' : '乙。'), bo: ${FALLBACK_ZH_SOURCE} });`,
    ].join('\n');
    const root = fixture({ 'lib/fixture.ts': source });
    const entry = corpus(root).calls[0];
    const forms = [`${TIBETAN_WORD}${SHAD}`, `${TIBETAN_WORD_TWO}${SHAD}`];
    const result = executeTibetanImport({
      repoRoot: root,
      rows: [importRow(entry, JSON.stringify(forms))],
    });
    expect(result.written).toBe(1);
    expect(fileFor(root)).toContain(
      `bo: reviewed((flag ? '${forms[0]}' : '${forms[1]}'))`,
    );
  });

  it('refuses a non-empty translation for the structural empty-text sentinel', () => {
    const source = localizedSource([{
      owner: 'EMPTY_LOCALIZED_TEXT',
      en: "''",
      zh: "''",
    }]);
    const root = fixture({ 'lib/fixture.ts': source });
    const entry = corpus(root).calls[0];
    const result = executeTibetanImport({
      repoRoot: root,
      rows: [importRow(entry, TIBETAN_WORD)],
    });
    expect(diagnostics(result)).toContain('EMPTY-SOURCE');
    expect(fileFor(root)).toBe(source);
  });
});
