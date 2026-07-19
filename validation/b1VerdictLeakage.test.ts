// B1 VERDICT-LEAKAGE GATE.
//
// The decided framing (docs/superpowers/specs/2026-07-15-beachhead-pipl-fda-memo.md) is B1
// "comprehension": the app may describe (a) our confidence in the READING, or (b) the REPORT'S
// OWN information — but must NEVER surface a conclusion about the patient's own value derived
// from our reference table. That is the FDA bright line ("applying a reference range to the
// individual's own number to output a patient-specific normal/abnormal determination"), and
// per the memo the non-device lane also forbids triage/urgency signals.
//
// WHY THIS TEST EXISTS: B1 was shipped half-done once already — the chip was reframed while the
// guard flags kept asserting verdicts ("This value is in a critical range... seek medical advice",
// "your value is outside the usual range"). A prose rule cannot hold that line; this gate can.
// If a future change reintroduces a verdict into user-visible text, this fails.
//
// NOTE: `typicalRange` (our curated range shown as GENERAL context) and the GLOSSARY text
// (SummarySection.glossary, sourced from entry.plain) are deliberately NOT policed —
// FDA's own "not a device" examples permit reference material and translations of medical terms,
// and the glossary lives one tap away from the patient's number, never beneath the chip.
//
// WHAT CHANGED (Codex blocker #2): the app used to render the fuller descriptions — which say
// what a HIGH/LOW value MEANS ("high values can indicate diabetes", troponin's "any value above
// the 99th-percentile cutoff is abnormal and... needs urgent assessment") — DIRECTLY BENEATH the
// report-relative chip. Under a chip that already says "Above your report's range", that clause
// composes into a patient-specific verdict: the FDA bright line. The fix splits the field. The
// CARD now renders a DIRECTION-NEUTRAL definition (entry.definition → SummarySection.plain)
// and this gate POLICES it — with BANNED plus CARD_BANNED (directional-implication / threshold /
// triage patterns). The fuller text moved to the un-policed glossary. So the line held is still
// "don't apply our range to THIS number", now enforced on the education text too, not just chips.

import { describe, it, expect } from 'vitest';
import { groundExtraction } from '@/lib/grounding';
import { buildSummary, type SummarySection } from '@/lib/summary';
import { REFERENCE_LABS } from '@/data/reference-labs';
import {
  LANGS,
  resolveText,
  type Lang,
  type LocalizedText,
} from '@/lib/i18n';
import { MIMIC_US_SAMPLE } from './real-corpus/us-sample';
import { MEDREPBENCH_SAMPLE } from './real-corpus/sample';

// Text that states a conclusion about the patient's value, or triages them.
const BANNED: { re: RegExp; why: string }[] = [
  { re: /critical range/i, why: 'asserts our verdict on the value' },
  { re: /seek medical/i, why: 'triage/urgency signal (memo forbids)' },
  { re: /promptly/i, why: 'urgency signal' },
  { re: /outside the (usual|normal) range/i, why: 'asserts our verdict on the value' },
  { re: /\byour value is\b/i, why: 'asserts our verdict on the value' },
  { re: /we used a wider range/i, why: 'reveals we judged the value with our range' },
  { re: /our reference range/i, why: 'reveals we judged the value with our range' },
  { re: /危急/, why: 'ZH: asserts our verdict' },
  { re: /及时就医|尽快就医/, why: 'ZH: triage/urgency signal' },
  { re: /我们的参考范围/, why: 'ZH: reveals we judged with our range' },
  { re: /较宽的范围/, why: 'ZH: reveals we judged with our range' },
];

