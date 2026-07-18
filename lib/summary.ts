import type { Classification, GroundedReport, GroundedRow, ReferenceEntry, Sex } from '@/lib/types';
import { resolveBounds, parsePrintedRange, parseScalar, statusAgainstPrinted } from '@/lib/reference';
import { disclaimers } from '@/lib/disclaimers';

export type Lang = 'en' | 'zh';
export type ReportStatus = 'below' | 'within' | 'above' | 'none';

export interface SummaryFlag {
  severity: string;
  messageEn: string;
  messageZh: string;
}

export interface SummarySection {
  key: string;
  nameEn: string;
  nameZh: string;
  valueText: string; // "7.8 mmol/L" or the raw printed value
  tone: string; // CSS/color tone (low|normal|high|unclassified|critical) — see note below
  chipEn: string; // the status chip label
  chipZh: string;
  // CARD education text: a DIRECTION-NEUTRAL definition of what the test is (entry.definitionEn/Zh).
  // It renders directly beneath the report-relative chip, so it must NEVER state what a high/low
  // value means — that composition is a patient-specific verdict (Codex blocker #2). '' when
  // unclassified / abstained. Policed by validation/b1VerdictLeakage.test.ts.
  plainEn: string;
  plainZh: string;
  // GLOSSARY text: the fuller description (entry.plainEn/Zh) carrying directional/reference nuance.
  // Reserved for a separate glossary one tap away from the patient's number — NOT rendered beneath
  // the chip. '' when unclassified / abstained.
  glossaryEn: string;
  glossaryZh: string;
  flags: SummaryFlag[];
  reportRange: string; // the range PRINTED ON THE REPORT (verbatim), '' when none
  typicalRange: string; // our curated range, shown as GENERAL context (varies by lab), '' when no entry
  source: string;
}

// B1 comprehension framing (see docs/superpowers/specs/2026-07-15-beachhead-pipl-fda-memo.md):
// the app must NOT surface an independent verdict on the patient's own value. So the visible
// chip reproduces where the value sits in the RANGE PRINTED ON THE REPORT (faithful translation
// of the report's own information); our own low/normal/high classification stays INTERNAL and
// only drives the safety guards / flags. When the report prints no range, we do not assert a
// verdict — we defer to the clinician.
const REPORT_STATUS_LABEL: Record<ReportStatus, { en: string; zh: string }> = {
  below: { en: 'Below your report’s range', zh: '低于报告所列范围' },
  within: { en: 'Within your report’s range', zh: '在报告所列范围内' },
  above: { en: 'Above your report’s range', zh: '高于报告所列范围' },
  none: { en: 'Ask your clinician to interpret', zh: '请由医生解读' },
};

// Abstained rows never assert a comparison (the value itself is uncertain / unrecognized) —
// so they never carry a verdict chip. low/normal/high map to "Not assessed" defensively: an
// abstained row should always be 'unclassified', but if any future guard path abstains while
// leaving a classification set, this must not leak "Low"/"High" as a verdict (B1 gate).
const ABSTAIN_LABEL: Record<Classification, { en: string; zh: string }> = {
  low: { en: 'Not assessed', zh: '未评估' },
  normal: { en: 'Not assessed', zh: '未评估' },
  high: { en: 'Not assessed', zh: '未评估' },
  critical: { en: 'Ask your clinician to interpret', zh: '请由医生解读' },
  unclassified: { en: 'Not assessed', zh: '未评估' },
};

// B1 RULE (see validation/b1VerdictLeakage.test.ts): a user-visible message may describe only
// (a) our confidence in the READING, or (b) the REPORT'S OWN information — never a conclusion
// about the patient's value derived from our table. So ONLY these two flags are speakable:
//   R6  — "confirm the value we read"      (routing; about our reading)
//   R13 — "we may have misread it"          (routing; about our reading)
// Everything else (R3 critical verdict+triage, R4 "your value is outside the usual range",
// R11/R12/R2b which reveal we judged the value against OUR range) stays INTERNAL: it still
// drives needsConfirm and still feeds the confirm-burden metrics — it just isn't spoken.
// The guard computes; the summary decides what is speakable.
const SURFACING_FLAGS = new Set(['R6-HIGH-STAKES-MANDATORY-CONFIRM', 'R13-IMPLAUSIBLE-VALUE']);

// Reproduce the report's OWN determination: where does the value sit in the range PRINTED on
// the report? Uses the raw value + raw printed range (report's own units) — pure arithmetic on
// what is visible on the page, not our reference table.
function reportStatus(row: GroundedRow): ReportStatus {
  // MUST use the RAW extracted value, NOT row.valueNum: valueNum has been CONVERTED to our SI
  // unit, while the printed range is the report's own text in the report's own units. Comparing
  // the two frames is a real bug (HCT 39% -> valueNum 0.39 vs printed "35-48" -> "Below"; a
  // normal Troponin 0.02 ng/mL -> 20 ng/L vs "0-0.04" -> "Above"). Both frames must be the
  // report's. This is also what makes the chip table-independent — pure arithmetic on the page.
  //
  // The comparison itself is DELEGATED to statusAgainstPrinted (lib/reference.ts), shared with
  // R11. A local re-implementation is how this drifted: it used Number.parseFloat (which turns
  // "3-15" into 3) and ignored bound strictness (so 5.2 read as "within" a printed "<5.2").
  return statusAgainstPrinted(parseScalar(row.extracted.value), parsePrintedRange(row.extracted.printedRange));
}

