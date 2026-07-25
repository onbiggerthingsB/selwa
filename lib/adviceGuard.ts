import {
  EMERGENCY_CATEGORIES,
  matchEmergencyText,
  type EmergencyCategory,
  type EmergencyMatch,
} from '@/data/emergency-lexicon';
import {
  DOSE_UNITS,
  EN_MED_CLASS_ANCHORS,
  FREQUENCY_TOKENS,
  IMPERATIVE_MED_ANAPHORS,
  MED_CLASS_ANCHORS,
} from '@/data/medical-lexicon';
import type {
  AdviceLanguageMode,
  AdviceModelOutput,
} from '@/lib/adviceSchema';
import { detectImmutables, splitClauses } from '@/lib/notesDetect';
import {
  detectSupplementalDrugs,
  frequencyConcept,
} from '@/lib/notesGuard';

export const ADVICE_SCHOOLS = ['tcm', 'tibetan', 'western'] as const;

export type AdviceSchoolId = (typeof ADVICE_SCHOOLS)[number];

export interface SchoolAdvice {
  suggestions: string[];
  seekCare: string;
}

export type AdviceBannerId =
  | 'emergency'
  | 'emergency-self-harm'
  | 'see-doctor';

export type AdviceRefusalReason =
  | 'dosing'
  | 'tibetan-output'
  | 'emergency-only'
  | 'out-of-scope';

export interface AdviceResult {
  presentation: 'normal' | 'banner' | 'blocked';
  banners: AdviceBannerId[];
  refused: AdviceRefusalReason | null;
  schools?: {
    tcm: SchoolAdvice;
    tibetan: SchoolAdvice;
    western: SchoolAdvice;
  };
}

export interface AdviceSafetyContext {
  question: string;
  languageMode: AdviceLanguageMode;
}

export type AdvicePreScreen =
  | {
      block: true;
      categories: EmergencyCategory[];
      result: AdviceResult;
    }
  | {
      block: false;
      categories: EmergencyCategory[];
    };

const TIBETAN_SCRIPT_RE = /[ༀ-࿿]/u;
const EN_INGESTION_RE =
  /\b(?:take|takes|taking|taken|drink|drinks|drinking|drunk|swallow|swallows|swallowing|swallowed|ingest|ingests|ingesting|ingested|use|uses|using|used|apply|applies|applying|applied|inject|injects|injecting|injected|administer|administers|administering|administered|inhale|inhales|inhaling|inhaled|insert|inserts|inserting|inserted|instill|instills|instilling|instilled|start|starts|starting|started|begin|begins|beginning|begun|continue|continues|continuing|continued|resume|resumes|resuming|resumed|stop|stops|stopping|stopped|discontinue|discontinues|discontinued|discontinuing)\b/iu;
const ZH_INGESTION_RE =
  /服用|口服|外用|使用|注射|吸入|滴入|塞入|开始|加用|继续|停用|停服|恢复|改用|换用|服|吃|喝|涂|打|吸|喷|贴/u;
const EN_REMEDY_ANCHORS = [
  'herbal remedy',
  'herbal medicine',
  'traditional remedy',
  'decoction',
  'supplement',
] as const;
const ZH_REMEDY_ANCHORS = ['草药', '中药', '藏药', '方剂', '汤剂', '补充剂'] as const;
const EN_GENERIC_MEDICATION_RE =
  /\b(?:medication|medications|medicine|medicines|drug|drugs|remedy|remedies)\b/iu;
const ZH_GENERIC_MEDICATION_RE = /药|药物|药品|药方|配方/u;
const ADVICE_LOCAL_DOSE_FORM_TOKENS = [
  'tsp', 'teaspoon', 'teaspoons', 'tbsp', 'tablespoon', 'tablespoons',
  'cc', 'scoop', 'scoops', 'puff', 'puffs', 'spoonful', 'spoonfuls',
  'suppository', 'suppositories', '勺', '茶匙', '汤匙', '泵', '栓', '栓剂',
] as const;
const ADVICE_LOCAL_DOSE_UNIT_TOKENS = [
  ...ADVICE_LOCAL_DOSE_FORM_TOKENS,
  'milligram', 'milligrams', 'gram', 'grams', 'microgram', 'micrograms',
  'milliliter', 'milliliters', 'millilitre', 'millilitres',
  'liter', 'liters', 'litre', 'litres', 'unit', 'units',
  'international unit', 'international units',
] as const;
const DOSE_FORM_DIMS = new Set([
  'tablet',
  'capsule',
  'pill',
  'sachet',
  'ampoule',
  'bottle',
  'drop',
  'spray',
  'patch',
]);
const DOSE_FORM_TOKENS = DOSE_UNITS.filter(({ dim }) =>
  DOSE_FORM_DIMS.has(dim),
)
  .map(({ token }) => token)
  .concat(ADVICE_LOCAL_DOSE_FORM_TOKENS);

