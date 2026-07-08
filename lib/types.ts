export type Sex = 'male' | 'female' | 'unknown';

export type Bound = number | { male: number; female: number };

export interface ReferenceEntry {
  key: string; // stable id, e.g. 'fasting_glucose'
  nameEn: string;
  nameZh: string;
  aliases: string[]; // EN abbreviations + ZH names/synonyms, matched case-insensitively
  unit: string; // canonical SI unit, e.g. 'mmol/L'
  allowedUnits: string[]; // exact equivalents accepted without conversion
  refLow: Bound | null; // null when the analyte has only an upper decision cutoff
  refHigh: Bound | null; // null when only a lower bound is meaningful (e.g. eGFR, HDL)
  criticalLow: number | null; // SI; null when no panic band defined
  criticalHigh: number | null; // SI
  highStakes: boolean; // any abnormal value always flagged for clinician
  populationSensitive: boolean; // range depends on sex/age/fasting/pregnancy
  ageBands?: AgeBand[];
  plainEn: string;
  plainZh: string;
  source: string;
}

export type Classification = 'low' | 'normal' | 'high' | 'critical' | 'unclassified';
// The guard's row-level verdict. 'confirm' is intentionally NOT a value here: the
// confirm-the-values gate is driven by the separate GroundedRow.needsConfirm
// boolean (evaluateRow only ever returns 'classify' or 'abstain'). Keeping a dead
// 'confirm' action here previously misled a design pass — see harden-extraction H0.
export type GuardAction = 'classify' | 'abstain';
export type FlagSeverity = 'info' | 'caution' | 'urgent';

export interface GuardFlag {
  id: string; // rule id, e.g. 'R4-HIGH-STAKES-ANY-ABNORMAL'
  severity: FlagSeverity;
  messageEn: string;
  messageZh: string;
}

export interface ExtractedRow {
  name: string;
  value: string | null; // kept as string to preserve exact decimal
  unit: string | null;
  printedRange: string | null; // reference range as printed on the report, if any
  confidence: 'low' | 'medium' | 'high';
}

export interface GroundedRow {
  extracted: ExtractedRow;
  entry: ReferenceEntry | null;
  valueNum: number | null;
  classification: Classification;
  action: GuardAction;
  needsConfirm: boolean;
  flags: GuardFlag[];
}

export interface GroundedReport {
  rows: GroundedRow[];
  sex: Sex;
  age?: number;
  generatedAt: number;
}

// --- M1: age support (additive; existing entries omit ageBands) ---
export interface AgeBand {
  ageMin: number; // inclusive, years
  ageMax: number; // inclusive, years
  refLow: Bound | null; // null when the band has only an upper cutoff
  refHigh: Bound | null; // null when the band has only a lower bound
}

// --- M3: doctor-notes immutables ---
export type ImmutableType = 'negation' | 'dosage' | 'drug' | 'number';
export type Polarity = 'present' | 'absent' | 'uncertain';

export interface Immutable {
  type: ImmutableType;
  raw: string;                 // verbatim source span
  finding?: string;            // negation: canonical finding key it scopes
  polarity?: Polarity;         // negation
  strength?: number;           // negation: hedge-ladder rank (higher = more certain)
  amount?: string;             // dosage/number: verbatim normalized digits
  unitDim?: string;            // dosage: normalized unit dimension key (mg, mL, mcg, IU, tablet…)
  frequency?: string;          // dosage: canonical frequency
  range?: { min: string; max: string }; // dosage range, e.g. 1–2 tablets
  drugId?: string | null;      // drug: canonical known id, or null = unknown-med
  numUnit?: string | null;     // number: trailing unit if any
}

export type SegmentKind = 'finding' | 'medication' | 'instruction' | 'followup' | 'other';
export type SegmentAction = 'render' | 'flag' | 'abstain';

export interface GroundedSegment {
  source: string;
  translated: string;          // '' when action === 'abstain'
  kind: SegmentKind;
  action: SegmentAction;
  flags: GuardFlag[];
  preserved: Immutable[];
}
export interface GroundedNotes {
  segments: GroundedSegment[];
  overallAction: SegmentAction; // max severity over segments (abstain > flag > render)
}
