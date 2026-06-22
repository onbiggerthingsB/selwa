# Health Translator

A safety-guarded medical-**comprehension** app — **not** a plain translator.

It carries a limited-English-proficiency patient through a medical encounter end-to-end:
- **Mode 1 (after-visit comprehension)** — photograph labs/discharge + paste/record what the doctor said → a grounded, translated, plain-language summary (diagnosis, meds + schedule, your labs explained vs reference ranges, "confirm with your doctor" flags).
- **Mode 2 (live in-visit interpreter)** — real-time two-way speech with medical-term fidelity and an "I'm unsure — confirm this" guard.

## Why not just use Google Translate?
For translating *words*, you can — so that part is commodity. Generic translators fail in healthcare in four ways that **are** this product: (1) clinically significant errors with no uncertainty flag, (2) translation ≠ comprehension, (3) no kept record (patients forget 40–80% of a visit), (4) reports are images of jargon. The moat is **comprehension + safety**, never raw translation.

## Status
Design approved (**Approach A** — hybrid, comprehension-first, one product / two modes). Build not started.

## Full design
See [`docs/DESIGN.md`](docs/DESIGN.md) — architecture, the safety/abstention guard, MVP cut, validation plan, milestones, risks/ethics.

## Phase 1 / v0 (start here)
Mode 1 only · **Mandarin ↔ English** · web/PWA: photograph a lab report → OCR → ground each value vs reference ranges → plain-language translated summary with an abstention/"confirm with clinician" guard on high-stakes items.

## Open decisions (confirm at kickoff)
1. Language pair (default Mandarin↔English)
2. Platform: web/PWA vs React Native
3. v0 grounding: cloud (recommended) vs on-device
4. Which medical KB / reference-range source to ground against

## Kickoff prompt (paste into a new Claude Code chat opened in this folder)
> Read `docs/DESIGN.md`. We approved Approach A. Turn it into an implementation plan for **Phase 1 / v0**: Mode 1 (after-visit comprehension), Mandarin↔English, web/PWA — photograph a lab report → OCR → ground each value against reference ranges → plain-language translated summary with an abstention/"confirm with clinician" guard on high-stakes items. The moat is comprehension + safety, never raw translation. Then build it commit by commit.
