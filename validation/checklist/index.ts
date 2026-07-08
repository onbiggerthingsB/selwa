import { BehavioralCaseSchema, type BehavioralCase } from './types';
import { LABS_VERDICT_MFT } from './cases/labs-verdicts.mft';
import { UNIT_MISMATCH_DIR } from './cases/unit-mismatch.dir';
import { OCR_NOISE_INV } from './cases/ocr-noise.inv';
import { NEGATION_FLIP_DIR } from './cases/negation-flip.dir';
import { DOSE_DRUG_DIR } from './cases/dose-drug.dir';

const RAW: BehavioralCase[] = [
  ...LABS_VERDICT_MFT, ...UNIT_MISMATCH_DIR, ...OCR_NOISE_INV, ...NEGATION_FLIP_DIR, ...DOSE_DRUG_DIR,
];

// Schema-validate + duplicate-id guard at module load (mirrors corpus/index.ts).
const seen = new Set<string>();
export const CHECKLIST: BehavioralCase[] = RAW.map((c) => {
  const parsed = BehavioralCaseSchema.parse(c);
  if (seen.has(parsed.id)) throw new Error(`Duplicate checklist id: ${parsed.id}`);
  seen.add(parsed.id);
  return parsed;
});
