// Validation metrics (M4.3) — the validated core of the harness.
//
// Three numbers, defined exactly:
//
//   medicalTermFidelity (term-weighted, over EMITTED cases only)
//     = Σ matchedImmutables / Σ |I_src|   for cases the pipeline emitted.
//     A case with |I_src| = 0 is excluded (it contributes neither numerator nor
//     denominator). No emitted case with immutables → denominator 0 → NaN.
//
//   abstentionPrecision = |A ∩ G| / |A|
//     A = cases the pipeline abstained on; G = gold shouldAbstain cases.
//     |A| = 0 → NaN (report N/A, NEVER 1.0).
//
//   abstentionRecall = |A ∩ G| / |G|
//     |G| = 0 → NaN. With { highStakesOnly: true }, restrict G to highStakes
//     gold-abstain cases — a missed abstention there is a release blocker.
//
// Undefined ratios return NaN so the report shows "N/A" rather than a misleading
// perfect score.

export interface GoldCase {
  id: string;
  shouldAbstain: boolean;
  highStakes: boolean;
  immutables: number; // |I_src| — total immutable medical terms in the source
}

export interface CaseResult {
  id: string;
  abstained: boolean;
  matchedImmutables: number; // immutables preserved in the emitted translation
  emitted: boolean; // did the pipeline produce a usable translation (not abstain)?
}

function goldById(gold: GoldCase[]): Map<string, GoldCase> {
  const m = new Map<string, GoldCase>();
  for (const g of gold) m.set(g.id, g);
  return m;
}

/**
 * Term-weighted medical-term fidelity over EMITTED cases only.
 * Σ matchedImmutables / Σ |I_src|, excluding cases with |I_src| = 0.
 * Returns NaN when no emitted case carries any immutable.
 */
export function medicalTermFidelity(results: CaseResult[], gold: GoldCase[]): number {
  const byId = goldById(gold);
  let matched = 0;
  let total = 0;
  for (const r of results) {
    if (!r.emitted) continue;
    const g = byId.get(r.id);
    if (!g) continue;
    if (g.immutables === 0) continue; // |I_src| = 0 → excluded
    matched += r.matchedImmutables;
    total += g.immutables;
  }
  if (total === 0) return NaN;
  return matched / total;
}

/**
 * Abstention precision = |A ∩ G| / |A|.
 * Returns NaN when nothing abstained (|A| = 0) — never 1.0.
 */
export function abstentionPrecision(results: CaseResult[], gold: GoldCase[]): number {
  const byId = goldById(gold);
  const abstained = results.filter((r) => r.abstained);
  if (abstained.length === 0) return NaN;
  const correct = abstained.filter((r) => byId.get(r.id)?.shouldAbstain === true).length;
  return correct / abstained.length;
}

export interface RecallOptions {
  /** Restrict the gold set G to highStakes cases (release-blocker subset). */
  highStakesOnly?: boolean;
}

/**
 * Abstention recall = |A ∩ G| / |G|.
 * With { highStakesOnly: true }, G is restricted to highStakes gold-abstain cases.
 * Returns NaN when |G| = 0.
 */
export function abstentionRecall(
  results: CaseResult[],
  gold: GoldCase[],
  opts: RecallOptions = {},
): number {
  const goldAbstain = gold.filter(
    (g) => g.shouldAbstain && (!opts.highStakesOnly || g.highStakes),
  );
  if (goldAbstain.length === 0) return NaN;
  const resultById = new Map(results.map((r) => [r.id, r]));
  const caught = goldAbstain.filter((g) => resultById.get(g.id)?.abstained === true).length;
  return caught / goldAbstain.length;
}
