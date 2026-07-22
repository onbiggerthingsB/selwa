# Health Translator — project handoff

**For a fresh planner picking this up cold.** Written 2026-07-22. Branch
`codex/remaining-work-cycle-ready` @ `a06e978`. 821 tests green, `tsc` clean, worktree clean.

The owner (LI KEKE) is currently **in Tibet (藏区)** — which matters, because the single
longest-lead blocker is finding a Tibetan+Chinese+medical reviewer, and that is now something
that can happen on the ground. See "If you're in Tibet right now" at the end.

---

## 1. What this app is, and the one rule that governs everything

A **health-report translator** for **Tibetan-speaking patients in mainland China** who need to
read **Chinese-language hospital lab reports**. Next.js 16 (App Router), TypeScript, deployed on
Vercel. Languages: English / Chinese / Tibetan (`en` / `zh` / `bo`).

**The non-negotiable safety rule — every change is measured against it:**

> The app **reproduces what the report already says**; it never applies its own knowledge to the
> patient's number to declare it normal or abnormal. "The LLM proposes, a deterministic guard
> verifies." There is no unguarded output path.

Concretely: it shows the reference range **printed on the patient's own report**, not a range we
chose. It flags numbers it might have misread. It hides sensitive results (drug screens, HIV,
etc.) so it can't announce them. Two hard metrics protect this and **must stay at these values**
on every change: `chipWrong = 0` on both test corpora, and the corpus scores
**MedRepBench (Chinese) 22/37** and **MIMIC (US) 111/212** must not move unless a change is
provably, intentionally about them.

**How work has been done here (keep this discipline):**
- **Pre-register numbers before coding.** Every task states the expected metric movement up front.
  A result that misses the prediction is a finding to investigate, not a rounding error. This repo's
  headline lesson: a metric once read 80% self-graded and 27% when graded honestly.
- **Verify, don't trust.** Reproduce every claim against the actual code before believing it —
  including your own. Green tests can measure the wrong thing.
- **Fail closed.** When unsure, abstain / refuse rather than emit.
- **Implementation is done by Codex** (gpt-5.6-sol) from detailed specs, then reviewed. Specs live
  in `docs/superpowers/specs/`. Match that house style: lead with measured evidence, fence scope
  with explicit "do NOT" lists, end with acceptance criteria.

---

## 2. What is built and shipped (on this branch)

**The lab-report translator (advisor's Feature 1) — engine complete:**
- Reads a Chinese lab-report photo → test names, values, printed ranges.
- Displays in en/zh; Tibetan mode exists as a setting.
- 16 deterministic guard rules; ~30 flag types; 116 curated reference analytes (each with
  Chinese + English name and definition).
- Sensitive-result suppression (drug screens, HIV, blast populations show no position).
- Rate limiting (Upstash-backed, cost-weighted, fail-closed) — verified live in production.
- Language preference persists across pages; consent screen is localizable.

**The Tibetan-readiness infrastructure — complete and hardened (this is a lot of the recent work):**
- The whole "container" for Tibetan exists and is safe, even though **no Tibetan words are in it
  yet** — every Tibetan screen currently shows Chinese as a labelled placeholder, by design.
- Four correctness pre-conditions fixed so the first real Tibetan string can't do harm (it can't
  become an OCR lookup key; the "unreviewed" badge and fallbacks behave correctly; the source-text
  lock now covers Tibetan).
- A **mechanical verification layer** (`lib/tibetanInvariants.ts`, `lib/tibetanWellFormedness.ts`)
  that checks a Tibetan translation preserved every number/unit and is well-formed — **no Tibetan
  competence required**.
- A **reviewer-packet exporter + fail-closed importer** (`lib/tibetanImport.ts`,
  `scripts/tibetan/`) — hands a translator three CSVs, ingests their answers, and writes them into
  the app **only if** they pass every safety check. Independently value-verified after write.
- A **pre-registered ZH→BO validation study** (`validation/tibetan-study/`) — the study that
  decides whether AI translation is good enough or a human must do it. Everything is ready except
  running it (needs a reviewer).

