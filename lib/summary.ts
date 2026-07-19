import type { Classification, GroundedReport, GroundedRow, ReferenceEntry, Sex } from '@/lib/types';
import {
  resolveBounds,
  parsePrintedRange,
  parseQualitative,
  parseScalar,
  parseValueRange,
  statusAgainstPrinted,
  statusQualitativeAgainstPrinted,
  statusRangeAgainstPrinted,
} from '@/lib/reference';
import { disclaimers } from '@/lib/disclaimers';
import {
  defineText,
  fallback,
  reviewed,
  unverified,
  type Lang,
  type LocalizedText,
} from '@/lib/i18n';

export type { Lang } from '@/lib/i18n';
export type ReportStatus = 'below' | 'within' | 'above' | 'outside' | 'none';

export interface SummaryFlag {
  severity: string;
  message: LocalizedText;
}

export interface SummarySection {
  key: string;
  name: LocalizedText;
  valueText: string; // "7.8 mmol/L" or the raw printed value
  tone: string; // CSS/color tone (low|normal|high|unclassified|critical) — see note below
  chip: LocalizedText; // the status chip label
  // CARD education text: a DIRECTION-NEUTRAL definition of what the test is (entry.definition).
  // It renders directly beneath the report-relative chip, so it must NEVER state what a high/low
  // value means — that composition is a patient-specific verdict (Codex blocker #2). '' when
  // unclassified / abstained. Policed by validation/b1VerdictLeakage.test.ts.
  plain: LocalizedText;
  // GLOSSARY text: the fuller description (entry.plain) carrying directional/reference nuance.
  // Reserved for a separate glossary one tap away from the patient's number — NOT rendered beneath
  // the chip. '' when unclassified / abstained.
  glossary: LocalizedText;
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
const REPORT_STATUS_LABEL: Record<ReportStatus, LocalizedText> = {
  below: defineText({
    en: reviewed('Below your report’s range'),
    zh: reviewed('低于报告所列范围'),
    bo: fallback('zh'),
  }),
  within: defineText({
    en: reviewed('Within your report’s range'),
    zh: reviewed('在报告所列范围内'),
    bo: fallback('zh'),
  }),
  above: defineText({
    en: reviewed('Above your report’s range'),
    zh: reviewed('高于报告所列范围'),
    bo: fallback('zh'),
  }),
  outside: defineText({
    en: reviewed('Outside your report’s range'),
    zh: reviewed('不在报告所列范围内'),
    bo: fallback('zh'),
  }),
  none: defineText({
    en: reviewed('Ask your clinician to interpret'),
    zh: reviewed('请由医生解读'),
    bo: fallback('zh'),
  }),
};

// Abstained rows never assert a comparison (the value itself is uncertain / unrecognized) —
// so they never carry a verdict chip. low/normal/high map to "Not assessed" defensively: an
// abstained row should always be 'unclassified', but if any future guard path abstains while
// leaving a classification set, this must not leak "Low"/"High" as a verdict (B1 gate).
const NOT_ASSESSED = defineText({
  en: reviewed('Not assessed'),
  zh: reviewed('未评估'),
  bo: fallback('zh'),
});

const ABSTAIN_LABEL: Record<Classification, LocalizedText> = {
  low: NOT_ASSESSED,
  normal: NOT_ASSESSED,
  high: NOT_ASSESSED,
  critical: REPORT_STATUS_LABEL.none,
  unclassified: NOT_ASSESSED,
};

// Empty content is absence, not reviewed clinical copy. Keeping it outside the
// review taxonomy prevents future localization audits from counting placeholders
// as human-reviewed strings.
const EMPTY_LOCALIZED_TEXT: LocalizedText = defineText({
  en: { text: '' },
  zh: { text: '' },
  bo: fallback('zh'),
});

// B1 RULE (see validation/b1VerdictLeakage.test.ts): a user-visible message may describe only
// (a) our confidence in the READING, or (b) the REPORT'S OWN information — never a conclusion
// about the patient's value derived from our table. Speakable flags are limited to our reading,
// our supported scope, or the report's own content (for example R6 and R13 reading checks).
// Clinical guard conclusions (R3/R4/R11/R12/R2b) stay INTERNAL: they still drive needsConfirm
// and feed the confirm-burden metrics, but are not spoken.
// The guard computes; the summary decides what is speakable.
//   R16 — "the range doesn't appear to use the same units as the value; check your report"
//         (about the REPORT'S OWN content + our ability to read it — not a verdict on the value.
//         It must be speakable: R16 suppresses the chip, and a bare "Ask your clinician to
//         interpret" with no reason is worse than useless when we know exactly why we deferred.)
const SURFACING_FLAGS = new Set([
  'R6-HIGH-STAKES-MANDATORY-CONFIRM',
  'R13-IMPLAUSIBLE-VALUE',
  // R1 states that the test is NOT in our reference set — a fact about OUR SCOPE, not a conclusion
  // about the patient's value, so it is speakable under the same rule that permits R6 and R13.
  // It must be spoken: the chip is decoupled from recognition, so on the real corpora 126 rows
  // (27.1%; 83 independently labelled high-stakes) asserted a position for an analyte we could not
  // name, with no disclosure at all. Silence let a reproduction of the report's own arithmetic read
  // as understanding of the test.
  'R1-UNKNOWN-ANALYTE',
  // R2 is the same category as R1 — a statement about OUR capability (we do not hold this unit),
  // not a conclusion about the value. It must be spoken for the same reason: adding a curated
  // entry moved rows from R1 (spoken) to R2 (silent), so recognising an analyte was making the
  // user WORSE informed. Seen on Troponin T, whose corpus rows print ng/mL against our ng/L band.
  'R2-UNIT-MISMATCH',
  'R16-PRINTED-RANGE-UNIT-SUSPECT',
  // R18 speaks only about our confidence in the specimen match. It must be
  // visible because the row abstains while its report-relative chip may still
  // reproduce the range printed on the report.
  'R18-SPECIMEN-MATCH-UNCORROBORATED',
]);

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
  // Each result shape has its own whole-field parser. Never relax parseScalar:
  // ranges such as "3-15" must reach parseValueRange, not silently become 3.
  const printed = parsePrintedRange(row.extracted.printedRange);
  const scalar = statusAgainstPrinted(parseScalar(row.extracted.value), printed);
  if (scalar !== 'none') return scalar;