// CARD education text (the direction-neutral definition) has a WIDER failure surface than chips
// and flags: a leaked definition doesn't say "critical range", it says "high values can indicate
// diabetes". These patterns catch that shape — a direction word bound to an implication, a
// threshold verdict, or a triage cue — in EN and ZH. Validated to trip 0/89 shipped definitions
// while catching 37/89 EN + 25/89 ZH of the ORIGINAL directional strings (the fuller descriptions),
// so re-pointing the card back at entry.plain, or re-adding a directional clause to a definition,
// fails this gate. Applied ONLY to card education text — never to chips (fixed, allow-listed
// below) nor the glossary (permitted reference material).
const CARD_BANNED: { re: RegExp; why: string }[] = [
  { re: /\b(high|higher|elevated|raised|low|lower|reduced|abnormal|positive)\b[^.;]{0,40}\b(indicate|indicates|suggest|suggests|mean|means|signal|signals|sign of|point to|points to|warrant|warrants|warn|warns|risk)\b/i, why: 'directional implication' },
  { re: /\bcan (indicate|signal|mean|suggest|point)\b/i, why: 'implication verb' },
  { re: /\b(above|below)\b[^.;]{0,20}\b(is|are|means?|indicates?|abnormal)\b/i, why: 'threshold verdict' },
  { re: /\bneeds? (urgent|prompt|immediate)\b/i, why: 'triage' },
  { re: /\bseek\b|\battention\b/i, why: 'triage' },
  { re: /升高[^。；]{0,20}(提示|表明|意味|说明|风险)|偏[高低][^。；]{0,20}(提示|表明|意味|说明|风险)/, why: 'ZH directional implication' },
  { re: /(过低|过高|异常)[^。；]{0,12}(危险|风险|就医|紧急)/, why: 'ZH triage/verdict' },
  { re: /(须|需)(紧急|尽快|及时)(就医|处理)/, why: 'ZH triage' },
];

// The ONLY chips the user may see: the report's own position, a deferral, or "not assessed".
const ALLOWED_CHIPS = {
  en: new Set([
    'Below your report’s range',
    'Within your report’s range',
    'Above your report’s range',
    'Outside your report’s range',
    'Ask your clinician to interpret',
    'Not assessed',
  ]),
  zh: new Set([
    '低于报告所列范围',
    '在报告所列范围内',
    '高于报告所列范围',
    '不在报告所列范围内',
    '请由医生解读',
    '未评估',
  ]),
} as const;

interface NamedCopy {
  context: string;
  copy: LocalizedText;
}

function visibleCopies(s: SummarySection): NamedCopy[] {
  return [
    { context: 'chip', copy: s.chip },
    ...s.flags.map((f, i) => ({ context: `flag ${i}`, copy: f.message })),
  ];
}

/**
 * Temporary, enforceable bo policy:
 *
 * There is deliberately no Tibetan clinical copy yet. A bo request resolves the
 * existing Chinese copy, so this gate can and does scan the text the user sees.
 * Merely adding bo to a loop would be unsafe: the EN/ZH regular expressions cannot
 * police future Tibetan prose. The direct-bo tripwire below therefore MUST fail on
 * the first direct clinical string. That change may land only together with
 * medically-literate Tibetan review and Tibetan-specific leakage rules.
 *
 * Availability/verification chrome is non-clinical and is rendered and tested by
 * the localization component tests. It is not an exemption from this clinical gate.
 */
function expectSafeLocalizedCopies(
  copies: NamedCopy[],
  rules: { re: RegExp; why: string }[],
  gateName: string,
): void {
  const counts: Record<Lang, number> = { en: 0, zh: 0, bo: 0 };
  const empty: string[] = [];
  const directBo: string[] = [];
  const badBoFallback: string[] = [];
  const violations: string[] = [];

  for (const { context, copy } of copies) {
    const boVariant = copy.bo;
    if (!('fallback' in boVariant)) {
      directBo.push(context);
    } else if (boVariant.fallback !== 'zh') {
      badBoFallback.push(`${context} → ${boVariant.fallback}`);
    }

    for (const lang of LANGS) {
      const resolved = resolveText(copy, lang);
      counts[lang] += 1;
      if (resolved.text.trim().length === 0) empty.push(`${context} ${lang}`);

      if (
        lang === 'bo'
        && (
          !resolved.usedFallback
          || resolved.resolvedLang !== 'zh'
          || resolved.path.join('→') !== 'bo→zh'
        )
      ) {
        badBoFallback.push(
          `${context} → resolved=${resolved.resolvedLang}, path=${resolved.path.join('→')}`,
        );
      }

      for (const rule of rules) {
        if (rule.re.test(resolved.text)) {
          violations.push(
            `${context} ${lang}/${resolved.resolvedLang} → "${resolved.text.slice(0, 70)}" [${rule.why}]`,
          );
        }
      }
    }
  }

  expect(counts.en, `${gateName}: the gate must inspect real visible copy`).toBeGreaterThan(0);
  expect(counts.zh, `${gateName}: ZH coverage must equal EN coverage`).toBe(counts.en);
  expect(counts.bo, `${gateName}: bo fallback coverage must equal EN coverage`).toBe(counts.en);
  expect(empty, `${gateName}: a localized clinical string resolved empty`).toEqual([]);
  expect(
    directBo,
    `${gateName}: direct bo clinical copy exists. Add Tibetan-specific leakage rules and medically-literate review before removing this tripwire.`,
  ).toEqual([]);
  expect(
    badBoFallback,
    `${gateName}: bo clinical copy must explicitly resolve through the tested zh fallback`,
  ).toEqual([]);
  expect(violations, `${gateName}:\n${violations.join('\n')}`).toEqual([]);
}

