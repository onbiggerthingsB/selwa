import { describe, expect, it } from 'vitest';
import type { AdviceModelOutput } from './adviceSchema';
import {
  ADVICE_SCHOOLS,
  applyAdviceSafetyFloors,
  preScreenQuestion,
  type AdviceSchoolId,
} from './adviceGuard';

function cleanOutput(): AdviceModelOutput {
  return {
    emergency: { detected: false, reason: null },
    outOfScope: false,
    tcm: {
      suggestions: ['Keep a regular sleep schedule.'],
      seekCare: 'See a clinician if symptoms persist.',
    },
    tibetan: {
      suggestions: ['Choose gentle activity as tolerated.'],
      seekCare: 'Seek care if the problem worsens.',
    },
    western: {
      suggestions: ['Stay hydrated and keep notes about your symptoms.'],
      seekCare: 'Talk with a clinician if you remain concerned.',
    },
  };
}

function setSchoolText(
  output: AdviceModelOutput,
  school: AdviceSchoolId,
  field: 'suggestions' | 'seekCare',
  text: string,
): void {
  if (field === 'suggestions') {
    output[school].suggestions = ['A clean first suggestion.', text];
    return;
  }
  output[school].seekCare = text;
}

function expectBlockedWithoutSchools(
  result: ReturnType<typeof applyAdviceSafetyFloors>,
  refused: 'dosing' | 'tibetan-output' | 'emergency-only' | 'out-of-scope',
): void {
  expect(result).toMatchObject({
    presentation: 'blocked',
    banners: [],
    refused,
  });
  expect(Object.hasOwn(result, 'schools')).toBe(false);
}

describe('preScreenQuestion', () => {
  it.each([
    ['自杀', 'zh' as const, 'self-harm'],
    ['I want to die', 'en' as const, 'self-harm'],
    ['I want\n   to die', 'en' as const, 'self-harm'],
    ['I swallowed poison', 'en' as const, 'overdose-poisoning'],
  ])('suppresses the model for %s', (question, languageMode, category) => {
    const result = preScreenQuestion(question, languageMode);

    expect(result.block).toBe(true);
    expect(result.categories).toContain(category);
    if (!result.block) throw new Error('expected a suppress-model result');
    expect(result.result).toEqual({
      presentation: 'blocked',
      banners: ['emergency-self-harm'],
      refused: 'emergency-only',
    });
    expect(Object.hasOwn(result.result, 'schools')).toBe(false);
  });

  it.each([
    ['胸痛', 'zh' as const, 'cardiac'],
    ['chest pain radiating to my arm', 'en' as const, 'cardiac'],
  ])('reports but does not suppress a somatic hit: %s', (question, languageMode, category) => {
    const result = preScreenQuestion(question, languageMode);

    expect(result).toEqual({ block: false, categories: [category] });
  });

  it('scans mixed-language questions without weakening the selected language', () => {
    expect(preScreenQuestion('I have 胸痛', 'en')).toEqual({
      block: false,
      categories: ['cardiac'],
    });
  });
});

describe('applyAdviceSafetyFloors emergency escalation', () => {
  it.each([
    ['胸痛', 'zh' as const],
    ['chest pain radiating to my arm', 'en' as const],
  ])('pins an emergency banner for a somatic question: %s', (question, languageMode) => {
    const result = applyAdviceSafetyFloors(cleanOutput(), {
      question,
      languageMode,
    });

    expect(result).toMatchObject({
      presentation: 'banner',
      banners: ['emergency'],
      refused: null,
    });
    expect(result.schools).toBeDefined();
  });

  it('honors the structured model emergency field for a benign question', () => {
    const output = cleanOutput();
    output.emergency = {
      detected: true,
      reason: 'The model detected an urgent symptom.',
    };

    const result = applyAdviceSafetyFloors(output, {
      question: 'How can I sleep better?',
      languageMode: 'en',
    });

    expect(result.presentation).toBe('banner');
    expect(result.banners).toEqual(['emergency']);
  });

  it.each(
    ADVICE_SCHOOLS.flatMap((school) => [
      [school, 'suggestions' as const],
      [school, 'seekCare' as const],
    ]),
  )('scans emergency concepts in %s.%s', (school, field) => {
    const output = cleanOutput();
    setSchoolText(
      output,
      school,
      field,
      'This could involve chest pain and needs urgent assessment.',
    );

    const result = applyAdviceSafetyFloors(output, {
      question: 'How can I sleep better?',
      languageMode: 'en',
    });

    expect(result.presentation).toBe('banner');
    expect(result.banners).toEqual(['emergency']);
  });

  it.each([
    'A person may want to die.',
    'This sounds like an overdose.',
  ])('blocks school prose when model output surfaces %s', (unsafeText) => {
    const output = cleanOutput();
    output.tibetan.seekCare = unsafeText;

    const result = applyAdviceSafetyFloors(output, {
      question: 'How can I sleep better?',
      languageMode: 'en',
    });

    expect(result).toEqual({
      presentation: 'blocked',
      banners: ['emergency-self-harm'],
      refused: 'emergency-only',
    });
    expect(Object.hasOwn(result, 'schools')).toBe(false);
  });

  it('fails closed if a suppress-model question reaches the post-model seam', () => {
    const result = applyAdviceSafetyFloors(cleanOutput(), {
      question: 'I want to die',
      languageMode: 'en',
    });

    expect(result).toEqual({
      presentation: 'blocked',
      banners: ['emergency-self-harm'],
      refused: 'emergency-only',
    });
    expect(Object.hasOwn(result, 'schools')).toBe(false);
  });
});

