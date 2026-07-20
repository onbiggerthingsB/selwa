# Tibetan unblocked work — sequenced Codex handoff (W0–W5)

Baseline **verified** at `9d8e858`: `npx vitest run --pool=threads` → 70 files / 701 tests green;
`npx tsc --noEmit` clean; MedRepBench analyte-confirm gold **22/37**; MIMIC **111/212**;
`chipWrong` **0** on both.

Spec: `docs/superpowers/specs/2026-07-20-tibetan-support.md`. It is implementation-grade — these
prompts point at it rather than restating it.

**What this sequence buys:** it makes a reviewer's hour worth several times more, and none of it can
be done *after* the reviewer arrives without wasting their time. **What it does not buy:** a single
Tibetan word. That is W6+ and needs a human; §4 establishes there is no machine substitute.

> **ORDER CHANGED FROM SPEC §9 — W1 (D4) NOW GOES FIRST.** The spec put D1 first. The grounding pass
> found that D4 installs the audit that catches a mistake in all three of the others, and that the
> disclaimer gap it closes is currently caught by **nothing at all** (proof in §W1). Install the net
> before doing the work over it. **Order: W1 → W0 → W2 → W3 → W4 → W5.**

**Invariant carried by every prompt.** Tibetan is display-only. `chipWrong`, CHIP%, and
analyte-confirm gold must not move on either corpus. If one moves, the change was not as scoped —
stop and report rather than accepting it.

**The unchanged-number trap.** W0 and W1 touch only tests and an index; their corpus numbers are
provably unchanged *a priori*, so an unchanged number is **not** evidence the work landed. Every
prompt therefore also pre-registers a **positive** number that must move.

---

## W1 — D4: direct-`bo` audit + `bo` baseline hashes

**Why first:** proven undefended. Mutating the lead disclaimer (`lib/disclaimers.ts:12-16`) to
`bo: reviewed('MUTANT-BO-DISCLAIMER')` and running the full suite produced **zero failures**. The
only mutation caught anywhere was a `uiCopy` one, and only incidentally, by a hardcoded string
comparison in a page test — not by any audit.

```
Repo: /Users/likerun/Desktop/health-translator
Branch: codex/remaining-work-cycle-ready @ 9d8e858
Baseline: 70 files / 701 tests green · tsc clean · MedRepBench 22/37 · MIMIC 111/212 · chipWrong 0

Read docs/superpowers/specs/2026-07-20-tibetan-support.md §1 (D4). Implement D4 ONLY.
Stop there. Do not start D1, D2 or D3.

WHY THIS IS FIRST: a bo: reviewed() on the lead disclaimer lands today with EVERY hash unchanged
and every test green. Verified by mutation. This tranche installs the net.

CHANGES
1. lib/localizationBaseline.test.ts:78,89 — widen the parameter type from SourceLang to Lang.
2. lib/localizationBaseline.test.ts:10-14 and :24-28 — add bo baselines as EXPLICITLY WRITTEN hex
   literals. Computed against HEAD (bo currently falls back to zh, so they equal the zh digests):
     REFERENCE_BASELINE.bo  = 'ec985ccea7ee893ff00abcc60caa903dcbcb968a464d71356bb449e3a51480e6'
     DISCLAIMER_BASELINE.bo = '26b37ac41f7ab7ca787474a8f0bd549f24937226f475fa873e7dffb3f0ccde4b'
3. lib/localizationBaseline.test.ts:99,107,115 — it.each(['en','zh'] as const) -> add 'bo'.
4. New audit file (e.g. lib/directBoAudit.test.ts) enumerating DISCLAIMER_TEXTS
   (lib/disclaimers.ts:11-35), all 25 UI_COPY keys, and every REFERENCE_LABS name/definition/plain.
   Reuse the auditBoFallback shape at validation/silentAssertion.test.ts:59-83. Any direct bo must
   appear in a NAMED ALLOW-LIST constant the test reads. The allow-list's expected state today is
   the single entry in (6) below.
5. RETIRE data/reference-labs.test.ts:258-260 INTO that audit — do not simply delete it. Those three
   assertions (e.name.bo / e.plain.bo / e.definition.bo toEqual({fallback:'zh'}) over all 116
   entries) are TODAY THE ONLY THING locking bo in the lab table. The audit must give the same
   coverage plus an opt-in door. Say so in the commit body.
6. There is EXACTLY ONE direct bo in the repo: lib/summary.ts:339, bo: unverified(row.extracted.name)
   — the report's verbatim printed name on an abstained row, deliberately unverified in all three
   languages. It is CORRECT. Do NOT "fix" it to fallback('zh'); that would relabel a verbatim OCR
   token as a Chinese translation. Put it in the allow-list with that reason.

DO NOT
- Compute the bo hash from zh (bo: REFERENCE_BASELINE.zh, or hashing referenceText('zh')). That
  defeats the entire source-drift lock. Write the literals.
- Widen it.each to LANGS (couples the baseline to a constant that will later grow).
- Delete data/reference-labs.test.ts:258-260 without the replacement lock.
- Soften validation/silentAssertion.test.ts:74-83 or the expect(bo).toBe(zh) byte-equality
  assertions at :183, :256, :261, :285, or validation/b1VerdictLeakage.test.ts:152, :320, :436.
  Those are chipWrong-adjacent. Leave all of them intact.

PRE-REGISTERED
- en and zh hashes for BOTH baselines unchanged to the character.
- Three it.each blocks go 2 cases -> 3.  <-- this is the positive number; unchanged corpus numbers
  are NOT evidence this landed, because D4 touches no runtime path.
- MedRepBench 22/37, MIMIC 111/212, chipWrong 0 — all unchanged.
- PROOF OF BITE REQUIRED: a fixture LocalizedText carrying a direct bo NOT in the allow-list must
  make the audit fail. Show it failing, then passing once allow-listed.

ACCEPTANCE: vitest green (--pool=threads; forks fails under load), tsc clean, corpus numbers
unmoved, proof-of-bite shown in both states.

DISCLOSURE: list every existing assertion you modified, weakened, moved or deleted, with file:line
and before/after text. "Locks unmodified" is true only if that list is empty — and item 5 guarantees
it will not be.
```

