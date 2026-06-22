---
type: project
title: "Health Translator — Design"
created: 2026-06-21
updated: 2026-06-21
tags: [project, idea]
status: draft
owner: agent
source: "Claude Code brainstorming (superpowers:brainstorming), 2026-06-21"
sources:
  - "https://pmc.ncbi.nlm.nih.gov/articles/PMC6450297/"
  - "https://link.springer.com/article/10.1007/s11606-021-06666-z"
  - "https://niloufar.org/wp-content/uploads/2022/05/FAccT2022_Reliable_and_Safe_Use_of_Machine_Translation_in_Medical_Settings.pdf"
  - "https://pmc.ncbi.nlm.nih.gov/articles/PMC12252260/"
  - "[[Frontier AI Project (Summer 2026) — Project Brief]]"
---

> [!note] Design doc authored by Claude (agent zone, 2026-06-21) via the brainstorming process. Approach A approved by Kerun. Next step happens in a NEW chat: turn this into an implementation plan, then build. Working name "Health Translator" — rename freely.

# Health Translator — Design

**One-liner.** A phone app that carries a limited-English-proficiency patient through a medical encounter end-to-end: a safety-guarded **live interpreter** during the visit, and a **kept, plain-language, translated comprehension record** after (diagnosis, meds, and your own labs explained).

## Why this isn't "just a translator" (the moat)
For translating *words*, Google/Apple already do free real-time speech translation — so a plain translator is a dead wrapper. Generic translators fail in healthcare in four specific ways, and **those failures are the product**:
1. **Clinical fidelity & safety.** Studies (Khoong et al., *JAMA Intern Med* 2019; *JGIM* 2021 pragmatic assessment; FAccT 2022 "Reliable and Safe Use of MT in Medical Settings") show consumer MT is ~90% accurate for Spanish but drops sharply for less-resourced languages, with a meaningful share of **clinically significant** errors (dosage, negation, benign/malignant) — and it **never flags its own uncertainty**.
2. **Translation ≠ comprehension.** Jargon→jargon still loses a low-health-literacy patient. The job is translate + **simplify + ground in *their* numbers**.
3. **No memory / no artifact.** Patients forget 40–80% of a visit; a translator gives ephemeral audio. The value is a **kept structured record**.
4. **Reports are images of jargon.** Labs/discharge papers need OCR + interpret + ground vs reference ranges (the verified 小红书 "体检报告看不懂" pain).

So this is a **safety-guarded medical-comprehension agent**, not a translator. The frontier techniques (grounded RAG + a faithfulness/abstention guard + multimodal report reading + on-device real-time speech) are exactly what a translator lacks — and the moat. If it ever drifts to "live-caption the convo," Google wins — build boundary-first.

## Calibration (why this project, for Kerun)
Chosen against his stated dials: **real users at scale × a frontier technique that wows** (he explicitly did *not* prioritize "personal niche" or "just fun"). Health Translator hits both: massive real audience (every LEP patient, international student, immigrant, elderly relative) and genuinely hard AI (real-time multimodal + grounded RAG + safety). Verified demand on 小红书 (看病语言不通 + 体检报告看不懂).

## Approach (A — approved): hybrid, comprehension-first, one product / two modes
Build as ONE product with TWO modes, but **sequence the build** so something always ships (guards against scope sprawl):
- **Mode 1 — After-visit comprehension (build FIRST):** photograph labs/discharge + paste/record what the doctor said → grounded, translated, plain-language summary: diagnosis explained, meds + schedule, labs vs reference ranges, red-flag "see a doctor" items, follow-ups. This is the moat, the verified demand, safer, and demo-able fast.
- **Mode 2 — Live in-visit interpreter (build SECOND, headline v2):** real-time two-way speech translation WITH medical-term fidelity and an "I'm unsure — confirm this" uncertainty guard, reusing Mode 1's safety + record spine.
- Heavy grounding/explanation runs cloud-side (quality) for v0; the live-speech fast path moves on-device later (latency/privacy).

