# Decision Dossier — Health Translator

**Date:** 2026-07-24 · **Repo state:** branch `codex/remaining-work-cycle-ready` @ `534c4fd` · **Audience:** an independent AI reviewer (Codex) with zero prior context.

---

## Orientation (read this first)

Health Translator is a student's web app that photographs a Chinese-language hospital lab report, OCRs it, and explains the patient's own numbers in plain language — built with an unusually strict safety design where a large language model does only OCR and a deterministic program assigns all clinical meaning. It began life as a **Tibetan** translator (for Tibetan patients in China who cannot read Mandarin reports), and the interesting part of this document is that a chain of field and desk research **inverted that founding thesis**. The engineering is real and validated; the strategic question — what to build next — is genuinely open. This dossier lays out what exists, how the thinking evolved, what the evidence does and does not support, and the decisions that were reached, framed as claims you are invited to challenge or overturn. Nothing here should be read as settled; the author of the current conclusions wants a real second opinion, including dissent.

---

## 1. What the product is

A web app (Next.js 16 / TypeScript, deployed on Vercel, calling the Claude API). Flow:

1. A patient photographs a Chinese hospital lab report (CBC, chemistry, etc.).
2. Claude Vision performs **OCR/extraction only** — it transcribes analyte name, value, unit, and the printed reference range into structured JSON. It is forbidden from classifying, diagnosing, or translating any clinical claim.
3. Deterministic TypeScript then assigns all meaning: it looks the analyte up in a curated reference table, checks units, and — critically — **reproduces the reference range printed on the patient's own report**, showing where the value falls relative to *that* printed range (below / within / above). It never invents its own normal/abnormal verdict for the patient.
4. A chain of ~16 deterministic "guard" rules can only ever *escalate* caution: flag a possible misread, force a "confirm with your clinician" prompt, or abstain entirely (blank the output and show the source verbatim). There is no unguarded output path in the core translator.

The core safety doctrine, repeated throughout the codebase: **"the LLM proposes, a deterministic guard verifies."** The product deliberately *withholds a position* on sensitive results (drug screens, HIV, blast-cell populations) so it cannot announce them.

The original mission: serve **Tibetan patients in mainland China** who receive Mandarin-only reports they cannot read. Tibetan (`bo`) is a first-class UI language in the code.

---

## 2. Exact technical state (verified at HEAD `534c4fd`)

**Health of the build**
- **1,056 tests green; `tsc` clean.** (Test count is the largest hard signal of how much verification scaffolding surrounds a fairly small product.)
- **117 curated reference analytes** (confirmed: 117 `key:` entries in `data/reference-labs.ts`), each with English + Chinese name, definition, and plain-language explanation, plus sourced reference bands and absolute plausibility bounds.

**Grounding against real, externally-authored data** (not self-graded — this distinction is load-bearing; see §3)
- **MedRepBench** (public Chinese lab-report gold corpus): **22/37** high-stakes analytes correctly handled on the honest, gold-labelled metric.
- **MIMIC-IV** (public de-identified US hospital labs): **111/212** on the same honest metric.
- **`chipWrong = 0` on both corpora** — zero cases where the app displayed a wrong position for the patient's value. This is the frozen safety invariant.

