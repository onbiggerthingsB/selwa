import { z } from 'zod';

const SchoolAdviceSchema = z.object({
  suggestions: z
    .array(z.string())
    .min(1)
    .describe(
      'General lifestyle/self-care suggestions from this school for this person. No drug names with doses, no prescriptions.',
    ),
  seekCare: z
    .string()
    .describe(
      "When this person should see a real clinician about this question, from this school's perspective.",
    ),
});

export const AdviceModelSchema = z.object({
  emergency: z.object({
    detected: z
      .boolean()
      .describe('True if the question describes symptoms needing urgent/emergency care.'),
    reason: z.string().nullable(),
  }),
  outOfScope: z
    .boolean()
    .describe(
      "True if the question is not a personal health question (tech support, homework, another person's prescription, etc.).",
    ),
  tcm: SchoolAdviceSchema,
  tibetan: SchoolAdviceSchema,
  western: SchoolAdviceSchema,
});

export type AdviceModelOutput = z.infer<typeof AdviceModelSchema>;

// FLAGGED DEFAULT: far above a real question, well below abuse scale.
export const MAX_ADVICE_QUESTION_CHARS = 2000;

const NO_DOSING_INSTRUCTION =
  "Never state a dose, quantity, strength, frequency, or duration for any medication, supplement, or herbal remedy — no numbers with units like mg/g/ml/片/克, no schedules like 'twice daily'/每日两次, for ANY tradition including Chinese and Tibetan herbal formulas. Describe *categories* of approaches; for anything involving a specific medicine or remedy and how much/how often to take it, say the patient must ask a doctor or pharmacist.";

export const ADVICE_PROMPT = [
  'Give cautious, general health suggestions for this person from exactly three perspectives: Chinese medicine (TCM), Tibetan medicine, and Western medicine.',
  'Populate all three school fields. For each school, provide one or more general lifestyle/self-care suggestions and explain when this person should see a real clinician. Do not present the response as a diagnosis or treatment plan.',
  'Use the supplied gender and age information only as patient context. Do not infer demographics that were not supplied.',
  'Write every suggestion, seek-care statement, and safety reason in the requested output language, which will be either English or Chinese. Never write Tibetan-language advice or use Tibetan script. Tibetan medicine is one of the requested medical perspectives, not an output-language request.',
  NO_DOSING_INSTRUCTION,
  'If the question describes acute severe symptoms or a possible emergency, set emergency.detected to true and make all three perspectives defer to urgent or emergency care. Do not present self-care suggestions as an alternative to urgent care. This instruction is a courtesy in addition to the deterministic safety checks applied after generation.',
  'Set outOfScope to true when the question is not a personal health question. Otherwise set it to false.',
].join('\n\n');

export type AdviceLanguageMode = 'en' | 'zh';

export interface AdvicePromptInput {
  gender: 'female' | 'male' | 'unknown';
  age?: number;
  languageMode: AdviceLanguageMode;
}

function describeAge(age: number | undefined): string {
  if (age === undefined) return 'not provided';
  if (age === 10) return 'under 18 (submitted age-band value: 10)';
  if (age === 40) return '18–64 (submitted age-band value: 40)';
  if (age === 70) return '65 and over (submitted age-band value: 70)';
  return String(age);
}

export function buildAdvicePrompt({
  gender,
  age,
  languageMode,
}: AdvicePromptInput): string {
  const requestedLanguage = languageMode === 'zh' ? 'Chinese (zh)' : 'English (en)';

  return [
    ADVICE_PROMPT,
    `Patient demographics: gender=${gender}; age=${describeAge(age)}.`,
    `Requested output language: ${requestedLanguage}.`,
  ].join('\n\n');
}
