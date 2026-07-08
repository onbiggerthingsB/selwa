// CheckList behavioral-case schema (validation-rigor cycle).
//
// R1–R12 + notesGuard recast as MFT/INV/DIR behavioral tests (Ribeiro et al.,
// ACL 2020), executed against the REAL guard. A unified Verdict normalizes the
// two guard vocabularies: labs 'classify'|'confirm'|'abstain' and notes
// 'render'|'flag'|'abstain' both map to render|flag|abstain (see run.ts).

import { z } from 'zod';

export const VerdictSchema = z.enum(['render', 'flag', 'abstain']);
export type Verdict = z.infer<typeof VerdictSchema>;

// Mirrors lib/types ExtractedRow (re-declared here to keep validation/ self-contained).
export const LabsRowSchema = z.object({
  name: z.string(),
  value: z.string().nullable(),
  unit: z.string().nullable(),
  printedRange: z.string().nullable(),
  confidence: z.enum(['low', 'medium', 'high']),
});

export const LabsInputSchema = z.object({
  row: LabsRowSchema,
  sex: z.enum(['male', 'female', 'unknown']).optional(),
  age: z.number().optional(),
});

export const NotesInputSchema = z.object({
  sourceText: z.string(),
  translatedText: z.string(),
  kind: z.enum(['finding', 'medication', 'instruction', 'followup', 'other']),
  originalText: z.string().optional(),
});

// A label-preserving perturbation for INV cases: a shallow patch applied to the
// labs row (or notes segment) that must NOT change the verdict/classification.
export const PerturbationSchema = z.object({
  name: z.string(),
  patch: z.record(z.string(), z.unknown()),
});

export const BehavioralCaseSchema = z
  .object({
    id: z.string(),
    capability: z.string(), // e.g. 'R1-unknown-analyte'
    testType: z.enum(['MFT', 'INV', 'DIR']),
    kind: z.enum(['labs', 'notes']),
    input: z.union([LabsInputSchema, NotesInputSchema]),
    perturbations: z.array(PerturbationSchema).optional(),
    expect: z.object({ verdict: VerdictSchema.optional() }),
  })
  .refine((c) => c.testType !== 'INV' || (c.perturbations?.length ?? 0) > 0, {
    message: 'INV cases require at least one perturbation',
  })
  .refine((c) => c.testType === 'INV' || c.expect.verdict !== undefined, {
    message: 'MFT/DIR cases require expect.verdict',
  });

export type LabsInput = z.infer<typeof LabsInputSchema>;
export type NotesInput = z.infer<typeof NotesInputSchema>;
export type BehavioralCase = z.infer<typeof BehavioralCaseSchema>;
