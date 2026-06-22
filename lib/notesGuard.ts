// Deterministic translation-fidelity guard for free-text doctor notes (M3.3).
//
// SAFETY MODEL: The LLM only *proposes* a translation/simplification of a note.
// It never decides safety. This guard recomputes the note's immutables
// (negations, doses, drugs, bare numbers, result polarities) independently from
// the SOURCE and demands they survive in the OUTPUT. Determinism overrides the
// LLM and may only ESCALATE caution (render → flag → abstain), never reduce it.
// The worst case the guard tolerates is a false abstention (over-caution); a
// silent fidelity error is never acceptable.
//
// The 18 red-team failure modes in lib/notesGuard.test.ts are the contract this
// file implements. See /tmp/m3-guard-contract.md and the test for the spec.

import type { GuardFlag, Immutable, SegmentAction, SegmentKind } from './types';
import { detectImmutables, splitClauses } from './notesDetect';
import { HIGH_RISK_PAIRS } from '@/data/medical-lexicon';

const CONFIRM_EN = 'Please confirm this with your clinician.';
const CONFIRM_ZH = '请与您的医生确认。';
const SHOWN_AS_WRITTEN_EN = 'Shown as written; we could not safely simplify this part.';
const SHOWN_AS_WRITTEN_ZH = '按原文显示；这一部分我们无法安全地简化。';

function flag(
  id: string,
  severity: GuardFlag['severity'],
  messageEn: string,
  messageZh: string,
): GuardFlag {
  return { id, severity, messageEn, messageZh };
}

// --- Language inference ------------------------------------------------------
function hasChinese(text: string): boolean {
  return /[一-鿿]/u.test(text);
}
function inferLang(text: string): 'en' | 'zh' {
  return hasChinese(text) ? 'zh' : 'en';
}

// --- Finding-synonym map (the ~8 findings in the failure modes) --------------
// Maps a ZH or EN finding span to a canonical key so a negated/asserted finding
// can be matched across languages. Keyed by substring membership (longest first
// is unnecessary — these terms don't nest). `highRisk` marks findings whose
// presence/absence is catastrophic to flip (occupies the R9-HIGH-RISK-PAIR set).
interface FindingSynonym {
  canonical: string;
  zh: string[];
  en: string[];
  highRisk: boolean;
}
const FINDING_SYNONYMS: FindingSynonym[] = [
  { canonical: 'mass', zh: ['占位'], en: ['space-occupying', 'space occupying', 'mass'], highRisk: true },
  { canonical: 'malignant', zh: ['恶性'], en: ['malignant', 'malignancy'], highRisk: true },
  { canonical: 'metastasis', zh: ['转移'], en: ['metastasis', 'metastatic', 'metastases'], highRisk: false },
  { canonical: 'nodule', zh: ['结节'], en: ['nodule', 'nodular'], highRisk: false },
  { canonical: 'calcification', zh: ['钙化'], en: ['calcification', 'calcified'], highRisk: false },
  { canonical: 'ild', zh: ['间质性肺病', '间质性肺疾病'], en: ['interstitial lung disease', 'ild'], highRisk: false },
];

// Anatomical locators: when a negated source finding carries one of these and
// the output drops the negation entirely, the negation/finding scope was broken
// across the translation (FM-14) — an abstain-level structural failure, not a
// plain polarity drop.
const ANATOMICAL_LOCATORS_ZH = ['肝内', '肺内', '颅内', '腹腔', '盆腔', '纵隔', '胸腔', '腹内'];
const ANATOMICAL_LOCATORS_EN = ['intrahepatic', 'intrapulmonary', 'intracranial', 'intra-abdominal'];

function canonicalFinding(finding: string, lang: 'en' | 'zh'): FindingSynonym | null {
  const hay = lang === 'en' ? finding.toLowerCase() : finding;
  for (const syn of FINDING_SYNONYMS) {
    const terms = lang === 'en' ? syn.en : syn.zh;
    if (terms.some((t) => hay.includes(t))) return syn;
  }
  return null;
}

// Does `text` (in `lang`) contain any synonym of the canonical finding?
function textMentionsFinding(text: string, syn: FindingSynonym, lang: 'en' | 'zh'): boolean {
  const hay = lang === 'en' ? text.toLowerCase() : text;
  const terms = lang === 'en' ? syn.en : syn.zh;
  return terms.some((t) => hay.includes(t));
}

