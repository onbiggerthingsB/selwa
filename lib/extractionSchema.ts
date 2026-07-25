import { z } from 'zod';

const PRINTED_FLAG_COPY_INSTRUCTION =
  'Some reports print an abnormality marker in or beside the result cell (for example ↑ ↓ H L * ! 偏高 偏低). Copy that marker into printedFlagRaw exactly as printed, as a verbatim string, and keep it OUT of the value field — value is the number alone. If no marker is printed for this row, printedFlagRaw MUST be null. Never write a marker that is not visibly printed on the page, and never produce one by comparing the value to the reference range; that comparison is not your task. If you cannot tell whether a mark is a flag or a printing artifact, use null.';

export const ExtractedRowSchema = z.object({
  name: z.string().describe('Analyte name exactly as printed (Chinese or English), e.g. 空腹血糖 or GLU'),
  value: z
    .string()
    .nullable()
    .describe('The measured value exactly as printed, as a string to preserve the decimal. null if absent.'),
  unit: z.string().nullable().describe('The unit exactly as printed, e.g. mmol/L. null if absent.'),
  printedRange: z
    .string()
    .nullable()
    .describe('The reference range printed on the report, e.g. 3.9-6.1. null if absent.'),
  printedFlagRaw: z
    .string()
    .nullable()
    .optional()
    .describe(PRINTED_FLAG_COPY_INSTRUCTION),
  confidence: z.enum(['low', 'medium', 'high']).describe('Your confidence in reading THIS row correctly.'),
  specimen: z
    .enum(['urine', 'blood', 'unknown'])
    .nullable()
    .optional()
    .describe(
      'The specimen for this row, ONLY when a specimen or panel heading is printed on the page. ' +
        'Use urine for urine/urinalysis; use blood for blood, serum, plasma, or whole-blood; use ' +
        'unknown for any other fluid or when no specimen is printed. Never infer specimen from ' +
        'the analyte name, value, or reference range.',
    ),
});

export const LabExtractionSchema = z.object({
  rows: z.array(ExtractedRowSchema),
});

export type ExtractedRowZ = z.infer<typeof ExtractedRowSchema>;
export type LabExtraction = z.infer<typeof LabExtractionSchema>;

export const EXTRACTION_PROMPT = [
  'You are an OCR/extraction engine for laboratory test reports. Extract EVERY analyte row you can read.',
  'Transcribe exactly what is printed — analyte name, numeric value, unit, and the printed reference range.',
  'For each row, read specimen ONLY from a printed section or panel heading (such as "Urinalysis"/"尿液分析", "Blood gas", or "Serum") or an explicit printed per-row specimen qualifier.',
  'Use "urine" for urine or urinalysis; use "blood" for blood, serum, plasma, or whole-blood; use "unknown" for any other fluid and whenever no specimen is printed.',
  'Do NOT infer specimen from the analyte name, value, or reference range; only an explicitly printed specimen word or panel heading counts.',
  'Do NOT infer, calculate, convert units, translate, or supply values that are not printed. Use null for an absent or unreadable value, unit, or printed reference range.',
  'Do NOT classify results as normal/abnormal and do NOT add reference ranges from your own knowledge — only copy the range printed on the page.',
  PRINTED_FLAG_COPY_INSTRUCTION,
  'Preserve decimal points exactly (e.g. 7.0 is not 70). For each row, report your reading confidence as low, medium, or high.',
  'Return only the structured rows.',
].join(' ');
