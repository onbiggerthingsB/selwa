import type { GroundedReport, GroundedRow, Sex } from '@/lib/types';
import type { LabExtraction } from '@/lib/extractionSchema';
import { findEntry } from '@/lib/reference';
import { parseValue, classify } from '@/lib/classify';
import { evaluateRow } from '@/lib/guard';

export function groundExtraction(extraction: LabExtraction, sex: Sex): GroundedReport {
  const rows: GroundedRow[] = extraction.rows.map((extracted) => {
    const entry = findEntry(extracted.name);
    const valueNum = parseValue(extracted.value);
    // classify only when grounded against a matched entry; the guard owns abstention.
    const classification = entry ? classify(valueNum, entry, sex) : 'unclassified';
    const outcome = evaluateRow(extracted, entry, valueNum, classification, sex);
    return {
      extracted,
      entry,
      valueNum,
      classification: outcome.action === 'abstain' ? 'unclassified' : classification,
      action: outcome.action,
      needsConfirm: outcome.needsConfirm,
      flags: outcome.flags,
    };
  });

  // generatedAt stamped by the caller (Date is non-deterministic in tests).
  return { rows, sex, generatedAt: 0 };
}
