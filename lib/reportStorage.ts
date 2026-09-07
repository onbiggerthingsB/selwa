import type { GroundedNotes, GroundedReport } from '@/lib/types';
import { z } from 'zod';
import { LANGS, resolveText } from '@/lib/i18n';

export const REPORT_SCHEMA_VERSION = 2;

export interface ReportWithOriginalNotes {
  report: GroundedReport;
  // Exact entered text, including empty/whitespace-only text. null means that the
  // authoritative original was not retained by the older storage format.
  originalNotes: string | null;
  // Historical data retained for preservation only. Neither source nor translated
  // inside these model-derived segments is an authoritative original.
  notes?: GroundedNotes;
}

export interface StoredReport extends ReportWithOriginalNotes {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const textVariant = z.union([
  z.object({ text: z.string(), review: z.enum(['reviewed', 'unverified']).optional() }).strict(),
  z.object({ fallback: z.enum(LANGS) }).strict(),
]);
const localizedText = z.object({ en: textVariant, zh: textVariant, bo: textVariant }).refine((value) => {
  try {
    for (const lang of LANGS) resolveText(value, lang);
    return true;
  } catch { return false; }
});
const bound = z.union([z.number().finite(), z.object({ male: z.number().finite(), female: z.number().finite() })]);
const entryForDisplay = z.object({
  key: z.string(), name: localizedText, definition: localizedText, plain: localizedText,
  interpretation: z.enum(['ours', 'report-only']),
  unit: z.string(), allowedUnits: z.array(z.string()),
  refLow: bound.nullable(), refHigh: bound.nullable(), source: z.string(),
  ageBands: z.array(z.object({
    ageMin: z.number().finite(), ageMax: z.number().finite(),
    refLow: bound.nullable(), refHigh: bound.nullable(),
  })).optional(),
});
// Validate every nested shape consumed by the existing result/saved renderers.
// Merely accepting an array would let rows:[null] crash after a successful load.
// Parsing checks structure only; use the original object below to preserve all
// stored lab fields, without dropping unknown fields or recomputing interpretation.
const reportForDisplay = z.object({
  sex: z.enum(['male', 'female', 'unknown']),
  age: z.number().finite().optional(), generatedAt: z.number().finite(),
  rows: z.array(z.object({
    extracted: z.object({
      name: z.string(), value: z.string().nullable(), unit: z.string().nullable(),
      printedRange: z.string().nullable(), printedFlagRaw: z.string().nullable().optional(),
      confidence: z.enum(['low', 'medium', 'high']),
      specimen: z.enum(['urine', 'blood', 'unknown']).nullable().optional(),
    }),
    entry: entryForDisplay.nullable(),
    action: z.enum(['classify', 'abstain']),
    classification: z.enum(['low', 'normal', 'high', 'critical', 'unclassified']),
    needsConfirm: z.boolean(),
    flags: z.array(z.object({ id: z.string(), severity: z.enum(['info', 'caution', 'urgent']), message: localizedText })),
  })),
});

// Validate the envelope needed to read existing records, without reclassifying or
// rewriting their lab rows. All migrations are read-only; legacy stored bytes remain.
export function normalizeStoredReport(value: unknown): StoredReport {
  if (!object(value)) throw new Error('Invalid stored report');
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1 && value.schemaVersion !== REPORT_SCHEMA_VERSION) {
    throw new Error('Unsupported stored report version');
  }
  const wrapped = 'report' in value;
  const report = wrapped ? value.report : value;
  if (!reportForDisplay.safeParse(report).success) {
    throw new Error('Invalid stored report');
  }
  let originalNotes: string | null = null;
  if (value.schemaVersion === REPORT_SCHEMA_VERSION) {
    if (!wrapped || (typeof value.originalNotes !== 'string' && value.originalNotes !== null)) {
      throw new Error('Invalid original notes record');
    }
    originalNotes = value.originalNotes;
  }
  return {
    ...(wrapped ? value : {}),
    schemaVersion: REPORT_SCHEMA_VERSION,
    report: report as unknown as GroundedReport,
    originalNotes,
  };
}

export function createStoredReport(value: ReportWithOriginalNotes): StoredReport {
  return normalizeStoredReport({ ...value, schemaVersion: REPORT_SCHEMA_VERSION });
}