// TONE IS NEUTRAL (B1). Position within the report's range is stated in the CHIP TEXT, which is
// faithful reproduction. COLOUR is not: the tinted "abnormal" tones (low/high/critical) read as
// "this is bad" — and that is our judgment, not the report's, and it is WRONG for the many
// analytes where out-of-range is good or benign (HDL 2.5 = protective; HBsAb 569 = well
// vaccinated; a high eGFR is fine). We have no direction-of-concern data to colour by, and
// inventing one for the decoupled long tail is impossible. So every report-relative status maps
// to the untinted tone; the text carries the meaning. Cost, accepted: no at-a-glance triage —
// which B1 routes to the clinician anyway.
// 'report' is a NEUTRAL gray with no valence. Mapping these to 'normal' was a bug: --sev-normal
// is semantic GREEN, so an above-range troponin rendered as "good" — trading a false alarm for a
// false reassurance, which is strictly worse.
const REPORT_TONE: Record<ReportStatus, string> = { below: 'report', within: 'report', above: 'report', none: 'unclassified' };

function valueText(row: GroundedRow): string {
  const v = row.extracted.value ?? '—';
  const u = row.extracted.unit ? ` ${row.extracted.unit}` : '';
  return `${v}${u}`;
}

function formatRefRange(entry: ReferenceEntry, sex: Sex, age?: number): string {
  const { low, high } = resolveBounds(entry, sex, age);
  const u = entry.unit;
  if (low !== null && high !== null) return `${low}–${high} ${u}`;
  if (high !== null) return `< ${high} ${u}`;
  if (low !== null) return `≥ ${low} ${u}`;
  return '';
}

export function buildSummary(
  report: GroundedReport,
  lang: Lang,
): { sections: SummarySection[]; disclaimers: string[] } {
  const sections: SummarySection[] = report.rows.map((row, i) => {
    const entry = row.entry;
    const classified = entry !== null && row.action === 'classify';

    // DECOUPLED (grilling Q1): the chip reproduces the report's OWN printed range — pure
    // arithmetic on the page, no table lookup — so it is NOT gated on whether we recognise the
    // analyte. Gating it on recognition discarded ~28 points of deliverable coverage (US:
    // recognition ~47% vs rows-with-a-printed-range ~75%) on rows where we can faithfully
    // reproduce what the report already says.
    // The ONE suppressor: R13 means we have positive evidence the VALUE was misread — asserting
    // a position from a number we believe is wrong is worse than deferring. (Unknown analytes
    // carry no R13, since bounds are per-analyte: the "no net" cost accepted in Q2.)
    const misread = row.flags.some((f) => f.id === 'R13-IMPLAUSIBLE-VALUE');
    const rs: ReportStatus = misread ? 'none' : reportStatus(row);
    const defer = rs === 'none';

    let tone: string;
    let chipEn: string;
    let chipZh: string;
    if (!defer) {
      tone = REPORT_TONE[rs];
      chipEn = REPORT_STATUS_LABEL[rs].en;
      chipZh = REPORT_STATUS_LABEL[rs].zh;
    } else if (classified) {
      tone = REPORT_TONE.none;
      chipEn = REPORT_STATUS_LABEL.none.en; // "Ask your clinician to interpret"
      chipZh = REPORT_STATUS_LABEL.none.zh;
    } else {
      tone = row.classification; // abstained/unknown rows keep the neutral abstain framing
      chipEn = ABSTAIN_LABEL[row.classification].en;
      chipZh = ABSTAIN_LABEL[row.classification].zh;
    }

    return {
      key: entry?.key ?? `row-${i}`,
      nameEn: entry ? entry.nameEn : row.extracted.name,
      nameZh: entry ? entry.nameZh : row.extracted.name,
      valueText: valueText(row),
      tone,
      chipEn,
      chipZh,
      // CARD: the direction-neutral definition (never the directional plainEn — that is glossary-only).
      plainEn: classified ? entry!.definitionEn : '',
      plainZh: classified ? entry!.definitionZh : '',
      // GLOSSARY: the fuller description, surfaced separately (not beneath the chip).
      glossaryEn: classified ? entry!.plainEn : '',
      glossaryZh: classified ? entry!.plainZh : '',
      flags: row.flags
        .filter((f) => SURFACING_FLAGS.has(f.id))
        .map((f) => ({ severity: f.severity, messageEn: f.messageEn, messageZh: f.messageZh })),
      // The report's OWN range is the report's information — it surfaces whenever we reproduced
      // a comparison from it, known analyte or not (decoupled). Our curated range + the plain
      // education below DO need the table, so they stay gated on recognition.
      reportRange: !defer ? (row.extracted.printedRange ?? '') : '',
      typicalRange: classified ? formatRefRange(entry!, report.sex, report.age) : '',
      source: classified ? (entry!.source ?? '') : '',
    };
  });

  return { sections, disclaimers: disclaimers(lang) };
}