function hasAnatomicalLocator(finding: string, lang: 'en' | 'zh'): boolean {
  const hay = lang === 'en' ? finding.toLowerCase() : finding;
  const locs = lang === 'en' ? ANATOMICAL_LOCATORS_EN : ANATOMICAL_LOCATORS_ZH;
  return locs.some((l) => hay.includes(l));
}

// --- Polarity classes --------------------------------------------------------
// Net polarity buckets for cross-side comparison.
type PolarityClass = 'absent' | 'present' | 'uncertain';

// A source/output negation immutable has polarity 'absent' | 'uncertain'. A
// finding that is asserted (no negation immutable scoping it) is 'present'.

// --- Compound "cannot exclude" detection -------------------------------------
// 不能排除 / 不能除外 / cannot exclude / cannot rule out: a NET uncertain-positive
// hedge (the finding is still on the table). detectImmutables sometimes splits
// 不能排除 into conflicting absent+uncertain markers, so we detect the compound
// directly from the clause text.
const CANNOT_EXCLUDE_ZH = ['不能排除', '不能除外', '不除外', '未能排除', '不排除'];
const CANNOT_EXCLUDE_EN = ['cannot exclude', 'cannot rule out', "can't exclude", "can't rule out"];
// Definite-absent exclusion verbs (the dangerous OUTPUT side of a hedge collapse).
const EXCLUDED_ZH = ['已排除', '排除', '可排除'];
const EXCLUDED_EN = ['excluded', 'ruled out', 'no evidence of', 'no evidence', 'negative for', '无证据'];

function mentionsCannotExclude(text: string, lang: 'en' | 'zh'): boolean {
  const hay = lang === 'en' ? text.toLowerCase() : text;
  const list = lang === 'en' ? CANNOT_EXCLUDE_EN : CANNOT_EXCLUDE_ZH;
  return list.some((p) => hay.includes(p));
}
function mentionsExcluded(text: string, lang: 'en' | 'zh'): boolean {
  const hay = lang === 'en' ? text.toLowerCase() : text;
  // ZH 无 (definite-absent) also reads as "no evidence".
  const list = lang === 'en' ? EXCLUDED_EN : [...EXCLUDED_ZH, '无'];
  return list.some((p) => hay.includes(p));
}

// --- High-risk pair presence (R9-HIGH-RISK-PAIR) -----------------------------
function highRiskPairsPresent(text: string): boolean {
  const lower = text.toLowerCase();
  return HIGH_RISK_PAIRS.some(
    (p) => text.includes(p.zh) || lower.includes(p.en.toLowerCase()),
  );
}

// --- Result polarity 阳性 / 阴性 / positive / negative -------------------------
// A test-result polarity token, independent of sentence negation. Detected by
// direct substring scan (the negation detector treats 阴性 as a marker, so we
// read result polarity separately and verbatim).
type ResultPolarity = 'positive' | 'negative';
function detectResultPolarity(text: string): ResultPolarity | null {
  const lower = text.toLowerCase();
  if (text.includes('阳性')) return 'positive';
  if (text.includes('阴性')) return 'negative';
  // EN: require the result-result word boundary to avoid 'positive' inside other
  // words; a simple includes is acceptable for these standalone tokens.
  if (/\bpositive\b/.test(lower)) return 'positive';
  if (/\bnegative\b/.test(lower)) return 'negative';
  return null;
}

// --- Supplemental drug recognition (R9) --------------------------------------
// A few drugs in the failure modes (clonazepam/clonidine, trastuzumab) sit
// outside the seed KNOWN_DRUGS list, so we recognize them here to compare
// canonical identities across the translation. This is intentionally small:
// the goal is fidelity comparison, not a complete formulary.
interface SuppDrug {
  id: string;
  zh: string[];
  en: string[];
}
const SUPPLEMENTAL_DRUGS: SuppDrug[] = [
  { id: 'clonazepam', zh: ['氯硝西泮'], en: ['clonazepam'] },
  { id: 'clonidine', zh: ['可乐定'], en: ['clonidine'] },
  { id: 'trastuzumab-emtansine', zh: ['恩美曲妥珠单抗'], en: ['trastuzumab emtansine', 'trastuzumab-emtansine', 't-dm1'] },
  { id: 'trastuzumab', zh: ['曲妥珠单抗'], en: ['trastuzumab'] },
];

function detectSupplementalDrugs(text: string, lang: 'en' | 'zh'): string[] {
  const hay = lang === 'en' ? text.toLowerCase() : text;
  const ids: string[] = [];
  for (const d of SUPPLEMENTAL_DRUGS) {
    const terms = lang === 'en' ? d.en : d.zh;
    if (terms.some((t) => hay.includes(t))) ids.push(d.id);
  }
  return ids;
}

