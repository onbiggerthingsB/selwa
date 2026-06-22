import { z } from 'zod';

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
  confidence: z.enum(['low', 'medium', 'high']).describe('Your confidence in reading THIS row correctly.'),
});

export const LabExtractionSchema = z.object({
  rows: z.array(ExtractedRowSchema),
});

export type ExtractedRowZ = z.infer<typeof ExtractedRowSchema>;
export type LabExtraction = z.infer<typeof LabExtractionSchema>;

export const EXTRACTION_PROMPT = [
  'You are an OCR/extraction engine for laboratory test reports. Extract EVERY analyte row you can read.',
  'Transcribe exactly what is printed — analyte name, numeric value, unit, and the printed reference range.',
  'Do NOT infer, calculate, convert units, translate, or supply values that are not printed. Use null for any field that is absent or unreadable.',
  'Do NOT classify results as normal/abnormal and do NOT add reference ranges from your own knowledge — only copy the range printed on the page.',
  'Preserve decimal points exactly (e.g. 7.0 is not 70). For each row, report your reading confidence as low, medium, or high.',
  'Return only the structured rows.',
].join(' ');
