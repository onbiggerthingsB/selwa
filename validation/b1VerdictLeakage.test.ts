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
// NOTE: `typicalRange` (our curated range shown as GENERAL context) and `plainEn/plainZh`
// (general education about the test) are deliberately NOT policed — FDA's own "not a device"
// examples permit reference material and translations of medical terms. The line is APPLYING
// our range to THIS patient's number, which is what the strings below would betray.

import { describe, it, expect } from 'vitest';
import { groundExtraction } from '@/lib/grounding';
import { buildSummary, type SummarySection } from '@/lib/summary';
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
});