// --- Drug salt / release qualifiers (R9) -------------------------------------
// Salt/ester forms and modified-release qualifiers that change clinical
// equivalence. Detected in source text near a known drug; their survival in the
// output is required.
const SALT_RELEASE_QUALIFIERS = [
  { zh: '琥珀酸', en: ['succinate'] },
  { zh: '酒石酸', en: ['tartrate'] },
  { zh: '马来酸', en: ['maleate'] },
  { zh: '富马酸', en: ['fumarate'] },
  { zh: '缓释', en: ['extended-release', 'extended release', 'sustained-release', 'sustained release', ' er', ' xr', ' sr'] },
  { zh: '控释', en: ['controlled-release', 'controlled release', ' cr'] },
];

// --- Frequency concept normalization (cross-lingual) -------------------------
// detectImmutables only tokenizes coded/ZH frequencies, so an EN long-form
// frequency ('three times daily') is invisible to it. The guard compares
// frequency by CONCEPT, scanning each side's text for any synonym, so a faithful
// 每日三次 → "three times daily" is NOT mistaken for a dropped frequency (FM-17).
const FREQUENCY_CONCEPTS: Array<{ concept: string; zh: string[]; en: string[] }> = [
  { concept: 'qd', zh: ['每日一次', '一日一次', '每天一次', '每日', '每天'], en: ['once daily', 'once a day', 'once per day', 'qd', 'q.d.', 'daily'] },
  { concept: 'bid', zh: ['每日两次', '一日两次', '每天两次', '每日二次'], en: ['twice daily', 'twice a day', 'two times daily', 'bid', 'b.i.d.'] },
  { concept: 'tid', zh: ['每日三次', '一日三次', '每天三次'], en: ['three times daily', 'three times a day', 'tid', 't.i.d.'] },
  { concept: 'qid', zh: ['每日四次', '一日四次', '每天四次'], en: ['four times daily', 'four times a day', 'qid', 'q.i.d.'] },
  { concept: 'prn', zh: ['需要时', '必要时', '按需'], en: ['as needed', 'prn', 'p.r.n.', 'when needed'] },
  { concept: 'qhs', zh: ['睡前', '每晚'], en: ['at bedtime', 'nightly', 'qhs', 'at night'] },
];

function frequencyConcept(text: string, lang: 'en' | 'zh'): string | null {
  const hay = lang === 'en' ? text.toLowerCase() : text;
  // Longest-form ZH tokens are checked first within each concept; concept order
  // is fine because the lists are disjoint.
  for (const f of FREQUENCY_CONCEPTS) {
    const terms = lang === 'en' ? f.en : f.zh;
    if (terms.some((t) => hay.includes(t))) return f.concept;
  }
  return null;
}

// --- OCR corruption / unparseable source (R8 / FM-18) ------------------------
const CORRUPTION_RE = /[▀-▟░-▓�]|[?？]{2,}/u;
function sourceHasCorruptedDose(source: string): boolean {
  if (!CORRUPTION_RE.test(source)) return false;
  // Corruption alone isn't enough; it must sit in a dose/medication context: a
  // digit, a dose-unit cue, or a prescription cue near the corruption.
  const doseContext =
    /\d/.test(source) ||
    /mg|mcg|ml|g\b|毫克|微克|毫升|片|粒|单位|iu/i.test(source) ||
    /处方|prescription|剂量|dose/i.test(source);
  return doseContext;
}

// --- Magnitude divergence helper (R8) ----------------------------------------
function magnitudeRatio(a: string, b: string): number | null {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb) || na === 0 || nb === 0) return null;
  return Math.max(na / nb, nb / na);
}

// --- Action aggregation ------------------------------------------------------
const ACTION_RANK: Record<SegmentAction, number> = { render: 0, flag: 1, abstain: 2 };
function maxAction(a: SegmentAction, b: SegmentAction): SegmentAction {
  return ACTION_RANK[a] >= ACTION_RANK[b] ? a : b;
}

export interface SegmentEvaluation {
  action: SegmentAction;
  flags: GuardFlag[];
  preserved: Immutable[];
  original: string;
}

