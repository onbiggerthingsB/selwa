---
type: project
title: "Feature 2 — Health Q&A Advice Portal (implementation spec)"
created: 2026-07-21
status: NOT STARTED — written for implementation by Codex (gpt-5.6-sol), no further conversation
owner: owner (the academic advisor no longer owns these decisions)
---

# Feature 2 — Health Q&A Advice Portal

## 0. The one fact that governs everything

**This is the app's first UNGUARDED output path.** Every other output in this app is a
translation or reproduction verified against a source document — the doctrine written at the top
of `lib/notesGuard.ts`: *the LLM only proposes; determinism decides; determinism may only
ESCALATE caution (render → flag → abstain), never reduce it; the worst tolerated failure is false
over-caution.* Advice has **no source to diff against**. There is nothing to compare the model's
answer to.

That is precisely why the deterministic safety floors in this spec are **mandatory, not optional**.
They are the compensating control that replaces "verify against a source." They operate on the two
things we *can* inspect deterministically — the **question** (pre-model) and the **raw model
output** (post-model) — and they make only two kinds of decision: *add a hard-coded escalation* or
*refuse to render*. No floor ever reads model output to decide to be **less** cautious. A reviewer
must understand that the safety story here is different by design: not "LLM proposes, guard verifies
against truth," but "LLM proposes, guard refuses anything it cannot structurally vouch for."

**A route that calls the model but is missing its safety wrapper is a defect, not a partial
feature. The route MUST NOT ship before its wrapper (§ Tranches).**

## 1. Settled decisions (do not re-open)

These are the owner's decisions. Where a design choice remains, this spec states a default and
flags it; it does not defer.

1. **Separate page.** Its own screen (`/advice`), own entry button on the home page, own consent,
   own disclaimers. It does **not** touch the lab-report translator or its safety architecture.
2. **Honest framing.** The feature openly presents itself as offering health *suggestions*, with
   fresh consent and disclaimers that say "general information, not a substitute for a doctor." The
   lab translator's "not a medical device / we don't interpret" disclaimers are **NOT** reused.
3. **Patient-specific advice**, from three perspectives: Chinese Medicine (中医), Tibetan Medicine
   (藏医), Western Medicine (西医). The demographics collected are gender and an age *band* only.
4. **Text-only.** No image input (a cost decision).
5. **Languages: Chinese and English only for generated answers.** Tibetan (`bo`) is a first-class
   *UI chrome* language (falls back to zh with the existing unverified marker) but Tibetan-language
   *medical advice is never generated* — see §7. This is the single most dangerous content the app
   could produce, and the floors cannot parse Tibetan.
6. **Opus 4.8** for the generation (safety-critical, not a bulk stage — per the model-routing
   preference in MEMORY).

## 2. File inventory

New files:

| path | purpose |
| --- | --- |
| `app/advice/page.tsx` | the advice screen (client component) |
| `app/api/advice/route.ts` | the model route (mirrors `translate-notes/route.ts`) |
| `lib/adviceSchema.ts` | Zod model-output schema, `MAX_ADVICE_QUESTION_CHARS`, `buildAdvicePrompt` |
| `lib/adviceGuard.ts` | the deterministic safety wrapper: pre-model + post-model seams, `AdviceResult` type |
| `data/emergency-lexicon.ts` | curated red-flag keyword/pattern list (zh + en) — analogue of `data/medical-lexicon.ts` |
| `lib/adviceConsent.ts` | Feature 2's own consent record (client, localStorage) — mirror of `lib/consent.ts` |
| `lib/adviceCopy.ts` | all advice-surface strings (entry card, consent copy, disclaimers, form labels, banner/refusal copy, error copy) via `defineText` |
| `components/AdviceEntryCard.tsx` | the secondary home-page entry control |
| Tests | `lib/adviceSchema.test.ts`, `lib/adviceGuard.test.ts`, `data/emergency-lexicon.test.ts`, `lib/adviceConsent.test.ts`, `app/advice/page.test.tsx`, plus additions to `lib/rateLimit.test.ts` and `lib/consent.test.ts` (or a new `lib/consentGate.test.ts`) |

Touched files (surgical, additive only):

| path | change |
| --- | --- |
| `app/page.tsx` | render `<AdviceEntryCard lang={lang} />` as a secondary control |
| `lib/consentGate.ts` | add `ADVICE_CONSENT_HEADER` + a version-parameterized `checkConsentVersion`; make `checkConsent` a one-line wrapper (zero behavior change) |
| `lib/rateLimit.ts` | add the `'advice'` route, its burst limiter, and its cost weight |

**Do NOT modify** any lab-translator surface: `lib/guard.ts`, `lib/grounding.ts`, `lib/reference.ts`,
`lib/notesGuard.ts`, `lib/summary.ts`, `lib/disclaimers.ts`, `lib/consentCopy.ts`,
`components/CaptureCard.tsx`, `app/result/*`, `app/api/extract/*`, `app/api/translate-notes/*`,
`data/reference-labs.ts`, `data/medical-lexicon.ts`. The two features share only *infrastructure*
(`anthropic.ts`, `rateLimit.ts`, `i18n.ts`, `langPreference.ts`, and the header-check helper in
`consentGate.ts`).

## 3. Build tranches (ordered, reviewable)

Land in this order. The hard rule: **the route (T2) MUST NOT ship before its wrapper (T3).** If
they land in one PR, T3's code and tests must be present and green in that same PR.

- **T1 — Entry point + page shell + i18n scaffold.** `components/AdviceEntryCard.tsx`, the
  `app/page.tsx` insertion, `app/advice/page.tsx` phase skeleton, and the `lib/adviceCopy.ts`
  strings they consume. Can land independently; it wires up no model call yet (submit can be a
  stub that renders the "unavailable" state until T2+T3 land). All new strings go through
  `defineText({en: reviewed(...), zh: reviewed(...), bo: fallback('zh')})` so the corpus audits pass.