**Check on the way back:** the retirement in item 5 is where a plausible-but-wrong result hides. If
the new audit enumerates `REFERENCE_LABS` but the allow-list mechanism lets an unnamed `bo` through,
coverage went *down* while the test count went up. Ask for the proof-of-bite output specifically.

---

## W0 — D1: index only source-language names

**The harm is proven, not theoretical.** Setting `wbc_count`'s `bo` name to `血红蛋白` (hemoglobin's
Chinese name) yields:

```
findEntryMatch('血红蛋白') -> wbc_count  exact  refLow=3.5 refHigh=9.5 unit=10^9/L
```

A row printed `血红蛋白` draws WBC's band, criticals, classification and Typical-range chip. `Map.set`
is last-writer-wins, so a later entry's Tibetan name silently steals an earlier entry's Chinese key.

```
Repo: /Users/likerun/Desktop/health-translator
Branch: codex/remaining-work-cycle-ready @ <commit from W1>
Read docs/superpowers/specs/2026-07-20-tibetan-support.md §1 (D1). Implement D1 ONLY.

THE FIX IS TWO EDITS, NOT ONE. SourceLang (lib/i18n.ts:10) is a TYPE ONLY; there is no runtime
array to map over.
1. lib/i18n.ts:10 — add
     export const SOURCE_LANGS = ['en','zh'] as const satisfies readonly Lang[];
     export type SourceLang = (typeof SOURCE_LANGS)[number];
   The resulting type is identical, so none of the ~50 downstream SourceLang consumers change.
2. lib/reference.ts:3,16 — import and map SOURCE_LANGS instead of LANGS.

INDEX is the ONLY structure that reads resolveText(e.name, lang) — verified by full-repo grep;
lib/reference.ts:16 is the only non-test LANGS consumer. SCOPED_INDEX (:47-57) and
SCOPED_ALIAS_NAMES (:59-67) build from specimenAliases only and need no change.

DO NOT
- Gate on review === 'reviewed'. A reviewed display name is still not a validated OCR token — the
  reviewer checks that the word means the analyte, not that no other analyte's printed Chinese name
  normalises onto it.
- Change LANGS itself to ['en','zh']. lib/i18n.test.ts:21 asserts LANGS === ['en','zh','bo'], and
  data/reference-labs.test.ts:253, validation/silentAssertion.test.ts:96 and
  validation/b1VerdictLeakage.test.ts:146,471,520 iterate LANGS to check all three display
  languages render. Narrowing it would silently drop bo from five audit loops.
- Touch data/reference-labs.test.ts:258-260 (or its W1 replacement). D1 does not subsume it.

PRE-REGISTERED
- INDEX contains EXACTLY 730 keys before and after, with 0 added, 0 removed, 0 re-pointed. The
  change is bit-exact today because bo resolves to the zh string. Report the measured key count.
- MedRepBench 22/37, MIMIC 111/212, chipWrong 0 — unchanged.

TEST — a vacuous test here is the failure mode. "No Tibetan names exist today" is trivially true
(there are zero) and stays green after a revert. Required instead:
  (a) the 730-key / 0-diff invariant, and
  (b) a synthetic LocalizedText name carrying a DIRECT bo string, asserting findEntryMatch(<that
      bo string>) returns {entry:null, matchedVia:'unmatched'} and the string is absent from both
      INDEX and SCOPED_INDEX.
Assertion (b) MUST fail if SOURCE_LANGS is swapped back to LANGS. Show that.

ACCEPTANCE: vitest green, tsc clean, corpus unmoved, key count 730/730, (b) shown failing under
revert.

DISCLOSURE: as in W1.
```