export function evaluateSegment(segment: {
  sourceText: string;
  translatedText: string;
  kind: SegmentKind;
}): SegmentEvaluation {
  const { sourceText, translatedText } = segment;
  const srcLang = inferLang(sourceText);
  const outLang = inferLang(translatedText);

  const srcIm = detectImmutables(sourceText, srcLang);
  const outIm = detectImmutables(translatedText, outLang);

  const flags: GuardFlag[] = [];
  const raiseTos: SegmentAction[] = ['render'];
  const seenFlagIds = new Set<string>();

  const add = (f: GuardFlag, raiseTo: SegmentAction) => {
    if (!seenFlagIds.has(f.id)) {
      seenFlagIds.add(f.id);
      flags.push(f);
    }
    raiseTos.push(raiseTo);
  };

  // R9-HIGH-RISK-PAIR — non-blocking info flag whenever a must-flag high-risk
  // term appears on either side (even if correctly translated).
  if (highRiskPairsPresent(sourceText) || highRiskPairsPresent(translatedText)) {
    add(
      flag(
        'R9-HIGH-RISK-PAIR',
        'info',
        'This note contains a high-stakes term (e.g. benign/malignant, positive/negative). ' + CONFIRM_EN,
        '该记录包含高风险术语（如良性/恶性、阳性/阴性）。' + CONFIRM_ZH,
      ),
      'render', // info: does not escalate on its own
    );
  }

  // ============================ R8: dose / number ============================
  // FM-18 short-circuit: an OCR-corrupted dose context is undecidable.
  if (sourceHasCorruptedDose(sourceText)) {
    add(
      flag(
        'R8-DOSE-SOURCE-UNPARSEABLE',
        'urgent',
        'The dose in the original could not be read clearly, so we are not simplifying it. ' + SHOWN_AS_WRITTEN_EN,
        '原文中的剂量无法清晰识别，因此我们不作简化。' + SHOWN_AS_WRITTEN_ZH,
      ),
      'abstain',
    );
  } else {
    evaluateDoses(srcIm, outIm, sourceText, translatedText, srcLang, outLang, add);
    evaluateBareNumbers(srcIm, outIm, add);
  }

  // ============================ R7: negation / polarity / hedge ==============
  evaluateNegations(srcIm, outIm, sourceText, translatedText, srcLang, outLang, add);

  // ============================ R9: drug / result polarity ===================
  evaluateDrugs(srcIm, outIm, sourceText, translatedText, srcLang, outLang, add);
  evaluateResultPolarity(sourceText, translatedText, add);

  const action = raiseTos.reduce(maxAction, 'render');
  const preserved = action === 'abstain' ? [] : srcIm;

  return {
    action,
    flags,
    preserved,
    original: sourceText,
  };
}

