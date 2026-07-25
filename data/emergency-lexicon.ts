import type { SourceLang } from '@/lib/i18n';

export const EMERGENCY_CATEGORIES = [
  'cardiac',
  'breathing',
  'stroke',
  'bleeding',
  'anaphylaxis',
  'self-harm',
  'overdose-poisoning',
  'unconscious',
  'seizure',
  'pregnancy-emergency',
  'infant-emergency',
] as const;

export type EmergencyCategory = (typeof EMERGENCY_CATEGORIES)[number];

/**
 * Each inner array is an OR-group; every group in a pattern must match.
 *
 * For example, `[['pregnant', 'pregnancy'], ['bleeding', 'severe pain']]`
 * means (pregnant OR pregnancy) AND (bleeding OR severe pain).
 */
export type EmergencyConjunctivePattern = readonly (readonly string[])[];

export interface EmergencyEntry {
  readonly category: EmergencyCategory;
  /** Unconditional Chinese substring matches. */
  readonly zh: readonly string[];
  /** Unconditional English alphanumeric-edge matches. */
  readonly en: readonly string[];
  /** Conditional Chinese matches whose OR-groups must all be present. */
  readonly zhConjunctive?: readonly EmergencyConjunctivePattern[];
  /** Conditional English matches whose OR-groups must all be present. */
  readonly enConjunctive?: readonly EmergencyConjunctivePattern[];
  /** True only when the model must not be called for this category. */
  readonly suppressModel: boolean;
}

/**
 * Owner-reviewed launch lexicon from the advice-portal implementation spec.
 *
 * Negation is intentionally not interpreted. A false escalation is tolerated;
 * silently missing an emergency concept is not.
 */
export const EMERGENCY_LEXICON: readonly EmergencyEntry[] = [
  {
    category: 'cardiac',
    zh: ['胸痛', '胸口痛', '心绞痛'],
    en: ['chest pain', 'crushing chest', 'pain radiating to arm', 'pain radiating to jaw'],
    zhConjunctive: [[['胸闷'], ['出汗', '放射']]],
    enConjunctive: [[['chest tightness'], ['sweat', 'sweating', 'radiating', 'radiation']]],
    suppressModel: false,
  },
  {
    category: 'breathing',
    zh: ['呼吸困难', '喘不上气', '窒息'],
    en: ["can't breathe", 'difficulty breathing', 'gasping'],
    suppressModel: false,
  },
  {
    category: 'stroke',
    zh: ['中风', '口眼歪斜', '嘴歪', '说话不清', '半边麻木', '突然看不见'],
    en: ['stroke', 'face drooping', 'slurred speech', 'one-sided weakness', 'one-sided numbness'],
    suppressModel: false,
  },
  {
    category: 'bleeding',
    zh: ['大出血', '血流不止', '呕血', '便血不止'],
    en: ['severe bleeding', "won't stop bleeding", 'vomiting blood'],
    suppressModel: false,
  },
  {
    category: 'anaphylaxis',
    zh: [],
    en: ['throat swelling', 'throat closing'],
    zhConjunctive: [[['过敏'], ['喉咙肿', '呼吸']]],
    enConjunctive: [[['allergic'], ['breathing', 'breathe']]],
    suppressModel: false,
  },
  {
    category: 'self-harm',
    zh: ['自杀', '想死', '不想活了', '轻生', '自残'],
    en: ['kill myself', 'end my life', 'suicide', 'want to die', 'hurt myself'],
    suppressModel: true,
  },
  {
    category: 'overdose-poisoning',
    zh: ['服毒', '吞了药', '误服', '过量服用'],
    en: ['overdose', 'took too many pills', 'swallowed poison'],
    suppressModel: true,
  },
  {
    category: 'unconscious',
    zh: ['昏迷', '失去意识', '叫不醒'],
    en: ['unconscious', 'unresponsive', "won't wake up"],
    suppressModel: false,
  },
  {
    category: 'seizure',
    zh: ['抽搐', '惊厥', '抽风'],
    en: ['seizure', 'convulsing', 'fitting'],
    suppressModel: false,
  },
  {
    category: 'pregnancy-emergency',
    zh: [],
    en: [],
    zhConjunctive: [[['孕'], ['出血', '剧痛']]],
    enConjunctive: [[['pregnant', 'pregnancy'], ['bleeding', 'severe pain']]],
    suppressModel: false,
  },
  {
    category: 'infant-emergency',
    zh: [],
    en: [],
    zhConjunctive: [[['婴儿'], ['高烧', '抽搐']]],
    enConjunctive: [[['infant', 'baby'], ['high fever', 'seizure']]],
    suppressModel: false,
  },
] as const;

export interface EmergencyMatch {
  readonly category: EmergencyCategory;
  readonly suppressModel: boolean;
}

function hasEnglishAlnumEdgeMatch(text: string, term: string): boolean {
  const haystack = text.toLowerCase().replace(/[’‘]/gu, "'");
  const needle = term.toLowerCase();
  let from = 0;

  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) return false;
    from = index + needle.length;

    // Match the alphanumeric edges exactly as notesDetect does. This keeps a
    // term such as "stroke" from firing inside an English identifier/word,
    // while still allowing punctuation inside or around multi-word phrases.
    let firstAlnum = 0;
    while (firstAlnum < needle.length && !/[a-z0-9]/i.test(needle[firstAlnum])) {
      firstAlnum += 1;
    }

    let lastAlnum = needle.length - 1;
    while (lastAlnum >= 0 && !/[a-z0-9]/i.test(needle[lastAlnum])) {
      lastAlnum -= 1;
    }

    if (firstAlnum > lastAlnum) continue;

    const beforeIndex = index + firstAlnum - 1;
    const afterIndex = index + lastAlnum + 1;
    const before = beforeIndex < 0 ? '' : haystack[beforeIndex];
    const after = afterIndex >= haystack.length ? '' : haystack[afterIndex];

    if (!/[a-z0-9]/i.test(before) && !/[a-z0-9]/i.test(after)) return true;
  }
}

function hasTerm(text: string, term: string, lang: SourceLang): boolean {
  return lang === 'zh' ? text.includes(term) : hasEnglishAlnumEdgeMatch(text, term);
}

function hasConjunctiveMatch(
  text: string,
  patterns: readonly EmergencyConjunctivePattern[] | undefined,
  lang: SourceLang,
): boolean {
  return (
    patterns?.some((pattern) =>
      pattern.every((alternatives) => alternatives.some((term) => hasTerm(text, term, lang))),
    ) ?? false
  );
}

/**
 * Finds every emergency category present in text, once and in lexicon order.
 * Chinese uses substring matching; English uses case-insensitive boundaries on
 * each term's first and last alphanumeric characters, matching notesDetect.
 */
export function matchEmergencyText(text: string, lang: SourceLang): EmergencyMatch[] {
  return EMERGENCY_LEXICON.filter((entry) => {
    const terms = lang === 'zh' ? entry.zh : entry.en;
    const conjunctive = lang === 'zh' ? entry.zhConjunctive : entry.enConjunctive;
    return terms.some((term) => hasTerm(text, term, lang)) || hasConjunctiveMatch(text, conjunctive, lang);
  }).map(({ category, suppressModel }) => ({ category, suppressModel }));
}
