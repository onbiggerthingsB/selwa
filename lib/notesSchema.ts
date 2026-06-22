import { z } from 'zod';

export const NoteSegmentSchema = z.object({
  sourceText: z.string().describe('The original clause exactly as the doctor wrote/said it, verbatim.'),
  translatedText: z
    .string()
    .describe('A plain, simplified translation of this clause for the patient. Numbers, doses, negations, and drug names kept exactly.'),
  kind: z
    .enum(['finding', 'medication', 'instruction', 'followup', 'other'])
    .describe('What this clause is about: a finding, a medication, an instruction, a follow-up, or other.'),
});

export const NotesTranslationSchema = z.object({
  segments: z.array(NoteSegmentSchema),
});

export type NoteSegment = z.infer<typeof NoteSegmentSchema>;
export type NotesTranslation = z.infer<typeof NotesTranslationSchema>;

export const NOTES_PROMPT = [
  "Translate and simplify these doctor's notes for a patient, segment by clause.",
  'Translate + simplify ONLY. Preserve every number, dose (amount + unit + frequency), negation, and drug name EXACTLY — do not round, convert, drop, or substitute any of them.',
  'Do NOT add a diagnosis, recommendation, or reassurance that is not in the source. Keep the source clause in sourceText and your plain translation in translatedText.',
].join(' ');
