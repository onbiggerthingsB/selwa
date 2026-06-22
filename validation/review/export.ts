// Clinician-review export (M4.4).
//
// Emits the corpus cases that need a human verdict (gold labels) to a CSV/JSON a
// clinician or bilingual reviewer can fill in. Pair with import.ts to fold the
// verdicts back. Used when dropping real de-identified reports into the corpus
// (see validation/corpus/README.md): the raw text is exported, a reviewer labels
// shouldAbstain / highStakes / abstainReason / the immutables, and import.ts
// merges them.

import type { CorpusCase } from '../types';

export interface ReviewRow {
  id: string;
  lang: string;
  kind: string;
  sourceText: string;
  // Reviewer fills these in:
  goldTranslation: string;
  shouldAbstain: string; // 'true' | 'false'
  highStakes: string; // 'true' | 'false'
  abstainReason: string; // one of the enum values, or '' when shouldAbstain is false
}

const CSV_COLUMNS: Array<keyof ReviewRow> = [
  'id',
  'lang',
  'kind',
  'sourceText',
  'goldTranslation',
  'shouldAbstain',
  'highStakes',
  'abstainReason',
];

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Build the review rows for cases that still need a verdict. */
export function toReviewRows(cases: CorpusCase[]): ReviewRow[] {
  return cases.map((c) => ({
    id: c.id,
    lang: c.lang,
    kind: c.kind,
    sourceText: c.sourceText,
    goldTranslation: c.goldTranslation,
    shouldAbstain: String(c.shouldAbstain),
    highStakes: String(c.highStakes),
    abstainReason: c.abstainReason ?? '',
  }));
}

/** Serialize review rows to CSV (header + one row per case). */
export function toReviewCsv(cases: CorpusCase[]): string {
  const rows = toReviewRows(cases);
  const header = CSV_COLUMNS.join(',');
  const body = rows.map((r) => CSV_COLUMNS.map((col) => csvEscape(r[col])).join(','));
  return [header, ...body].join('\n') + '\n';
}

/** Serialize review rows to JSON. */
export function toReviewJson(cases: CorpusCase[]): string {
  return JSON.stringify(toReviewRows(cases), null, 2) + '\n';
}
