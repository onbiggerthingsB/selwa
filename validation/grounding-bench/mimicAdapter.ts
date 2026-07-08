// MIMIC-IV adapter — DOCUMENTED STUB (execution deferred).
//
// Access: PhysioNet Credentialed Health Data License + CITI training + DUA
// (weeks of lead time — the long pole). Source tables:
//   - hosp/labevents: itemid, valuenum, valueuom, ref_range_lower, ref_range_upper, flag
//   - hosp/d_labitems: itemid → label, fluid, category (NB: post-hoc LOINC codes are
//     imperfect — do NOT trust them for analyte identity; map via label + our aliases).
// Map each labevents row → LabObservation (collapse `flag` to normal/abnormal), then
// score with groundingRecall(). Keep all MIMIC data OUT of git (env-gated path).
import type { LabObservation } from './types';

export function loadMimicObservations(_dir = process.env.MIMIC_DIR): LabObservation[] {
  throw new Error(
    'MIMIC-IV execution is deferred: complete PhysioNet credentialing + CITI training, ' +
      'export labevents+d_labitems to a local CSV, set MIMIC_DIR, and implement the CSV→LabObservation map. See README.',
  );
}
