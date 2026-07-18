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
// (SummarySection.glossaryEn/Zh, sourced from entry.plainEn/Zh) are deliberately NOT policed —
// FDA's own "not a device" examples permit reference material and translations of medical terms,
// and the glossary lives one tap away from the patient's number, never beneath the chip.
//
// WHAT CHANGED (Codex blocker #2): the app used to render the fuller plainEn/plainZh — which say
// what a HIGH/LOW value MEANS ("high values can indicate diabetes", troponin's "any value above
// the 99th-percentile cutoff is abnormal and... needs urgent assessment") — DIRECTLY BENEATH the
// report-relative chip. Under a chip that already says "Above your report's range", that clause
// composes into a patient-specific verdict: the FDA bright line. The fix splits the field. The
// CARD now renders a DIRECTION-NEUTRAL definition (entry.definitionEn/Zh, → SummarySection.plainEn/Zh)
// and this gate POLICES it — with BANNED plus CARD_BANNED (directional-implication / threshold /
// triage patterns). The fuller text moved to the un-policed glossary. So the line held is still
// "don't apply our range to THIS number", now enforced on the education text too, not just chips.

import { describe, it, expect } from 'vitest';
import { groundExtraction } from '@/lib/grounding';
import { buildSummary, type SummarySection } from '@/lib/summary';
import { REFERENCE_LABS } from '@/data/reference-labs';
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
// while catching 37/89 EN + 25/89 ZH of the ORIGINAL directional strings (the fuller plainEn/Zh),
// so re-pointing the card back at plainEn, or re-adding a directional clause to a definition,
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
const ALLOWED_CHIPS_EN = new Set([
  'Below your report’s range',
  'Within your report’s range',
  'Above your report’s range',
  'Ask your clinician to interpret',
  'Not assessed',
]);

function visibleStrings(s: SummarySection): string[] {
  return [s.chipEn, s.chipZh, ...s.flags.flatMap((f) => [f.messageEn, f.messageZh])];
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
    const violations: string[] = [];
    for (const [n, v, u, r] of FORCING_ROWS) {
      for (const s of sectionsFor(n, v, u, r)) {
        for (const text of visibleStrings(s)) {
          for (const b of BANNED) {
            if (b.re.test(text)) violations.push(`${n} ${v}${u ?? ''} → "${text.slice(0, 70)}" [${b.why}]`);
          }
        }
      }
    }
    expect(violations, `B1 verdict leakage:\n${violations.join('\n')}`).toEqual([]);
  });

  it('real corpora surface no banned verdict/triage text', () => {
    const violations: string[] = [];
    for (const corpus of [MIMIC_US_SAMPLE, MEDREPBENCH_SAMPLE]) {
      for (const rep of corpus) {
        for (const it of rep.items) {
          for (const s of sectionsFor(it.item_name, it.item_value, it.item_unit || null, it.item_range || null)) {
            for (const text of visibleStrings(s)) {
              for (const b of BANNED) if (b.re.test(text)) violations.push(`${it.item_name.trim()} → "${text.slice(0, 60)}" [${b.why}]`);
            }
          }
        }
      }
    }
    expect([...new Set(violations)], `B1 verdict leakage on real data:\n${[...new Set(violations)].join('\n')}`).toEqual([]);
  });

  it('the chip is only ever the report’s own position, a deferral, or "not assessed"', () => {
    const bad: string[] = [];
    for (const [n, v, u, r] of FORCING_ROWS) {
      for (const s of sectionsFor(n, v, u, r)) {
        if (!ALLOWED_CHIPS_EN.has(s.chipEn)) bad.push(`${n} ${v} → chip "${s.chipEn}"`);
      }
    }
    // ABSTAIN_LABEL maps low→"Low"/high→"High": a verdict chip if ever reachable.
    expect(bad, `verdict chips:\n${bad.join('\n')}`).toEqual([]);
  });

  // EXHAUSTIVE: the card renders entry.definitionEn/Zh verbatim, so policing the source field
  // covers every one of the 89 — not only the analytes that happen to appear in the corpora.
  it('every reference definition (the card education text) leaks no verdict/triage — all 89', () => {
    const violations: string[] = [];
    const CARD_RULES = [...BANNED, ...CARD_BANNED];
    for (const e of REFERENCE_LABS) {
      for (const [lang, text] of [['EN', e.definitionEn], ['ZH', e.definitionZh]] as const) {
        for (const b of CARD_RULES) {
          if (b.re.test(text)) violations.push(`${e.key} ${lang} → "${text.slice(0, 70)}" [${b.why}]`);
        }
      }
    }
    expect(violations, `card definition leakage:\n${violations.join('\n')}`).toEqual([]);
  });

  // WIRING: the card education text (SummarySection.plainEn/Zh) must be the DEFINITION, not the
  // fuller directional plainEn/Zh. If a future change re-points summary.ts back at entry.plainEn,
  // the rendered card text stops matching entry.definitionEn and this fails — before the directional
  // string can reach a patient beneath the chip.
  it('the rendered card text is the direction-neutral definition, not the fuller description', () => {
    const mismatches: string[] = [];
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
      if (s.plainEn !== entry.definitionEn) mismatches.push(`${key}: card EN "${s.plainEn.slice(0, 50)}" ≠ definitionEn`);
      if (s.plainZh !== entry.definitionZh) mismatches.push(`${key}: card ZH "${s.plainZh.slice(0, 30)}" ≠ definitionZh`);
      // and the fuller description must NOT be the card text
      if (s.plainEn === entry.plainEn && entry.plainEn !== entry.definitionEn) mismatches.push(`${key}: card is rendering the fuller plainEn`);
    }
    expect(mismatches, `card wiring:\n${mismatches.join('\n')}`).toEqual([]);
  });
});
