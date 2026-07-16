---
type: project
title: "Beachhead + regulatory decision memo — PIPL / FDA / US-privacy"
created: 2026-07-15
status: decided
owner: agent
disclaimer: "Regulatory ORIENTATION, not legal advice. Classification/scope are fact-specific and the underlying FDA guidances were revised Jan 2026 — confirm with qualified counsel before launch."
source: "Sourced multi-agent research (Opus), 2026-07-15; grounded in lib/anthropic.ts (the cross-border transfer point)"
---

# Beachhead + regulatory decision memo

> **DECIDED 2026-07-16 — A = US Mandarin diaspora · B = B1 comprehension/translation (non-device).**
> Consequences now driving the work: (1) the output layer must reframe from *verdict on your
> value* → *comprehension of your report* (surface the report's OWN flags/ranges + general
> education + route "is mine OK?" to the clinician); (2) the beachhead corpus is **US-lab reports
> (English names, US conventional units)**, not the Chinese/SI MedRepBench set — the measurement &
> coverage track re-targets accordingly (recognition still matters: you must recognize an analyte
> to translate/educate on it); (3) privacy hygiene before real users + on-device/de-identified OCR
> as the convergent architecture.

**The one input still needed from you.** Everything else in the coverage/measurement track is
merged; this memo forces the decision the strategy panel flagged as gating the whole
architecture: **which market are we building for, and what may the app assert?**

## TL;DR — recommendation

1. **Beachhead: the US limited-English Mandarin diaspora.** Real, well-defined unmet need;
   PIPL does not apply; one regulator to navigate instead of China's wall.
2. **Product framing must shift** from *"we tell you your value is high/low"* toward *"we help
   you understand what your report says"* — because a patient-facing tool that applies a
   reference range to the user's own value to output a high/low verdict is **most likely a
   regulated FDA device**, and our deterministic/abstain design does **not** change that
   (FDA classifies on intended use, not implementation).
3. **On-device / de-identified OCR is the strategically convergent investment** — it is what
   both a future mainland-China entry (PIPL) *and* the present US-privacy minimization duty
   both point to. Build toward it regardless of which market wins.

Then: US-privacy hygiene is a concrete checklist (below), not a blocker.

## The three walls

### 1. Mainland China — PIPL (a wall for the current architecture)
A mainland patient's lab-report image (name + values + hospital) is **sensitive personal
information** (PIPL Art. 28, "medical health"). Sending it to a US LLM is a cross-border
transfer (Art. 38) needing a lawful mechanism + **separate consent** (Art. 39) + a **PIPIA**
(Art. 55). The March-2024 volume "safe harbor" (<100k people) **expressly excludes sensitive
PI**, so there is *no free pass by low volume* — even a handful of health records needs a CAC
Standard Contract + filing (or certification; a full CAC security assessment only above 10,000
sensitive-PI subjects/yr). In practice these are **unavailable to a small B2C app**: a commodity
US LLM vendor won't sign China's Standard Contract, and an overseas app owes an **in-China
representative** (Art. 53). → The only defensible mainland architecture is to keep identifiable
sensitive data from crossing the border: **on-device or in-China OCR + de-identification.**

