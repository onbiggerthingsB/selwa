// Corpus case schema for the validation harness (M4.1).
//
// SAFETY MODEL: This harness is NEVER imported by the app (lib/ or app/). It is
// run only by Vitest and `npm run validate` (tsx). It measures the safety and
// comprehension delta of OUR guarded pipeline against a pluggable
// machine-translation baseline on a shared corpus. Corpus cases are synthetic or
// public-style — NEVER real PHI. The `validation/corpus/README.md` documents the
// drop-in slot for real de-identified clinician-reviewed data.

import { z } from 'zod';

// A single drug immutable: the verbatim surface form plus the canonical drug id
// it should resolve to ('' / a known id). Used by the runner's fidelity scoring.
export const DrugImmutableSchema = z.object({
  surface: z.string(),
  canonicalId: z.string(),
});

// A bare numeric immutable: the verbatim value string and its trailing unit
// (empty string when the number carries no unit).
export const NumberImmutableSchema = z.object({
  value: z.string(),
  unit: z.string(),
});

export const ImmutablesSchema = z.object({
  negations: z.array(z.string()),
  dosages: z.array(z.string()),
  drugs: z.array(DrugImmutableSchema),
  numbers: z.array(NumberImmutableSchema),
});

// Why a case is expected to abstain. Mirrors the failure families the guard
// owns (R7 negation, R8 dose/number, R9 drug) plus the M2 unit-conversion trap.
export const AbstainReasonSchema = z.enum([
  'dropped_negation',
  'dose_mismatch',
  'drug_ambiguous',
  'number_unit_mismatch',
  'unit_conversion_ambiguous',
]);

export const CorpusCaseSchema = z.object({
  id: z.string(),
  lang: z.enum(['zh', 'en']),
  kind: z.enum(['labs', 'notes', 'mixed']),
  sourceText: z.string(),
  goldTranslation: z.string(),
  immutables: ImmutablesSchema,
  shouldAbstain: z.boolean(),
  highStakes: z.boolean(),
  abstainReason: AbstainReasonSchema.optional(),

  // --- Harness candidate (offline run) ---------------------------------------
  // The candidate translation the OURS pipeline evaluates when no live LLM is
  // available. For faithful (should-NOT-abstain) cases this is the gold
  // translation; for should-abstain cases it is a deliberately-flawed
  // translation that exercises the guard. Optional: the runner falls back to
  // goldTranslation when absent.
  candidateTranslation: z.string().optional(),
});

export type DrugImmutable = z.infer<typeof DrugImmutableSchema>;
export type NumberImmutable = z.infer<typeof NumberImmutableSchema>;
export type Immutables = z.infer<typeof ImmutablesSchema>;
export type AbstainReason = z.infer<typeof AbstainReasonSchema>;
export type CorpusCase = z.infer<typeof CorpusCaseSchema>;

// Total count of immutable medical terms in a case (|I_src|), used as the
// denominator weight in the term-weighted medical-term fidelity metric. A case
// with totalImmutables === 0 is excluded from fidelity scoring.
export function totalImmutables(c: Pick<CorpusCase, 'immutables'>): number {
  const im = c.immutables;
  return im.negations.length + im.dosages.length + im.drugs.length + im.numbers.length;
}
