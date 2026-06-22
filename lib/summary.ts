import type { Classification, GroundedReport, GroundedRow, ReferenceEntry, Sex } from '@/lib/types';
import { resolveBounds } from '@/lib/reference';
import { disclaimers } from '@/lib/disclaimers';

export type Lang = 'en' | 'zh';

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
  status: Classification;
  statusLabelEn: string;
  statusLabelZh: string;
  plainEn: string; // '' when unclassified / abstained
  plainZh: string;
  flags: SummaryFlag[];
  refRange: string; // our curated comparison range, '' when no entry
  source: string;
}

const STATUS_LABEL: Record<Classification, { en: string; zh: string }> = {
  low: { en: 'Low', zh: '偏低' },
  normal: { en: 'In range', zh: '正常' },
  high: { en: 'High', zh: '偏高' },
  critical: { en: 'Confirm with clinician', zh: '请与医生确认' },
  unclassified: { en: 'Not assessed', zh: '未评估' },
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
    const classified = entry !== null && row.action === 'classify';
    return {
      key: entry?.key ?? `row-${i}`,
      nameEn: entry ? entry.nameEn : row.extracted.name,
      nameZh: entry ? entry.nameZh : row.extracted.name,
      valueText: valueText(row),
      status: row.classification,
      statusLabelEn: STATUS_LABEL[row.classification].en,
      statusLabelZh: STATUS_LABEL[row.classification].zh,
      plainEn: classified ? entry!.plainEn : '',
      plainZh: classified ? entry!.plainZh : '',
      flags: row.flags.map((f) => ({
        severity: f.severity,
        messageEn: f.messageEn,
        messageZh: f.messageZh,
      })),
      refRange: entry ? formatRefRange(entry, report.sex, report.age) : '',
      source: entry?.source ?? '',
    };
  });

  return { sections, disclaimers: disclaimers(lang) };
}