describe('applyAdviceSafetyFloors medication-dosing refusal', () => {
  it.each([
    ['take ibuprofen 400 mg', 'en' as const],
    ['黄芪 10 克', 'zh' as const],
    ['drink the decoction three times a day', 'en' as const],
    ['每日三次服用', 'zh' as const],
    ['take 2 metformin', 'en' as const],
    ['Take one ibuprofen tablet.', 'en' as const],
    ['Take one tablet.', 'en' as const],
    ['Take half a tablet.', 'en' as const],
    ['Take two metformin.', 'en' as const],
    ['Use thirteen mg.', 'en' as const],
    ['The amount is twenty mg.', 'en' as const],
    ['４００毫克', 'zh' as const],
    ['½ tablet', 'en' as const],
    [`400${String.fromCodePoint(0x200b)}mg`, 'en' as const],
    ['Take 2 antibiotics.', 'en' as const],
    ['Use a 400-mg dose.', 'en' as const],
    ['Take ibuprofen q.d.', 'en' as const],
    ['Take ibuprofen b.i.d.', 'en' as const],
    ['Take ibuprofen QAM.', 'en' as const],
    ['每周服用中药。', 'zh' as const],
    ['Take ibuprofen.', 'en' as const],
    ['服用布洛芬。', 'zh' as const],
    ['Use an antibiotic.', 'en' as const],
    ['Drink the decoction.', 'en' as const],
    ['按时服药。', 'zh' as const],
    ['Take medication weekly.', 'en' as const],
    ['Take fluconazole.', 'en' as const],
    ['服用氟康唑。', 'zh' as const],
    ['Continue metformin.', 'en' as const],
    ['继续服用二甲双胍。', 'zh' as const],
    ['Start metformin.', 'en' as const],
    ['加用二甲双胍。', 'zh' as const],
    ['Take it every morning.', 'en' as const],
    ['Take it twice weekly.', 'en' as const],
    ['Take it every 8 hours.', 'en' as const],
    ['Drink it weekly.', 'en' as const],
    ['隔天服用。', 'zh' as const],
    ['早晚服用。', 'zh' as const],
    ['Take it every other day.', 'en' as const],
    ['Take it on alternate days.', 'en' as const],
    ['The medicine should be taken every other day.', 'en' as const],
    ['Take it, twice daily.', 'en' as const],
    ['Drink, three times a day.', 'en' as const],
    ['每两天服用。', 'zh' as const],
    ['服用，一日两次。', 'zh' as const],
    ['Take it for five days.', 'en' as const],
    ['Use it for two weeks.', 'en' as const],
    ['服用五天。', 'zh' as const],
    ['Use a 2% cream.', 'en' as const],
    ['Apply 1% hydrocortisone.', 'en' as const],
    ['Use the 0.05 percent ointment.', 'en' as const],
    ['Take 2 teaspoons.', 'en' as const],
    ['Use one teaspoon of syrup.', 'en' as const],
    ['Take two puffs.', 'en' as const],
    ['Use one scoop.', 'en' as const],
    ['喝两勺。', 'zh' as const],
    ['The amount is 400 milligrams.', 'en' as const],
    ['Use five milliliters.', 'en' as const],
    ['Take ten micrograms.', 'en' as const],
    ['Use two grams.', 'en' as const],
    ['Use 400\nmg.', 'en' as const],
    ['Use 10\n克。', 'zh' as const],
    ['Inject insulin.', 'en' as const],
    ['Administer aspirin.', 'en' as const],
    ['Inhale the medicine.', 'en' as const],
    ['Insert the suppository.', 'en' as const],
    ['注射胰岛素。', 'zh' as const],
    ['吸入药物。', 'zh' as const],
    ['take 2 clonazepam', 'en' as const],
    ['Use the antibiotic twice daily', 'en' as const],
  ])('refuses a whole answer containing %s', (unsafeText, languageMode) => {
    const output = cleanOutput();
    output.western.suggestions = [unsafeText];

    const result = applyAdviceSafetyFloors(output, {
      question: 'What general self-care might help?',
      languageMode,
    });

    expectBlockedWithoutSchools(result, 'dosing');
  });

  it.each(
    ADVICE_SCHOOLS.flatMap((school) => [
      [school, 'suggestions' as const],
      [school, 'seekCare' as const],
    ]),
  )('scans dosing in %s.%s', (school, field) => {
    const output = cleanOutput();
    setSchoolText(output, school, field, 'Take ibuprofen 400 mg.');

    const result = applyAdviceSafetyFloors(output, {
      question: 'What general self-care might help?',
      languageMode: 'en',
    });

    expectBlockedWithoutSchools(result, 'dosing');
  });

  it('does not treat a non-medication monitoring frequency as dosing', () => {
    const output = cleanOutput();
    output.western.suggestions = [
      'Check your blood pressure twice daily and write down the readings.',
    ];

    const result = applyAdviceSafetyFloors(output, {
      question: 'How can I monitor this?',
      languageMode: 'en',
    });

    expect(result).toMatchObject({
      presentation: 'normal',
      banners: [],
      refused: null,
    });
    expect(result.schools).toBeDefined();
  });

  it('does not treat a natural monitoring schedule as a prescription', () => {
    const output = cleanOutput();
    output.western.suggestions = [
      'Check your blood pressure every 8 hours and write down the readings.',
    ];

    const result = applyAdviceSafetyFloors(output, {
      question: 'How can I monitor this?',
      languageMode: 'en',
    });

    expect(result).toMatchObject({
      presentation: 'normal',
      banners: [],
      refused: null,
    });
    expect(result.schools).toBeDefined();
  });
});