**Check on the way back:** the 730/730 count. If it changed, `bo` was resolving to something other
than the `zh` string somewhere and there is a second defect to investigate.

---

## W2 — D2: split the fallback notice from the unverified badge

Today `showVerification` defaults to `true` (`components/LocalizedText.tsx:58`) and **no call site
anywhere passes `false`** — so in `bo` mode every one of the 32 `LocalizedText` sites carries the
badge, and the badge reads 翻译未经审核.

```
Repo: /Users/likerun/Desktop/health-translator @ <commit from W0>
Read docs/superpowers/specs/2026-07-20-tibetan-support.md §1 (D2). Implement D2 ONLY.

TWO DIFFERENT MESSAGES, TWO DIFFERENT PLACES.
- FALLBACK NOTICE (resolved.usedFallback === true) means "this is not your language". It is
  identical for every string on screen, so it is SCREEN-LEVEL, not per-string. Rendering it 32x is
  the same saturation defect in a new coat. app/result/page.tsx:65-82 already hosts exactly this
  via UI_COPY.tibetanUnavailable (lib/uiCopy.ts:19-23). Any per-string affordance must be
  NON-TEXTUAL — data-resolved-lang is already emitted at components/LocalizedText.tsx:69; drive CSS
  from it, do not repeat a Chinese sentence.
- UNVERIFIED BADGE (!usedFallback && review === 'unverified') means "this IS your language and it
  may be wrong". Per-string, and it becomes meaningful the day the first bo: reviewed() lands.

CHANGES
1. components/LocalizedText.tsx:72 — resolved.review === 'unverified'
                                  -> !resolved.usedFallback && resolved.review === 'unverified'
2. components/LocalizedText.tsx:73 — the marker is currently passed the REQUESTED lang, and
   TranslationVerificationMarker re-resolves at :32. Pass resolved.resolvedLang instead, or a
   Tibetan badge on Tibetan content will itself resolve bo->zh and render in Chinese.
3. app/globals.css:93 — DELETE the font-family line from .translation-verification-marker. The
   marker already carries lang={label.resolvedLang} (LocalizedText.tsx:38), so the existing
   :lang(bo) rule (:78-84) and :lang(zh)/.zh rules (:70-73) already apply by inheritance.
   Hardcoding --font-cjk plus a bo special case is the fragile version. Preserve the
   .btn-primary .translation-verification-marker colour override at :423.

DO NOT
- Replace the badge with a differently-worded badge that still renders on all 32 strings.
- Suppress the badge on fallbacks WITHOUT surfacing a fallback notice — that removes the only
  current signal.
- Add bo: reviewed(...) to UNVERIFIED_TRANSLATION_LABEL. That is Tier-0 reviewer work (§3), out of
  scope here.
- Make the notice usedFallback-triggered AND per-string.

PRE-REGISTERED
- Badge count in bo mode goes 32 -> 0.  <-- the positive number.
- ZH and EN screens byte-identical. components/LocalizedText.test.tsx:13-38 must pass UNCHANGED.
- fallbacks still 439. Corpus numbers unmoved.
- app/result/page.test.tsx:61 currently asserts
  notice.querySelectorAll('[data-translation-review="unverified"]').length > 0 inside the
  tibetan-availability aside. That WILL go to 0 under the correct fix. UPDATE it to assert the
  fallback notice — do not delete it — and disclose the edit explicitly.

TESTS: (1) bo render of a fallback('zh') string asserts NO element with
data-translation-review="unverified" and data-resolved-lang="zh"; (2) bo render of a synthetic
bo: unverified('…') asserts the badge IS present with lang="bo"; (3) bo render of a synthetic
bo: reviewed('…') asserts no badge; (4) the two existing en/zh tests pass byte-unchanged.

ACCEPTANCE + DISCLOSURE: as in W1.
```

