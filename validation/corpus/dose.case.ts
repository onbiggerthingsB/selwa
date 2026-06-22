// Dose / number failure family (R8). Rounded amounts, swapped unit dimensions,
// dropped frequency, collapsed ranges — plus faithful doses that must render.
// Synthetic; NO real PHI.

import type { CorpusCase } from '../types';

export const DOSE_CASES: CorpusCase[] = [
  {
    id: 'dose-01-magnitude-metformin',
    lang: 'zh',
    kind: 'notes',
    sourceText: '二甲双胍 850mg 每日两次。',
    goldTranslation: 'Metformin 850 mg twice daily.',
    immutables: {
      negations: [],
      dosages: ['850mg'],
      drugs: [{ surface: '二甲双胍', canonicalId: 'metformin' }],
      numbers: [{ value: '850', unit: 'mg' }],
    },
    shouldAbstain: true,
    highStakes: true,
    abstainReason: 'dose_mismatch',
    // Deliberately flawed: dose diverges by >=2x (850 -> 250) — the magnitude
    // class the guard abstains on, not a benign rounding.
    candidateTranslation: 'Metformin 250 mg twice daily.',
  },
  {
    id: 'dose-02-unit-swap-levothyroxine',
    lang: 'en',
    kind: 'notes',
    sourceText: 'Levothyroxine 50 mcg once daily.',
    goldTranslation: '左甲状腺素 50 微克 每日一次。',
    immutables: {
      negations: [],
      dosages: ['50 mcg'],
      drugs: [{ surface: 'levothyroxine', canonicalId: 'levothyroxine' }],
      numbers: [{ value: '50', unit: 'mcg' }],
    },
    shouldAbstain: true,
    highStakes: true,
    abstainReason: 'number_unit_mismatch',
    // Deliberately flawed: mcg -> 毫克 (mg) is a 1000x dose error.
    candidateTranslation: '左甲状腺素 50 毫克 每日一次。',
  },
  {
    id: 'dose-03-dropped-frequency-flag',
    lang: 'zh',
    kind: 'notes',
    sourceText: '阿托伐他汀 20mg 每晚一次。',
    goldTranslation: 'Atorvastatin 20 mg once nightly.',
    immutables: {
      negations: [],
      dosages: ['20mg 每晚一次'],
      drugs: [{ surface: '阿托伐他汀', canonicalId: 'atorvastatin' }],
      numbers: [{ value: '20', unit: 'mg' }],
    },
    // The amount + drug survive; only the frequency is dropped. The guard FLAGS
    // (emits with a "frequency lost" caution) rather than abstaining, so the
    // gold is emit-with-caution, NOT abstain. This case checks that the harness
    // credits a faithful-enough emission and does not over-count it as an
    // abstention miss.
    shouldAbstain: false,
    highStakes: false,
    candidateTranslation: 'Atorvastatin 20 mg.',
  },
  {
    id: 'dose-04-faithful-amoxicillin',
    lang: 'zh',
    kind: 'notes',
    sourceText: '阿莫西林 500 毫克 每日三次。',
    goldTranslation: 'Amoxicillin 500 mg three times daily.',
    immutables: {
      negations: [],
      dosages: ['500 毫克 每日三次'],
      drugs: [{ surface: '阿莫西林', canonicalId: 'amoxicillin' }],
      numbers: [{ value: '500', unit: 'mg' }],
    },
    shouldAbstain: false,
    highStakes: false,
    // Faithful: 毫克 ≡ mg true transliteration; frequency preserved -> render.
    candidateTranslation: 'Amoxicillin 500 mg three times daily.',
  },
  {
    id: 'dose-05-faithful-ibuprofen-range',
    lang: 'zh',
    kind: 'notes',
    sourceText: '布洛芬 1-2片 需要时服用。',
    goldTranslation: 'Ibuprofen 1-2 tablets as needed.',
    immutables: {
      negations: [],
      dosages: ['1-2片'],
      drugs: [{ surface: '布洛芬', canonicalId: 'ibuprofen' }],
      numbers: [],
    },
    shouldAbstain: false,
    highStakes: false,
    // Faithful: full range + PRN frequency survive -> render.
    candidateTranslation: 'Ibuprofen 1-2 tablets as needed.',
  },
];