const EN_QUANTITY_ATOM =
  '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|half|quarter|single|double|triple|dozen)';
const EN_QUANTITY_PHRASE =
  `${EN_QUANTITY_ATOM}(?:[-\\s]+(?:and\\s+)?${EN_QUANTITY_ATOM}){0,4}`;
const EN_QUANTITY_WORD_RE = new RegExp(`\\b${EN_QUANTITY_ATOM}\\b`, 'iu');
const EN_NATURAL_SCHEDULE_RE = new RegExp(
  `\\b(?:daily|weekly|monthly|hourly|nightly|every\\s+other\\s+day|on\\s+alternate\\s+days|every\\s+(?:(?:\\d+|${EN_QUANTITY_ATOM})\\s+)?(?:hour|hours|day|days|week|weeks|month|months|morning|evening|night)|(?:once|twice|${EN_QUANTITY_ATOM}\\s+times?)\\s+(?:daily|weekly|monthly|a\\s+day|per\\s+day|a\\s+week|per\\s+week|a\\s+month|per\\s+month)|morning\\s+and\\s+evening|with\\s+(?:each\\s+)?meals?|before\\s+meals?|after\\s+meals?)\\b`,
  'iu',
);
const EN_MEDICATION_DURATION_RE = new RegExp(
  `\\b(?:for|over)\\s+(?:a|an|\\d+|${EN_QUANTITY_PHRASE}|few|several|a\\s+couple\\s+of)\\s+(?:hours?|days?|weeks?|months?)\\b`,
  'iu',
);
const ZH_NATURAL_SCHEDULE_RE =
  /隔天|早晚|每月|每晨|按需|按时|每(?:两|2)天|每隔\s*(?:\d+|[零一二两三四五六七八九十半]+)\s*(?:小时|天|日|周|月)|(?:每日|每天|一日|每周|每月)\s*(?:\d+|[一二两三四五六七八九十]+)\s*次/u;
const ZH_MEDICATION_DURATION_RE =
  /(?:连续\s*)?(?:\d+|[零一二两三四五六七八九十百半数几]+)\s*(?:小时|天|日|周|个月|月)/u;
const MEDICATION_STRENGTH_RE = new RegExp(
  `(?:\\d+(?:\\.\\d+)?|${EN_QUANTITY_PHRASE})\\s*(?:%|percent(?:age)?)`,
  'iu',
);
const EN_DOSAGE_FORM_RE =
  /\b(?:cream|ointment|solution|suspension|syrup|drops?|gel|lotion|suppository|suppositories)\b/iu;