// ============================================================================
// R7 — negation / polarity / hedge
// ============================================================================
function evaluateNegations(
  srcIm: Immutable[],
  outIm: Immutable[],
  sourceText: string,
  translatedText: string,
  srcLang: 'en' | 'zh',
  outLang: 'en' | 'zh',
  add: (f: GuardFlag, raiseTo: SegmentAction) => void,
): void {
  const srcNegs = srcIm.filter((i) => i.type === 'negation');
  const outNegs = outIm.filter((i) => i.type === 'negation');

  // --- Hedge collapse: source "cannot exclude X" → output "excluded / no
  // evidence" is a positive→negative boundary cross of a hedge (FM-03, FM-04).
  if (mentionsCannotExclude(sourceText, srcLang) && mentionsExcluded(translatedText, outLang)) {
    add(
      flag(
        'R7-HEDGE-STRENGTH-WEAKENED',
        'urgent',
        'The original keeps this finding as a possibility ("cannot exclude"); the translation states it is excluded. ' +
          SHOWN_AS_WRITTEN_EN,
        '原文将该发现保留为一种可能（“不能排除”），而译文却称其已被排除。' + SHOWN_AS_WRITTEN_ZH,
      ),
      'abstain',
    );
    // The double-negative collapse also flips net polarity (FM-03 expects both).
    add(
      flag(
        'R7-NEGATION-POLARITY-MISMATCH',
        'urgent',
        'The yes/no meaning of this finding differs between the original and the translation. ' + SHOWN_AS_WRITTEN_EN,
        '该发现在原文与译文之间的肯定/否定含义不一致。' + SHOWN_AS_WRITTEN_ZH,
      ),
      'abstain',
    );
  }

  // Per source negation, compare the (polarity, finding) pair with the output.
  for (const sn of srcNegs) {
    const findingText = sn.finding ?? '';
    const syn = canonicalFinding(findingText, srcLang);
    if (!syn) continue; // unrecognized finding → can't safely compare across langs

    // Already handled above as a hedge collapse.
    if (mentionsCannotExclude(sourceText, srcLang)) continue;

    const srcPol: PolarityClass = sn.polarity === 'absent' ? 'absent' : 'uncertain';

    // Find an output negation scoping the SAME canonical finding.
    const matchedOut = outNegs.find((on) => {
      const onSyn = canonicalFinding(on.finding ?? '', outLang);
      return onSyn?.canonical === syn.canonical;
    });

    // Does the output ASSERT (mention without negation) this finding?
    const outMentions = textMentionsFinding(translatedText, syn, outLang);

    if (matchedOut) {
      const outPol: PolarityClass = matchedOut.polarity === 'absent' ? 'absent' : 'uncertain';
      // Same negation polarity on both sides → preserved (no flag).
      if (outPol === srcPol) continue;
      // Polarity diverges on the same finding. A source UNCERTAIN/PRESENT
      // finding rendered as definite-ABSENT in the output is a false
      // reassurance (FM-02): abstain on a high-risk finding, else flag.
      if (srcPol === 'uncertain' && outPol === 'absent') {
        add(
          flag(
            'R7-NEGATION-POLARITY-MISMATCH',
            syn.highRisk ? 'urgent' : 'caution',
            'The original keeps this finding open, but the translation states it is absent. ' +
              (syn.highRisk ? SHOWN_AS_WRITTEN_EN : CONFIRM_EN),
            '原文将该发现保留为可能，但译文却称其不存在。' +
              (syn.highRisk ? SHOWN_AS_WRITTEN_ZH : CONFIRM_ZH),
          ),
          syn.highRisk ? 'abstain' : 'flag',
        );
      } else {
        // source absent → output uncertain (the finding is re-opened): a
        // recoverable in-band divergence → flag.
        add(
          flag(
            'R7-NEGATION-POLARITY-MISMATCH',
            'caution',
            'The certainty of this finding differs between the original and the translation. ' + CONFIRM_EN,
            '该发现的确定程度在原文与译文之间不一致。' + CONFIRM_ZH,
          ),
          'flag',
        );
      }
      continue;
    }

    // Output has a negation, but on a DIFFERENT finding, while THIS finding is
    // asserted in the output → the negation was retargeted (FM-15).
    if (outNegs.length > 0 && outMentions) {
      add(
        flag(
          'R7-NEGATION-RETARGETED',
          'caution',
          'A negation in the original appears to attach to a different finding in the translation. ' + CONFIRM_EN,
          '原文中的否定在译文中似乎指向了不同的发现。' + CONFIRM_ZH,
        ),
        'flag',
      );
      continue;
    }

    // Output dropped the negation entirely and asserts the finding.
    if (outMentions) {
      // Scope break: a negated finding with an anatomical locator lost both its
      // negation and its anatomical scoping (FM-14) → abstain.
      if (hasAnatomicalLocator(findingText, srcLang)) {
        add(
          flag(
            'R7-NEGATION-SCOPE-BROKEN',
            'urgent',
            'A "not seen" finding in the original is asserted in the translation, and its scope was lost. ' +
              SHOWN_AS_WRITTEN_EN,
            '原文中“未见”的发现在译文中被陈述为存在，且其范围信息丢失。' + SHOWN_AS_WRITTEN_ZH,
          ),
          'abstain',
        );
        continue;
      }

      // Direction nuance:
      //  - source ABSENT  → output PRESENT  = FALSE ALARM   → flag (FM-01)
      //  - source UNCERTAIN/PRESENT → output ABSENT = FALSE REASSURANCE → abstain (FM-02)
      // Here the output asserts (present), so:
      if (srcPol === 'absent') {
        add(
          flag(
            'R7-NEGATION-POLARITY-MISMATCH',
            'caution',
            'The original rules this finding out, but the translation states it is present. ' + CONFIRM_EN,
            '原文排除了该发现，但译文却称其存在。' + CONFIRM_ZH,
          ),
          'flag',
        );
      } else {
        // source uncertain, output asserts present — unusual; treat as mismatch flag.
        add(
          flag(
            'R7-NEGATION-POLARITY-MISMATCH',
            'caution',
            'The original is uncertain about this finding, but the translation asserts it. ' + CONFIRM_EN,
            '原文对该发现并不确定，但译文却予以肯定。' + CONFIRM_ZH,
          ),
          'flag',
        );
      }
      continue;
    }

    // Output negates this finding's polarity by ASSERTING absence where the
    // source asserted/raised it (false reassurance). This is the FM-02 shape:
    // source has an UNCERTAIN/PRESENT marker on a finding, output NEGATES it.
  }

  // --- False-reassurance direction: source asserts/uncertain on a finding,
  // output NEGATES it (FM-02). The source negation list above only covers source
  // markers; FM-02's source marker is 提示 (uncertain) scoping 恶性, and the
  // output 'no malignant' is a NEGATION. Detect by matching an output negation
  // whose finding the source did NOT negate.
  for (const on of outNegs) {
    const onSyn = canonicalFinding(on.finding ?? '', outLang);
    if (!onSyn) continue;
    // Was this finding negated on the source side too?
    const srcNegatedSame = srcNegs.some(
      (sn) => canonicalFinding(sn.finding ?? '', srcLang)?.canonical === onSyn.canonical,
    );
    if (srcNegatedSame) continue;
    // Source mentions the finding but does NOT negate it → output added a
    // negation = false reassurance.
    if (textMentionsFinding(sourceText, onSyn, srcLang)) {
      const severity: SegmentAction = onSyn.highRisk ? 'abstain' : 'flag';
      add(
        flag(
          'R7-NEGATION-POLARITY-MISMATCH',
          onSyn.highRisk ? 'urgent' : 'caution',
          'The original asserts (or leaves open) this finding, but the translation denies it. ' +
            (onSyn.highRisk ? SHOWN_AS_WRITTEN_EN : CONFIRM_EN),
          '原文肯定（或保留）了该发现，但译文却予以否定。' +
            (onSyn.highRisk ? SHOWN_AS_WRITTEN_ZH : CONFIRM_ZH),
        ),
        severity,
      );
    }
  }
}

