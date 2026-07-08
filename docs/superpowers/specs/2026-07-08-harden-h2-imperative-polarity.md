---
type: project
title: "Health Translator — H2 / R7b: medication imperative-polarity guard"
created: 2026-07-08
status: shipped
owner: agent
source: "harden-extraction H2; built TDD, hardened over 3 adversarial review rounds (Opus + Fable 5)"
---

# H2 — R7b: medication imperative-polarity (hold ↔ continue ↔ dose-direction)

Closes the Khoong-2019 flagship harm: machine translation flips **"hold [stop] your kidney
medicine"** into **"keep taking it."** Before R7b the notes guard had **no imperative
reconciler** — a drug faithfully echoed on both sides passed `evaluateSegment` (which only
checks negation/dose/drug/result-polarity), so a hold→continue flip **rendered a confident
wrong instruction**. A wrongful abstain here is safe (blank the translation, show the
verbatim original + "confirm with clinician"); a missed flip is potentially fatal.

## Design (deterministic, escalate-only — preserves the LLM-is-OCR-only moat)

- **New immutable** `imperative` (`lib/types.ts`): `imperative: hold|continue|dose-change|unknown`,
  `doseDir: up|down|unknown`, reusing `drugId` for scope.
- **Detector** `detectImperatives` (`lib/notesDetect.ts`), per-clause, after drugs so spans
  exist for scope binding. Multi-char, med-scoped markers (`停药`/`暂停服用`/`继续服用`/`减量`;
  EN `stop taking`/`hold off`/`keep taking`) so disease/finding false-friends (`停经`
  amenorrhea, `继续观察` keep-observing, `恢复良好` recovering-well) never fire. Guards:
  - **Drug-scope gate**: bare/ambiguous markers (`继续`/`维持`/`停`/EN `stop`/`hold`/…) carry
    `requiresDrugScope` — emit only with a drug in the clause, OR a med **anaphor**
    (`这个药` / "this medication") or drug-**class** anchor (`降压药` / "statin", "blood thinner").
  - **Double-inversion** by **immediate adjacency** (`endsWith`, not a window): `不要停药` =
    do-not-stop = continue; `不得不停用` ("had to stop" — a real hold) does **not** invert.
  - **`停…药` regex** catches `停他汀类药物`/`停降压药` even when the class isn't a known drug;
    **`cut … in half`** regex catches a drug-separated halve. `STOP_FALSE_FRIEND_NEXT` /
    `PAUSE_FALSE_FRIEND_NEXT` keep `停经`/`停止`/`暂停期间` from firing.
- **Reconciliation** `imperativesInconsistent` (`lib/notesGrounding.ts`): compare the ORIGINAL
  note's directives against the model's **translation** (not its echoed `sourceText`, which
  the LLM can rewrite to agree with its wrong output). Detect under **both** lexicons and
  union (so a mixed-script note can't misroute `inferLang` and skip the check). Compare the
  **polarity multiset**; key by **drugId only when ≥2 distinct polarities** are present (a
  per-drug SWAP is possible → catch `hold(A)+continue(B)` rendered `continue(A)+hold(B)`),
  else by polarity alone (so a shared directive reordered across `和`/"and" doesn't
  false-mismatch). Any mismatch, dropped directive, or unverifiable order (bare `调整`/"adjust")
  → **replace the whole note with the verbatim-original abstain** (NOT merely append — a
  flipped segment otherwise still renders its wrong text).

## Verification — three adversarial rounds (converged)

1. **Opus multi-agent review** → 10 **unsafe blockers** (cross-drug swap; bare `停`+drug;
   `inferLang` misroute; double-inversion window false-flip `别的`/`不得不`; requiresDrugScope
   pronoun miss; **a detected flip still rendered its wrong translation**). All fixed; a
   re-trace confirmed **0 still open**.
2. **Fable 5 completeness hunt** → 11 missed-phrasing classes (bare EN `stop`; ZH `别吃`/`别用`;
   drug-class nouns not an anchor; `skip`/`wean`/`d-c`; `减到`/`加到`; `维持原方案`) + 6
   over-abstains. All fixed.
3. **Opus expansion review** → 8 more tail phrasings (`照常`/`一直吃`; **EN class anchor was
   ZH-only**; `翻倍`; `keep off`/`get off`; `cut … in half`; up-dose synonyms) + 8 over-abstains
   (tightened with `requiresDrugScope`). All fixed. **No structural flaw, no hole introduced
   by the fixes.**

Result at ship: 316 lib/data/validation tests pass; CheckList 13/13; release-gate recall 1.0.

## Known residual (inherent to a lexicon approach)

Coverage is a **long tail** — each review round surfaced only rarer colloquial phrasings, no
logic bugs. The safety bias means: (a) any *detected* directive that is flipped abstains; (b)
the residual risk is a directive **missed on the original side** by an un-lexiconed phrasing,
which then renders. Mitigation is ongoing lexicon growth plus the **H3 multi-pass
self-consistency** direction (deferred behind its kill experiment, see
[harden-h3](2026-07-08-harden-h3-extraction-design.md)) as the eventual non-lexicon complement.
Cross-drug swaps among two **unknown** drugs (both `?`-scoped) remain on the polarity-only
multiset — a documented lower-frequency gap.
