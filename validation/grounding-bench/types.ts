// Real-observation grounding validator (validation-rigor cycle). Validates the
// DETERMINISTIC low/normal/high classification against real reference ranges +
// abnormal flags (MIMIC-IV labevents), image-free — separating grounding error
// from OCR error. Execution deferred (PhysioNet credentialing); scorer lands now.
export interface LabObservation {
  analyteName: string;   // report/source analyte name (mapped to our table by grounding)
  value: string;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
  abnormalFlag: 'normal' | 'abnormal'; // dataset's own flag, collapsed to binary
}