---

## W3 — D3: consent screen onto `LocalizedText`

> **WIRING FAILURE — PRE-REGISTER THIS OR THE TRANCHE LANDS GREEN AND DEAD.** `CaptureCard` takes
> **no props at all** (`components/CaptureCard.tsx:161`), and its only call site is
> `app/page.tsx:28`. `app/page.tsx:9` is `const [lang] = useState<Lang>('en')` — **no setter, no
> language selector on the home page.** The `EN/中文/TB` toggle exists only on the *result* page.
> The consent screen is shown *before* any report exists — i.e. before the only language control in
> the product is reachable. Passing `lang` in as things stand wires it to a constant `'en'`: the
> refactor lands, every test passes, and the Tibetan consent copy is permanently unreachable.

```
Repo: /Users/likerun/Desktop/health-translator @ <commit from W2>
Read docs/superpowers/specs/2026-07-20-tibetan-support.md §1 (D3). Implement D3 ONLY.

SCOPE IS THE CONSENT BLOCK ONLY — components/CaptureCard.tsx:528-576, six strings:
  :529 aria-label "Before we read your report" (English-only today, no ZH)
  :533-534 heading · :547-548 transfer bullet · :551-552 on-device bullet
  :564 "I agree — read my report · 我同意，读取报告" · :573 "Back · 返回"
439 -> 445 fallbacks. THIS IS THE ONE TRANCHE WHERE THE COUNT RISES. It is not a regression.

The file holds ~25 FURTHER hardcoded bilingual strings (idle form :399-455, preview :460-470,
redact :478-522, quality :583-601, extracting :611,619). DO NOT convert them. "Plumb lang through
CaptureCard" is not an invitation to convert the file.
The 12 existing bo: fallback('zh') sites in this file are FAILURE_PRESENTATION (:38-160), not
consent copy. Leave them.

REQUIRED, and this is the point of the tranche: add a language control (or persisted language) on
the HOME page so the consent screen is reachable in bo at all. A test must DRIVE it.

DO NOT
- Bump CONSENT_VERSION (lib/consent.ts:15, currently 2). This changes presentation, not disclosure
  content; a bump forces every existing user to re-consent and 403s in-flight requests via
  lib/consentGate.ts.
- Thread lang as a module-level or context default of 'en' and call it done.
- Change any of the six English or Chinese strings while in there.

PRE-REGISTERED
- fallbacks 439 -> 445.  <-- the positive number.
- Corpus numbers unmoved; chipWrong 0.

TESTS
1. Capture from HEAD BEFORE refactoring: a lock proving the en and zh renders of all six strings
   are byte-identical after. Items 5 and 6 are single JSX text nodes joined by " · " and item 1 has
   no ZH at all — the lock must cover the RENDERED output including the separator and the
   <span className="zh" lang="zh"> wrapper structure. A naive LocalizedText swap changes DOM shape
   even when the strings match.
2. lang="bo" render asserting data-requested-lang="bo" / data-resolved-lang="zh" on all six.
3. THE ANTI-WIRING-FAILURE TEST: drive the HOME PAGE language control to bo and assert the consent
   dialog reflects it. Without this the change is untestable by construction.
4. components/CaptureCard.test.tsx:163-178 (the 403 -> consent-dialog route test) passes UNMODIFIED.

ACCEPTANCE + DISCLOSURE: as in W1.
```

---

## W4 — mechanical verification layer (§5)

> **THE VACUOUS-GREEN TRAP.** The `bo` curated corpus is size **0** today. Every Class A and Class B
> check will report 0 findings and pass — while proving nothing. This is the exact wiring-failure
> shape that has bitten twice in this project.
>
> **And a naive implementation fails on every string.** `resolveText(x, 'bo')` returns the *Chinese*
> fallback text with `resolvedLang: 'zh'` (`lib/i18n.ts:88-104`). A check written as "resolve to bo,
> assert no CJK" flags all 439. The layer must select on **presence of a literal `bo` key**, not on
> resolved output.

