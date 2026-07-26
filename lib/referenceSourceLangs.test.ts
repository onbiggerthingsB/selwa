import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REFERENCE_LABS } from '@/data/reference-labs';
import {
  LANGS,
  SOURCE_LANGS,
  defineText,
  resolveText,
  reviewed,
  type Lang,
  type LocalizedText,
} from '@/lib/i18n';

const DIRECT_BO_NAME = 'བོད་ཡིག་གི་ཚོད་ལྟའི་མིང་།';
const TARGET = REFERENCE_LABS.find((entry) => entry.key === 'wbc_count')!;
const ORIGINAL_NAME = TARGET.name;

type ReferenceModule = typeof import('@/lib/reference');

let reference: ReferenceModule;

beforeAll(async () => {
  // Inject a reviewed display-only Tibetan name before the real reference module
  // initializes. Its EN/ZH source names remain byte-identical.
  TARGET.name = defineText({
    en: ORIGINAL_NAME.en,
    zh: ORIGINAL_NAME.zh,
    bo: reviewed(DIRECT_BO_NAME),
  });
  reference = await import('@/lib/reference');
});

afterAll(() => {
  TARGET.name = ORIGINAL_NAME;
});

function modeledIndex(
  languages: readonly Lang[],
  targetName: LocalizedText = TARGET.name,
): Map<string, string> {
  const index = new Map<string, string>();
  for (const entry of REFERENCE_LABS) {
    const name = entry === TARGET ? targetName : entry.name;
    const localizedNames = languages.map(
      (lang) => resolveText(name, lang).text,
    );
    for (const token of [entry.key, ...localizedNames, ...entry.aliases]) {
      index.set(reference.normName(token), entry.key);
    }
  }
  return index;
}

function indexDiff(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): { added: string[]; removed: string[]; repointed: string[] } {
  return {
    added: [...after.keys()].filter((key) => !before.has(key)),
    removed: [...before.keys()].filter((key) => !after.has(key)),
    repointed: [...after]
      .filter(([key, entryKey]) => before.has(key) && before.get(key) !== entryKey)
      .map(([key]) => key),
  };
}

function observableIndex(): Map<string, string> {
  // INDEX can contain only keys, localized names, or aliases. Include every
  // display language in the candidate universe so an accidentally indexed
  // direct Tibetan name is observable rather than omitted from the audit.
  const candidates = new Set<string>();
  for (const entry of REFERENCE_LABS) {
    const displayNames = LANGS.map((lang) => resolveText(entry.name, lang).text);
    for (const token of [entry.key, ...displayNames, ...entry.aliases]) {
      candidates.add(reference.normName(token));
    }
  }

  const actual = new Map<string, string>();
  for (const normalized of candidates) {
    const match = reference.findEntryMatch(normalized, 'unknown');
    if (match.entry !== null && match.matchedVia === 'exact') {
      actual.set(normalized, match.entry.key);
    }
  }
  return actual;
}

describe('reference names index only source languages', () => {
  // Index-size tripwire. 735 -> 742 (seven GGT aliases), then 742 -> 752 (ten aliases for
  // spellings a real report printed that the table already covered otherwise), both 2026-07-26
  // and both traced to validation/camera-path/. Rebaseline
  // deliberately when aliases are curated; the invariant being protected is that bo contributes
  // NOTHING to the index, which the before/after equality below is what actually checks.
  it('keeps the source-language map bit-exact with the current 788-key index', () => {
    expect(SOURCE_LANGS).toEqual(['en', 'zh']);
    expect(LANGS).toEqual(['en', 'zh', 'bo']);

    // Reconstruct the pre-D1 map with the unmutated table: bo currently falls
    // back to zh, so removing it from the index must be a literal zero diff.
    const before = modeledIndex(LANGS, ORIGINAL_NAME);
    const after = modeledIndex(SOURCE_LANGS, ORIGINAL_NAME);

    expect({
      beforeKeys: before.size,
      afterKeys: after.size,
      ...indexDiff(before, after),
    }).toEqual({
      beforeKeys: 788,
      afterKeys: 788,
      added: [],
      removed: [],
      repointed: [],
    });
  });

  it('excludes a direct bo display name from INDEX and SCOPED_INDEX', () => {
    const unmatched = { entry: null, matchedVia: 'unmatched' };
    expect(reference.findEntryMatch(DIRECT_BO_NAME)).toEqual(unmatched);
    expect(reference.findEntryMatch(DIRECT_BO_NAME, 'unknown')).toEqual(unmatched);
    // Explicit specimen lookups traverse SCOPED_INDEX as well as INDEX.
    expect(reference.findEntryMatch(DIRECT_BO_NAME, 'blood')).toEqual(unmatched);
    expect(reference.findEntryMatch(DIRECT_BO_NAME, 'urine')).toEqual(unmatched);

    const expected = modeledIndex(SOURCE_LANGS);
    const actual = observableIndex();
    expect(actual.has(reference.normName(DIRECT_BO_NAME))).toBe(false);
    expect({
      expectedKeys: expected.size,
      actualKeys: actual.size,
      ...indexDiff(expected, actual),
    }).toEqual({
      expectedKeys: 788,
      actualKeys: 788,
      added: [],
      removed: [],
      repointed: [],
    });
  });
});