## Architecture (components — each isolated, testable)
1. **Capture** — photo/file (documents) + audio stream (live mode).
2. **OCR / document ingest** — labs & discharge papers → structured fields (analyte, value, unit, reference range).
3. **ASR** (live mode) — streaming multilingual speech→text.
4. **Translation engine** — MT with a medical-terminology layer; emits translation **+ per-segment confidence**.
5. **Safety / abstention guard** (pillar) — flags low-confidence segments and high-stakes terms (dosage, negation, drug names, lab values); **abstains / says "confirm with clinician" rather than guessing**. Deterministic rules + a verification pass. This is the safety contribution and a core differentiator.
6. **Grounding / comprehension engine** — RAG over a vetted medical knowledge base + lab reference ranges; turns jargon into plain language grounded in the patient's actual data; never free-floats.
7. **Visit record store** — persists the structured, translated summary (meds, schedule, labs, follow-ups, flags).
8. **TTS** (live mode) — speech output.
9. **UI** — document upload + comprehension summary (Mode 1); live captions/audio (Mode 2).

**Data flow (Mode 1):** photo/transcript → OCR/parse → grounding engine (RAG) → safety guard → comprehension record → UI.
**Data flow (Mode 2):** audio → ASR → translate(+confidence) → safety guard → TTS/captions, logging to the same record.

## MVP cut (Phase 1, finishable)
- **Mode 1 only**, **one language pair: Mandarin ↔ English** (huge LEP population; Kerun is bilingual so he can test it himself; Tibetan/low-resource is a later differentiator).
- Input: a lab report photo + pasted/typed doctor notes. Output: a plain-language, translated summary with each lab value mapped to its reference range and high-stakes items flagged "confirm with your doctor."
- Web/PWA first (fastest), or React Native if mobile-camera UX matters early.

## Validation — the held-out number (rigor)
Don't claim "it works." Assemble ~30–50 real (de-identified) lab/discharge samples; have the output checked against professional translation + a clinician/bilingual reviewer. Report: **medical-term fidelity rate**, **abstention precision** (did it correctly flag the terms it should be unsure about?), and an honest error analysis. Benchmark against raw Google Translate on the same set to show the safety/comprehension delta. That comparison is the contribution.

## Risks, ethics & safety (a design pillar, not a footnote)
- **Not a medical device, not medical advice.** Every output: "confirm with your clinician." No diagnosis/treatment decisions.
- **Abstain on high stakes.** Dosages, negations, drug names, abnormal labs → flag + defer, never guess.
- **PHI privacy.** Minimize/de-identify; move to on-device for the live path; explicit consent + a clear data-handling policy.
- **Language safety gating.** Only enable language pairs where measured fidelity clears a bar; visibly mark others as unsupported.
- **No defamation/over-claiming.** Present neutrally; show the source.

## Milestones
- **v0** — Mode 1, Mandarin↔English, OCR + grounded plain-language lab/discharge summary + safety flags. *(weeks)*
- **v1** — the validation number (fidelity + abstention vs Google Translate) + polish. *(the paper-shaped artifact)*
- **v2** — Mode 2 live interpreter with the uncertainty guard. *(the headline "wow")*
- **v3** — more language pairs incl. **Tibetan/low-resource** (his unique edge) + on-device path.

## Open decisions for the new chat
1. Confirm language pair (default Mandarin↔English).
2. v0 platform: web/PWA vs React Native.
3. v0 cloud-only grounding (recommended) vs start on-device.
4. Which medical KB / reference-range source to ground against.

## Kickoff prompt (paste into the new chat)
> I'm building **Health Translator** — a safety-guarded medical-comprehension app (NOT a plain translator). Read the design doc at `Wiki/Projects/Health Translator — Design.md` in my vault. We approved **Approach A** (hybrid, comprehension-first, one product / two modes). Start by turning the design into an implementation plan for **Phase 1 / v0**: Mode 1 (after-visit comprehension), Mandarin↔English, web/PWA — photograph a lab report → OCR → ground each value against reference ranges → plain-language translated summary with an abstention/"confirm with clinician" guard on high-stakes items. The moat is comprehension + safety, never raw translation. Then we build it commit by commit.

## Grounded in
- [[Frontier AI Project (Summer 2026) — Project Brief]] — where Project 2 ideation lived
- Khoong et al. 2019 / JGIM 2021 / FAccT 2022 — medical machine-translation error & safety evidence (see `sources`)
- 小红书 pain-mining (2026-06-21): 看病语言不通 + 体检报告看不懂 (verified demand)
