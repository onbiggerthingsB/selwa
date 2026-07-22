import { describe, expect, it } from 'vitest';
import {
  EMERGENCY_CATEGORIES,
  EMERGENCY_LEXICON,
  matchEmergencyText,
  type EmergencyCategory,
} from './emergency-lexicon';

const POSITIVE_FIXTURES = {
  cardiac: {
    zh: '他突然胸痛。',
    en: 'I have crushing chest pain.',
  },
  breathing: {
    zh: '我喘不上气。',
    en: "She says she can't breathe.",
  },
  stroke: {
    zh: '突然嘴歪，说话也不清。',
    en: 'His face is drooping and he has slurred speech.',
  },
  bleeding: {
    zh: '伤口大出血。',
    en: "The wound won't stop bleeding.",
  },
  anaphylaxis: {
    zh: '过敏后喉咙肿了。',
    en: 'I am allergic and having trouble breathing.',
  },
  'self-harm': {
    zh: '我想自杀。',
    en: 'I want to die.',
  },
  'overdose-poisoning': {
    zh: '我刚才服毒了。',
    en: 'I swallowed poison.',
  },
  unconscious: {
    zh: '他昏迷了。',
    en: 'The patient is unresponsive.',
  },
  seizure: {
    zh: '孩子正在抽搐。',
    en: 'They are having a seizure.',
  },
  'pregnancy-emergency': {
    zh: '怀孕后突然剧痛。',
    en: 'I am pregnant and have severe pain.',
  },
  'infant-emergency': {
    zh: '婴儿正在高烧。',
    en: 'My baby has a high fever.',
  },
} as const satisfies Record<EmergencyCategory, Readonly<{ zh: string; en: string }>>;

function categories(text: string, lang: 'en' | 'zh'): EmergencyCategory[] {
  return matchEmergencyText(text, lang).map((match) => match.category);
}

describe('emergency lexicon', () => {
  it('contains every category exactly once', () => {
    expect(EMERGENCY_LEXICON.map((entry) => entry.category)).toEqual(EMERGENCY_CATEGORIES);
  });

  it.each(EMERGENCY_CATEGORIES)('has a Chinese positive control for %s', (category) => {
    expect(categories(POSITIVE_FIXTURES[category].zh, 'zh')).toContain(category);
  });

  it.each(EMERGENCY_CATEGORIES)('has an English positive control for %s', (category) => {
    expect(categories(POSITIVE_FIXTURES[category].en, 'en')).toContain(category);
  });

  it('suppresses the model only for self-harm and overdose/poisoning', () => {
    expect(
      EMERGENCY_LEXICON.filter((entry) => entry.suppressModel).map((entry) => entry.category),
    ).toEqual(['self-harm', 'overdose-poisoning']);
  });

  it('requires every side of the curated conjunctive patterns', () => {
    expect(categories('只有胸闷，没有出汗或放射症状。', 'zh')).toContain('cardiac');
    expect(categories('只有胸闷。', 'zh')).not.toContain('cardiac');
    expect(categories('I have chest tightness with sweating.', 'en')).toContain('cardiac');
    expect(categories('I have chest tightness after exercise.', 'en')).not.toContain('cardiac');

    expect(categories('只是普通的过敏皮疹。', 'zh')).not.toContain('anaphylaxis');
    expect(categories('I have an allergic rash.', 'en')).not.toContain('anaphylaxis');
    expect(categories('怀孕后有轻微恶心。', 'zh')).not.toContain('pregnancy-emergency');
    expect(categories('I am pregnant and mildly nauseated.', 'en')).not.toContain(
      'pregnancy-emergency',
    );
    expect(categories('婴儿吃奶正常。', 'zh')).not.toContain('infant-emergency');
    expect(categories('My baby has a mild fever.', 'en')).not.toContain('infant-emergency');
  });

  it('uses English alphanumeric-edge boundaries', () => {
    expect(categories('STROKE!', 'en')).toContain('stroke');
    expect(categories('unstroked', 'en')).not.toContain('stroke');
    expect(categories('outfitting', 'en')).not.toContain('seizure');
    expect(categories('A Babylon guide to high fever', 'en')).not.toContain('infant-emergency');
  });

  it('normalizes curly apostrophes from common mobile keyboards', () => {
    expect(categories('I can’t breathe.', 'en')).toContain('breathing');
    expect(categories('They won’t wake up.', 'en')).toContain('unconscious');
  });

  it('documents accepted false escalations from deliberate negation/context blindness', () => {
    expect(categories('I do not have chest pain.', 'en')).toContain('cardiac');
    expect(categories('这是一堂关于中风的课程。', 'zh')).toContain('stroke');
    expect(categories('I am allergic but breathing normally.', 'en')).toContain('anaphylaxis');
  });
});
