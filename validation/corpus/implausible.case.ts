// R13 family. An implausible high-stakes labs value (decimal-shift / misread) that
// OURS must SUPPRESS via R13 → gold shouldAbstain + highStakes, so the release gate
// stays valid now that the guard catches it. Synthetic; NO real PHI.

import type { CorpusCase } from '../types';

export const IMPLAUSIBLE_CASES: CorpusCase[] = [
  {
    id: 'implausible-potassium-40',
    lang: 'en',
    kind: 'labs',
    sourceText: '钾 40 mmol/L',
    goldTranslation: 'Potassium 40 mmol/L (implausible — likely a misread of 4.0)',
    immutables: { negations: [], dosages: [], drugs: [], numbers: [{ value: '40', unit: 'mmol/L' }] },
    shouldAbstain: true,
    highStakes: true,
    abstainReason: 'implausible_value',
  },
  {
    id: 'implausible-glucose-550',
    lang: 'zh',
    kind: 'labs',
    sourceText: '空腹血糖 550 mmol/L',
    goldTranslation: 'Fasting glucose 550 mmol/L (implausible — likely a misread)',
    immutables: { negations: [], dosages: [], drugs: [], numbers: [{ value: '550', unit: 'mmol/L' }] },
    shouldAbstain: true,
    highStakes: true,
    abstainReason: 'implausible_value',
  },
];