**Validated on a real Lhasa hospital report** (a family member's consented, de-identified CBC + CRP — the first field dogfood on genuine input rather than a research corpus):
- 17 of 27 analytes recognized; **all 4 report-flagged abnormals reproduced correctly; zero wrong calls.** Frozen as a regression fixture (`validation/real-corpus/field-lhasa.ts`).

**Tibetan support — infrastructure fully built, content is ZERO**
- Everything needed to ship Tibetan safely exists: a safe translation pipeline, a mechanical verification layer that checks a Tibetan translation preserved every number/unit and is well-formed (`lib/tibetanInvariants.ts`, `tibetanWellFormedness.ts` — no Tibetan competence required to run), a reviewer-packet exporter + **fail-closed** importer (`lib/tibetanImport.ts`, `scripts/tibetan/`) that writes reviewer answers into the app *only if* they pass every safety check, and a **pre-registered ZH→BO validation study** harness (`validation/tibetan-study/`).
- **But there is no actual Tibetan content.** `curatedBo = 0`. Every Tibetan string currently falls back to Chinese with an "unverified" marker. The whole layer is blocked on **recruiting one Chinese-literate + Tibetan-literate + medically-literate reviewer.** The infrastructure is ready; it needs their words.

**Feature 2 — a health-advice Q&A portal — BUILT (tranches T1–T4)**
- A **separate** page (`/advice`), its own consent, its own honest disclaimers ("suggestions, not a substitute for a doctor"), a guarded route (`app/api/advice/route.ts`) mirroring the notes-translation route.
- It is the app's **first unguarded output path** — advice has no source document to verify against. The compensating design is a set of deterministic **safety floors** (`lib/adviceGuard.ts`, `data/emergency-lexicon.ts`) that can only add escalation or refuse to render:
  - **Emergency-symptom escalation that skips the model entirely** for self-harm / overdose questions (`emergency-self-harm`, `emergency-only`).
  - A **no-medication-dosing output scan** that refuses any answer containing dose instructions.
  - **Refusal of any Tibetan in the output** (`tibetan-output` block) — the floors cannot parse Tibetan, and Tibetan advice is judged the single highest-harm content, so it is structurally forbidden.
  - Mandatory clinician-referral line appended in code.
- It deliberately serves **Chinese/English only** and **refuses Tibetan output**.
- **NOT done:** the final adversarial audit (**T5**). It also ships with **VERIFY-BEFORE-RELEASE placeholder hotline numbers**, and its patient-specific-advice legal exposure (regulated-device risk in both US and China) is real and accepted by the owner.

**What is genuinely NOT tested / unknown**
- **The actual camera/OCR path on a real photo has never been run end-to-end.** Every validation number above used *hand-transcribed* rows fed into the deterministic pipeline. The OCR field-recall of Claude Vision on a real phone photo of a Chinese report is unmeasured.
- **Mainland-China reachability is unconfirmed.** `*.vercel.app` reportedly needs a VPN; no custom domain has been bound and tested from a mainland connection.
- **No PIPL consent flow or 生成式AI备案 (generative-AI filing)** exists for a public mainland service. The filing is understood to be unobtainable by a foreign student operator without a PRC partner entity.

---

## 3. The strategic journey and the struggles (the heart of this dossier)

**A framing fact that changes the whole lens: the founder is a student, and the app does NOT need to survive long-term.** This is explicit and important. It removes the "durable business / defensible moat / will this last five years" lens that would otherwise dominate. The right question is closer to: *what is the most valuable, most honest thing to build and learn in the time available?* — not *what compounds into a company?*

The project began as a Tibetan translator. Then a sequence of findings inverted the thesis. The struggle is that **each finding weakened the original reason for the project without cleanly pointing at a replacement**, and the strongest replacement (Chinese comprehension) is the one the founder is *least* emotionally attached to.

**One methodological scar worth internalizing, because it recurs.** Early in the project, a headline quality metric read **80%** when the app was graded against its *own* reference table, and **27%** when graded against independent gold labels an outside labeler produced without seeing that table. The denominator had been quietly defined by what the app could already name. This taught the team a rule now enforced everywhere: *green signals can measure the wrong thing; verify every claim, including your own, against an external source.* Keep this in mind when weighing any number in this document — the 22/37 and 111/212 figures are the *honest* (gold-labelled) versions precisely because of that lesson.

The three findings, in order:

### Finding 1 — Field visit (Lhasa, in person, hospital front desk, 2026-07-22)
Talking to hospital front-desk staff:
- All lab/imaging reports are issued in **Mandarin only** (confirms the Chinese-source decision).
- Monolingual-Tibetan patients (cannot read or speak Mandarin) are **"extremely rare"** in urban Lhasa now.
- For the rare monolingual patient, staff **verbally translate** ad hoc — unrecorded, not re-readable (a weak but real incumbent).

**The honest caveat on this finding:** it is **one best-case, unrepresentative data point.** N = 1 hospital, staff not patients, and **Lhasa is the most Mandarin-assimilated place in the entire Tibetan world.** Roughly 80% of Tibetans are rural. So this sample is precisely where the founding premise is *least* likely to hold. It lowers confidence in "many monolingual urban patients"; it does **not** settle whether rural/pastoral/elderly Tibetans need the tool.

### Finding 2 — Demographics deep research (verified, adversarially checked, politically-loaded sources flagged)
- **~7.06M** ethnic Tibetans in China (total).
- **Truly monolingual** (no functional Mandarin): roughly **1M** (range 0.5–2M). **LOW confidence — this number has never been measured by anyone.** Treat it as an order-of-magnitude guess, not a datum.
- **Cannot fluently READ a Chinese medical report** (may speak some Mandarin): **~3–5M+.** This is the far larger and more durable population — and it is a *comprehension* problem, not a *translation* problem.
- The monolingual cohort is **closed and shrinking.** Mandarin-only kindergartens since fall 2021 mean essentially every Tibetan child since ~2020 is Mandarin-schooled. The monolingual segment largely disappears in **15–25 years** by mortality with no replacement.
- **Literacy is the sharpest constraint.** ~73% of the older generation (today's ~50+) is illiterate (72.8% of Tibetans 15+ were illiterate in the 1990 census; that cohort is now 50+). The TAR has China's worst illiteracy (~28% all-ages vs 3.3% national). **The monolingual elderly mostly cannot read — in any language.** A *written* Tibetan translation cannot reach them; only **audio** could. And reading a clinical report is a *higher* bar than the census literacy line, so functional inability is even higher than 73%.

**Source-bias note:** Tibet demographic and language data is politically charged from every direction (PRC official sources, exile-community sources, and Western academic sources each carry a slant). The ~1M monolingual figure in particular is a synthesis of unmeasured estimates and should be handled as the weakest link in any argument that leans on it.

### Finding 3 — Competitive and verification research (verified)
- **Doubao / ByteDance and other PRC assistants** give free Mandarin health advice at scale *with full compliance* (备案, PRC entity) — but **do not support Tibetan.** So Tibetan is a genuine moat; but a **Mandarin advice chatbox would compete head-on with a free, better, compliant incumbent** (a bad wedge).
- **DeepZang** (a Tibetan LLM, launched March 2026, Lhasa private company): real, but **no developer API or weights, no published quality evidence, and an opaque ideological content filter** (a correctness risk under this app's verify-against-source architecture). Its "world's first" claim is a purchased certificate; ≥4 Tibetan LLMs predate it.
- **智达AI / Zhida** (Qinghai Normal University national key lab, CAC-filed): its "智能藏医" module is **traditional Sowa Rigpa medicine** (Four Tantras / 四部医典, herbal knowledge graphs, practitioner symptom→treatment support) — **not biomedical lab-report interpretation.** So it is a *neighbour, not a rival.* No incumbent anywhere was found that "explains a modern lab report in Tibetan" → **the moat holds by absence.** But Zhida owns the whole adjacent toolbox (photo-translation, OCR, Tibetan TTS, a CAC-filed model) and could pivot fastest if it wanted to.
- **The verification wall (the load-bearing technical fact).** The only peer-reviewed measurement (**TLUE, EMNLP 2025**) found frontier models score **at or below random-guess baseline** on Tibetan medical understanding. Critically, **Claude translating *into* Tibetan scored BLEU 34.8 while Tibetan experts approved only 28.74% of the output.** That is "fluent but wrong" quantified: a respectable automatic score with **~71% expert rejection.** There is still **no automated quality metric (no COMET model) for Tibetan.** So a machine *can generate* Tibetan; **nobody can verify that a given Tibetan output is correct** without a human expert reading each one.

---

## 4. The research findings, with confidence levels and source-bias notes (summary table)

| Claim | Figure | Confidence | Bias / caveat |
|---|---|---|---|
| Total ethnic Tibetans in China | 7.06M | High | Census-derived |
| Truly monolingual (no functional Mandarin) | ~1M (0.5–2M) | **LOW — never measured** | Politically charged; weakest link |
| Cannot fluently read a Chinese medical report | 3–5M+ | Medium | The larger, more durable market |
| Older-generation illiteracy (today's 50+) | ~73% | Medium-High | 1990 census cohort aged forward; report-reading bar is higher still |
| Monolingual cohort trajectory | disappears in 15–25 yrs | Medium-High | Mandarin-only kindergartens since 2021 |
| Claude→Tibetan expert approval | 28.74% (BLEU 34.8) | High (peer-reviewed, TLUE) | The verification wall |
| Frontier models on Tibetan medical understanding | ≤ random baseline | High (peer-reviewed) | — |
| Lhasa "monolingual patients extremely rare" | qualitative | **LOW — N=1, best-case city** | Staff not patients; most-assimilated city |
| Incumbent that explains a lab report in Tibetan | none found | Medium | Moat by absence; Zhida is adjacent |
| App's honest grounding score (ZH / US) | 22/37 · 111/212, chipWrong 0 | High (external gold) | Hand-transcribed rows, not real OCR |

---

## 5. The decisions made, and the reasoning behind each (framed as challengeable claims)

Each of these is a **claim the current thinking reached.** They are stated so you can agree *or* dissent. The reasoning is given honestly; the counter-case is steelmanned in §6.

### Claim A — Tibetan OUTPUT is PARKED, and the reason is verifiability, not market size.
The blocker is not that the Tibetan market is small. It is that Tibetan output is **unverifiable** (28.74% expert approval; no automated metric) *and* the target elderly population **cannot read text anyway** (~73% illiterate). The decisive distinction: **the blocker is verification, not generation.** A better Tibetan *generator* (DeepZang, a future model) does not create a *verifier*. Under this app's whole doctrine — never emit what you cannot structurally vouch for — shipping unverifiable Tibetan medical text would violate the one rule the project is built on.

### Claim B — The recommended wedge is CHINESE COMPREHENSION ("explain the Chinese report in plain language").
It is **already built and validated** on a real Lhasa report. It serves the **large and durable ~3–5M+** population who can speak some Mandarin but cannot *read* a clinical report. It is **un-owned by the giants** (Doubao does generic advice, not report-grounded explanation of *your* numbers). And the **education-policy trajectory grows it**: spoken Mandarin is universalizing while clinical-Chinese literacy lags, so the "can speak, can't read the report" gap widens even as pure monolingualism vanishes. It is verifiable-against-a-source, so it fits the safety architecture perfectly.

### Claim C — If any Tibetan health chatbot is built, it must be RETRIEVAL over pre-reviewed content, NOT live generation.
The founder proposed a **generative Tibetan health chatbot** ("nobody else does it; I can recruit verifiers for training"). The reasoning against *live generation*:
1. **Recruiting people to verify training / measure the model does not verify each LIVE answer.** The harm is per-answer at runtime; no reviewer pool checks live output as it is produced.
2. **Generative Tibetan health advice is the single highest-harm content the app could produce** — unverifiable, in a language the safety loop cannot read, delivered to a vulnerable user.
3. The target elderly **cannot read text anyway**.
The proposed **safe alternative:** a **retrieval bot over a pre-reviewed, bounded answer set** — reviewers bless every possible output *in advance*, so every output a user can receive has been human-checked before shipping. And whichever version, it needs **audio** to reach the illiterate elderly. A useful side effect: **recruiting reviewers is also the cheapest demand test** — it is the founder's line into the community.

### Claim D — (implicit) The honest safety metric is the externally-graded one, and `chipWrong = 0` is non-negotiable.
Every future change is measured against gold labels an outside labeler produced without seeing the app's table, and against the frozen 22/37 · 111/212 · chipWrong-0 baseline. This is a decision about *epistemics*, not features, and it is why the numbers in this dossier can be trusted more than typical self-reported metrics.

---

## 6. The unresolved tensions and struggles (stated honestly, both sides steelmanned)

This section deliberately does **not** flatter the §5 conclusions. Here is the strongest case *for* the roads not taken, and every place the evidence is thin.

**Steelman for building Tibetan / the generative chatbot anyway:**
- **The moat is real and rare.** "Explain a modern lab report in Tibetan" has *no incumbent anywhere.* A defensible niche with no competitor is exactly what a student project can uniquely occupy — the giants will never bother. Chinese comprehension, by contrast, puts the app against 丁香医生, 平安好医生, and Doubao, all better-resourced.
- **"Unverifiable" is an argument against *unsupervised* generation, not against *the mission*.** The retrieval-bot compromise already shows the harm can be bounded. If every output is pre-blessed, the 28.74% number stops being a live risk — it becomes a *content-authoring* cost, not a runtime one.
- **The founder's motivation and access are the scarce inputs.** The founder is *in Tibet now*, cares about this population, and can recruit reviewers. Pivoting to Chinese comprehension spends that unique access on a problem anyone could solve. For a project that "need not last," the learning value of doing the hard, un-owned thing may exceed the expected value of the safe, crowded thing.
- **Audio + Tibetan could reach a population literally no product reaches today.** The illiteracy finding is usually cited *against* Tibetan text — but it is equally an argument *for* Tibetan **audio**, which nobody has built for lab comprehension.

**Steelman for the §5 conclusions (the case against the above):**
- A moat around an output you cannot verify is a moat around a **liability**. Being the only product that does X is bad if X is "confidently tells sick, vulnerable, illiterate elderly people wrong medical things in a language no one on the team can check."
- The retrieval compromise is real but **narrow**: a pre-blessed answer set cannot answer the open-ended questions patients actually ask, so it may collapse to a FAQ — useful, but far less than "a chatbot."
- Chinese comprehension being "crowded" is less true than it looks: the incumbents do *generic* advice, not *grounded reproduction of the patient's own report*, which is the one thing this app does and they structurally avoid (device-regulation risk).

**The places the evidence is genuinely thin (flag these hard):**
1. **The ~1M monolingual headcount is unmeasured** — the single number the entire "how big is the Tibetan market" argument rests on, and it has a 4× range and low confidence. Any decision that hinges on it is standing on sand.
2. **Demand is unvalidated.** *No rural or elderly Tibetan user has ever been observed using the tool.* The only field contact was hospital *staff* in the most-assimilated city. The comprehension wedge is validated for *correctness* (one real report) but not for *demand* — nobody has shown a real target user wants it.
3. **The camera/OCR path is untested on a real photo.** All 22/37 · 111/212 numbers use hand-transcribed rows. The product's actual first step — point a phone at a report — has zero measured field performance. This could dominate real-world usefulness and is currently a blind spot.
4. **Reachability is unknown.** If `*.vercel.app` is blocked in the mainland and no compliant hosting/model path is stood up, *none* of the above matters for the intended users. This is a binary, cheap-to-test unknown that gates everything.
5. **Feature 2 is a built, unaudited liability.** It is the first unguarded output path, has not had its T5 adversarial audit, carries placeholder hotline numbers, and gives patient-specific advice with accepted regulated-device exposure. It exists in the repo *right now*. Whether it should ship at all — vs. be quarantined until audited, or cut — is itself an open decision, not just a "finish it" task.

**The technical crux, stated plainly (this is the distinction to reason with):**
- **Verifiable-against-a-source = SAFE.** Comprehension (reproduce the report's own range, define the term) can always be checked against the source document. This is the entire moat and the entire safety story.
- **Unverifiable generation = UNSAFE.** Advice, and any Tibetan output, has *no source to diff against*. The 28.74% Tibetan-approval figure is what "unverifiable generation" costs, measured. Every strategic choice below reduces to: **which side of this line does it fall on, and if it's on the unsafe side, is the harm bounded before runtime?**

---

## 7. The question for you, Codex — and an explicit invitation to dissent

You now have the same picture the team has:

- an **already-built, validated Chinese-comprehension engine** (117 analytes, 1,056 tests, 22/37 · 111/212, chipWrong 0, one real Lhasa report passed);
- a **real but unverifiable Tibetan generation landscape** (moat by absence, but 28.74% expert approval and no automated verifier);
- a **target elderly population that is ~73% illiterate and shrinking** (15–25 years to cohort disappearance), reachable only by audio if at all;
- a **moat that holds by absence** but around an output nobody can currently verify;
- a **student project that need not last long-term** (learning value can outweigh durability);
- and **unvalidated demand** — no rural user observed, camera/OCR path untested, mainland reachability unknown;
- plus a **built-but-unaudited advice portal** already sitting in the repo.

**What should the founder do NEXT, and why?** In what order should they build, test, or refuse?

You are free — encouraged — to **disagree** with the current conclusions ("park Tibetan output / build Chinese comprehension / retrieval-not-live-generation / quarantine Feature 2 until T5"). If you think the founder should double down on Tibetan, or ship the chatbot, or kill Feature 2, or that the untested camera path or reachability question must be resolved *before any of this matters*, say so and say why. Be concrete: name what you would **build**, what you would **test first** (and what result would change your mind), and what you would **refuse** to build at all. Reason on the real numbers above, and call out anywhere you think the team's evidence is too thin to support the weight it is being asked to bear.