```
Repo: /Users/likerun/Desktop/health-translator @ <commit from W3>
Read docs/superpowers/specs/2026-07-20-tibetan-support.md §5. Implement the shared extractor plus
Class A (minus A6/A10) and Class B1/B2/B4/B5/B7/B10/B12/B13. Stop there.

BUILD THE SHARED STATIC EXTRACTOR FIRST. There is no registry of LocalizedText, and most floor
strings are function-local literals inside guard bodies (lib/guard.ts, lib/notesGuard.ts,
lib/summary.ts, lib/imageQuality.ts, ...), unreachable without contriving guard inputs. Use a static
AST scan of defineText({...}) object literals. `typescript` is already a devDependency, so
ts.createSourceFile + a visitor is a zero-new-dep path. Put it in lib/localizedTextCorpus.ts —
W5's CSV exporters consume the SAME extractor. Do not write this scanner twice.

POSITIVE CONTROLS ARE MANDATORY. For each check, feed a synthetic bo string that MUST fail it, and
assert it fails. A test suite that only reports "0 findings over 0 strings" is worthless until
Tier 0 lands. Also assert the corpus size the extractor found, so a silently-empty extractor is
visible.

CLASS A (dependency-free, one test file, e.g. lib/tibetanWellFormedness.test.ts):
A1 non-empty after trim · A2 zero CJK (reuse the /[一-鿿]/u already at lib/notesGuard.ts:34)
A3 codepoint allow-set U+0F00-0FFF + ASCII digits + Latin tokens + punctuation · A4 Devanagari
bleed (one range, additive to A3) · A5 unassigned/deprecated U+0F48, U+0F6D-0F70, U+0F98; reject
precomposed U+0F77/U+0F79; NFC stability via String.normalize · A7 tsheg discipline (STANDARD_TSHEG
already exists at components/TibetanText.tsx:3) · A9 zero-width/bidi controls.
SKIP A6 — C1 subsumes it, and C1 is out of scope here.

CLASS B (e.g. lib/tibetanInvariants.test.ts): B1 number multiset with U+0F20-0F29 normalisation ·
B2 interval structure · B4 Latin token verbatim · B5 unit verbatim (vocabulary exists as
entry.allowedUnits plus the equivalence classes at data/unit-whitelist-audit.test.ts:15-50) ·
B7 clause-count vs shad · B10 placeholder integrity · B12 name collision (all 116 ZH and all 116 EN
names measured distinct, so the ZH precondition holds) · B13 source-drift lock.

EXPLICITLY OUT OF SCOPE, DO NOT STUB AS PASSING
- B3, B6, B9, B11 — they need the TIBETAN side of a locked lexicon, which is W5. Their ZH sides
  partly exist (RAW_MARKERS_ZH, data/medical-lexicon.ts:117-152, 33 markers) but the ZH comparator
  set does not exist anywhere in the repo and must be authored.
- B8 — length-ratio band; uncomputable until Tier 0 ships. If included at all, it must THROW
  "no calibration data", not pass.
- A10 and C1 — they require vendoring a pinned Noto Serif Tibetan and adding a shaper (harfbuzzjs)
  or cmap reader (fontkit). The font today is materialised only into gitignored, hash-named
  .next/static/media/*.woff2 by next/font/google (app/layout.tsx:19-24) and is not addressable from
  a test. Size separately; not this tranche.
- C2/C3 — need real layout; jsdom does not lay out and Playwright is not in package.json.

DO NOT extend SourceLang to include 'bo'. That type is load-bearing for the invariant that the
deterministic detectors never see Tibetan.
DO NOT fold lib/imperativePolarity.test.ts into this. It tests a LIVE ZH<->EN pipeline with real
detectors on both sides and an abstention consequence; this layer is static, over authored copy,
with no Tibetan-side detector. It is the evidence that polarity flips are real, not a duplicate.
lib/summary.ts:339 (bo: unverified(row.extracted.name)) is a verbatim OCR echo and must be EXCLUDED
from the corpus, or A2 flags it as a false positive.

PRE-REGISTERED: bo curated-corpus size 0 (report the measured number); all checks 0 findings; every
positive control fails as designed; corpus numbers unmoved; git diff --stat shows ZERO lines changed
in lib/reference.ts, lib/guard.ts, lib/grounding.ts, lib/summary.ts.

ACCEPTANCE + DISCLOSURE: as in W1.
```

---

## W5 — glossary extraction, reviewer packet, round-trip importer (§6)