- **T2 — Schema + prompt + route.** `lib/adviceSchema.ts`, `app/api/advice/route.ts`, the
  `consentGate.ts` and `rateLimit.ts` additions. **Must land together with T3** — a route that
  returns raw model output is the exact defect this feature exists to prevent.
- **T3 — The deterministic safety wrapper.** `lib/adviceGuard.ts` + `data/emergency-lexicon.ts`.
  This is the load-bearing tranche. Its positive-control tests (§6) are acceptance-blocking.
- **T4 — Consent + disclaimers.** `lib/adviceConsent.ts`, the consent/disclaimer strings in
  `lib/adviceCopy.ts`, and the consent phase in `app/advice/page.tsx`. Depends on T1's shell.
- **T5 — Tests + audits.** All `*.test.ts(x)` above, run with `--pool=threads` (see the testing-env
  memo). The corpus audits (`directBoAudit`, `localizedTextCorpus`) run automatically over
  `app/components/data/lib` — no registration needed, but every new string must be shaped correctly.

T1 and T4 may land before T2/T3 (the page shows the unavailable/consent states without a working
route). T2 and T3 are inseparable.

---

## 4. The route — `app/api/advice/route.ts`

Mirror `app/api/translate-notes/route.ts` step for step, with two inserted deterministic stages.

```ts
export const runtime = 'nodejs';        // REQUIRED: the SDK breaks on the edge runtime
export const dynamic = 'force-dynamic'; // never cache an advice handler

export async function POST(req: NextRequest) {
  // 1. Advice consent gate — distinct header + version. A lab consent must NOT authorize this.
  const consent = checkConsentVersion(req.headers.get(ADVICE_CONSENT_HEADER), ADVICE_CONSENT_VERSION);
  if (!consent.ok) return NextResponse.json({ error: consent.error }, { status: consent.status });

  // 2. Rate limit — its own burst bucket, cost-weighted against the shared daily budget.
  const rateLimitResponse = await enforcePaidRouteRateLimit(req, 'advice');
  if (rateLimitResponse) return rateLimitResponse;

  // 3. Parse + validate body (below).
  //    ... malformed JSON -> 400; question invalid -> 400; too long -> 413; enums bad -> 400 ...

  // 4. Pre-model emergency scan (deterministic, on the QUESTION). §6.1
  const preScreen = preScreenQuestion(question, languageMode);
  if (preScreen.block) return NextResponse.json({ data: preScreen.result }); // zero model cost

  // 5. Model call.
  try {
    const message = await getAnthropic().messages.parse({
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      messages: [{ role: 'user', content: buildAdvicePrompt({ gender, age, languageMode }) + '\n\n' + question }],
      output_config: { format: zodOutputFormat(AdviceModelSchema) },
    });
    const parsed = message.parsed_output;
    if (!parsed) return NextResponse.json({ error: 'Could not answer' }, { status: 422 });

    // 6. Post-model floors (deterministic). The ONLY producer of the response payload. §6
    const result = applyAdviceSafetyFloors(parsed, { question, languageMode });
    return NextResponse.json({ data: result });
  } catch {
    // Swallow the raw SDK error: it may carry request payloads or key material. No question content in the log.
    console.error('advice: model call failed');
    return NextResponse.json({ error: 'Could not answer the question' }, { status: 502 });
  }
}
```

### 4.1 Request shape and validation (reject loudly, never truncate)

```ts
{ gender: 'female' | 'male' | 'unknown', age?: number, question: string, languageMode: 'en' | 'zh' }
```

- malformed JSON → **400**.
- `question` not a non-empty (trimmed) string → **400** `'No question provided'`.
- `question.length > MAX_ADVICE_QUESTION_CHARS` → **413** `'Question too long'`. **Never truncate** —
  same rationale documented for `MAX_NOTES_CHARS` in `lib/notesSchema.ts`: a floor comparing against
  half an input is comparing against a different input; silently answering half the question corrupts
  what the answer is "about."
- `gender` not in `{female, male, unknown}` → **400**.
- `languageMode` not `'en' | 'zh'` → **400**. **This is the server-side floor that makes Tibetan
  output structurally unrequestable** (§7). `'bo'` on this field is a 400.
- `age` present but not a finite number in 0–120 → **400**.

Response: `{ data: AdviceResult }` (§5) or `{ error: string }` with the statuses above.

### 4.2 Consent gate change — `lib/consentGate.ts`

Add, without changing the two existing routes' behavior:

```ts
export const ADVICE_CONSENT_HEADER = 'x-ht-advice-consent-version';

export function checkConsentVersion(headerValue: string | null, expectedVersion: number): ConsentCheck {
  // exact body of today's checkConsent, but comparing against `expectedVersion` instead of CONSENT_VERSION
}

// existing export becomes a one-line wrapper — byte-identical behavior for extract + translate-notes:
export function checkConsent(headerValue: string | null): ConsentCheck {
  return checkConsentVersion(headerValue, CONSENT_VERSION);
}
```

The advice route imports `ADVICE_CONSENT_VERSION` from `lib/adviceConsent.ts` (§8) and calls
`checkConsentVersion(header, ADVICE_CONSENT_VERSION)`. Because the advice route reads a **distinct
header** and checks a **distinct version constant**, a lab-translator consent can never authorize an
advice transfer, and vice versa — the separation is guaranteed at the transfer point, not by policy.

### 4.3 Rate limit change — `lib/rateLimit.ts`

Extend the existing machinery, no new mechanism:

- `PaidRoute` → `'extract' | 'translate-notes' | 'advice'`.
- `DynamicRateLimitTarget` gains `'advice-burst'`.
- `RateLimitConfig` gains `adviceBurst: number` and `adviceCostUnits: number`.
- `PaidRouteLimiters` gains `adviceBurst: SharedWindowLimiter`.
- `DEFAULTS` gains `adviceBurst: 5` and `adviceCostUnits: 3`. **Flagged defaults:** text-only, so
  cheaper than the vision `extract` (5), but a three-school Opus generation is several times a notes
  translation (1); 3 units means ~20 questions/day inside the shared 60-unit daily budget. Owner may
  tune via env.
- `readRateLimitConfig` reads env `RATE_LIMIT_ADVICE_BURST` and `RATE_LIMIT_ADVICE_COST_UNITS` via
  the existing `positiveInteger` helper with the new defaults.
- `createProductionLimiters` adds an `adviceBurst` limiter with prefix `${prefix}:advice:burst`.
- `applyPaidRouteLimits`'s route→burst ternary and route→cost-units ternary become maps that include
  `advice` → `adviceBurst` / `adviceCostUnits`. Widen the `config` Pick to include `adviceCostUnits`.
- `setDynamicRateLimitOverride` (and whatever `DynamicRateLimitTarget` switch exists) routes
  `'advice-burst'` to the `adviceBurst` limiter.
- **The daily cost bucket stays shared** across all three routes deliberately — it is the per-network
  spend cap, and advice spend is spend.

---

## 5. The response shape

The deterministic frame is **structure, not model text**. The server sends only enum keys and the
(guarded) school prose; all banners, labels, referrals, and disclaimers are hard-coded client strings.

```ts
// lib/adviceGuard.ts
export const ADVICE_SCHOOLS = ['tcm', 'tibetan', 'western'] as const;

export interface SchoolAdvice {
  suggestions: string[]; // general self-care/lifestyle suggestions; NO doses, NO prescriptions
  seekCare: string;      // when this person should see a real clinician
}

export type AdviceBannerId = 'emergency' | 'emergency-self-harm' | 'see-doctor' /* wrapper-defined ids */;
export type AdviceRefusalReason = 'dosing' | 'tibetan-output' | 'emergency-only' | 'out-of-scope';

export interface AdviceResult {
  presentation: 'normal' | 'banner' | 'blocked';
  banners: AdviceBannerId[];         // IDs, not prose — the client maps IDs to localized copy in adviceCopy.ts
  refused: AdviceRefusalReason | null;
  schools?: { tcm: SchoolAdvice; tibetan: SchoolAdvice; western: SchoolAdvice }; // ABSENT when blocked/refused
}
```

Contract that makes client bugs harmless:

- When the wrapper **blocks** or **refuses**, `schools` is **structurally absent** from the payload.
  No client bug can render advice text that was never sent.
- `banners` carries IDs only. The client maps each ID to a localized `defineText` string in
  `adviceCopy.ts`. There is no path by which model text can occupy a banner, label, or disclaimer slot.
- The response JSON carries **no disclaimer field**. The disclaimer/referral block is emitted by the
  page frame unconditionally (§3 of the safety design / §9 here) — there is nothing for a refactor to
  "forget to append."

---

## 6. The deterministic safety floors (mandatory)

`lib/adviceGuard.ts` is pure functions, no I/O. Two seams around the model call. **Every floor is
escalate-only: it may add a banner or refuse; it may never downgrade caution.**

### 6.0 The model-output schema — structured safety fields FIRST

`lib/adviceSchema.ts`:

```ts
const SchoolAdviceSchema = z.object({
  suggestions: z.array(z.string()).min(1)
    .describe('General lifestyle/self-care suggestions from this school for this person. No drug names with doses, no prescriptions.'),
  seekCare: z.string()
    .describe("When this person should see a real clinician about this question, from this school's perspective."),
});

export const AdviceModelSchema = z.object({
  emergency: z.object({
    detected: z.boolean().describe('True if the question describes symptoms needing urgent/emergency care.'),
    reason: z.string().nullable(),
  }),
  outOfScope: z.boolean()
    .describe('True if the question is not a personal health question (tech support, homework, another person\'s prescription, etc.).'),
  tcm: SchoolAdviceSchema,
  tibetan: SchoolAdviceSchema,
  western: SchoolAdviceSchema,
});
export type AdviceModelOutput = z.infer<typeof AdviceModelSchema>;

export const MAX_ADVICE_QUESTION_CHARS = 2000; // FLAGGED DEFAULT: far above a real question, well below abuse scale
```

The wrapper keys on the **structured fields** (`emergency.detected`, `outOfScope`) plus its **own
deterministic string checks** (dose patterns, Tibetan script). It never keys on prose to relax a floor.

### 6.1 Floor A — Emergency-symptom escalation

**Data** — `data/emergency-lexicon.ts` (analogue of `data/medical-lexicon.ts`):

```ts
type EmergencyCategory =
  | 'cardiac' | 'breathing' | 'stroke' | 'bleeding' | 'anaphylaxis'
  | 'self-harm' | 'overdose-poisoning' | 'unconscious' | 'seizure'
  | 'pregnancy-emergency' | 'infant-emergency';

interface EmergencyEntry {
  category: EmergencyCategory;
  zh: string[];          // substring match (the notesGuard zh convention)
  en: string[];          // alnum-edge word-boundary match (reuse the EN-boundary logic in lib/notesDetect.ts)
  suppressModel: boolean; // true ONLY for 'self-harm' and 'overdose-poisoning'
}
```

Seed content (curated, human-written launch set — **every term owner-reviewed before ship**):

