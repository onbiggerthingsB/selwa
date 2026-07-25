import { describe, expect, it } from 'vitest';

import {
  ADVICE_PROMPT,
  AdviceModelSchema,
  MAX_ADVICE_QUESTION_CHARS,
  buildAdvicePrompt,
} from './adviceSchema';

const validOutput = {
  emergency: { detected: false, reason: null },
  outOfScope: false,
  tcm: { suggestions: ['Keep a regular sleep schedule.'], seekCare: 'See a clinician if symptoms persist.' },
  tibetan: { suggestions: ['Choose gentle daily movement.'], seekCare: 'Seek care if symptoms worsen.' },
  western: { suggestions: ['Track when symptoms occur.'], seekCare: 'Arrange an assessment for persistent symptoms.' },
};

describe('AdviceModelSchema', () => {
  it('parses all three school perspectives with structured safety fields', () => {
    expect(AdviceModelSchema.safeParse(validOutput).success).toBe(true);
  });

  it('keeps the structured safety fields before the three schools', () => {
    expect(Object.keys(AdviceModelSchema.shape)).toEqual([
      'emergency',
      'outOfScope',
      'tcm',
      'tibetan',
      'western',
    ]);
  });

  it('requires at least one suggestion from every school', () => {
    const bad = structuredClone(validOutput);
    bad.tibetan.suggestions = [];

    expect(AdviceModelSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects missing or malformed safety fields', () => {
    const missingEmergency = { ...validOutput, emergency: undefined };
    const malformedOutOfScope = { ...validOutput, outOfScope: 'false' };

    expect(AdviceModelSchema.safeParse(missingEmergency).success).toBe(false);
    expect(AdviceModelSchema.safeParse(malformedOutOfScope).success).toBe(false);
  });

  it('uses the reviewed field descriptions verbatim', () => {
    expect(AdviceModelSchema.shape.emergency.shape.detected.description).toBe(
      'True if the question describes symptoms needing urgent/emergency care.',
    );
    expect(AdviceModelSchema.shape.outOfScope.description).toBe(
      "True if the question is not a personal health question (tech support, homework, another person's prescription, etc.).",
    );
    expect(AdviceModelSchema.shape.tcm.shape.suggestions.description).toBe(
      'General lifestyle/self-care suggestions from this school for this person. No drug names with doses, no prescriptions.',
    );
    expect(AdviceModelSchema.shape.tcm.shape.seekCare.description).toBe(
      "When this person should see a real clinician about this question, from this school's perspective.",
    );
  });
});

describe('advice prompt', () => {
  it('sets the flagged question-size default', () => {
    expect(MAX_ADVICE_QUESTION_CHARS).toBe(2000);
  });

  it('requests all three schools and only English or Chinese output', () => {
    expect(ADVICE_PROMPT).toMatch(/Chinese medicine \(TCM\)/);
    expect(ADVICE_PROMPT).toMatch(/Tibetan medicine/);
    expect(ADVICE_PROMPT).toMatch(/Western medicine/);
    expect(ADVICE_PROMPT).toMatch(/either English or Chinese/);
    expect(ADVICE_PROMPT).toMatch(/Never write Tibetan-language advice or use Tibetan script/);
  });

  it('carries the exact no-dosing safety instruction', () => {
    expect(ADVICE_PROMPT).toContain(
      "Never state a dose, quantity, strength, frequency, or duration for any medication, supplement, or herbal remedy — no numbers with units like mg/g/ml/片/克, no schedules like 'twice daily'/每日两次, for ANY tradition including Chinese and Tibetan herbal formulas. Describe *categories* of approaches; for anything involving a specific medicine or remedy and how much/how often to take it, say the patient must ask a doctor or pharmacist.",
    );
  });

  it('asks every school to defer to urgent care for acute severe symptoms', () => {
    expect(ADVICE_PROMPT).toMatch(/acute severe symptoms or a possible emergency/i);
    expect(ADVICE_PROMPT).toMatch(/all three perspectives defer to urgent or emergency care/i);
    expect(ADVICE_PROMPT).toMatch(/courtesy.*deterministic safety checks/i);
  });

  it('adds demographics and the requested Chinese output language', () => {
    const prompt = buildAdvicePrompt({ gender: 'female', age: 40, languageMode: 'zh' });

    expect(prompt).toContain('gender=female');
    expect(prompt).toContain('age=18–64 (submitted age-band value: 40)');
    expect(prompt).toContain('Requested output language: Chinese (zh).');
  });

  it('makes omitted age explicit and requests English output', () => {
    const prompt = buildAdvicePrompt({ gender: 'unknown', languageMode: 'en' });

    expect(prompt).toContain('gender=unknown');
    expect(prompt).toContain('age=not provided');
    expect(prompt).toContain('Requested output language: English (en).');
  });
});