function sectionsFor(name: string, value: string, unit: string | null, range: string | null): SummarySection[] {
  const rep = groundExtraction({ rows: [{ name, value, unit, printedRange: range, confidence: 'high' }] }, 'unknown');
  return buildSummary(rep, 'en').sections;
}

// Rows engineered to force each guard to fire, so the gate sees the worst case — not just
// whatever the corpus happens to contain.
const FORCING_ROWS: [string, string, string | null, string | null][] = [
  ['钾', '6.8', 'mmol/L', null], // R3 critical, no printed range
  ['钾', '6.8', 'mmol/L', '3.5-5.1'], // R3 critical WITH a printed range
  ['钾', '5.6', 'mmol/L', null], // R4 high-stakes abnormal
  ['空腹血糖', '9.9', 'mmol/L', '3.9-6.1'], // high-stakes, out of printed range
  ['谷草转氨酶', '11', 'U/L', '2-40'], // R11 value-flip
  ['钾', '40', 'mmol/L', null], // R13 implausible
  ['HCT', '39', '%', '35-48'], // R2b unit-converted
  ['血红蛋白', '130', 'g/L', null], // R12 population-sensitive
  ['Total cholesterol', '150', 'mg/dL', '3.0-5.2'], // R16 printed-range unit mismatch (surfaced)
  ['Creatinine', '1.0', 'mg/dL', '59-104'], // R16 on a high-stakes analyte
];