// ============================================================================
// R8 — dose
// ============================================================================
function evaluateDoses(
  srcIm: Immutable[],
  outIm: Immutable[],
  sourceText: string,
  translatedText: string,
  srcLang: 'en' | 'zh',
  outLang: 'en' | 'zh',
  add: (f: GuardFlag, raiseTo: SegmentAction) => void,
): void {
  const srcDoses = srcIm.filter((i) => i.type === 'dosage');
  const outDoses = outIm.filter((i) => i.type === 'dosage');

  for (const sd of srcDoses) {
    // --- Range dose (FM-08) is handled first: a source range requires BOTH
    // endpoints to survive, and we match a candidate by EITHER endpoint so a
    // collapse to one endpoint reads as range-incomplete, not amount-divergence.
    if (sd.range) {
      const rangeCandidate =
        outDoses.find(
          (od) =>
            od.unitDim === sd.unitDim &&
            (od.range
              ? od.range.min === sd.range!.min && od.range.max === sd.range!.max
              : od.amount === sd.range!.min || od.amount === sd.range!.max),
        ) ??
        outDoses.find((od) => od.unitDim === sd.unitDim) ??
        outDoses[0];

      if (!rangeCandidate) {
        add(doseNotPreservedFlag(sd.raw), 'flag');
        continue;
      }
      if (rangeCandidate.unitDim !== sd.unitDim) {
        add(unitDimensionMismatchFlag(sd.raw), 'abstain');
        continue;
      }
      const fullRangeSurvives =
        rangeCandidate.range &&
        rangeCandidate.range.min === sd.range.min &&
        rangeCandidate.range.max === sd.range.max;
      if (!fullRangeSurvives) {
        add(
          flag(
            'R8-DOSE-RANGE-INCOMPLETE',
            'caution',
            `The dose range was collapsed to a single value (original: ${sd.raw}). ` + CONFIRM_EN,
            `剂量范围被压缩为单一数值（原文：${sd.raw}）。` + CONFIRM_ZH,
          ),
          'flag',
        );
      }
      continue; // range handled; frequency is moot for a collapsed range
    }

    // Find an output dose with the same amount (preferred) or, failing that, the
    // closest candidate by unit dimension, so we can diagnose the divergence.
    const sameAmount = outDoses.find((od) => od.amount === sd.amount);
    const candidate =
      sameAmount ??
      outDoses.find((od) => od.unitDim === sd.unitDim) ??
      outDoses[0];

    if (!candidate) {
      // No dose survived at all → not preserved.
      add(doseNotPreservedFlag(sd.raw), 'flag');
      continue;
    }

    // --- Unit dimension mismatch (FM-06) → abstain (1000× error class).
    if (sd.unitDim !== candidate.unitDim) {
      add(unitDimensionMismatchFlag(sd.raw), 'abstain');
      continue;
    }

    // --- Amount divergence (FM-05 rounding, FM-09 decimal).
    if (sd.amount !== candidate.amount) {
      const ratio = magnitudeRatio(sd.amount ?? '', candidate.amount ?? '');
      add(doseNotPreservedFlag(sd.raw), ratio !== null && ratio >= 2 ? 'abstain' : 'flag');
      if (ratio !== null && ratio >= 2) {
        add(
          flag(
            'R8-DOSE-MAGNITUDE-DIVERGENCE',
            'urgent',
            `The dose changed by ${ratio.toFixed(1)}× in translation (original: ${sd.raw}). ` + SHOWN_AS_WRITTEN_EN,
            `译文中剂量变化达 ${ratio.toFixed(1)} 倍（原文：${sd.raw}）。` + SHOWN_AS_WRITTEN_ZH,
          ),
          'abstain',
        );
      }
      continue; // amount already flagged; range/frequency are moot for this dose
    }

    // (A source RANGE dose is fully handled at the top of the loop and never
    // reaches here, so scalar amount comparison above is exhaustive.)

    // --- Frequency dropped (FM-07) — compared cross-lingually by concept so a
    // faithful translation (FM-17) does NOT false-positive.
    const srcFreq = frequencyConcept(sourceText, srcLang);
    if (srcFreq) {
      const outFreq = frequencyConcept(translatedText, outLang);
      if (outFreq !== srcFreq) {
        add(
          flag(
            'R8-DOSE-FREQUENCY-DROPPED',
            'caution',
            `The dosing frequency was lost in translation (original: ${sd.raw}, ${srcFreq.toUpperCase()}). ` +
              CONFIRM_EN,
            `译文中遗漏了服药频次（原文：${sd.raw}，${srcFreq.toUpperCase()}）。` + CONFIRM_ZH,
          ),
          'flag',
        );
      }
    }
  }
}