**Verified state:** 821 tests, `tsc` clean, `chipWrong` 0 both corpora, no Tibetan shipped
(`curatedBo = 0`).

---

## 3. IN FLIGHT — Feature 2: the Health Q&A advice portal

The advisor's Feature 2. **The owner has decided to build it and owns all the decisions.** Two
architecture forks were settled:

1. **Separate page** — its own screen, its own entry button, its own consent, fully separate from
   the lab translator. The translator's safety design stays untouched.
2. **Honest framing** — the app's disclaimers/consent get rewritten so it openly presents itself
   as offering health *suggestions* (not "just a reading aid"), with fresh consent.

**What it is (from the advisor's spec):** a text-only form — gender, age, question, language — that
returns health suggestions from **three schools: Chinese medicine, Tibetan medicine, Western
medicine**, with a disclaimer. Patient-specific advice (the owner's choice).

**The one thing a planner MUST understand before building this:** Feature 2 is the app's **first
unguarded output path.** Every existing safety mechanism verifies a translation against its source;
advice has no source to check against. So the guard pattern can't fully apply. Build these safety
floors in **by default** (they are design, not options):
- A **separate route + API** (mirror `app/api/translate-notes/route.ts`: `runtime='nodejs'`,
  consent gate, rate limit, model call, error swallowing that never leaks keys).
- **Emergency-symptom escalation is hard-coded, not AI-generated** — if the question mentions
  chest pain / trouble breathing / etc., prepend a deterministic "seek emergency care now" line.
- **No specific medication dosing**, ever — this is a permanent hard line, not a toggle.
- Every answer carries a deterministic "this is general information, not a substitute for seeing a
  doctor" line + the school labels, appended in code (not left to the model).
- New consent version + honest disclaimer copy in `lib/disclaimers.ts` / `lib/consentCopy.ts`.

**Regulatory reality the owner has accepted (documented, decided):** giving advice can make the
app a regulated medical device in both the US and China, and in China can get the site blocked.
The owner chose to proceed anyway; it is their project. The **separate-page + honest-framing**
choices are the most defensible way to do it. Full analysis is in this session's history; the
short version: *don't* weave advice into the lab report, *don't* keep the old "not a medical
device" wording alongside advice, and *never* ship medication dosing.

**Status: decided, spec not yet written.** The immediate next step is to write the Feature 2 build
spec (route, API, form UI, three-school prompt, safety floors, consent v-bump, disclaimer rewrite)
in `docs/superpowers/specs/`, then have Codex implement it.

---

## 4. Waiting to be built / blocked

### Blocked on a human (not code)

| Item | What it needs |
|---|---|
| **Tibetan content (the actual words)** | A reviewer who reads **Chinese + Tibetan + medical terms.** The whole importer/packet machinery is ready; it just needs their words. **This is the #1 blocker and the owner is now in Tibet.** |
| **Run the ZH→BO validation study** | The reviewer above + the owner setting the pass/fail threshold. Everything else (`validation/tibetan-study/`) is built and runnable. |
| **Mainland reachability answer** | Test whether the site opens from a mainland connection (it reportedly needs a VPN on `*.vercel.app`). Bind a custom domain and retest. Decides whether Vercel survives at all. |
| **The medical dictionary lead** | Buy **《汉藏英对照现代医学词汇》** (Chinese–Tibetan–English Modern Medical Vocabulary, 民族出版社 2019). If it covers analyte names, the reviewer's job drops from *translate* to *select against a published standard* — the single highest-leverage action in the project. |

### Ready to code (unblocked)

| Item | What it is |
|---|---|
| **Feature 2 build** | §3 above — decided, needs a spec then implementation. |
| **Feature 3** | Feed the (already safety-verified) lab results into the Feature 2 portal as context. Depends on Feature 2 shipping first. |
| **Remaining high-stakes curation** | ~9 uncurated high-stakes analytes need curated reference bands **with cited clinical sources** (research, not typing). Its own future cycle. |
| **R18 / needsConfirm consistency** | Small guard question found this session: when a specimen-scoped high-stakes analyte abstains via rule R18, it does not carry a confirm prompt the way rule R2 does. Pre-existing, safe (it still abstains, never misclassifies), but arguably inconsistent. One-line change with its own blast radius — spec it standalone if pursued. |
| **Consent / privacy (PIPL)** | Standalone consent for sensitive health data, a privacy notice, a withdrawal path, and the advisor's GPT-drafted user agreement. Partly legal-gated. |

### Decisions now owned by the owner (previously routed to the advisor)

- Feature 2 scope — **decided: patient-specific, separate page, honest framing.**
- Validation pass/fail threshold — set before running the study.
- What to show a patient on a row the app can't interpret — currently reproduces the report's own
  printed values (a reasonable default; confirm or refine).
- Reachability / hosting path if `*.vercel.app` is blocked — Path B is mainland-reachable hosting
  plus a Chinese-hosted model (Qwen/GLM/Doubao), which the plan already scoped.

### Explicitly NOT doing (recorded so nobody re-opens them)

- ICP 备案 / generative-AI filing — not obtainable by a foreign student operator; needs a PRC
  partner entity or a different deployment lane.
- Weaving advice into the lab report (Feature 2 stays a separate surface).
- Medication dosing advice — permanent hard line.

---

## 5. If you're in Tibet right now — highest-leverage actions

These unlock more than another month of coding:
1. **Find one Chinese-literate, Tibetan-literate, medically-literate reviewer.** Tibetan medical
   colleges (西藏藏医药大学, 青海大学藏医学院), Sowa Rigpa institutions, hospital staff. This is *the*
   blocker for everything Tibetan.
2. **Buy 《汉藏英对照现代医学词汇》** and check whether it lists lab analyte names (GLU, ALT, CREA, HGB…).
   One book; potentially reshapes the whole translation effort.
3. **Test reachability from your actual mainland connection** — does the deployed site open without
   a VPN? A one-line answer that decides the hosting question.
4. Once you have a reviewer: run `validation/tibetan-study/` — generate the sample across models,
   run the mechanical check, hand them the blinded scoring sheet.

---

## 6. Where things live (map for the planner)

```
app/page.tsx                      home (entry buttons + language toggle) — Feature 2 button goes here
app/result/page.tsx               lab-report result view
app/api/extract/route.ts          OCR of the lab image (LLM route)
app/api/translate-notes/route.ts  free-text note translation (LLM route) — MIRROR THIS for Feature 2
lib/guard.ts                      the 16 deterministic guard rules
lib/summary.ts                    builds the patient-facing result; sensitive-analyte suppression
lib/reference.ts                  analyte name index (source languages only)
data/reference-labs.ts            116 curated analytes (zh/en names + definitions + bands)
lib/disclaimers.ts                the framing copy — REWRITE for Feature 2's honest framing
lib/consent.ts / consentGate.ts / consentCopy.ts   consent version + gate + copy
lib/i18n.ts                       en/zh/bo localization; reviewed() vs fallback('zh')
lib/tibetanImport.ts              reviewer-packet exporter + fail-closed importer
lib/tibetanInvariants.ts / tibetanWellFormedness.ts   mechanical Tibetan checks
validation/tibetan-study/         the ZH→BO validation study (PROTOCOL.md is the entry point)
validation/real-corpus/run.ts     the corpus harness — run to see the two hard metrics
docs/superpowers/specs/           implementation specs (house style to match)
scripts/tibetan/                  export-packet / import-reviewed CLIs
```

Run `npx vitest run --pool=threads` (the forks pool fails under load) and
`npx tsx validation/real-corpus/run.ts` to confirm green + frozen metrics before and after any change.

---

## 7. One-paragraph summary for the planner

The lab-report translator is built and safe; its Tibetan layer is fully engineered but has zero
actual Tibetan words in it, waiting on a reviewer the owner is now positioned to find in Tibet.
The next code feature is the **Health Q&A advice portal (Feature 2)** — decided as a separate page
with honest framing, needing a spec then implementation, and carrying real safety floors because it
is the app's first unguarded output path. The biggest non-code unlocks are a Tibetan medical
reviewer, one dictionary purchase, and a mainland-reachability test. Keep the discipline that got it
here: pre-register numbers, verify every claim against the code, fail closed, and never move
`chipWrong` off 0.