describe('applyAdviceSafetyFloors whole-answer refusal and precedence', () => {
  it('refuses Tibetan script and structurally omits all schools', () => {
    const output = cleanOutput();
    output.tibetan.suggestions = ['བོད་'];

    const result = applyAdviceSafetyFloors(output, {
      question: 'What general self-care might help?',
      languageMode: 'en',
    });

    expectBlockedWithoutSchools(result, 'tibetan-output');
  });

  it('refuses out-of-scope output and structurally omits all schools', () => {
    const output = cleanOutput();
    output.outOfScope = true;

    const result = applyAdviceSafetyFloors(output, {
      question: 'Help with my laptop',
      languageMode: 'en',
    });

    expectBlockedWithoutSchools(result, 'out-of-scope');
  });

  it('refuses out-of-scope prose without erasing an emergency escalation', () => {
    const output = cleanOutput();
    output.outOfScope = true;
    output.emergency.detected = true;
    output.western.suggestions = ['བོད་ take ibuprofen 400 mg'];

    const result = applyAdviceSafetyFloors(output, {
      question: 'Help with my laptop',
      languageMode: 'en',
    });

    expect(result).toEqual({
      presentation: 'blocked',
      banners: ['emergency'],
      refused: 'out-of-scope',
    });
    expect(Object.hasOwn(result, 'schools')).toBe(false);
  });

  it('refuses Tibetan output without erasing an emergency escalation', () => {
    const output = cleanOutput();
    output.emergency.detected = true;
    output.western.suggestions = ['བོད་ take ibuprofen 400 mg'];

    const result = applyAdviceSafetyFloors(output, {
      question: 'What general self-care might help?',
      languageMode: 'en',
    });

    expect(result).toEqual({
      presentation: 'blocked',
      banners: ['emergency'],
      refused: 'tibetan-output',
    });
    expect(Object.hasOwn(result, 'schools')).toBe(false);
  });

  it('refuses dosing without erasing a structured emergency escalation', () => {
    const output = cleanOutput();
    output.emergency.detected = true;
    output.western.suggestions = ['Take ibuprofen 400 mg.'];

    const result = applyAdviceSafetyFloors(output, {
      question: 'What general self-care might help?',
      languageMode: 'en',
    });

    expect(result).toEqual({
      presentation: 'blocked',
      banners: ['emergency'],
      refused: 'dosing',
    });
    expect(Object.hasOwn(result, 'schools')).toBe(false);
  });

  it('refuses dosing without erasing a pre-model somatic emergency hit', () => {
    const output = cleanOutput();
    output.western.suggestions = ['Take ibuprofen 400 mg.'];

    const result = applyAdviceSafetyFloors(output, {
      question: 'I have chest pain radiating to my arm.',
      languageMode: 'en',
    });

    expect(result).toEqual({
      presentation: 'blocked',
      banners: ['emergency'],
      refused: 'dosing',
    });
    expect(Object.hasOwn(result, 'schools')).toBe(false);
  });

  it('renders a clean answer normally with all three schools', () => {
    const output = cleanOutput();
    const result = applyAdviceSafetyFloors(output, {
      question: 'How can I improve my sleep routine?',
      languageMode: 'en',
    });

    expect(result).toEqual({
      presentation: 'normal',
      banners: [],
      refused: null,
      schools: {
        tcm: output.tcm,
        tibetan: output.tibetan,
        western: output.western,
      },
    });
  });
});

describe('advice guard determinism', () => {
  it('returns identical pre-screen and post-model results for identical input', () => {
    const context = {
      question: 'I have no chest pain.',
      languageMode: 'en' as const,
    };
    const output = cleanOutput();

    expect(preScreenQuestion(context.question, context.languageMode)).toEqual(
      preScreenQuestion(context.question, context.languageMode),
    );
    expect(applyAdviceSafetyFloors(output, context)).toEqual(
      applyAdviceSafetyFloors(output, context),
    );
  });
});
