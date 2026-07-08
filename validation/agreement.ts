// Inter-rater agreement for the clinician gold (validation-rigor cycle).
//
// On our skewed distribution (abstain/critical cases are rare), Cohen's kappa
// collapses even at high raw agreement — the well-documented kappa paradox. We
// therefore report AC1 + PABAK + raw agreement + prevalence together. The
// landmark MT-safety papers (Khoong 2019, Taira 2021) reported NO inter-rater
// reliability at all, so this is a cheap way to be methodologically stronger.
// Grounding: Zec et al. 2017 (the kappa paradox); Gwet's AC1; PABAK.

export interface BooleanVerdictPair {
  a: boolean; // reviewer A verdict (e.g. shouldAbstain)
  b: boolean; // reviewer B verdict
}

export interface AgreementStats {
  n: number;
  rawAgreement: number; // Po
  prevalence: number;   // mean positive rate across both raters
  cohensKappa: number;
  gwetAC1: number;
  pabak: number;
}

export function agreementStats(pairs: BooleanVerdictPair[]): AgreementStats {
  const n = pairs.length;
  const nan: AgreementStats = {
    n, rawAgreement: NaN, prevalence: NaN, cohensKappa: NaN, gwetAC1: NaN, pabak: NaN,
  };
  if (n === 0) return nan;

  let bothPos = 0, bothNeg = 0, aPos = 0, bPos = 0;
  for (const { a, b } of pairs) {
    if (a) aPos += 1;
    if (b) bPos += 1;
    if (a && b) bothPos += 1;
    else if (!a && !b) bothNeg += 1;
  }
  const po = (bothPos + bothNeg) / n;               // observed agreement
  const pA = aPos / n, pB = bPos / n;               // per-rater positive rates
  const prevalence = (pA + pB) / 2;

  // Cohen's kappa: chance agreement by independent marginals.
  const peCohen = pA * pB + (1 - pA) * (1 - pB);
  const cohensKappa = peCohen === 1 ? 1 : (po - peCohen) / (1 - peCohen);

  // Gwet's AC1: chance agreement via a prevalence-robust formulation.
  const piHat = (pA + pB) / 2;
  const peGwet = 2 * piHat * (1 - piHat);
  const gwetAC1 = peGwet === 1 ? 1 : (po - peGwet) / (1 - peGwet);

  // PABAK: prevalence-and-bias-adjusted kappa = 2·Po − 1.
  const pabak = 2 * po - 1;

  return { n, rawAgreement: po, prevalence, cohensKappa, gwetAC1, pabak };
}
