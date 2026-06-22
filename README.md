# Health Translator

A safety-guarded medical-**comprehension** app — **not** a plain translator.

It carries a limited-English-proficiency patient through a medical encounter end-to-end:
- **Mode 1 (after-visit comprehension)** — photograph labs/discharge + paste/record what the doctor said → a grounded, translated, plain-language summary (diagnosis, meds + schedule, your labs explained vs reference ranges, "confirm with your doctor" flags).
- **Mode 2 (live in-visit interpreter)** — real-time two-way speech with medical-term fidelity and an "I'm unsure — confirm this" guard.

## Why not just use Google Translate?
For translating *words*, you can — so that part is commodity. Generic translators fail in healthcare in four ways that **are** this product: (1) clinically significant errors with no uncertainty flag, (2) translation ≠ comprehension, (3) no kept record (patients forget 40–80% of a visit), (4) reports are images of jargon. The moat is **comprehension + safety**, never raw translation.

## Status
**Approach A approved · Phase 1 / v0 built.** Mode 1 (after-visit comprehension), Mandarin ↔ English, web/PWA. Labs-only: photograph a lab report → OCR → ground each value vs reference ranges → plain-language translated summary with an abstention / "confirm with your clinician" guard on high-stakes and uncertain items. Plan: [`docs/superpowers/plans/2026-06-21-health-translator-v0.md`](docs/superpowers/plans/2026-06-21-health-translator-v0.md).

## Full design
See [`docs/DESIGN.md`](docs/DESIGN.md) — architecture, the safety/abstention guard, MVP cut, validation plan, milestones, risks/ethics.

## How the safety model works (the moat)
The LLM (Claude vision) does **OCR/extraction only** — it transcribes the printed analyte/value/unit/range rows and nothing else. Everything that assigns *meaning* is deterministic TypeScript grounded in a curated reference table ([`data/reference-labs.ts`](data/reference-labs.ts), ~28 analytes, SI units):

`extract (Claude) → reference lookup → unit check → numeric classification → safety guard (rules R1–R12) → templated bilingual summary`

The model never supplies a reference range, never classifies a value, never diagnoses, never translates a clinical claim. The guard biases toward deferral: unknown analytes and unit mismatches **abstain** (shown verbatim, no judgment); high-stakes analytes (glucose, potassium, creatinine, LDL, hemoglobin) and critical values are **always re-confirmed** by the user before interpretation and flagged "confirm with your clinician." PHI stays on-device — the image transits the server only transiently to reach Claude and is never persisted; the kept record lives only in your browser's IndexedDB.

## Running v0 locally
Prerequisites: Node 20+.

```bash
npm install
cp .env.local.example .env.local      # then set ANTHROPIC_API_KEY (server-only; never NEXT_PUBLIC_)
npm test                              # unit + component tests (no API key needed)
npm run dev                           # http://localhost:3000  (Turbopack)
npm run dev:pwa                       # dev with the service worker (webpack — Serwist needs webpack)
npm run build                         # production build; generates public/sw.js (webpack)
```

The home page and tests run without a key; **photographing a report** needs `ANTHROPIC_API_KEY` set in `.env.local` (the extract route calls Claude server-side). See [`docs/RUNNING.md`](docs/RUNNING.md) for constraints and gotchas.

## v0 scope and what's deferred
- **In v0:** labs-only, Mandarin ↔ English, the deterministic safety core, the confirm-the-values gate, the kept on-device record, PWA/offline shell.
- **Deferred:** free-text doctor-notes translation and the negation/dosage/drug-name fidelity rules (R7–R9, present as tested no-ops); unit auto-conversion (v0 abstains on unit mismatch); Mode 2 (live interpreter). The validation number (medical-term fidelity + abstention precision vs raw Google Translate) is v1.