  const qualitative = statusQualitativeAgainstPrinted(
    parseQualitative(row.extracted.value),
    parseQualitative(row.extracted.printedRange),
  );
  if (qualitative !== 'none') return qualitative;

  return statusRangeAgainstPrinted(parseValueRange(row.extracted.value), printed);
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
const REPORT_TONE: Record<ReportStatus, string> = {
  below: 'report',
  within: 'report',
  above: 'report',
  outside: 'report',
  none: 'unclassified',
};

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
    const handled = entry !== null && row.action === 'classify';
    const curated = handled && entry.interpretation === 'ours';

    // DECOUPLED (grilling Q1): the chip reproduces the report's OWN printed range — pure
    // arithmetic on the page, no table lookup — so it is NOT gated on whether we recognise the
    // analyte. Gating it on recognition discarded ~28 points of deliverable coverage (US:
    // recognition ~47% vs rows-with-a-printed-range ~75%) on rows where we can faithfully
    // reproduce what the report already says.
    // The suppressors are the two cases where we have POSITIVE EVIDENCE that one side of the
    // comparison is unusable — asserting a position from an input we believe is wrong is worse
    // than deferring:
    //   R13 — the VALUE was misread.
    //   R16 — the printed RANGE cannot be in the unit we assumed (Codex #5), so raw-value-vs-raw-
    //         range is comparing two different units. This produced inverted chips on real
    //         mixed-unit reports ("Below your report's range" for a value genuinely above it).
    // Both are per-analyte table lookups, so an UNRECOGNISED analyte carries neither: the "no net"
    // cost accepted in Q2 applies to R16 too — we cannot detect a unit mismatch we can't scale.
    const unusable = row.flags.some(
      (f) => f.id === 'R13-IMPLAUSIBLE-VALUE' || f.id === 'R16-PRINTED-RANGE-UNIT-SUSPECT',
    );
    const rs: ReportStatus = unusable ? 'none' : reportStatus(row);
    const defer = rs === 'none';
    // R17 does NOT suppress the chip: the chip is the report's own arithmetic and stays correct
    // whatever specimen the row is. What it suppresses is OUR band being shown beside it.
    const bandNotComparable = row.flags.some((f) => f.id === 'R17-BAND-NOT-COMPARABLE');

    let tone: string;
    let chip: LocalizedText;
    if (!defer) {
      tone = REPORT_TONE[rs];
      chip = REPORT_STATUS_LABEL[rs];
    } else if (handled) {
      tone = REPORT_TONE.none;
      chip = REPORT_STATUS_LABEL.none; // "Ask your clinician to interpret"
    } else {
      tone = row.classification; // abstained/unknown rows keep the neutral abstain framing
      chip = ABSTAIN_LABEL[row.classification];
    }

    return {
      key: entry?.key ?? `row-${i}`,
      // A matched entry is not enough to trust its curated name: an abstention
      // means the guard could not safely establish that the entry describes this
      // row. Keep the report's verbatim name and mark it unverified.
      name: handled
        ? entry.name
        : defineText({
            en: unverified(row.extracted.name),
            zh: unverified(row.extracted.name),
            bo: unverified(row.extracted.name),
          }),
      valueText: valueText(row),
      tone,
      chip,
      // CARD: the direction-neutral definition (never the directional plain — that is glossary-only).
      plain: handled ? entry!.definition : EMPTY_LOCALIZED_TEXT,
      // GLOSSARY: the fuller description, surfaced separately (not beneath the chip).
      glossary: handled ? entry!.plain : EMPTY_LOCALIZED_TEXT,
      flags: row.flags
        .filter((f) => SURFACING_FLAGS.has(f.id))
        .map((f) => ({ severity: f.severity, message: f.message })),
      // The report's OWN range is faithfully reproduced whenever present, even
      // when we cannot parse it or compute a position from it. Our curated range
      // and education still require a safely handled entry.
      reportRange: row.extracted.printedRange ?? '',
      // R17: our band does not overlap the report's printed range, so it is almost certainly not
      // measuring this row (usually a different SPECIMEN under the same name — the urine-vs-serum
      // β2-microglobulin case). Presenting it as "Typical range" beside the patient's number is a
      // wrong-range claim, so we withhold it and its provenance rather than guess the specimen.
      typicalRange: curated && !bandNotComparable ? formatRefRange(entry!, report.sex, report.age) : '',
      source: curated && !bandNotComparable ? (entry!.source ?? '') : '',
    };
  });

  return { sections, disclaimers: disclaimers(lang) };
}
