// Drug-name failure family (R9). Look-alike substitution, result-polarity flip,
// dropped salt/release qualifier — plus a faithful drug that must render.
// Synthetic; NO real PHI.

import type { CorpusCase } from '../types';

export const DRUG_CASES: CorpusCase[] = [
  {
    id: 'drug-01-lookalike-substitution',
    lang: 'zh',
    kind: 'notes',
    sourceText: '继续服用氯硝西泮。',
    goldTranslation: 'Continue clonazepam.',
    immutables: {
      negations: [],
      dosages: [],
      drugs: [{ surface: '氯硝西泮', canonicalId: 'clonazepam' }],
      numbers: [],
    },
    shouldAbstain: true,
    highStakes: true,
    abstainReason: 'drug_ambiguous',
    // Deliberately flawed: clonazepam -> clonidine (a different drug).
    candidateTranslation: 'Continue clonidine.',
  },
  {
    id: 'drug-02-result-polarity-flip',
    lang: 'zh',
    kind: 'notes',
    sourceText: '乙肝表面抗原 阳性。',
    goldTranslation: 'Hepatitis B surface antigen positive.',
    immutables: {
      negations: ['阳性'],
      dosages: [],
      drugs: [],
      numbers: [],
    },
    shouldAbstain: true,
    highStakes: true,
    abstainReason: 'drug_ambiguous',
    // Deliberately flawed: positive -> negative result flip.
    candidateTranslation: 'Hepatitis B surface antigen negative.',
  },
  {
    id: 'drug-03-unknown-altered',
    lang: 'zh',
    kind: 'notes',
    sourceText: '服用恩美曲妥珠单抗治疗。',
    goldTranslation: 'Take trastuzumab emtansine for treatment.',
    immutables: {
      negations: [],
      dosages: [],
      drugs: [{ surface: '恩美曲妥珠单抗', canonicalId: '' }],
      numbers: [],
    },
    shouldAbstain: true,
    highStakes: true,
    abstainReason: 'drug_ambiguous',
    // Deliberately flawed: an unverifiable drug substituted with a known one.
    candidateTranslation: 'Take trastuzumab for treatment.',
  },
  {
    id: 'drug-04-faithful-metformin',
    lang: 'zh',
    kind: 'notes',
    sourceText: '继续服用二甲双胍。',
    goldTranslation: 'Continue metformin.',
    immutables: {
      negations: [],
      dosages: [],
      drugs: [{ surface: '二甲双胍', canonicalId: 'metformin' }],
      numbers: [],
    },
    shouldAbstain: false,
    highStakes: false,
    // Faithful: drug preserved by canonical id -> render.
    candidateTranslation: 'Continue metformin.',
  },
];
