import type { ExtractedField, ExtractionSample } from './types';

const FIELDS = ['name', 'value', 'unit', 'referenceRange', 'abnormalFlag'] as const;
type Field = (typeof FIELDS)[number];

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '').trim();
}

// Match a predicted row to a gold row by normalized name (the row key MedRepBench
// uses); recall is computed per field over gold rows.
export interface RecallResult {
  perField: Record<Field, number>;
  overall: number;
}

export function fieldRecall(predicted: ExtractedField[], gold: ExtractionSample['gold']): RecallResult {
  const predByName = new Map(predicted.map((p) => [norm(p.name), p]));
  const hits: Record<Field, number> = { name: 0, value: 0, unit: 0, referenceRange: 0, abnormalFlag: 0 };
  for (const g of gold) {
    const p = predByName.get(norm(g.name));
    if (!p) continue; // whole row missed → no field credited
    hits.name += 1; // name matched by construction
    for (const f of FIELDS) {
      if (f === 'name') continue;
      if (norm(p[f]) === norm(g[f])) hits[f] += 1;
    }
  }
  const denom = gold.length;
  const perField = Object.fromEntries(
    FIELDS.map((f) => [f, denom === 0 ? NaN : hits[f] / denom]),
  ) as Record<Field, number>;
  const overall =
    denom === 0 ? NaN : FIELDS.reduce((s, f) => s + perField[f], 0) / FIELDS.length;
  return { perField, overall };
}
