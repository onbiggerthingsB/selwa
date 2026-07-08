import type { CorpusCase } from '../types';
// Uncurated-unit trap: a value whose unit has no curated unambiguous conversion must
// abstain (R2), never silently mis-classify. Grounding: the mg/dL-vs-mmol/L family of
// real-world harms (ChatGPT diabetes study, arXiv 2501.07931) — the safe response is
// to refuse a conversion the table does not curate. (urea/BUN and calcium are the
// deliberately-excluded uncurated units per data/unit-conversions.ts.)
export const UNIT_TRAP_CASES: CorpusCase[] = [
  {
    id: 'unit-trap-urea-mgdl', lang: 'zh', kind: 'labs',
    sourceText: '尿素 14 mg/dL', goldTranslation: 'Urea 14 mg/dL (no unambiguous SI conversion)',
    immutables: { negations: [], dosages: [], drugs: [], numbers: [{ value: '14', unit: 'mg/dL' }] },
    shouldAbstain: true, highStakes: false, abstainReason: 'unit_conversion_ambiguous',
  },
  {
    id: 'unit-trap-glucose-gl', lang: 'zh', kind: 'labs',
    sourceText: '空腹血糖 5.5 g/L', goldTranslation: 'Fasting glucose 5.5 g/L (non-standard unit)',
    immutables: { negations: [], dosages: [], drugs: [], numbers: [{ value: '5.5', unit: 'g/L' }] },
    shouldAbstain: true, highStakes: true, abstainReason: 'number_unit_mismatch',
  },
];
