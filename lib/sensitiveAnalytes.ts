import { normName } from '@/lib/reference';

// Names only: these rows remain outside the clinical reference table, with no
// band, high-stakes classification, or confirmation behavior attached.
export const SENSITIVE_ANALYTE_NAMES = [
  // Disclosure-harm refusals: showing a drug-screen or HIV position on a shared
  // phone can carry consequences far beyond the clinical record.
  'Cocaine, Urine',
  'Methadone, Urine',
  'Benzodiazepine Screen, Urine',
  'Oxycodone',
  'Opiate Screen, Urine',
  'Amphetamine Screen, Urine',
  'Barbiturate Screen, Urine',
  '人类免疫缺陷 病毒抗体/抗原 (P24)',
  // Prognostic-shock refusal: a position on a myeloid blast population can read
  // as a leukaemia conclusion when delivered by phone without a clinician.
  '髓系原始细胞群',
] as const;

const SENSITIVE_ANALYTE_INDEX = new Set(SENSITIVE_ANALYTE_NAMES.map(normName));

/**
 * Mitigates the known-name cases only. Matching is exact after the same
 * normalization used by the reference index; there is deliberately no
 * substring matching. An unmatched vendor spelling or OCR variant fails open
 * and still shows the report-relative chip, so this is not a guarantee.
 */
export function isSensitiveAnalyteName(rawName: string): boolean {
  return SENSITIVE_ANALYTE_INDEX.has(normName(rawName));
}
