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
  // D-dimer, SAME FEU basis, exact decimal-scale changes (1 mg/L = 1000 ng/mL = 1000 µg/L).
  // These are basis-preserving (FEU→FEU), so unambiguous — a bare (basis-less) ng/mL / µg/L
  // is NOT listed and still abstains via R2. This restores rule-out interpretation on the
  // most common real report format (e.g. 480 ng/mL FEU = 0.48 mg/L FEU, below the 0.5 cutoff).
  { analyteKey: 'd_dimer', conventionalUnit: 'ng/mL FEU', siUnit: 'mg/L FEU', factorConvToSI: 0.001, factorSIToConv: 1000, source: 'Decimal-scale unit change within FEU basis (1 mg/L = 1000 ng/mL); exact' },
  { analyteKey: 'd_dimer', conventionalUnit: 'µg/L FEU', siUnit: 'mg/L FEU', factorConvToSI: 0.001, factorSIToConv: 1000, source: 'Decimal-scale unit change within FEU basis (1 mg/L = 1000 µg/L); exact' },
  // Hematocrit %: the fraction expressed as a percentage. 39% = 0.39 L/L (×0.01), exact. Safe
  // because % and L/L are MAGNITUDE-SEPARABLE (H1.5 mode-a: a value is plausible in exactly one
  // — 1-70 only as %, 0.1-0.7 only as L/L), so no ambiguity; a mis-scaled value is caught by R13.
  { analyteKey: 'hematocrit', conventionalUnit: '%', siUnit: 'L/L', factorConvToSI: 0.01, factorSIToConv: 100, source: 'HCT % → L/L (×0.01); magnitude-separable, unambiguous' },
  // US conventional-unit coverage (MIMIC beachhead). g/dL→g/L (×10) and phosphate mg/dL→mmol/L
  // are magnitude-separable / explicitly-labelled (not the mEq/L divalent trap), so unambiguous.
  { analyteKey: 'hemoglobin', conventionalUnit: 'g/dL', siUnit: 'g/L', factorConvToSI: 10, factorSIToConv: 0.1, source: 'Hb g/dL → g/L (×10); mass conc, exact, magnitude-separable' },
  { analyteKey: 'mchc', conventionalUnit: 'g/dL', siUnit: 'g/L', factorConvToSI: 10, factorSIToConv: 0.1, source: 'MCHC g/dL → g/L (×10); mass conc, exact, magnitude-separable' },
  { analyteKey: 'phosphate', conventionalUnit: 'mg/dL', siUnit: 'mmol/L', factorConvToSI: 0.3229, factorSIToConv: 3.097, source: 'IFCC (phosphorus MW 30.97); mg/dL is explicit (not the mEq/L trap)' },
  // Troponin I ng/mL → ng/L (x1000, exact decimal scale). DEFERRED in the US-unit bite because
  // troponin bands are ASSAY-SPECIFIC and a fixed band could drive a wrong verdict — but under
  // B1 our band drives NO user-visible verdict (the chip reproduces the report's printed range;
  // our classification only feeds the guards). So the assay-variability objection no longer
  // applies, and the conversion is what actually restores R6 mandatory-confirm on a US troponin
  // — without it the English alias is cosmetic, because the row abstains at R2 first.
  { analyteKey: 'troponin_i', conventionalUnit: 'ng/mL', siUnit: 'ng/L', factorConvToSI: 1000, factorSIToConv: 0.001, source: 'Decimal-scale unit change (1 ng/mL = 1000 ng/L); exact' },
  // NOTE: urea/BUN and calcium are DELIBERATELY EXCLUDED (abstain-traps: urea-vs-BUN ×2.14
  // ambiguity, calcium mg/dL vs mEq/L). Absence from this list ⇒ convertValue() returns null
  // ⇒ the caller abstains (R2-UNIT-MISMATCH) rather than risk a wrong conversion.
];