- **cardiac**: 胸痛, 胸口痛, 心绞痛, 胸闷（+出汗/放射）; chest pain, crushing chest, pain radiating to arm/jaw
- **breathing**: 呼吸困难, 喘不上气, 窒息; can't breathe, difficulty breathing, gasping
- **stroke**: 中风, 口眼歪斜, 嘴歪, 说话不清, 半边麻木, 突然看不见; stroke, face drooping, slurred speech, one-sided weakness/numbness
- **bleeding**: 大出血, 血流不止, 呕血, 便血不止; severe bleeding, won't stop bleeding, vomiting blood
- **anaphylaxis**: 过敏（+喉咙肿/呼吸）; throat swelling, throat closing, allergic + breathing
- **self-harm** *(suppressModel)*: 自杀, 想死, 不想活了, 轻生, 自残; kill myself, end my life, suicide, want to die, hurt myself
- **overdose-poisoning** *(suppressModel)*: 服毒, 吞了药, 误服, 过量服用; overdose, took too many pills, swallowed poison
- **unconscious**: 昏迷, 失去意识, 叫不醒; unconscious, unresponsive, won't wake up
- **seizure**: 抽搐, 惊厥, 抽风; seizure, convulsing, fitting
- **pregnancy-emergency**: 孕（+出血/剧痛）; pregnant + bleeding/severe pain
- **infant-emergency**: 婴儿（+高烧/抽搐）; infant/baby + high fever/seizure

**Where it runs — twice, server-side:**

1. **Pre-model**, on the question — `preScreenQuestion(question, languageMode)`. Deterministic from
   input alone; no jailbreak of the model can remove it. Produces `categories: EmergencyCategory[]`.
   - If any hit category has `suppressModel: true` → **skip the model call entirely**. Return
     `{ presentation:'blocked', banners:['emergency-self-harm'], refused:'emergency-only', /* no schools */ }`.
     Rationale: a "three schools of medicine" answer to suicidal ideation is intrinsically harmful
     regardless of content; skipping the call removes all model risk at the single highest-stakes
     moment (and is zero cost).
   - If only non-suppress categories hit → the model **is** called (many benign questions contain
     "chest pain"); the emergency banner will still be pinned above the answer post-model.
2. **Post-model**, on each perspective string (inside `applyAdviceSafetyFloors`) — re-scan for
   emergency concepts the *model* surfaced ("this could be a heart attack") that the user didn't type.
   Also honor `emergency.detected === true` from the schema. Output-side hits **add** categories/banner;
   they never remove any. This is the escalate-only union.

**On a somatic (non-suppress) hit:** `presentation:'banner'`, `banners` includes `'emergency'`,
schools render **below** the pinned banner.

**Negation is deliberately NOT handled** ("no chest pain" still banners). The guard tolerates false
escalation, never false silence — exactly as `notesGuard` tolerates false abstention. The banner is
written **conditionally** ("if this is happening now…") precisely so a false positive is a visible
over-caution, never a wrong statement. This is what makes broad, negation-blind substring matching
acceptable.

**Banner copy** — hard-coded in `lib/adviceCopy.ts`, `defineText({en: reviewed(...), zh: reviewed(...), bo: fallback('zh')})`,
keyed by banner ID. Never a model string.

- `emergency` (all somatic categories — one banner regardless of how many hit):
  - EN: *"If this is happening to you or someone near you right now, get emergency help immediately — in mainland China call 120 (ambulance); elsewhere call your local emergency number (for example 911 in the US). Do not wait for an answer on this page. Nothing below can replace emergency care."*
  - ZH: *「如果您或身边的人现在正出现这种情况，请立即寻求急救：中国大陆请拨打 120（急救电话），其他地区请拨打当地急救电话（如美国 911）。不要等待本页的回答。下方任何内容都不能替代急救。」*
- `emergency-self-harm` (replaces the general banner for that category):
  - EN: *"You deserve support right now. In mainland China you can call the national psychological assistance hotline 12356; in the US or Canada call or text 988; elsewhere contact your local crisis line or emergency number. If you are in immediate danger, call emergency services (120 in mainland China). This page cannot help with this — a person can."*
  - ZH: *「此刻您值得获得支持。中国大陆可拨打全国心理援助热线 12356；美国或加拿大可拨打或发送短信至 988；其他地区请联系当地心理危机热线或急救电话。如有即时危险，请拨打急救电话（中国大陆 120）。本页无法为此提供帮助——但真实的人可以。」*

**Hotline numbers are safety-critical facts.** Store `120`, `12356`, `988` in one constants block
in `lib/adviceCopy.ts` with a `// VERIFY BEFORE RELEASE` sentinel. A unit test asserts the sentinel
acknowledgement is present (same spirit as the `reviewed()`/`unverified()` discipline). A wrong
emergency number is itself a safety defect; owner must re-verify at launch and on a recurring check.

**POSITIVE-CONTROL tests (acceptance-blocking — a do-nothing wrapper passes vacuously otherwise):**

- `data/emergency-lexicon.test.ts`: every category has ≥1 zh fixture and ≥1 en fixture that **hits**;
  plus benign near-miss fixtures documenting *accepted* false positives.
- `lib/adviceGuard.test.ts`:
  - a suppress-model question (`自杀`, `want to die`) → **the model is never called** (mock the
    Anthropic client and assert zero invocations) and the result is `blocked` + `emergency-self-harm`.
  - a somatic question (`胸痛`, `chest pain radiating to my arm`) → `banners` includes `'emergency'`.
  - a benign question where the **model output** says "this could be a heart attack" (`emergency.detected: true`
    or a lexicon hit in the prose) → the emergency banner fires **even though the question was benign**.
    This is the proof the post-model scan is wired, not dead code.

### 6.2 Floor B — No medication dosing

**Prompt-level instruction** (polite request; the scan is the law) appended to `ADVICE_PROMPT`:

> "Never state a dose, quantity, strength, frequency, or duration for any medication, supplement, or
> herbal remedy — no numbers with units like mg/g/ml/片/克, no schedules like 'twice daily'/每日两次,
> for ANY tradition including Chinese and Tibetan herbal formulas. Describe *categories* of
> approaches; for anything involving a specific medicine or remedy and how much/how often to take it,
> say the patient must ask a doctor or pharmacist."

