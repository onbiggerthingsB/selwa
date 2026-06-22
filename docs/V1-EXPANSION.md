# Health Translator — v1 Expansion Brief

> Purpose: v0 is built and works, but it **looks too simple** and is scoped narrow. This brief tells the next session what to upgrade so it produces a *complete* plan — without rebuilding the (good) safety core.

## Do NOT rebuild
The safety architecture is the moat and it's done well: LLM does **OCR/extraction only**; all meaning is deterministic (`lib/grounding.ts` → `lib/classify.ts` → `lib/guard.ts` rules R1–R12) grounded in `data/reference-labs.ts`; on-device IndexedDB record; PWA; tested. Keep all of it. Expansion = **polish + scope**, not a rewrite.

## Why it looks simple (diagnosis)
1. **UI is unstyled** — single hand-written `app/globals.css`, no design system; default `<select>`/`<input>`; flat row list. Functional, not designed.
2. **Scope is v0-narrow** — labs-only, Mandarin↔English; doctor-notes, unit conversion, larger analyte table, the validation number, and Mode 2 are deferred.

## Part A — Make it look serious (use the `frontend-design` skill)
A stressed patient on a phone needs calm clarity, not a form. Targets:
- Mobile-first, real visual hierarchy; a proper **result as a medical "report card"** (cards, not a flat `<ul>`).
- Turn the status colors already defined in `globals.css` (low/normal/high/critical/unclassified) into proper **severity chips + a per-row band**; make "critical/confirm with clinician" unmistakable but **reassuring, not alarming**.
- Polished capture flow (camera/upload affordance, preview, retake), real **loading / extracting / uncertain** states, and an empathetic disclaimer treatment.
- Bilingual toggle that's visible and instant; large legible type; accessible contrast.
- Consider a lightweight design system (CSS variables → tokens; or Tailwind if the team prefers) — but keep the bundle lean for the PWA.

## Part B — Make it do more (use `brainstorming` → then `writing-plans`)
Scope v1 features, each as its own testable unit, safety-core preserved:
1. **Doctor-notes plain-language translation** — the deferred free-text path; this is where the negation/dosage/drug-name fidelity rules (R7–R9, currently no-ops) must come alive, with the abstention guard.
2. **Unit auto-conversion** — replace v0's "abstain on unit mismatch" with safe, tested conversions (SI ↔ conventional) where unambiguous; still abstain when not.
3. **Expand the reference table** — well beyond ~28 analytes; sex/age-specific ranges where they matter; provenance for each range.
4. **The validation number (the rigor proof)** — assemble ~30–50 de-identified reports; measure **medical-term fidelity** + **abstention precision** vs. raw Google Translate, with clinician/bilingual review. This is the contribution that makes it more than an app.
5. **Mode 2 (live in-visit interpreter)** — real-time two-way speech with the uncertainty guard, on the same safety + record spine. Largest; sequence last.

## Skill sequence for the next session (important)
The user asked for "brainstorming → a complete implementation plan." Precise order:
1. **`frontend-design`** for Part A (UI), iterating against a live preview.
2. **`brainstorming`** to design Part B scope → it hands off to **`writing-plans`**, which produces the *complete* implementation plan (milestones, units, tests). Brainstorming alone yields a design/spec, not the plan — let it complete into writing-plans.

## Kickoff prompt (paste in the build chat)
> Read `docs/DESIGN.md` and `docs/V1-EXPANSION.md`. v0 is built; don't rebuild the deterministic safety core. First, use the **frontend-design** skill to redesign the UI (Part A) — a calm, mobile-first medical report-card experience — and iterate against a live preview. Then use **brainstorming** to design the Part B v1 scope and let it hand off to **writing-plans** for a complete implementation plan (doctor-notes translation + R7–R9 fidelity rules, unit conversion, expanded reference table, the validation number vs Google Translate, then Mode 2). Keep the safety guarantees intact throughout.
