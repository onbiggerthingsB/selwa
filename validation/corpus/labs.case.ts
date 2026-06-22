// Labs family (M1/M2). Unit-conversion traps that OURS must abstain on (R2),
// safe conversions that OURS renders (R2b), and faithful in-range values.
// These cases drive the labs path of the runner (groundExtraction). The
// sourceText/goldTranslation are the printed lab line and its plain reading;
// the immutables capture the numeric value+unit that must survive.
// Synthetic; NO real PHI.

import type { CorpusCase } from '../types';

export const LABS_CASES: CorpusCase[] = [
  {
    id: 'labs-01-urea-conversion-trap',
    lang: 'zh',
    kind: 'labs',
    sourceText: '尿素 14 mg/dL',
    goldTranslation: 'Urea 14 mg/dL',
    immutables: {
      negations: [],
      dosages: [],
      drugs: [],
      numbers: [{ value: '14', unit: 'mg/dL' }],
    },
    shouldAbstain: true,
    highStakes: false,
    // No curated urea/BUN conversion exists (the molar ambiguity trap): OURS
    // must abstain (R2-UNIT-MISMATCH) rather than guess a value.
    abstainReason: 'unit_conversion_ambiguous',
  },
  {
    id: 'labs-02-glucose-safe-conversion',
    lang: 'en',
    kind: 'labs',
    sourceText: 'GLU 99 mg/dL',
    goldTranslation: 'Glucose 99 mg/dL (= 5.49 mmol/L)',
    immutables: {
      negations: [],
      dosages: [],
      drugs: [],
      numbers: [{ value: '99', unit: 'mg/dL' }],
    },
    shouldAbstain: false,
    highStakes: false,
    // Curated, unambiguous conversion (R2b): 99 mg/dL = 5.49 mmol/L -> render.
  },
  {
    id: 'labs-03-potassium-faithful',
    lang: 'en',
    kind: 'labs',
    sourceText: 'K 4.2 mmol/L',
    goldTranslation: 'Potassium 4.2 mmol/L',
    immutables: {
      negations: [],
      dosages: [],
      drugs: [],
      numbers: [{ value: '4.2', unit: 'mmol/L' }],
    },
    shouldAbstain: false,
    highStakes: false,
    // Already canonical unit, in range -> render with no conversion.
  },
];