**Deterministic output scan** in `lib/adviceGuard.ts`, run per perspective string. Reuse the curated
machinery in `data/medical-lexicon.ts` and `lib/notesGuard.ts`/`lib/notesDetect.ts` — do not reinvent:

- **Pattern A — amount+unit**: a number adjacent to any dose unit from `DOSE_UNIT_TOKENS` in
  `data/medical-lexicon.ts` (mg, mcg, g, ml, IU, 毫克, 微克, 毫升, 克, 片, 粒, 单位, …), the same
  detector family `detectImmutables` uses for `type:'dosage'`. `500mg` is a hit even with no drug named.
- **Pattern B — frequency schedule**: any token from the `FREQUENCY_CONCEPTS` table in `notesGuard.ts`
  (每日三次 / twice daily / bid / 睡前 / as needed …) in the **same clause** (reuse the existing
  `splitClauses`) as (i) a `KNOWN_DRUGS`/`MED_CLASS_ANCHORS`/`EN_MED_CLASS_ANCHORS` match, or (ii) an
  ingestion verb (服/吃/喝/take/服用). Frequency alone in a non-medication clause ("check your blood
  pressure twice daily") does **not** hit; frequency + ingestion verb does, even for unnamed remedies
  ("drink the decoction three times a day").
- **Pattern C — drug+number adjacency**: a `KNOWN_DRUGS`/supplemental drug match in the same clause as
  any bare number (catches "take 2 metformin").
- Herbal formulas are in scope **by construction**: Pattern A fires on 黄芪 10克 because 克/g are dose
  units. No herb list is needed for the floor to hold.

**On any hit: refuse the ENTIRE answer.** All three perspectives are discarded server-side. Result:
`{ presentation:'blocked', banners:[], refused:'dosing', /* no schools */ }`. The client shows one
hard-coded replacement (`lib/adviceCopy.ts`, keyed by refusal reason):

- EN: *"We can't show this answer because it included specific medication or remedy amounts, which this app never provides. For any medicine — including herbal or traditional remedies — and how much or how often to take it, please ask a doctor or pharmacist."*
- ZH: *「此回答包含具体的用药或用量信息，本应用一律不提供此类内容，因此无法显示。任何药物（包括中药、藏药等传统药物）的品种、用量和服用频次，请咨询医生或药师。」*

Whole-answer refusal (not redaction, not per-perspective) is the only option whose failure mode is
purely the tolerated one (false over-refusal), and the user still gets the referral line — the correct
medical answer to every dosing question. **No automatic retry at launch** (flagged owner option: one
silent re-generation, only if telemetry shows a real hit rate on benign questions).

**POSITIVE-CONTROL tests (acceptance-blocking):**

- western drug + mg (`take ibuprofen 400 mg`) → `refused:'dosing'`, no `schools`.
- herbal 克 dose (`黄芪 10 克`) → `refused:'dosing'`.
- frequency + ingestion verb without a number (`drink the decoction three times a day` / `每日三次服用`) → hit.
- frequency in a non-medication clause (`check your blood pressure twice daily`) → **must NOT hit**.
- drug + bare number (`take 2 metformin`) → hit.
- a clean answer with none of the above → `presentation:'normal'`, `schools` present. (Proves the
  scan isn't refusing everything — the negative control for the positive control.)

### 6.3 Floor C — No Tibetan-language output (see §7)

`applyAdviceSafetyFloors` scans every perspective string for Tibetan script `/[ༀ-࿿]/`. Any
occurrence → refuse the whole answer: `{ presentation:'blocked', banners:[], refused:'tibetan-output', /* no schools */ }`
with the hard-coded replacement (EN/ZH in `adviceCopy.ts`). Model-emitted Tibetan is treated exactly
like a model-emitted dose: unverifiable content, discarded. **Positive-control test:** a perspective
containing `བོད་` → `refused:'tibetan-output'`, no `schools`.

### 6.4 Floor D — Out-of-scope

`outOfScope === true` from the schema → `{ presentation:'blocked', banners:[], refused:'out-of-scope', /* no schools */ }`.
Test: a model output with `outOfScope:true` yields `blocked` and structurally contains no `schools` key.

### 6.5 Non-contradiction / precedence

Non-contradiction between the emergency banner and the school advice cannot be verified
deterministically (no source to diff), so the floor is **precedence and suppression**, which can be:

- The emergency banner always renders **pinned above all three cards**, carrying its hard-coded
  "nothing below can replace emergency care" line — so even a "try rest and herbal tea" answer is
  visually and textually subordinated to the escalation.
- For suppress-model categories, no perspectives exist at all (§6.1).
- The prompt additionally asks the model to defer all three perspectives to urgent care on acute
  severe symptoms — but per doctrine that instruction is a courtesy, not a floor; the **ordering rule
  is the floor.**

### 6.6 Determinism

`lib/adviceGuard.test.ts` asserts identical input → identical guard result (pure functions).

---

## 7. The Tibetan default (settled; revisit only with a human review pipeline)

**No Tibetan-language advice at launch.** Serve zh/en only. A `bo` UI user sees the feature with the
app's existing "unverified translation / not available in Tibetan yet" chrome (bo→zh fallback per
`LANGUAGE_CONFIG`) plus a hard-coded reviewed statement that answers are provided in Chinese/English
only for now, and `languageMode` defaults to `zh`.

Why (settled by default):

1. **The floors cannot parse Tibetan.** The emergency lexicon, dose-unit tokens, frequency concepts,
   and drug anchors exist only in zh/en (`SOURCE_LANGS = ['en','zh']` in `lib/i18n.ts` encodes exactly
   this constraint). A Tibetan-language answer would pass through `adviceGuard` **unscanned** — the
   unguarded path inside the app's first unguarded path. Disqualifying on its own.
2. **No reviewer exists; fluent-but-wrong is the documented failure mode** (project research +
   MEMORY: even deliberate refusal mechanisms behaved unexpectedly in the Tibetan pipeline).
   Generated Tibetan advice beside a Chinese disclaimer inverts the safe design — the reader who most
   needs the disclaimer is least likely to read the Chinese it's written in. The app's Tibetan
   invariant machinery (`tibetanImport.ts`, `tibetanInvariants.ts`) trusts Tibetan strings **only when
   imported and verified**; generated advice has no import path.
3. **Consistency.** The rest of the app already shows bo as zh-fallback with an unverified marker
   rather than generating Tibetan. Feature 2 generating it would make the *most* dangerous surface the
   *least* conservative one.

Enforced by two deterministic mechanisms, not policy:

- **Input floor:** the route's `languageMode` accepts only `'en' | 'zh'`; a `bo` request is a **400**.
- **Output floor:** Floor C (§6.3) refuses any Tibetan script in the output.

(Note the Tibetan *school* — 藏医 — is still rendered, in zh/en. That is the Tibetan medical
*tradition* described in Chinese/English, distinct from the Tibetan *language*.)

---

## 8. Consent — separate record

`lib/adviceConsent.ts`, mirroring `lib/consent.ts` verbatim but as a separate purpose:

```ts
const KEY = 'ht:advice-consent';
export const ADVICE_CONSENT_VERSION = 1;
export interface AdviceConsentRecord { version: number; at: number; }
export function hasAdviceConsent(): boolean { /* mirror hasConsent, keyed on KEY + ADVICE_CONSENT_VERSION */ }
export function grantAdviceConsent(now = Date.now()): void { /* mirror grantConsent */ }
export function revokeAdviceConsent(): void { /* mirror revokeConsent */ }
```

Why separate (not a shared-version bump):

- **Different processing, different disclosure.** The lab consent's disclosure enumerates exactly two
  transfers (photo + typed notes). A health *question* is a third, more intent-revealing kind of data.
  Under the FTC §5 / WA MHMDA logic at the top of `lib/consent.ts`, a materially different disclosure
  needs its own affirmative opt-in — piggybacking would be the exact "undisclosed transfer" defect the
  v1→v2 bump existed to fix.
- **Independent lifecycles.** Bumping a shared `CONSENT_VERSION` would force every lab-translator user
  to re-consent for a feature they never touch.
- **Asymmetric users.** A user may consent to lab OCR and never to advice, or vice versa. One record
  cannot represent that.

**Separation invariant (test):** granting lab consent does **not** grant advice consent, and vice
versa — assert in `lib/adviceConsent.test.ts`, and assert at the route level that a request carrying
the lab `CONSENT_HEADER` (or the value `'2'` on the advice header) is a **403** on `/api/advice`, and
that the advice header is rejected on the lab routes.

---

## 9. i18n, disclaimers, and the page frame

All strings go through `defineText({en: reviewed(...), zh: reviewed(...), bo: fallback('zh')})` in
`lib/adviceCopy.ts`. The corpus audits (`lib/directBoAudit.test.ts`, `lib/localizedTextCorpus.test.ts`)
walk `app/components/data/lib` automatically — no registration, but any malformed string fails them.

### 9.1 Consent dialog (`lib/adviceCopy.ts`, CaptureCard-style `role="dialog"`)

Heading and dialog label share reviewed zh from day one (do not repeat the `consentCopy.ts`
`dialogLabel` debt).

- heading — EN: *"Before you ask"* · ZH: *「在提问之前」*
- body 1 (what this is, honestly) — EN: *"This page gives health suggestions written by an AI (Anthropic's Claude), from three perspectives: Chinese medicine, Tibetan medicine, and Western medicine. They are general information and ideas to discuss with a professional — not a diagnosis, not a treatment plan, and not a substitute for seeing a doctor."* · ZH: *「本页面由 AI（Anthropic 的 Claude）从中医、藏医、西医三个视角给出健康建议。这些是一般性信息，供您与专业人员讨论——不是诊断，不是治疗方案，也不能替代就医。」*
- body 2 (transfer disclosure) — EN: *"Your question — including any health details you type in it — is sent to Anthropic (a US company) to generate the answer. We don't save your question on our servers, it is never used for advertising, and Anthropic does not use it to train its models, though it may hold it briefly (up to 30 days) for safety checks."* · ZH: *「您的提问（包括其中的健康信息）会发送给美国公司 Anthropic 以生成回答。我们不会将您的提问保存在服务器上，绝不用于广告；Anthropic 不会用它训练模型，但可能为安全检查短暂保留（最多 30 天）。」*
- body 3 (limits, honestly) — EN: *"The AI can be wrong, even when it sounds confident, and no person reviews its answers before you see them. It will never tell you what medicine to take or how much. In an emergency, don't ask here — call 120 (mainland China) or your local emergency number."* · ZH: *「AI 可能出错，即使听起来很有把握；回答在您看到之前没有经过人工审核。它绝不会告诉您该吃什么药、吃多少。遇到紧急情况请勿在此提问——请拨打 120（中国大陆）或当地急救电话。」*
- agree — EN: *"I understand — ask my question"* · ZH: *「我已了解，开始提问」*
- back — EN: *"Back"* · ZH: *「返回」*

Agree calls `grantAdviceConsent()` then `submit()`.

### 9.2 Standing disclaimer set (`ADVICE_DISCLAIMERS` in `lib/adviceCopy.ts`)

Same shape as `DISCLAIMER_TEXTS` (lead sentence + quieter points). **Does NOT reuse the lab set and
does NOT claim "not a medical device"** — that framing belongs to the non-interpreting translator
surface and would be misleading beside actual suggestions.

1. EN: *"This page offers general health suggestions generated by AI, from three medical traditions. They are starting points to discuss with a professional — not a diagnosis or a treatment plan for you."* · ZH: *「本页面提供由 AI 生成的一般性健康建议，来自三种医学传统。它们是供您与专业人员讨论的参考，不是针对您个人的诊断或治疗方案。」*
2. EN: *"The AI can be wrong, even when it sounds confident. No person reviews these answers before you see them."* · ZH: *「AI 可能出错，即使听起来很有把握。回答在您看到之前没有经过人工审核。」*
3. EN: *"We never provide medication doses. For any medicine or remedy — including herbal and traditional ones — and how much to take, ask a doctor or pharmacist."* · ZH: *「我们一律不提供用药剂量。任何药物（包括中药、藏药等传统药物）的品种与用量，请咨询医生或药师。」*
4. EN: *"The Chinese-medicine and Tibetan-medicine perspectives reflect traditional practice, not modern clinical-trial evidence."* · ZH: *「中医与藏医视角反映的是传统实践，而非现代临床试验证据。」*
5. EN: *"If symptoms are severe or getting worse quickly, don't wait for an answer here — in mainland China call 120; elsewhere call your local emergency number."* · ZH: *「如症状严重或迅速加重，请不要等待本页回答——中国大陆请拨打 120，其他地区请拨打当地急救电话。」*

### 9.3 Referral block (structural, always emitted by the frame)

`app/advice/page.tsx` renders every response inside a fixed `AdviceFrame` that unconditionally emits,
in the user's language via `resolveText`, **below every rendered answer AND below every refusal**:

- EN: *"These are general suggestions to bring to a professional — not a diagnosis or treatment plan for you. Please discuss anything you plan to act on with a doctor, and see a doctor promptly if symptoms persist or worsen."*
- ZH: *「以上只是供您与专业人员讨论的一般性建议，不是针对您个人的诊断或治疗方案。任何打算实际采取的做法，请先与医生讨论；如症状持续或加重，请及时就医。」*

Because the frame is part of the page component and model text is only ever interpolated *into* it, no
model output, prompt bug, or refusal path can omit it. The response JSON carries no disclaimer field.
**Frame test:** every rendered state AND every refused/blocked state contains the referral block and
the disclaimer set.

### 9.4 Three-school labels (never model output)

Fixed order 中医 / 藏医 / 西医, each in a card whose header and epistemic subtitle are hard-coded
`defineText` strings:

- 中医 / Chinese Medicine — EN: *"A traditional Chinese medicine perspective — based on traditional practice and theory, not on modern clinical-trial evidence."* · ZH: *「中医视角——基于传统实践与理论，而非现代临床试验证据。」*
- 藏医 / Tibetan Medicine — EN: *"A traditional Tibetan medicine perspective — based on traditional practice and theory, not on modern clinical-trial evidence."* · ZH: *「藏医视角——基于传统实践与理论，而非现代临床试验证据。」*
- 西医 / Western Medicine — EN: *"General information from mainstream medicine — still general, not a diagnosis for you."* · ZH: *「现代医学的一般性信息——仍属一般信息，不是针对您的诊断。」*

### 9.5 Home entry (`components/AdviceEntryCard.tsx`, inserted in `app/page.tsx`)

A visually **secondary** `<Link href="/advice">` styled quieter than `<CaptureCard>` (the lab
translator stays the primary action). Copy in `lib/adviceCopy.ts`:

- Title — EN: *"Ask a health question"* · ZH: *「咨询健康问题」*
- Subtitle — EN: *"General suggestions from Chinese, Tibetan, and Western medicine — not a diagnosis."* · ZH: *「来自中医、藏医、西医的一般性建议——不是诊断。」*

Honest at the doorway: it says "suggestions," not "answers," before the user navigates.

---

## 10. The page — `app/advice/page.tsx`

`'use client'`, `useLangPreference()` for `lang`, same `<main>`/header skeleton as home (wordmark
links back to `/`). Phase machine mirroring CaptureCard's, gate-at-submit:

```ts
type Phase = 'form' | 'consent' | 'asking' | 'result' | 'error';
```

- Gate at submit exactly as CaptureCard does: `if (!hasAdviceConsent()) { setPhase('consent'); return; }`
  (SSR-safe — do not read localStorage during render).
- **Consent phase**: the CaptureCard `role="dialog"` structure with `ADVICE_CONSENT_COPY`. Agree →
  `grantAdviceConsent()` → `submit()`.
- **Form** (fields per Input Prompt 2):
  - `gender`: `<select>` `unknown | female | male`, reusing the `Sex` type from `lib/types.ts` and the
    exact option copy CaptureCard uses (`Prefer not to say · 不便透露`, etc.).
  - `age`: the same banded `<select>` CaptureCard uses (optional: `undefined | 10 | 40 | 70`). Do not
    collect exact age — the band is the established privacy-minimizing pattern.
  - `question`: required `<textarea>`, trimmed non-empty, live character count vs
    `MAX_ADVICE_QUESTION_CHARS`.
  - `languageMode`: **default = UI `lang` mapped to `'zh' | 'en'`** (bo→zh), with an explicit two-button
    override. When `lang === 'bo'`, render the "answers are Chinese/English only for now" aside (new
    reviewed string in `adviceCopy.ts`) and default `languageMode` to `zh`.
  - Request carries the `ADVICE_CONSENT_HEADER: String(ADVICE_CONSENT_VERSION)`.
- **Asking**: the `aria-live="polite"` breathing-skeleton pattern from CaptureCard's `extracting` phase.
- **Result**: renders `AdviceResult`:
  1. a `role="alert"` **banner slot first**, fed exclusively by `result.banners` (page maps IDs →
     `adviceCopy.ts` strings; the page never decides banner content);
  2. then the three school cards in fixed order (only when `presentation !== 'blocked'` and `schools`
     present);
  3. then the standing `ADVICE_DISCLAIMERS` block + the structural referral block (always).
  - When `presentation === 'blocked'` (suppress-model, dosing, tibetan-output, out-of-scope), only the
    banner region + refusal message + disclaimers/referral render — no school content exists in the
    payload to render.
- **Error**: the CaptureCard `FAILURE_PRESENTATION` pattern with the status→cause mapping
  `403 → consent`, `429 → rate-limited`, `413 → too long`, `422 → could-not-answer`, `>=500 → unavailable`.
  Failure logging matches CaptureCard: status + cause only, never response bodies.

---

## 11. Explicit "do NOT" list

- **Do NOT** touch the lab translator's routes, guards, grounding, reference table, disclaimers,
  consent copy, or `CaptureCard` (§2 list). Feature 2 shares infrastructure only.
- **Do NOT** reuse the lab `DISCLAIMER_TEXTS` or the "not a medical device / we don't interpret"
  framing. Feature 2 has its own honest advice-framing disclaimers (§9.2).
- **Do NOT** generate Tibetan-language medical advice (§7). `languageMode` accepts only `en|zh`
  (400 otherwise); any Tibetan script in output is refused.
- **Do NOT** add image input — text-only.
- **Do NOT** output medication dosing — Floor B refuses the whole answer on any dose/frequency hit.
- **Do NOT** let raw model output cross the API boundary — `applyAdviceSafetyFloors` is the only
  producer of the response payload; blocked/refused results carry no `schools` key.
- **Do NOT** ship the route without its wrapper (§3).
- **Do NOT** truncate an over-length question — 413 instead (§4.1).
- **Do NOT** put model text into any banner, label, disclaimer, or referral slot — those are
  hard-coded `defineText` strings selected by enum ID.
- **Do NOT** delete or weaken any existing test to make this pass.

---

## 12. Acceptance criteria

Build + type:

- [ ] `npx tsc --noEmit` clean.
- [ ] `npx vitest run --pool=threads` fully green (per the testing-env memo; no existing test deleted
      or weakened).

Safety positive controls (each must actively fire — a do-nothing wrapper must fail these):

- [ ] Suppress-model question (`自杀` / `want to die`) → model **never called** (mocked-client
      zero-invocation assertion), result `blocked` + `emergency-self-harm`, no `schools`.
- [ ] Somatic question (`胸痛` / `chest pain radiating to my arm`) → `banners` includes `'emergency'`.
- [ ] Benign question + model output asserting an emergency (`emergency.detected:true`) → emergency
      banner fires anyway (proves the post-model scan is live).
- [ ] Dosing: western drug+mg, herbal 克 dose, frequency+ingestion-verb (no number), drug+bare-number
      each → `refused:'dosing'`, no `schools`. Frequency in a non-medication clause → **no** hit. A
      clean answer → `presentation:'normal'` with `schools` present.
- [ ] Tibetan script in output → `refused:'tibetan-output'`, no `schools`.
- [ ] `outOfScope:true` → `blocked`, structurally no `schools` key.
- [ ] Determinism: identical input → identical guard result.
- [ ] Every emergency category has a hitting zh fixture and a hitting en fixture in
      `data/emergency-lexicon.test.ts`.
- [ ] Hotline-number `// VERIFY BEFORE RELEASE` sentinel present and asserted acknowledged.

Route + consent + rate limit:

- [ ] Missing/blank advice header → 403; lab `CONSENT_VERSION` value (`'2'`) sent on the advice header
      → 403; empty question → 400; over-length → 413; `languageMode:'bo'` → 400; bad `gender`/`age` →
      400; model failure → generic **502 with no error detail** (no question content logged).
- [ ] `checkConsent` behavior byte-identical for extract + translate-notes after the
      `checkConsentVersion` refactor (assert in the extended consent-gate tests).
- [ ] Granting lab consent does **not** grant advice consent, and vice versa
      (`lib/adviceConsent.test.ts`).
- [ ] `'advice'` routes to its own burst bucket, debits `adviceCostUnits` from the shared daily bucket,
      fails closed on store timeout, and `'advice-burst'` dynamic override reaches the right limiter
      (`lib/rateLimit.test.ts` additions).

Page:

- [ ] Consent gate precedes the first submit (no fetch fires without it); the request carries
      `ADVICE_CONSENT_HEADER`; a 403 returns the user to the consent phase; the banner slot renders
      wrapper IDs; `presentation:'blocked'` renders no school content; `lang==='bo'` shows the
      unavailability aside and defaults `languageMode` to `zh`.
- [ ] Frame test: every rendered AND every refused/blocked state contains the referral block and the
      disclaimer set.
- [ ] Every new string in `adviceCopy.ts` passes `directBoAudit` (`bo: fallback('zh')`) and is
      extracted by `localizedTextCorpus` — no manual registration.

Lab translator unperturbed (the disclosure rule):

- [ ] The lab translator's existing tests and corpus numbers are **UNCHANGED** — Feature 2 must not
      perturb them: **MedRepBench 22/37, MIMIC 111/212, chipWrong 0.** Run
      `npx tsx validation/real-corpus/run.ts` and confirm the before/after `R6-gold` and `chipWrong`
      numbers are identical to `main`.
- [ ] Global lab gates diff-free by construction (no lab-path file changed): `chipFidelity`,
      `goldLabelGates`, `b1VerdictLeakage`, and the alias locks.
- [ ] **Disclosure rule:** the PR description lists every existing assertion touched. The only expected
      one is the `consentGate` refactor (`checkConsent` → wrapper over `checkConsentVersion`); its test
      must show identical behavior. If any other existing assertion changes, call it out explicitly —
      an unlisted change to a lab-path test is a review-blocking event.
