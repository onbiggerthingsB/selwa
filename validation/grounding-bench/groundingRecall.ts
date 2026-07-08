import { groundExtraction } from '@/lib/grounding';
import type { LabObservation } from './types';

export interface GroundingRecallResult {
  total: number;
  scored: number;    // observations our table recognized + classified (not abstained/unclassified)
  agreement: number; // fraction where our normal/abnormal matches the dataset flag
}

// Our classification collapses to binary: normal → 'normal'; low/high/critical → 'abnormal'.
function isAbnormal(classification: string): boolean | null {
  if (classification === 'normal') return false;
  if (classification === 'low' || classification === 'high' || classification === 'critical') return true;
  return null; // unclassified/abstained → not scored
}

export function groundingRecall(observations: LabObservation[]): GroundingRecallResult {
  let scored = 0;
  let agree = 0;
  for (const o of observations) {
    const report = groundExtraction(
      { rows: [{ name: o.analyteName, value: o.value, unit: o.unit, printedRange: null, confidence: 'high' }] },
      'unknown',
    );
    const cls = report.rows[0].classification;
    const ours = isAbnormal(cls);
    if (ours === null) continue; // our guard abstained/couldn't classify → not counted here
    scored += 1;
    if (ours === (o.abnormalFlag === 'abnormal')) agree += 1;
  }
  return { total: observations.length, scored, agreement: scored === 0 ? NaN : agree / scored };
}