function doseNotPreservedFlag(raw: string): GuardFlag {
  return flag(
    'R8-DOSE-NOT-PRESERVED',
    'caution',
    `The dose amount differs from the original (${raw}). ` + CONFIRM_EN,
    `剂量与原文不一致（原文：${raw}）。` + CONFIRM_ZH,
  );
}

function unitDimensionMismatchFlag(raw: string): GuardFlag {
  return flag(
    'R8-DOSE-UNIT-DIMENSION-MISMATCH',
    'urgent',
    `The dose unit changed in translation (original: ${raw}). This can be a large dosing error. ` +
      SHOWN_AS_WRITTEN_EN,
    `译文中剂量单位发生了改变（原文：${raw}）。这可能是严重的剂量错误。` + SHOWN_AS_WRITTEN_ZH,
  );
}

// ============================================================================
// R8 — bare numbers
// ============================================================================
function evaluateBareNumbers(
  srcIm: Immutable[],
  outIm: Immutable[],
  add: (f: GuardFlag, raiseTo: SegmentAction) => void,
): void {
  const srcNums = srcIm.filter((i) => i.type === 'number').map((i) => i.amount);
  const outNums = new Set(
    outIm.filter((i) => i.type === 'number').map((i) => i.amount),
  );
  // A source bare number that also appears as a dose amount in the output counts
  // as preserved (it just changed role); include output dose amounts too.
  for (const od of outIm.filter((i) => i.type === 'dosage')) {
    if (od.amount) outNums.add(od.amount);
  }
  for (const n of srcNums) {
    if (n === undefined) continue;
    if (!outNums.has(n)) {
      add(
        flag(
          'R8-NUMBER-NOT-PRESERVED',
          'caution',
          `A number from the original is missing or altered in the translation (${n}). ` + CONFIRM_EN,
          `译文中遗漏或改动了原文中的数字（${n}）。` + CONFIRM_ZH,
        ),
        'flag',
      );
    }
  }
}

