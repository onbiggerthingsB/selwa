import type { Classification, GroundedReport, GroundedRow, ReferenceEntry, Sex } from '@/lib/types';
import { resolveBounds, parsePrintedRange } from '@/lib/reference';
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
  plainEn: string; // general education about the test; '' when unclassified / abstained
  plainZh: string;
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

// Abstained rows never assert a comparison (the value itself is uncertain / unrecognized).
const ABSTAIN_LABEL: Record<Classification, { en: string; zh: string }> = {
  low: { en: 'Low', zh: '偏低' },
  normal: { en: 'In range', zh: '正常' },
  high: { en: 'High', zh: '偏高' },
  critical: { en: 'Confirm with clinician', zh: '请与医生确认' },
  unclassified: { en: 'Not assessed', zh: '未评估' },
};

// Reproduce the report's OWN determination: where does the value sit in the range PRINTED on
// the report? Uses the raw value + raw printed range (report's own units) — pure arithmetic on
// what is visible on the page, not our reference table.
function reportStatus(row: GroundedRow): ReportStatus {
  const pr = parsePrintedRange(row.extracted.printedRange);
  const v = row.valueNum;
  if (!pr || v === null) return 'none';
  if (pr.low !== null && v < pr.low) return 'below';
  if (pr.high !== null && v > pr.high) return 'above';
  return 'within';
}

// Map the report-relative status to the existing CSS tone classes (reused, no new styles).
const REPORT_TONE: Record<ReportStatus, string> = { below: 'low', within: 'normal', above: 'high', none: 'unclassified' };

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

    let tone: string;
    let chipEn: string;
    let chipZh: string;
    if (classified) {
      const rs = reportStatus(row);
      tone = REPORT_TONE[rs];
      chipEn = REPORT_STATUS_LABEL[rs].en;
      chipZh = REPORT_STATUS_LABEL[rs].zh;
    } else {
      tone = row.classification; // 'unclassified' / 'critical' etc. keep the abstain framing
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
      plainEn: classified ? entry!.plainEn : '',
      plainZh: classified ? entry!.plainZh : '',
      flags: row.flags.map((f) => ({ severity: f.severity, messageEn: f.messageEn, messageZh: f.messageZh })),
      // Ranges only on classified rows — abstained/unknown rows stay neutral (value + flags only).
      reportRange: classified ? (row.extracted.printedRange ?? '') : '',
      typicalRange: classified ? formatRefRange(entry!, report.sex, report.age) : '',
      source: classified ? (entry!.source ?? '') : '',
    };
  });

  return { sections, disclaimers: disclaimers(lang) };
}