const ZH_DOSAGE_FORM_RE = /乳膏|软膏|溶液|混悬液|糖浆|滴剂|凝胶|洗剂|栓剂|栓/u;
const EN_DOSE_UNIT_ALT = DOSE_UNITS.map(({ token }) => token)
  .concat(ADVICE_LOCAL_DOSE_UNIT_TOKENS)
  .filter((token) => /[a-z]/iu.test(token) && !/[一-鿿]/u.test(token))
  .sort((left, right) => right.length - left.length)
  .map((token) => token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
  .join('|');
const EN_WORDED_AMOUNT_WITH_UNIT_RE = new RegExp(
  `\\b(?:a|an|${EN_QUANTITY_PHRASE})(?:\\s+and\\s+a\\s+half)?\\s+(?:a\\s+|an\\s+)?(?:${EN_DOSE_UNIT_ALT})\\b`,
  'iu',
);
const ALL_DOSE_UNIT_ALT = DOSE_UNITS.map(({ token }) => token)
  .concat(ADVICE_LOCAL_DOSE_UNIT_TOKENS)
  .sort((left, right) => right.length - left.length)
  .map((token) => token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
  .join('|');
const HYPHENATED_AMOUNT_WITH_UNIT_RE = new RegExp(
  `(?:\\d+(?:\\.\\d+)?|[零一二两三四五六七八九十半]+|${EN_QUANTITY_PHRASE})\\s*[-–—]\\s*(?:${ALL_DOSE_UNIT_ALT})(?=$|[^a-z0-9一-鿿])`,
  'iu',
);
const AMOUNT_WITH_UNIT_RE = new RegExp(
  `(?:\\d+(?:\\.\\d+)?|[零一二两三四五六七八九十百半]+|${EN_QUANTITY_PHRASE})\\s*(?:${ALL_DOSE_UNIT_ALT})(?=$|[^a-z0-9一-鿿])`,
  'iu',
);
const FRACTIONAL_AMOUNT_WITH_UNIT_RE = new RegExp(
  `\\d+\\s*/\\s*\\d+\\s*(?:${ALL_DOSE_UNIT_ALT})(?=$|[^a-z0-9一-鿿])`,
  'iu',
);

const DOTTED_FREQUENCY_NORMALIZATIONS = [
  [/\bq\.d\.(?=$|[^a-z0-9])/giu, 'qd'],
  [/\bb\.i\.d\.(?=$|[^a-z0-9])/giu, 'bid'],
  [/\bt\.i\.d\.(?=$|[^a-z0-9])/giu, 'tid'],
  [/\bq\.i\.d\.(?=$|[^a-z0-9])/giu, 'qid'],
  [/\bp\.r\.n\.(?=$|[^a-z0-9])/giu, 'prn'],
  [/\bq\.h\.s\.(?=$|[^a-z0-9])/giu, 'qhs'],
] as const;
const EN_CURATED_FREQUENCY_RES = FREQUENCY_TOKENS.filter((token) =>
  /^[a-z0-9/]+$/iu.test(token),
).map(
  (token) =>
    new RegExp(
      `(?<![a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![a-z0-9])`,
      'iu',
    ),
);
const ZH_CURATED_FREQUENCY_TOKENS = FREQUENCY_TOKENS.filter((token) =>
  /[一-鿿]/u.test(token),
);

function splitAdviceClauses(text: string): string[] {
  const normalized = DOTTED_FREQUENCY_NORMALIZATIONS.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    text,
  );
  return splitClauses(normalized);
}

function hasCuratedFrequencyToken(clause: string): boolean {
  return (
    EN_CURATED_FREQUENCY_RES.some((pattern) => pattern.test(clause)) ||
    ZH_CURATED_FREQUENCY_TOKENS.some((token) => clause.includes(token))
  );
}

function normalizeSafetyText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .replace(/⁄/gu, '/')
    .replace(/\s+/gu, ' ');
}

function languageScanOrder(preferred: AdviceLanguageMode): AdviceLanguageMode[] {
  return preferred === 'en' ? ['en', 'zh'] : ['zh', 'en'];
}

/**
 * Scan both supported source languages. The selected mode is checked first,
 * while the second pass prevents mixed-language questions or model output from
 * creating an unscanned safety gap.
 */
function emergencyMatches(
  text: string,
  preferredLanguage: AdviceLanguageMode,
): EmergencyMatch[] {
  const normalizedText = normalizeSafetyText(text);
  const matches = languageScanOrder(preferredLanguage).flatMap((lang) =>
    matchEmergencyText(normalizedText, lang),
  );
  const byCategory = new Map(
    matches.map((match) => [match.category, match] as const),
  );

  return EMERGENCY_CATEGORIES.flatMap((category) => {
    const match = byCategory.get(category);
    return match ? [match] : [];
  });
}

function blocked(
  refused: AdviceRefusalReason,
  banners: AdviceBannerId[] = [],
): AdviceResult {
  // Deliberately construct this object without a schools key. Refused model
  // prose never crosses the API boundary, even if a client renderer is buggy.
  return {
    presentation: 'blocked',
    banners,
    refused,
  };
}

export function preScreenQuestion(
  question: string,
  languageMode: AdviceLanguageMode,
): AdvicePreScreen {
  const matches = emergencyMatches(question, languageMode);
  const categories = matches.map((match) => match.category);

  if (matches.some((match) => match.suppressModel)) {
    return {
      block: true,
      categories,
      result: blocked('emergency-only', ['emergency-self-harm']),
    };
  }

  return { block: false, categories };
}