describe('B1 gate — no user-visible verdict about the patient’s own value', () => {
  it('guard-forcing rows surface no banned verdict/triage text', () => {
    const copies: NamedCopy[] = [];
    for (const [n, v, u, r] of FORCING_ROWS) {
      for (const s of sectionsFor(n, v, u, r)) {
        copies.push(
          ...visibleCopies(s).map(({ context, copy }) => ({
            context: `${n} ${v}${u ?? ''} ${context}`,
            copy,
          })),
        );
      }
    }
    expectSafeLocalizedCopies(copies, BANNED, 'B1 verdict leakage');
  });

  it('R18 explains an uncorroborated specimen match without making a clinical claim', () => {
    const report = groundExtraction(
      {
        rows: [
          {
            name: 'pH',
            value: '7.1',
            unit: 'pH',
            printedRange: '7.35-7.45',
            confidence: 'high',
            specimen: 'urine',
          },
        ],
      },
      'unknown',
    );
    const [section] = buildSummary(report, 'en').sections;
    const copies = visibleCopies(section).map(({ context, copy }) => ({
      context: `R18 ${context}`,
      copy,
    }));
    const visibleEn = copies.map(({ copy }) => resolveText(copy, 'en').text);
    const visibleZh = copies.map(({ copy }) => resolveText(copy, 'zh').text);
    const visibleBo = copies.map(({ copy }) => resolveText(copy, 'bo').text);

    expect(report.rows[0].flags.map((f) => f.id)).toContain('R18-SPECIMEN-MATCH-UNCORROBORATED');
    expect(visibleEn.join(' ')).toMatch(/could not corroborate the specimen/i);
    expect(visibleZh.join(' ')).toMatch(/无法用报告上打印的参考信息确认/);
    expect(visibleBo, 'bo must show the exact tested Chinese R18 disclosure').toEqual(visibleZh);
    expectSafeLocalizedCopies(copies, BANNED, 'R18 B1 verdict leakage');
  });

  it('real corpora surface no banned verdict/triage text', () => {
    const copies: NamedCopy[] = [];
    for (const corpus of [MIMIC_US_SAMPLE, MEDREPBENCH_SAMPLE]) {
      for (const rep of corpus) {
        for (const it of rep.items) {
          for (const s of sectionsFor(it.item_name, it.item_value, it.item_unit || null, it.item_range || null)) {
            copies.push(
              ...visibleCopies(s).map(({ context, copy }) => ({
                context: `${it.item_name.trim()} ${context}`,
                copy,
              })),
            );
          }
        }
      }
    }
    expectSafeLocalizedCopies(copies, BANNED, 'B1 verdict leakage on real data');
  });

  it('the chip is only ever the report’s own position, a deferral, or "not assessed"', () => {
    const bad: string[] = [];
    const copies: NamedCopy[] = [];
    const counts: Record<Lang, number> = { en: 0, zh: 0, bo: 0 };
    for (const [n, v, u, r] of FORCING_ROWS) {
      for (const s of sectionsFor(n, v, u, r)) {
        copies.push({ context: `${n} ${v}${u ?? ''} chip`, copy: s.chip });
        for (const lang of LANGS) {
          const chip = resolveText(s.chip, lang);
          counts[lang] += 1;
          if (
            (chip.resolvedLang !== 'en' && chip.resolvedLang !== 'zh')
            || !ALLOWED_CHIPS[chip.resolvedLang].has(chip.text)
          ) {
            bad.push(`${n} ${v} ${lang}/${chip.resolvedLang} → chip "${chip.text}"`);
          }
        }
      }
    }
    expectSafeLocalizedCopies(copies, [], 'B1 chip allow-list coverage');
    expect(counts.en).toBeGreaterThan(0);
    expect(counts).toEqual({ en: counts.en, zh: counts.en, bo: counts.en });
    // ABSTAIN_LABEL maps low→"Low"/high→"High": a verdict chip if ever reachable.
    expect(bad, `verdict chips:\n${bad.join('\n')}`).toEqual([]);
  });

  // EXHAUSTIVE: the card renders entry.definition verbatim, so policing the source field
  // covers every entry — not only the analytes that happen to appear in the corpora.
  it('every reference definition (the card education text) leaks no verdict or triage', () => {
    const CARD_RULES = [...BANNED, ...CARD_BANNED];
    const copies = REFERENCE_LABS.map((entry) => ({
      context: `${entry.key} card definition`,
      copy: entry.definition,
    }));
    expect(copies).toHaveLength(REFERENCE_LABS.length);
    expectSafeLocalizedCopies(copies, CARD_RULES, 'card definition leakage');
  });

  // WIRING: the card education text (SummarySection.plain) must be the DEFINITION, not the
  // fuller directional entry.plain. If a future change re-points summary.ts back at entry.plain,
  // the rendered card text stops matching entry.definition and this fails — before the directional
  // string can reach a patient beneath the chip.
  it('the rendered card text is the direction-neutral definition, not the fuller description', () => {
    const mismatches: string[] = [];
    const renderedCopies: NamedCopy[] = [];
    // Recognised, in-range values so the row classifies and the card education text is emitted.
    const CASES: [string, string, string, string][] = [
      ['Troponin I', '5', 'ng/L', 'troponin_i'],
      ['空腹血糖', '5.0', 'mmol/L', 'fasting_glucose'],
      ['血红蛋白', '140', 'g/L', 'hemoglobin'],
      ['Potassium', '4.2', 'mmol/L', 'potassium'],
    ];
    for (const [name, value, unit, key] of CASES) {
      const entry = REFERENCE_LABS.find((e) => e.key === key)!;
      const [s] = sectionsFor(name, value, unit, null);
      renderedCopies.push({ context: `${key} rendered card definition`, copy: s.plain });
      for (const lang of LANGS) {
        const card = resolveText(s.plain, lang).text;
        const definition = resolveText(entry.definition, lang).text;
        const fuller = resolveText(entry.plain, lang).text;
        if (card !== definition) {
          mismatches.push(
            `${key} ${lang}: card "${card.slice(0, 50)}" ≠ definition`,
          );
        }
        // and the fuller description must NOT be the card text
        if (card === fuller && fuller !== definition) {
          mismatches.push(`${key} ${lang}: card is rendering the fuller description`);
        }
      }
    }
    expectSafeLocalizedCopies(
      renderedCopies,
      [...BANNED, ...CARD_BANNED],
      'rendered card definition leakage',
    );
    expect(mismatches, `card wiring:\n${mismatches.join('\n')}`).toEqual([]);
  });
});
