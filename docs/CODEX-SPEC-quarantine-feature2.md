# SPEC: Quarantine Feature 2 (advice portal) + fail-closed zero-row extraction

Repo: `/Users/likerun/Desktop/health-translator`, branch `codex/remaining-work-cycle-ready`. All line numbers verified against this branch by a scout pass and an independent reviewer build.

## Why (trust this; it was verified by running the shipped code)

Feature 2 (free-text health-advice portal) violates the product's safety invariant ("LLM is OCR-only; meaning is deterministic from a curated table"). We ran the shipped guard (`lib/adviceGuard.ts`) against adversarial inputs:

- A multi-day food-and-water-avoidance plan returned `presentation: normal` and rendered to the user.
- "The lump is definitely not cancer, no biopsy needed" returned `normal` and rendered.
- "Exercise through crushing chest pain" fired the emergency banner, BUT all three schools of harmful prose still rendered underneath — the banner path is non-suppressing by design; only `blocked()` drops schools.

The guard checks only enumerated lexical/structural signals (emergency keywords, model-set outOfScope, Tibetan script, dosing patterns) and nothing about medical truth. Harmful and false advice reaches users. HIGH severity, shipped. Decision: quarantine the feature end to end, preserving all T1–T4 code on the branch as research.

Separately (C6, MEDIUM, also verified by running the route): `POST /api/extract` returns `200 {"data":{"rows":[]}}` when the model parses zero rows. The client then navigates to `/result` and renders an empty report with no error — false reassurance by omission.

---

## TASK Q — Quarantine Feature 2

Three layers, all required. The API guard (Q3) is the load-bearing control; Q1/Q2 are defense in depth. (The residual client-side vector is chunk-level only — a stale PWA cache can hold the old `/advice` JS chunk, and an already-open client can still `fetch('/api/advice')`; see the Serwist note under VERIFICATION. Q3 closes both.)

### Q1. Home page: stop rendering the entry card

File: `app/page.tsx`
- Delete line 54: `<AdviceEntryCard lang={lang} />`.
- Delete line 3: `import { AdviceEntryCard } from '@/components/AdviceEntryCard';`. NOTE: nothing automated will catch this if you forget — `tsconfig.json` has no `noUnusedLocals` and there is no ESLint config file in this repo. Delete it deliberately and verify by grep that `app/page.tsx` no longer references `AdviceEntryCard`.
- `lang` stays used by `CaptureCard`/`SavedVisits` — no other fallout.
- Do NOT edit `components/AdviceEntryCard.tsx` itself; it stays as preserved research (it contributes zero corpus strings).

### Q2. `/advice` route: real 404, research preserved

`app/page.tsx` is a client component, so any flag inside it would ship in the bundle. Instead:

- Rename `app/advice/page.tsx` → `app/advice/AdvicePageResearch.tsx` (same directory — App Router only treats reserved filenames as routes, so this file becomes inert but stays in the `app/` corpus-scan scope, where it contributes zero `defineText` calls; corpus-neutral).
- Write a new `app/advice/page.tsx`: a small **server** component (no `'use client'`) whose entire body calls `notFound()` from `next/navigation`, with a comment block stating this is a safety quarantine of Feature 2 (C3), dated, and that the research implementation lives in `AdvicePageResearch.tsx`. This makes `/advice` a genuine server-rendered 404 AND tree-shakes the client module (and its `fetch('/api/advice')` path) out of the bundle. This pattern is verified working on this repo's Next 16.2.9: a probe route whose page body is only `notFound()` passes `next build` and `tsc --noEmit` and prerenders.
- Repoint `app/advice/page.test.tsx:23` from `import AdvicePage from './page'` to `./AdvicePageResearch` so the 21 existing tests keep passing against the preserved component. Do not otherwise modify those tests, and do NOT add any `vi.mock('next/navigation', …)` to that file — the preserved tests render a `next/link`-using component, and a file-scoped mock would replace the module for all 21 of them. The quarantine test goes in a separate file (see TEST OBLIGATIONS #2).
- There is no `app/not-found.tsx` in this repo, so the default (unstyled, English) Next 404 renders. **This is accepted — do NOT add `app/not-found.tsx`** (adding one risks new localized strings; see tripwire section). If you believe a branded 404 is needed, stop and ask.
- Do NOT use `redirect()`, and do NOT introduce any env-var flag (`NEXT_PUBLIC_*` is explicitly prohibited by `.env.local.example` and would create a one-env-var path back to shipping the harm surface).

### Q3. `POST /api/advice`: unconditional fail-closed, first statement in the handler

File: `app/api/advice/route.ts` (115 lines). Handler starts line 20; consent check is lines 21–24; rate limiter (awaited Redis I/O) line 32; `req.json()` line 37; `getAnthropic().messages.parse` line 85. Note `lib/anthropic.ts` is lazy (`getAnthropic()` constructs the client), so an early return guarantees no client construction.

Required behavior:
- Insert a guard as the **first statement** of `POST`, before line 21. It must return before the consent-header read, before `enforcePaidRouteRateLimit`, before `req.json()`, before `preScreenQuestion`, before `getAnthropic()`.
- The guard must not reference `req` in any way — nothing about the request is inspected. (Keep the `req` parameter as-is; the unreachable remainder still uses it, so no unused-param issue.)
- Response: **`410 Gone`**, JSON body `{ error: 'Advice feature disabled', errorZh: '健康咨询功能已停用' }`, header `Cache-Control: no-store`. Rationale for 410 over the two tempting alternatives:
  - Not `403 {error:'Consent required'}` (the shape the route already emits): a quarantine indistinguishable from the consent check means tests cannot detect a refactor that restores the consent path and re-enables the portal for consenting users. The quarantine response must be unique.
  - Not `503`: the client copy for ≥500 says "temporarily unavailable, try again later," which is false for a permanent quarantine. 410 is semantically honest; client-side it maps to the generic `'could-not-answer'` state (`app/advice/page.tsx:157-162`), which only matters to stale clients anyway.
  - These body strings are plain route JSON (like the existing `'Consent required'`), NOT `defineText()` calls — they are corpus-invisible. Do not implement them via `defineText`.
- Implementation constraint: the rest of the handler (lines 21–114) must remain in the file, unreachable but compiling clean — this is a disable, not a delete. Suggested mechanism: a module-level `const FEATURE_2_QUARANTINED: boolean = true;` (typed `boolean`, not literal `true`, so TypeScript does not mark the remainder unreachable) guarding the return. Add a comment: re-enabling requires deleting this constant AND the quarantine tests, i.e. it cannot happen silently.
- Keep line 17 `export const runtime = 'nodejs'` and line 18 `export const dynamic = 'force-dynamic'` as-is.

### Q4. Docs — `docs/RUNNING.md`, all advice-route claims

Annotate every statement that the quarantine falsifies; do not delete the curls, mark them:

- `:45` — route list entry for `POST /api/advice`: mark as quarantined (returns 410 unconditionally).
- `:40-47` — the claim that rate limiting covers `POST /api/advice` and runs "before reading the JSON body": annotate that under quarantine the handler returns 410 before the rate limiter ever runs, so `/api/advice` no longer consumes rate-limit allowances at all.
- `~:175-176` — "The advice route can be checked without a model call by sending an empty question so the allowed request stops at validation": false under quarantine (validation is unreachable); annotate.
- `:180-182` — the three curl examples against `/api/advice`: annotate that all three now return `410 { error: 'Advice feature disabled', … }`.
- `~:186-187` — "A request without the consent header must continue to return `403` before consuming a rate-limit allowance": false under quarantine (it returns 410); annotate.

---

## TASK E — `/api/extract` fails closed on zero rows

### E1. Route guard (the fix)

File: `app/api/extract/route.ts:47-49`. Currently `{rows: []}` is truthy and falls through to `200 {data: parsed}`. Change the condition so that `!parsed || parsed.rows.length === 0` returns the **existing** `422 { error: 'Could not read the report' }` response (same as the `parsed_output === null` branch — semantically the same event). Add a one-line comment: a report that OCRs to nothing must not present as an empty report.

**Do NOT add `.min(1)` to `LabExtractionSchema` (`lib/extractionSchema.ts:35-37`).** Verified reasons: (a) `zodOutputFormat` emits `minItems: 1` into the model's constrained-decoding grammar, making an empty array un-emittable — a blank image would pressure the model to invent a row, directly attacking the OCR-only invariant; (b) the SDK's `parse` throws on a `too_small` issue, landing in the blanket catch as a 502 → client renders "service unavailable / Try again" instead of the honest "unreadable / Retake". Leave `lib/extractionSchema.test.ts` alone — `{rows: []}` stays schema-valid on purpose.

### E2. Client defense in depth

File: `components/CaptureCard.tsx:356-360`. Extend the existing schema-failure branch so a 200 whose parsed `rows.length === 0` also calls `failSubmission('unreadable', res.status, overrideQuality)` and returns. Reuses the shipped, localized, tested `unreadable` → "Retake" path. **Zero new strings.**

---

## NON-GOALS (do not do these)

- Do NOT delete or edit: `lib/adviceGuard.ts`, `lib/adviceCopy.ts` (must stay **byte-identical** — it contributes 51 locked corpus calls), `lib/adviceSchema.ts`, `lib/adviceConsent.ts`, `lib/consentGate.ts`, `data/emergency-lexicon.ts`, `components/AdviceEntryCard.tsx`, or their tests (`lib/adviceGuard.test.ts` — 105 tests, the biggest research asset — `lib/adviceSchema.test.ts`, `lib/adviceConsent.test.ts`, `lib/adviceCopy.test.ts`, `lib/consentGate.test.ts`, `data/emergency-lexicon.test.ts`).
- Do NOT remove the `'advice'` route id or `RATE_LIMIT_ADVICE_*` config from `lib/rateLimit.ts` (~8 tests in `lib/rateLimit.test.ts` depend on it).
- Do NOT move any advice file out of `app/`, `components/`, `data/`, `lib/` (e.g. into `research/`) — the localized-text corpus statically scans those dirs and membership changes break locked counts. The Q2 rename stays inside `app/advice/`.
- Do NOT delete or thin the advice CSS blocks in `app/globals.css:300-458` (the advice styles run through the `.advice-referral` block closing at 458) — dead but harmless, preserved research.
- Do NOT touch `components/DisclaimerBanner.tsx` ("A reading aid, not medical advice.") or `components/SummaryView.test.tsx:57` — that is the lab-translator disclaimer, unrelated to Feature 2.
- Do NOT add any env-var or config flag for re-enablement.
- Do NOT author ANY new `defineText()` call anywhere under `app|components|data|lib` (see tripwires).

---

## TEST OBLIGATIONS

Baseline: 87 files, 1056 tests, all green (verified). 58 tests will break under this quarantine; every rewrite must assert the QUARANTINED behavior so a later refactor silently re-enabling the portal fails loudly.

### Update (will break, rewrite to assert quarantine)

1. **`app/api/advice/route.test.ts`** — all 41 tests fail under a 410 guard (including the 5 consent-403 tests). Wrap the existing `describe('POST /api/advice')` in `describe.skip`, retitled to mark it preserved pre-quarantine research, and add a new active `describe` with the quarantine suite. The existing harness already has everything needed: `reqWith(..., { bodyReader })` (lines 80–99) and hoisted mocks for `getAnthropic`, `enforcePaidRouteRateLimit`, `preScreenQuestion`, `parse`, and `applyAdviceSafetyFloors`. New tests must assert, for a request with a **valid consent header and fully valid body**:
   - status 410, body `{ error: 'Advice feature disabled', errorZh: '健康咨询功能已停用' }`, `Cache-Control: no-store`;
   - `bodyReader` **not** called (body never read);
   - `getAnthropic` **not** called (no Anthropic client constructed);
   - `enforcePaidRouteRateLimit` **not** called;
   - `preScreenQuestion` **not** called, `parse` **not** called, `applyAdviceSafetyFloors` **not** called (parity with the skipped consent tests — the full "nothing downstream runs" contract);
   - plus one case with a missing consent header proving the 410 is unconditional (not the old 403 path).
2. **`app/advice/page.test.tsx`** — repoint the import at line 23 to `./AdvicePageResearch` (all 21 tests then keep passing unchanged). The `notFound()` proof goes in a **new separate file `app/advice/quarantine.test.tsx`** — NOT in `page.test.tsx`, because the required file-scoped `vi.mock('next/navigation', () => ({ notFound }))` would replace the module for all 21 preserved tests (which render a `next/link`-using component and have no such mock today). In `quarantine.test.tsx`: import the new `./page`, mock `next/navigation`'s `notFound` to throw a sentinel, and assert the render throws it / the mock was called. This is the "/advice is unavailable" proof.
3. **`components/AdviceEntryCard.test.tsx`** — the `<Home />` test at lines 44–55 fails (its `getByRole('link', { name: 'Ask a health question' })` throws). Rewrite it to assert the quarantine: home renders exactly one `.capture-card` and **zero** `.advice-entry-card` / zero link named "Ask a health question" (`queryByRole` → null). Keep the two direct-render component tests (lines 24–42) green as preserved research; annotate them as such.

### New (Task E)

4. **`app/api/extract/route.test.ts`** — beside the existing `parsed_output: null` 422 test (lines 68–72), add: `parse.mockResolvedValue({ parsed_output: { rows: [] } })` → assert 422. The harness (mocked `parse`, `reqWith`) is already right.
5. **`components/CaptureCard.test.tsx`** — beside "treats a 200 response that fails the extraction schema as unreadable" (line 374), add a case where the 200 body is `{ data: { rows: [] } }`. Mirror the neighboring test's assertions exactly: `expectUnreadablePresentation(alert)`, `expect(mocks.push).not.toHaveBeenCalled()`, and `consoleError` called with `{ status: 200, cause: 'unreadable' }`. Do NOT assert on `setPendingReport` — `@/lib/session` is not mocked in this file (the only hoisted mocks are `push`, `downscaleToJpeg`, `hasConsent`, `grantConsent`, `fetch`), and adding a `vi.mock('@/lib/session', …)` is out of scope. The `push`-not-called assertion already proves no navigation occurred.

### Must pass UNMODIFIED (this is the point of the disable)

`lib/localizedTextCorpus.test.ts`, `lib/directBoAudit.test.ts`, `lib/adviceCopy.test.ts`, `lib/tibetanImport.test.ts`, `lib/tibetanInvariants.test.ts`, `lib/tibetanWellFormedness.test.ts`, `lib/localizationBaseline.test.ts`, `lib/adviceGuard.test.ts`, `lib/rateLimit.test.ts`, `app/page.test.tsx` (has zero advice references — verified), `lib/extractionSchema.test.ts`.

---

## TRIPWIRE / INVENTORY-LOCK WARNING — READ BEFORE TOUCHING ANYTHING

Scout S5 ran the shipped corpus extractor and concluded: **a disable-only quarantine changes ZERO locked counts.** The corpus is a pure AST scan for `defineText()` calls under `app|components|data|lib` — it has no notion of routing, rendering, or dead code. Current locked values that must remain exactly as-is: `sourceFiles` 15, `calls` 494, `fallbackBo` 493, `curatedBo` 0, `excludedDirectBo` 1, `referenceCalls` 337, `packet.floor` 156, `UI_COPY` keys 25, `CONSENT_COPY` 6, `DISCLAIMER_TEXTS` 5, `REFERENCE_LABS` 117. `lib/adviceCopy.ts` contributes 51 of the 494; `AdvicePageResearch.tsx` and `AdviceEntryCard.tsx` contribute 0.

Three ways this change could still trip a lock — avoid all three:
1. Adding any new `defineText()` call anywhere in the scanned dirs (a "feature unavailable" notice, a quarantine banner, new failure copy). The 410 body and route errors are plain JSON strings — keep it that way.
2. Editing `lib/adviceCopy.ts` at all, even a comment inside a `defineText`.
3. Introducing a TypeScript parse error in any scanned file (the extractor throws on parse diagnostics, failing every corpus test at once).

**HARD RULE: if any exact-count assertion fails (`localizedTextCorpus.test.ts:26-31`, `directBoAudit.test.ts:119-125`, `tibetanImport.test.ts:227/323-331`, `tibetanInvariants.test.ts`, `tibetanWellFormedness.test.ts`, or the runtime throw at `lib/tibetanImport.ts:476`), STOP AND ASK. Do not rebaseline any number yourself, under any circumstances.** This repo has been burned twice by silent rebaselines. A failing count means your change did something this spec says it must not do.

---

## VERIFICATION

Vitest's default forks pool fails under machine load in this environment. **Always use `--pool=threads`**; do not trust a bare `npm test` failure without re-running with the flag.

```bash
# Full suite
npx vitest run --pool=threads

# Corpus/inventory locks specifically (must pass with ZERO edits to these files)
npx vitest run --pool=threads lib/localizedTextCorpus.test.ts lib/directBoAudit.test.ts \
  lib/adviceCopy.test.ts lib/tibetanImport.test.ts lib/tibetanInvariants.test.ts \
  lib/tibetanWellFormedness.test.ts

# Quarantine + extract surfaces
npx vitest run --pool=threads app/api/advice/route.test.ts app/advice \
  components/AdviceEntryCard.test.tsx app/api/extract/route.test.ts components/CaptureCard.test.tsx

# Types + production build (confirms /advice compiles as a server 404 page)
npx tsc --noEmit
npm run build
```

Green looks like: full suite passes with roughly the baseline 1056 tests plus the new quarantine/zero-row tests, minus nothing (the 41 skipped route tests report as skipped, not failed); every corpus-lock file passes byte-unmodified; `tsc` and `next build` clean.

Serwist/PWA note for the PR description (verified by building the branch — state it as settled, not open): the generated `public/sw.js` precache manifest contains exactly one HTML URL, `/~offline`; `/advice` appears only as the JS chunk `/_next/static/chunks/app/advice/page-<hash>.js`. **No stale service worker can serve the old `/advice` document.** The residual vector is chunk-level only: a previously installed PWA may retain the old advice page chunk, and an already-open client can still call `fetch('/api/advice')` — the Q3 unconditional 410 is the control for both.

## COMMITS

Follow the repo convention `type(scope): summary`. Two commits:

1. `fix(advice): quarantine Feature 2 — remove entry, 404 /advice, fail-closed 410 /api/advice (C3)`
2. `fix(extract): fail closed on zero-row extraction instead of empty 200 (C6)`