### 2. FDA — the app's *core act* is the regulated act (applies to the US market too)
As built (apply reference range to the user's value → "high/low" + patient-specific meaning), the
app is **most likely a medical device / SaMD** (FD&C §201(h)), and fits **none** of the escape
lanes: **CDS** is HCP-facing (the "independent review" prong presumes a clinician reader; the
2022 final guidance, reaffirmed Jan 2026, dropped the draft's patient enforcement discretion);
**MDDS** covers only transfer/store/convert/display and breaks the instant software "interprets
or analyzes" lab data (§520(o)(1)(D)); **General Wellness** excludes interpreting physiologic/lab
data or disease-context claims. **The abstain guard reduces harm but does not change
classification for the values it *does* interpret.** The non-device lane (FDA's own "NOT a
device" examples — "translations of medical terms," "library of clinical descriptions") is to
**stop declaring the patient's own value abnormal** and route "is my number OK / what does it
mean for me" to the clinician.

> The bright risk line, verbatim from the research: *"you are non-device as long as the software
> does not apply a reference range to the individual's own number to output a patient-specific
> normal/abnormal/high/low determination … the instant it does that (even deterministically, even
> with an abstain guard), it is 'interpreting clinical laboratory test data' and lands in device
> territory."*

**The genuinely unsettled middle (our opening):** faithfully OCR-ing and translating the
report's **own** printed flags/ranges (the paper already says "H", already prints 3.9–6.1) is
arguably *reproduction/translation*, not new interpretation. Our independent classification
against **our** table — when the report lacks a range — is what crosses into interpretation.

### 3. US privacy — "not HIPAA" ≠ unregulated (the diaspora obligations)
A non-HIPAA consumer app shipping name + values + hospital to a US AI is exposed to **FTC Act §5**
(GoodRx $1.5M, BetterHelp $7.8M — health data to third parties without affirmative consent), the
2024 **FTC Health Breach Notification Rule** (unauthorized *disclosure* = reportable "breach";
60-day notice), **CA CMIA** ($1,000/violation, private right of action, no size threshold), CCPA,
and — sharpest — **WA My Health My Data Act** (no revenue/volume threshold, private right of
action, requires a *separate* consumer-health-data privacy policy + opt-in). Navigable, but real.

## Why US-diaspora beachhead (the synthesis)

- **The need is concrete and worsening.** ~1.8–2M Chinese-speaking LEP people; **52%** of
  Chinese-at-home speakers report limited English — the **highest of any major US language
  group** (vs 39% Spanish). The 21st Century Cures Act now forces labs to release raw results to
  portals *immediately* — so a Chinese-LEP patient sees an abnormal English number **before** any
  clinician explains it. That is exactly the moment this product serves.
- **PIPL is off the table** (US labs, US-resident subjects, US processing — PIPL keys on the
  subject's location, not ethnicity/language).
- **One navigable regulator, not a wall.** The US path needs *framing + privacy hygiene + counsel*;
  the mainland path needs PIPL mechanisms that are effectively closed to a small app **plus**
  China's own device regime. Same FDA question exists either way; only the US path is tractable
  solo.

## The decision I need from you

**A — Beachhead:** US Mandarin diaspora (recommended) vs mainland China vs both-later.

**B — What the app may assert (the FDA-shaped fork):**
- **B1 "Comprehension/translation" (non-device lane, recommended to start):** translate and
  surface the report's **own** values/flags/ranges + general educational context per analyte;
  do **not** output an independent verdict on the patient's number; route "is mine OK?" to the
  clinician. Aligns with our existing abstain/"confirm with clinician" safety philosophy. Lets us
  ship without a 510(k). *Cost:* we soften the "tell me if my number is bad" promise.
- **B2 "Interpretation" (SaMD path):** keep declaring high/low on the patient's value; engage FDA
  counsel, expect Class II 510(k)/De Novo + a quality system before US launch; consider a **513(g)**
  to get FDA's read. Higher ceiling, much heavier.

My recommendation: **A = US diaspora, B = B1 now** (with a 513(g)/counsel check to confirm the
line), because B1 is both the lower-risk lane *and* the honest expression of the safety moat — we
were already abstaining and deferring to clinicians; B1 makes that the product's spine rather than
its exception. Then B2 only if/when the clearance investment is justified.

## If we proceed (near-term, no blocker)

**Privacy hygiene (do before any real users, all markets):**
- Affirmative **opt-in consent BEFORE the image leaves the device**, naming the Anthropic (US)
  transfer for OCR only, on-device meaning, no diagnosis. (One screen satisfies FTC §5 + MHMDA.)
- **No** ad-tech / tracking pixels / analytics that transmit health data (the GoodRx/BetterHelp trap).
- Accurate specific privacy policy naming Anthropic; **separate WA Consumer-Health-Data policy**.
- **Data minimization: strip name/hospital/MRN before the OCR call where feasible** (serves both
  US minimization *and* the mainland PIPL de-identification path — convergent).
- Anthropic **processor/service-provider terms + no-training / zero-retention**; short retention; TLS + at-rest encryption; a breach runbook (HBNR 60-day).

**FDA framing guardrails (for B1):** describe as a translation / health-literacy aid; prominent
"does not diagnose, does not interpret your results, not a substitute for your clinician"; present
ranges as *"typical adult ranges vary by lab,"* not an applied verdict; avoid "abnormal,"
"concerning," "you should," risk scores, urgency/triage. App-store copy + onboarding must match
(intended use is inferred from *all* claims).

## Caveats
Regulatory **orientation, not legal advice.** FDA CDS + General Wellness guidances were **revised
Jan 2026** (fast-moving, deregulatory-framed, untested on consumer tools) — pin to the live fda.gov
docs. HBNR/CMIA scope and B1-vs-B2 line are fact-specific to the exact UI/claims shipped; confirm
with FDA + privacy counsel (and consider a 513(g) / pre-sub) before launch.

## Sources
PIPL Arts. 3/28/29/38/39/53/55 + 2024 Cross-Border Provisions; FDA §201(h)/§520(o), CDS final
guidance (Fed. Reg. 2022-09-28) + Jan-2026 revision, MDDS 21 CFR 880.6310, General Wellness
guidance, "Software Functions That Are NOT Medical Devices"; FTC §5 (GoodRx/BetterHelp), HBNR
(Fed. Reg. 2024-10855), CA CMIA §56.06, CCPA, WA MHMDA (RCW 19.373); US Census 2019 ACS, MPI,
JMIR PMC11907665. Full URLs in the research transcript (workflow wf_1504cd78-efe).