function schoolStrings(output: AdviceModelOutput): string[] {
  return ADVICE_SCHOOLS.flatMap((school) => [
    ...output[school].suggestions,
    output[school].seekCare,
  ]);
}

function hasMedicationClass(clause: string): boolean {
  const lower = clause.toLowerCase();
  return (
    MED_CLASS_ANCHORS.some((anchor) => clause.includes(anchor)) ||
    EN_MED_CLASS_ANCHORS.some((anchor) => lower.includes(anchor))
  );
}

function hasMedicationAnaphorOrRemedy(clause: string): boolean {
  const lower = clause.toLowerCase();
  return (
    IMPERATIVE_MED_ANAPHORS.some(({ lang, token }) =>
      lang === 'zh' ? clause.includes(token) : lower.includes(token),
    ) ||
    EN_GENERIC_MEDICATION_RE.test(clause) ||
    ZH_GENERIC_MEDICATION_RE.test(clause) ||
    EN_REMEDY_ANCHORS.some((anchor) => lower.includes(anchor)) ||
    ZH_REMEDY_ANCHORS.some((anchor) => clause.includes(anchor)) ||
    DOSE_FORM_TOKENS.some((token) =>
      /[一-鿿]/u.test(token)
        ? clause.includes(token)
        : new RegExp(
            `(?<![a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?![a-z0-9])`,
            'iu',
          ).test(clause),
    )
  );
}

function hasIngestionVerb(clause: string): boolean {
  return ZH_INGESTION_RE.test(clause) || EN_INGESTION_RE.test(clause);
}

function containsAmountWithDoseUnit(text: string): boolean {
  return (
    EN_WORDED_AMOUNT_WITH_UNIT_RE.test(text) ||
    AMOUNT_WITH_UNIT_RE.test(text) ||
    HYPHENATED_AMOUNT_WITH_UNIT_RE.test(text) ||
    FRACTIONAL_AMOUNT_WITH_UNIT_RE.test(text)
  );
}

function clauseContainsDosing(
  clause: string,
  preferredLanguage: AdviceLanguageMode,
): boolean {
  const scans = languageScanOrder(preferredLanguage).map((lang) => ({
    lang,
    immutables: detectImmutables(clause, lang),
  }));

  // Pattern A: any amount adjacent to a curated dose unit is forbidden, even
  // without a named medicine (for example 500mg or 黄芪 10克).
  if (
    containsAmountWithDoseUnit(clause) ||
    scans.some(({ immutables }) =>
      immutables.some((immutable) => immutable.type === 'dosage'),
    )
  ) {
    return true;
  }

  const hasDetectedDrug = scans.some(({ immutables }) =>
    immutables.some((immutable) => immutable.type === 'drug'),
  );
  const hasMedicationImperative = scans.some(({ immutables }) =>
    immutables.some((immutable) => immutable.type === 'imperative'),
  );
  if (hasMedicationImperative) return true;
  const hasSupplementalDrug = scans.some(
    ({ lang }) => detectSupplementalDrugs(clause, lang).length > 0,
  );
  const hasNamedDrug = hasDetectedDrug || hasSupplementalDrug;
  const hasMedicationReferent =
    hasNamedDrug ||
    hasMedicationClass(clause) ||
    hasMedicationAnaphorOrRemedy(clause);
  const hasAdministration = hasIngestionVerb(clause);
  const hasDosageForm =
    EN_DOSAGE_FORM_RE.test(clause) || ZH_DOSAGE_FORM_RE.test(clause);
  const hasBareNumber = scans.some(({ immutables }) =>
    immutables.some((immutable) => immutable.type === 'number'),
  );
  const hasWordedEnglishQuantity = EN_QUANTITY_WORD_RE.test(clause);

  // Pattern C: a known or supplemental drug and a bare number in one clause.
  if (hasMedicationReferent && (hasBareNumber || hasWordedEnglishQuantity)) {
    return true;
  }

  // Durations and strengths are dosage instructions when they occur beside a
  // medicine/form anchor or an administration verb. They are caught here even
  // when the shared immutable detector has no matching unit token.
  const hasDuration =
    EN_MEDICATION_DURATION_RE.test(clause) ||
    ZH_MEDICATION_DURATION_RE.test(clause);
  if (hasDuration && (hasMedicationReferent || hasAdministration)) return true;

  if (
    MEDICATION_STRENGTH_RE.test(clause) &&
    (hasMedicationReferent || hasAdministration || hasDosageForm)
  ) {
    return true;
  }

  // A direct administration instruction is a prescription even when it omits
  // amount and schedule. The prompt asks for categories only; the guard is the
  // enforceable boundary that prevents "Take ibuprofen" from crossing it.
  if ((hasMedicationReferent || hasDosageForm) && hasAdministration) return true;

  const hasFrequency = languageScanOrder(preferredLanguage).some(
    (lang) => frequencyConcept(clause, lang) !== null,
  ) ||
    hasCuratedFrequencyToken(clause) ||
    EN_NATURAL_SCHEDULE_RE.test(clause) ||
    ZH_NATURAL_SCHEDULE_RE.test(clause);

  // Pattern B: frequency is forbidden only in a medication/ingestion clause.
  // A monitoring instruction such as "check blood pressure twice daily" stays
  // renderable because it has neither a medicine referent nor ingestion verb.
  return (
    hasFrequency &&
    (hasMedicationReferent || hasAdministration)
  );
}

