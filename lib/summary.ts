import type { Classification, GroundedReport, GroundedRow } from '@/lib/types';
import { disclaimers } from '@/lib/disclaimers';

export type Lang = 'en' | 'zh';

export interface SummarySection {
  key: string; // entry key or a synthetic id for unknowns
  title: string; // analyte name in the chosen language
  valueText: string; // "7.8 mmol/L" or the raw printed value
  status: Classification;
  statusLabel: string; // localized label
  plain: string; // plain-language meaning ('' when unclassified)
  flags: { severity: string; message: string }[];
  source: string;
}

const STATUS_LABEL: Record<Classification, { en: string; zh: string }> = {
  low: { en: 'Low', zh: '偏低' },
  normal: { en: 'Normal', zh: '正常' },
  high: { en: 'High', zh: '偏高' },
  critical: { en: 'Critical — seek care', zh: '危急 — 请就医' },
  unclassified: { en: 'Not interpreted', zh: '未作解读' },
};

function valueText(row: GroundedRow): string {
  const v = row.extracted.value ?? '—';
  const u = row.extracted.unit ? ` ${row.extracted.unit}` : '';
  return `${v}${u}`;
}

export function buildSummary(
  report: GroundedReport,
  lang: Lang,
): { sections: SummarySection[]; disclaimers: string[] } {
  const sections: SummarySection[] = report.rows.map((row, i) => {
    const entry = row.entry;
    const title = entry ? (lang === 'zh' ? entry.nameZh : entry.nameEn) : row.extracted.name;
    const plain =
      entry && row.action === 'classify' ? (lang === 'zh' ? entry.plainZh : entry.plainEn) : '';
    return {
      key: entry?.key ?? `row-${i}`,
      title,
      valueText: valueText(row),
      status: row.classification,
      statusLabel: STATUS_LABEL[row.classification][lang],
      plain,
      flags: row.flags.map((f) => ({
        severity: f.severity,
        message: lang === 'zh' ? f.messageZh : f.messageEn,
      })),
      source: entry?.source ?? '',
    };
  });

  return { sections, disclaimers: disclaimers(lang) };
}
