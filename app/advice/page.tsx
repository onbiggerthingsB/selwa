import { notFound } from 'next/navigation';

// SAFETY QUARANTINE of Feature 2 (the free-text health-advice portal) — 2026-07-25.
//
// WHY (verified by running the shipped guard, not by inspection): lib/adviceGuard.ts enforces only
// enumerated lexical/structural floors — an emergency-keyword lexicon, the model's own outOfScope
// boolean, a Tibetan-script regex, and dosing patterns. It never adjudicates medical truth. Probing
// applyAdviceSafetyFloors with synthetic model output showed a multi-day food-and-water-avoidance
// plan and a definite "that lump is not cancer, no biopsy needed" both returning
// presentation:'normal' with the prose copied verbatim into the response, and "exercise through
// crushing chest pain" returning presentation:'banner' with the harmful schools still populated —
// the emergency banner is non-suppressing by design; only blocked() drops schools. Harmful and
// false advice therefore reached the user-facing render. That violates the product invariant that
// nothing is asserted which cannot be verified against a source document.
//
// This is a DISABLE, not a delete. The full T1-T4 implementation is preserved unmodified beside
// this file as AdvicePageResearch.tsx (and lib/adviceGuard.ts, lib/adviceCopy.ts,
// data/emergency-lexicon.ts with their tests) so the research survives on the branch.
//
// This server component renders no client bundle, so the research page's fetch('/api/advice') path
// is tree-shaken out of the shipped app. It is defence in depth only: the load-bearing control is
// the unconditional 410 at the top of app/api/advice/route.ts, which is what stops an already-open
// or PWA-cached client. Re-enabling requires deleting this file's notFound() AND the quarantine
// tests in app/advice/quarantine.test.tsx — it cannot happen silently.
export default function AdvicePage(): never {
  notFound();
}