function containsDosing(
  texts: readonly string[],
  languageMode: AdviceLanguageMode,
): boolean {
  return texts.some((text) => {
    const normalized = normalizeSafetyText(text);

    // Pattern A is context-free, so scan the whole perspective before clause
    // splitting. This keeps line-wrapped amount/unit pairs such as "400\nmg"
    // from being separated by formatting whitespace.
    if (containsAmountWithDoseUnit(normalized)) return true;

    if (
      splitAdviceClauses(normalized).some((clause) =>
        clauseContainsDosing(clause, languageMode),
      )
    ) {
      return true;
    }

    // A comma often separates one medication instruction rather than two
    // independent clauses ("Take it, twice daily" / "服用，一日两次"). Re-scan
    // with comma boundaries joined; false over-refusal is the safe direction.
    if (!/[,，]/u.test(normalized)) return false;
    const commaBridged = normalized.replace(/[,，]/gu, ' ');
    return splitAdviceClauses(commaBridged).some((clause) =>
      clauseContainsDosing(clause, languageMode),
    );
  });
}

function copySchool(school: AdviceModelOutput[AdviceSchoolId]): SchoolAdvice {
  return {
    suggestions: [...school.suggestions],
    seekCare: school.seekCare,
  };
}

export function applyAdviceSafetyFloors(
  output: AdviceModelOutput,
  context: AdviceSafetyContext,
): AdviceResult {
  const questionMatches = emergencyMatches(
    context.question,
    context.languageMode,
  );

  // The route returns at the pre-model seam for these categories. Keeping the
  // same suppression here makes this function fail closed if called directly.
  if (questionMatches.some((match) => match.suppressModel)) {
    return blocked('emergency-only', ['emergency-self-harm']);
  }

  const texts = schoolStrings(output);
  const outputEmergencyMatches = texts.flatMap((text) =>
    emergencyMatches(text, context.languageMode),
  );
  const outputHasSuppressEmergency = outputEmergencyMatches.some(
    (match) => match.suppressModel,
  );
  const emergencyBanners: AdviceBannerId[] = outputHasSuppressEmergency
    ? ['emergency-self-harm']
    : questionMatches.length > 0 ||
        output.emergency.detected ||
        outputEmergencyMatches.length > 0
      ? ['emergency']
      : [];

  // Refused model prose is never copied into the response. A refusal is not
  // allowed to erase emergency evidence established by an independent floor.
  if (output.outOfScope) return blocked('out-of-scope', emergencyBanners);
  if (texts.some((text) => TIBETAN_SCRIPT_RE.test(normalizeSafetyText(text)))) {
    return blocked('tibetan-output', emergencyBanners);
  }
  if (containsDosing(texts, context.languageMode)) {
    return blocked('dosing', emergencyBanners);
  }

  if (outputHasSuppressEmergency) {
    return blocked('emergency-only', ['emergency-self-harm']);
  }
  const showEmergencyBanner = emergencyBanners.length > 0;

  return {
    presentation: showEmergencyBanner ? 'banner' : 'normal',
    banners: emergencyBanners,
    refused: null,
    schools: {
      tcm: copySchool(output.tcm),
      tibetan: copySchool(output.tibetan),
      western: copySchool(output.western),
    },
  };
}
