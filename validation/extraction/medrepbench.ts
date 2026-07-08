import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fieldRecall } from './fieldRecall';
import type { Extractor } from './extractor';
import type { ExtractionSample } from './types';

const FIELDS = ['name', 'value', 'unit', 'referenceRange', 'abnormalFlag'] as const;

export interface ExtractionReport {
  extractorId: string;
  sampleCount: number;
  meanOverallRecall: number;
  perField: Record<(typeof FIELDS)[number], number>;
}

/**
 * Load samples from MEDREPBENCH_DIR (a directory of {id}.json gold files whose
 * imagePath points at the co-located image). Nothing is committed. Throws a clear
 * error when the env var is unset so this stays strictly opt-in.
 */
export function loadMedRepBench(dir = process.env.MEDREPBENCH_DIR): ExtractionSample[] {
  if (!dir) throw new Error('MEDREPBENCH_DIR is unset — download MedRepBench and point this at the gold dir (see README).');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as ExtractionSample);
}

export async function runExtractionBenchmark(
  samples: ExtractionSample[],
  extractor: Extractor,
): Promise<ExtractionReport> {
  const perField: Record<string, number> = { name: 0, value: 0, unit: 0, referenceRange: 0, abnormalFlag: 0 };
  let overall = 0;
  let scored = 0;
  for (const s of samples) {
    const predicted = await extractor.extract(s);
    const r = fieldRecall(predicted, s.gold);
    if (Number.isNaN(r.overall)) continue;
    overall += r.overall;
    for (const f of FIELDS) perField[f] += r.perField[f];
    scored += 1;
  }
  const div = scored === 0 ? NaN : scored;
  return {
    extractorId: extractor.id,
    sampleCount: samples.length,
    meanOverallRecall: overall / div,
    perField: Object.fromEntries(FIELDS.map((f) => [f, perField[f] / div])) as ExtractionReport['perField'],
  };
}
