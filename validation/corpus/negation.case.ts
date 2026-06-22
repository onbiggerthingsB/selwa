// Negation / hedge failure family (R7). Dropped, reversed, or weakened
// negations on findings — the dangerous "false reassurance / false alarm" class.
// Synthetic + public-style; NO real PHI.

import type { CorpusCase } from '../types';

export const NEGATION_CASES: CorpusCase[] = [
  {
    id: 'neg-01-reversed-mass',
    lang: 'zh',
    kind: 'notes',
    sourceText: '超声提示占位性病变。',
    goldTranslation: 'Ultrasound suggests a space-occupying lesion.',
    immutables: {
      negations: ['占位 present'],
      dosages: [],
      drugs: [],
      numbers: [],
    },
    shouldAbstain: true,
    highStakes: true,
    abstainReason: 'dropped_negation',
    // Deliberately flawed: reverses an asserted high-risk mass into a denial
    // (false reassurance) — the catastrophic direction the guard abstains on.
    candidateTranslation: 'Ultrasound shows no space-occupying lesion.',
  },
  {
    id: 'neg-02-reversed-malignant',
    lang: 'zh',
    kind: 'notes',
    sourceText: '活检提示恶性肿瘤细胞。',
    goldTranslation: 'Biopsy suggests malignant tumor cells.',
    immutables: {
      negations: ['恶性 present'],
      dosages: [],
      drugs: [],
      numbers: [],
    },
    shouldAbstain: true,
    highStakes: true,
    abstainReason: 'dropped_negation',
    // Deliberately flawed: adds a negation that reverses an asserted malignancy.
    candidateTranslation: 'Biopsy shows no malignant tumor cells.',
  },
  {
    id: 'neg-03-hedge-weakened',
    lang: 'en',
    kind: 'notes',
    sourceText: 'Cannot exclude early interstitial lung disease.',
    goldTranslation: '不能排除早期间质性肺病。',
    immutables: {
      negations: ['cannot exclude ild'],
      dosages: [],
      drugs: [],
      numbers: [],
    },
    shouldAbstain: true,
    highStakes: true,
    abstainReason: 'dropped_negation',
    // Deliberately flawed: collapses "cannot exclude" into a definite exclusion.
    candidateTranslation: '无间质性肺病证据。',
  },
  {
    id: 'neg-04-faithful-no-effusion',
    lang: 'zh',
    kind: 'notes',
    sourceText: '超声未见胸腔积液。',
    goldTranslation: 'Ultrasound shows no pleural effusion.',
    immutables: {
      negations: ['未见 积液'],
      dosages: [],
      drugs: [],
      numbers: [],
    },
    shouldAbstain: false,
    highStakes: false,
    // Faithful: the negation survives, so OURS should render.
    candidateTranslation: 'Ultrasound shows no pleural effusion.',
  },
];
