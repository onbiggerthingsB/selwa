export interface UnitConversion {
  analyteKey: string;
  conventionalUnit: string; // e.g. 'mg/dL'
  siUnit: string;           // canonical SI on our reference table
  factorConvToSI: number;   // conventional × this = SI
  factorSIToConv: number;   // SI × this = conventional
  source: string;
}

export const UNIT_CONVERSIONS: UnitConversion[] = [
  { analyteKey: 'fasting_glucose', conventionalUnit: 'mg/dL', siUnit: 'mmol/L', factorConvToSI: 0.0555, factorSIToConv: 18.0182, source: 'IFCC molar conversion (glucose MW 180)' },
  { analyteKey: 'total_cholesterol', conventionalUnit: 'mg/dL', siUnit: 'mmol/L', factorConvToSI: 0.02586, factorSIToConv: 38.67, source: 'IFCC (cholesterol MW 386.65)' },
  { analyteKey: 'ldl_cholesterol', conventionalUnit: 'mg/dL', siUnit: 'mmol/L', factorConvToSI: 0.02586, factorSIToConv: 38.67, source: 'IFCC (same molecule as total cholesterol)' },
  { analyteKey: 'hdl_cholesterol', conventionalUnit: 'mg/dL', siUnit: 'mmol/L', factorConvToSI: 0.02586, factorSIToConv: 38.67, source: 'IFCC (same molecule as total cholesterol)' },
  { analyteKey: 'triglycerides', conventionalUnit: 'mg/dL', siUnit: 'mmol/L', factorConvToSI: 0.01129, factorSIToConv: 88.57, source: 'IFCC (triolein MW ~885)' },
  { analyteKey: 'creatinine', conventionalUnit: 'mg/dL', siUnit: 'umol/L', factorConvToSI: 88.42, factorSIToConv: 0.01131, source: 'IFCC (creatinine MW 113.12); SI is µmol/L' },
  { analyteKey: 'total_bilirubin', conventionalUnit: 'mg/dL', siUnit: 'umol/L', factorConvToSI: 17.10, factorSIToConv: 0.05848, source: 'IFCC (bilirubin MW 584.66); SI is µmol/L' },
  { analyteKey: 'uric_acid', conventionalUnit: 'mg/dL', siUnit: 'umol/L', factorConvToSI: 59.48, factorSIToConv: 0.01681, source: 'IFCC (uric acid MW 168.11); SI is µmol/L' },
  // NOTE: urea/BUN and calcium are DELIBERATELY EXCLUDED (abstain-traps: urea-vs-BUN ×2.14
  // ambiguity, calcium mg/dL vs mEq/L). Absence from this list ⇒ convertValue() returns null
  // ⇒ the caller abstains (R2-UNIT-MISMATCH) rather than risk a wrong conversion.
];