// ============================================================================
// R9 — drug name
// ============================================================================
function evaluateDrugs(
  srcIm: Immutable[],
  outIm: Immutable[],
  sourceText: string,
  translatedText: string,
  srcLang: 'en' | 'zh',
  outLang: 'en' | 'zh',
  add: (f: GuardFlag, raiseTo: SegmentAction) => void,
): void {
  // Known drug ids from the detector, augmented with the supplemental list.
  const srcKnown = new Set<string>(
    srcIm.filter((i) => i.type === 'drug' && i.drugId).map((i) => i.drugId as string),
  );
  const outKnown = new Set<string>(
    outIm.filter((i) => i.type === 'drug' && i.drugId).map((i) => i.drugId as string),
  );
  for (const id of detectSupplementalDrugs(sourceText, srcLang)) srcKnown.add(id);
  for (const id of detectSupplementalDrugs(translatedText, outLang)) outKnown.add(id);

  // Unknown med-context tokens from the source detector (drugId === null).
  const srcUnknownTokens = srcIm
    .filter((i) => i.type === 'drug' && i.drugId === null)
    .map((i) => i.raw);

  // --- Drug substitution (FM-11): a source known drug resolves to a DIFFERENT
  // known drug in the output (and is itself absent from the output) → abstain.
  for (const id of srcKnown) {
    if (outKnown.has(id)) continue; // preserved
    // The source drug is gone. If the output names a different known drug,
    // it's a substitution. (Bare base-name like metoprolol staying is handled by
    // the outKnown.has check above.)
    if (outKnown.size > 0) {
      add(
        flag(
          'R9-DRUG-SUBSTITUTED',
          'urgent',
          'The medication name in the translation differs from the original. ' + SHOWN_AS_WRITTEN_EN,
          '译文中的药品名称与原文不同。' + SHOWN_AS_WRITTEN_ZH,
        ),
        'abstain',
      );
    }
  }

  // --- Unknown drug altered (FM-13): a source unknown med-context token must
  // appear verbatim in the output. If it doesn't (and the output substitutes a
  // drug-like word), abstain — we cannot verify the LLM's guess.
  for (const tok of srcUnknownTokens) {
    if (!tok) continue;
    if (translatedText.includes(tok)) continue; // preserved verbatim
    // The unknown drug was not carried over. If the output introduces any drug
    // (known or supplemental), it altered an unverifiable drug.
    const outNamesADrug =
      outIm.some((i) => i.type === 'drug') ||
      detectSupplementalDrugs(translatedText, outLang).length > 0;
    if (outNamesADrug) {
      add(
        flag(
          'R9-UNKNOWN-DRUG-ALTERED',
          'urgent',
          'The original names a medication we cannot verify, and the translation changed it. ' + SHOWN_AS_WRITTEN_EN,
          '原文中的药品我们无法核验，而译文对其作了改动。' + SHOWN_AS_WRITTEN_ZH,
        ),
        'abstain',
      );
    }
  }

  // --- Dropped salt / release qualifier (FM-12): a base drug correctly survives
  // but a salt/release qualifier present in the source is missing in the output.
  for (const q of SALT_RELEASE_QUALIFIERS) {
    const srcHas = srcLang === 'zh' ? sourceText.includes(q.zh) : q.en.some((e) => sourceText.toLowerCase().includes(e.trim()));
    if (!srcHas) continue;
    const outLower = translatedText.toLowerCase();
    const outHas =
      translatedText.includes(q.zh) || q.en.some((e) => outLower.includes(e.trim()));
    // Only material when a base drug actually survived (otherwise substitution
    // already covers it).
    const baseSurvived = [...srcKnown].some((id) => outKnown.has(id));
    if (!outHas && baseSurvived) {
      add(
        flag(
          'R9-DRUG-QUALIFIER-DROPPED',
          'caution',
          'A salt or extended-release form from the original drug name is missing in the translation. ' + CONFIRM_EN,
          '译文中遗漏了原文药名中的盐型或缓释剂型信息。' + CONFIRM_ZH,
        ),
        'flag',
      );
    }
  }
}

// ============================================================================
// R9 — result polarity (阳性 / 阴性)
// ============================================================================
function evaluateResultPolarity(
  sourceText: string,
  translatedText: string,
  add: (f: GuardFlag, raiseTo: SegmentAction) => void,
): void {
  const srcPol = detectResultPolarity(sourceText);
  const outPol = detectResultPolarity(translatedText);
  if (srcPol && outPol && srcPol !== outPol) {
    add(
      flag(
        'R9-RESULT-POLARITY-FLIP',
        'urgent',
        'A positive/negative test result was flipped in translation. ' + SHOWN_AS_WRITTEN_EN,
        '译文中检验结果的阳性/阴性发生了颠倒。' + SHOWN_AS_WRITTEN_ZH,
      ),
      'abstain',
    );
  }
}

// Re-export for callers that align LLM segments to source clauses.
export { splitClauses };
