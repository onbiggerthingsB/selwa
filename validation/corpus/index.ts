// Aggregated, schema-validated corpus for the validation harness (M4.1).
//
// Every case is parsed through CorpusCaseSchema at module load, so an invalid
// case throws here (fail-fast) rather than producing a quietly-wrong metric.
// The corpus is synthetic / public-style — NEVER real PHI. See README.md for the
// real-de-identified-data drop-in slot.

import { CorpusCaseSchema, type CorpusCase } from '../types';
import { NEGATION_CASES } from './negation.case';
import { DOSE_CASES } from './dose.case';
import { DRUG_CASES } from './drug.case';
import { LABS_CASES } from './labs.case';
import { UNIT_TRAP_CASES } from './unit-trap.case';
import { UNKNOWN_ANALYTE_CASES } from './unknown-analyte.case';
import { IMPLAUSIBLE_CASES } from './implausible.case';

const RAW_CASES: CorpusCase[] = [
  ...NEGATION_CASES,
  ...DOSE_CASES,
  ...DRUG_CASES,
  ...LABS_CASES,
  ...UNIT_TRAP_CASES,
  ...UNKNOWN_ANALYTE_CASES,
  ...IMPLAUSIBLE_CASES,
];

// Validate + freeze. Duplicate ids are a corpus authoring bug, so reject them.
const seenIds = new Set<string>();
export const CORPUS: CorpusCase[] = RAW_CASES.map((c) => {
  const parsed = CorpusCaseSchema.parse(c);
  if (seenIds.has(parsed.id)) {
    throw new Error(`Duplicate corpus case id: ${parsed.id}`);
  }
  seenIds.add(parsed.id);
  return parsed;
});