```
Repo: /Users/likerun/Desktop/health-translator @ <commit from W4>
Read docs/superpowers/specs/2026-07-20-tibetan-support.md §6. Implement W5. Consume W4's extractor.

THREE CSVs — measured counts, two confirmed and one corrected:
- glossary-names.csv — 116 rows. CONFIRMED (REFERENCE_LABS.length === 116; 116 distinct ZH names,
  116 distinct EN; 618 Han total). Columns: key (the stable join key, already used by
  localizationBaseline.test.ts:81), zh, en, unit, one-line context from definition (NOT plain —
  plain is directional), empty bo. ADD specimen and aliases: the reviewer needs 血糖 vs urine
  glucose disambiguated.
- floor-strings.csv — 105 rows. CONFIRMED as 99 + D3's 6 consent entries. Two columns are
  load-bearing and easy to lose: SCREEN/SITE and LEAKAGE CONSTRAINT. The latter is not decoration —
  lib/guard.ts:155-168 carries an inline comment explaining that 参考资料 is used DELIBERATELY
  instead of 我们的参考范围 because the leakage gate bans implying we judged the value. That comment
  must ride along as a cell or the reviewer will reproduce the banned reading.
- glossary-terms.csv — the spec says ~35; MEASURED ~41-45, and it is an AUTHORING task, not an
  extraction. What exists: 33 ZH negation/uncertainty markers (data/medical-lexicon.ts:117-152) and
  2 DISTINCT boilerplate sentences, not 3 — CONFIRM_CLINICIAN_ZH (lib/guard.ts:23) and CONFIRM_ZH
  (lib/notesGuard.ts:21) are byte-identical '请与您的医生确认。' declared twice. The comparator set is
  0 rows and must be written by hand. REPORT THE MEASURED COMPOSITION rather than a round number.
  Dedupe those two constants into ONE glossary entry or the same sentence gets reviewed twice and
  can diverge.

EIGHT of the 105 floor strings are runtime-interpolated (lib/grounding.ts:82,84; lib/guard.ts:266,
270; lib/notesGuard.ts:742/745, 786/790, 817/821, 839/840, 852/856, 890/893). Carry them with a
stable placeholder token ({unit}, {original}); B10 checks token count and order on the way back.

THE IMPORTER — there is an existing pattern and it is deliberately weaker:
validation/review/export.ts + import.ts. Reuse csvEscape (export.ts:34-37) and the keyed-merge shape
verbatim. Two gaps make it insufficient as-is:
- applyVerdicts (import.ts:29-39) returns new in-memory objects; it never writes source. W5's
  importer must emit TypeScript — rewrite the bo: property of a SPECIFIC defineText({...}) literal
  from fallback('zh') to reviewed('…'). Do this AST-anchored on the extractor's node positions.
  NEVER a regex over the file: data/reference-labs.ts is 3,070 lines with bo: fallback('zh')
  repeated 334 times and a textual replace cannot tell them apart.
- applyVerdicts keys on id alone and silently passes unmatched rows through. The new importer must
  FAIL CLOSED and WRITE NOTHING on any rejection (all-or-nothing per CSV), with a named error per
  row, when: (a) zh_sha256 does not match current ZH source (this IS B13 source-drift);
  (b) any Class A check fails on the bo cell; (c) any Class B invariant fails against the paired ZH;
  (d) the key/site anchor is unknown or ambiguous; (e) a bo cell is non-empty but the row is not
  marked reviewed — reviewed() stays opt-in per lib/i18n.ts:18; (f) B12 — the incoming BO name
  collides with another analyte's BO name.

ACCEPTANCE for the importer is a RED-TEAM FIXTURE SET: drifted ZH hash, CJK tail in the bo cell,
dropped number, colliding name, unknown key. Every case must be REFUSED, and the file on disk
verified byte-identical afterward.

PRE-REGISTERED: 116 / measured-~41-45 (report composition) / 105 rows. Corpus numbers unmoved.

ACCEPTANCE + DISCLOSURE: as in W1.
```

---

## Measured spec correction to carry into §3

**Tier 3 is 206 distinct prose strings, not 218.** 102 authored `plain` blocks exist, but **26 of
the 116 entries have `plain` byte-identical to `definition`** — 14 via the `urineReportOnly` helper
(`data/reference-labs.ts:14-36`) plus 12 authored duplicates. Deduplicated: **206 strings, 7,324 Han
characters** (116 definitions = 2,419; 116 plains = 5,473; union 7,324). The 116-name / 618-Han
figures are exact.

This does not change the Tier-3 conclusion — 206 strings of directional clinical prose is still
weeks of qualified reviewer time — but the exporter must emit **206, not 218**, or the reviewer is
paid twice for 12 strings.
