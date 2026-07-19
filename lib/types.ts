import type { LocalizedText } from '@/lib/i18n';

export type Sex = 'male' | 'female' | 'unknown';

export type Bound = number | { male: number; female: number };

export interface ReferenceEntry {
  key: string; // stable id, e.g. 'fasting_glucose'
  name: LocalizedText;
  aliases: string[]; // EN abbreviations + ZH names/synonyms, matched case-insensitively
  specimen: 'blood' | 'urine'; // required: known context must never cross specimen frames
  /**
   * 'ours' uses a curated band. 'report-only' names/translates the test but
   * never classifies it; any position comes solely from the printed report.
   */
  interpretation: 'ours' | 'report-only';
  /**
   * Aliases that are safe only when the report explicitly identifies the row's
   * specimen. These are indexed separately from the unscoped aliases above.
   */
  specimenAliases?: Partial<Record<'urine' | 'blood', string[]>>;
  unit: string; // canonical SI unit, e.g. 'mmol/L'
  allowedUnits: string[]; // exact equivalents accepted without conversion
  unitOptional?: boolean; // curated exception for intrinsically unitless rows whose reports omit a unit
  refLow: Bound | null; // null when the analyte has only an upper decision cutoff
  refHigh: Bound | null; // null when only a lower bound is meaningful (e.g. eGFR, HDL)
  criticalLow: number | null; // SI; null when no panic band defined
  criticalHigh: number | null; // SI
  // R13 (harden-H1): absolute PLAUSIBILITY bounds — hard OCR-integrity min/max in
  // the canonical SI unit, deliberately far wider than the reference/critical band
  // so every real survivable/critical value passes; only magnitude-absurd misreads
  // (decimal shifts, inserted digits, wrong-row values) fall outside. NOT a
  // reference range, NOT a panic threshold, NOT biological impossibility. null = no
  // meaningful numeric bound on that side (qualitative fields).
  // Source: docs/superpowers/specs/2026-07-08-absolute-bounds-source.md
  absoluteLow: number | null;
  absoluteHigh: number | null;
  highStakes: boolean; // any abnormal value always flagged for clinician
  populationSensitive: boolean; // range depends on sex/age/fasting/pregnancy
  ageBands?: AgeBand[];
  // B1 (Codex blocker #2): the CARD renders `definition` — a DIRECTION-NEUTRAL
  // definition of what the test IS (no "high means X", no thresholds, no triage), so it cannot
  // compose with the report-relative chip into a patient-specific verdict. `plain` is
  // the FULLER description (carries directional/reference nuance) and is reserved for a separate
  // glossary one tap away from the patient's number — never rendered beneath the chip. See
  // lib/summary.ts and validation/b1VerdictLeakage.test.ts.
  definition: LocalizedText;
  plain: LocalizedText;
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
  message: LocalizedText;
}

export interface ExtractedRow {
  name: string;
  value: string | null; // kept as string to preserve exact decimal
  unit: string | null;
  printedRange: string | null; // reference range as printed on the report, if any
  confidence: 'low' | 'medium' | 'high';
  specimen?: 'urine' | 'blood' | 'unknown' | null; // absent/null === unknown
}

export interface GroundedRow {
  extracted: ExtractedRow;
  entry: ReferenceEntry | null;
  matchedVia: 'unmatched' | 'exact' | 'specimen-scoped';
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
export type ImmutableType = 'negation' | 'dosage' | 'drug' | 'number' | 'imperative';
export type Polarity = 'present' | 'absent' | 'uncertain';
// R7b (harden-H2): medication-directive polarity. A hold↔continue flip (Khoong 2019's
// flagship harm: "hold the kidney medicine" → "keep taking it") or a dose-direction
// swap must force an abstain. 'unknown' = a directive we cannot confidently classify
// (bare 调整/adjust) → also abstain, since a missed flip is the only dangerous class.
export type ImperativePolarity = 'hold' | 'continue' | 'dose-change' | 'unknown';
export type DoseDir = 'up' | 'down' | 'unknown';

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
  drugId?: string | null;      // drug/imperative: canonical known id in scope, or null = unknown-med
  numUnit?: string | null;     // number: trailing unit if any
  imperative?: ImperativePolarity; // imperative: hold/continue/dose-change/unknown
  doseDir?: DoseDir;           // imperative: direction of a dose-change directive
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
