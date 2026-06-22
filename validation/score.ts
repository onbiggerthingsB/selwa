// Per-case scoring helpers for the runner (M4.4).
//
// `matchedImmutables` counts how many of a case's gold immutable medical terms
// survive verbatim in a candidate translation string. The check is deliberately
// simple and deterministic — substring presence of each immutable's surface
// form / value / dosage / negation token — so the fidelity metric is reproducible
// and does not itself depend on the LLM. Numbers must match value (unit presence
// is a soft bonus, not required, since a faithful translation may localize the
// unit word but must keep the magnitude).

import type { CorpusCase } from './types';

// Normalize for loose matching: lowercase, collapse whitespace. We keep digits
// and CJK intact.
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

// A negation immutable is encoded in the corpus as "<marker> <finding>" or a
// bare result-polarity token ('阳性'). We credit it as preserved when the
// finding/polarity token survives AND the candidate does not flip its polarity.
// For scoring purposes we only require the finding/polarity surface to appear;
// the guard owns the harder polarity-flip safety check.
function negationPreserved(neg: string, candidate: string): boolean {
  const c = norm(candidate);
  // Take the most contentful token(s) of the negation descriptor.
  const tokens = neg.split(/\s+/).filter((t) => t && t !== 'present' && t !== 'absent');
  if (tokens.length === 0) return false;
  // Map a few canonical finding tokens to their cross-lingual surface forms so a
  // ZH source negation can be credited against an EN translation.
  const SURFACE: Record<string, string[]> = {
    占位: ['占位', 'space-occupying', 'space occupying', 'mass', 'lesion'],
    恶性: ['恶性', 'malignant', 'malignan'],
    积液: ['积液', 'effusion'],
    ild: ['ild', 'interstitial lung disease', '间质性肺病'],
    阳性: ['阳性', 'positive'],
    阴性: ['阴性', 'negative'],
    未见: ['未见', 'no ', 'not ', 'without', 'free of'],
    'cannot exclude': ['cannot exclude', 'cannot rule out', '不能排除', '不除外'],
  };
  return tokens.every((tok) => {
    const surfaces = SURFACE[tok] ?? [tok];
    return surfaces.some((s) => c.includes(norm(s)));
  });
}

function drugPreserved(surface: string, canonicalId: string, candidate: string): boolean {
  const c = norm(candidate);
  if (c.includes(norm(surface))) return true;
  if (canonicalId && c.includes(norm(canonicalId))) return true;
  return false;
}

function numberPreserved(value: string, candidate: string): boolean {
  // Match the numeric magnitude as a standalone token (avoid '5' matching '50').
  const v = value.replace(/[^\d.]/g, '');
  if (!v) return false;
  const re = new RegExp(`(?<!\\d)${v.replace('.', '\\.')}(?!\\d)`);
  return re.test(candidate);
}

function dosagePreserved(dosage: string, candidate: string): boolean {
  // A dosage descriptor (e.g. '850mg', '1-2片', '50 mcg') is preserved when its
  // numeric core survives; the unit may be transliterated.
  const nums = dosage.match(/\d+(?:\.\d+)?/g) ?? [];
  if (nums.length === 0) return norm(candidate).includes(norm(dosage));
  return nums.every((n) => numberPreserved(n, candidate));
}

/**
 * Count gold immutables that survive in `candidate`. The denominator |I_src| is
 * `totalImmutables(case)` from types.ts; this is the numerator.
 */
export function countMatchedImmutables(c: CorpusCase, candidate: string): number {
  if (!candidate) return 0;
  let matched = 0;
  for (const neg of c.immutables.negations) {
    if (negationPreserved(neg, candidate)) matched += 1;
  }
  for (const dose of c.immutables.dosages) {
    if (dosagePreserved(dose, candidate)) matched += 1;
  }
  for (const drug of c.immutables.drugs) {
    if (drugPreserved(drug.surface, drug.canonicalId, candidate)) matched += 1;
  }
  for (const num of c.immutables.numbers) {
    if (numberPreserved(num.value, candidate)) matched += 1;
  }
  return matched;
}
