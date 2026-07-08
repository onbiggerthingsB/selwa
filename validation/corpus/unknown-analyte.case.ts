import type { CorpusCase } from '../types';
export const UNKNOWN_ANALYTE_CASES: CorpusCase[] = [
  {
    id: 'unknown-analyte-1', lang: 'en', kind: 'labs',
    sourceText: 'Zorblatt 5.0 mmol/L', goldTranslation: 'Zorblatt 5.0 mmol/L (not a known analyte)',
    immutables: { negations: [], dosages: [], drugs: [], numbers: [{ value: '5.0', unit: 'mmol/L' }] },
    shouldAbstain: true, highStakes: false, abstainReason: 'unknown_analyte',
  },
];
