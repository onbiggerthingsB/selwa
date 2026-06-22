// Clinician-verdict import (M4.4).
//
// Folds reviewer verdicts (from export.ts's CSV/JSON) back onto corpus cases:
// overrides goldTranslation / shouldAbstain / highStakes / abstainReason where a
// reviewer supplied a value. Cases without a matching verdict pass through
// unchanged. Immutable labeling stays in the case file (it is structured), but a
// reviewer's abstain verdict is authoritative.

import type { AbstainReason, CorpusCase } from '../types';
import { AbstainReasonSchema } from '../types';
import type { ReviewRow } from './export';

function parseBool(s: string | undefined, fallback: boolean): boolean {
  if (s === undefined || s === '') return fallback;
  return s.trim().toLowerCase() === 'true';
}

function parseReason(s: string | undefined): AbstainReason | undefined {
  if (!s || s.trim() === '') return undefined;
  const parsed = AbstainReasonSchema.safeParse(s.trim());
  return parsed.success ? parsed.data : undefined;
}

/** Apply a map of reviewer verdicts (keyed by case id) onto the corpus. */
export function applyVerdicts(cases: CorpusCase[], verdicts: ReviewRow[]): CorpusCase[] {
  const byId = new Map(verdicts.map((v) => [v.id, v]));
  return cases.map((c) => {
    const v = byId.get(c.id);
    if (!v) return c;
    const shouldAbstain = parseBool(v.shouldAbstain, c.shouldAbstain);
    return {
      ...c,
      goldTranslation: v.goldTranslation?.trim() ? v.goldTranslation : c.goldTranslation,
      shouldAbstain,
      highStakes: parseBool(v.highStakes, c.highStakes),
      abstainReason: shouldAbstain ? parseReason(v.abstainReason) ?? c.abstainReason : undefined,
    };
  });
}

/** Parse a JSON verdict blob (the inverse of export.toReviewJson). */
export function parseVerdictJson(json: string): ReviewRow[] {
  const data = JSON.parse(json);
  if (!Array.isArray(data)) throw new Error('Verdict JSON must be an array of review rows.');
  return data as ReviewRow[];
}
