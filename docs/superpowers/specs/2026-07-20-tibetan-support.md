# Tibetan support — the thing the product is for, and has never done

Status: **NOT STARTED.** Baseline: branch `codex/remaining-work-cycle-ready` @ `d49dec5`.
Test runner: `npx vitest run --pool=threads` (the forks pool fails under machine load).
Corpus runner: `npx tsx validation/real-corpus/run.ts`.

Measured at `d49dec5`, 2026-07-20, by grep and by reading the files named:

```
grep -r "bo: reviewed("      --include=*.ts --include=*.tsx   →   0
grep -r "bo: fallback('zh')" --include=*.ts --include=*.tsx   → 439
```

| file | `bo: fallback('zh')` sites | Han chars in that file (comments stripped) |
|---|---:|---:|
| `data/reference-labs.ts` | 334 | 9,674 |
| `lib/uiCopy.ts` | 25 | 191 |
| `lib/notesGuard.ts` | 23 | 659 |
| `lib/guard.ts` | 13 | 405 |
| `components/CaptureCard.tsx` | 12 | 416 |
| `lib/summary.ts` | 7 | 42 |
| `lib/notesSummary.ts` | 6 | 29 |
| `lib/disclaimers.ts` | 5 | 221 |
| `lib/i18n.test.ts` | 4 | — |
| `lib/imageQuality.ts` | 3 | 65 |
| `lib/notesGrounding.ts` | 2 | 65 |
| `components/LocalizedText.test.tsx` | 2 | — |
| `lib/grounding.ts` | 1 | 16 |
| `lib/crossRowChecks.ts` | 1 | 49 |
| `components/LocalizedText.tsx` | 1 | 6 |
| **total** | **439** | **11,838** |

`data/reference-labs.ts` decomposes (parsed field-by-field, not estimated):

| field | strings | Han chars |
|---|---:|---:|
| `name` | 116 | 618 |
| `definition` | 116 | 2,419 |
| `plain` | 102 | 5,210 |
| **total** | **334** | **8,247** |

**Every Tibetan-mode string in this product resolves to Chinese.** The product exists so that a
Tibetan-speaking patient can read a Chinese lab report. In Tibetan mode it shows them the Chinese
lab report.

---

## 0. What a Tibetan user sees today. Read this before anything else in the document.

Tap བོད་ཡིག. `app/result/page.tsx:65-82` renders:

1. A notice reading **藏语暂不可用；目前显示中文内容。** — "Tibetan is not yet available; Chinese
   content is shown for now" — **in Chinese** (`lib/uiCopy.ts:19-23`, `bo: fallback('zh')`).
2. Beside it, a "Tibetan typography probe": `TIBETAN_TYPOGRAPHY_SAMPLE`
   (`components/TibetanText.tsx:8-17`) — three hand-built stacked-consonant code-point fixtures
   joined by tsheg. Deliberately non-linguistic. **The only Tibetan script a Tibetan user has ever
   seen in this product is three meaningless glyph clusters.**
3. Every card below: Chinese text, each carrying an "unverified translation" badge that itself
   reads **翻译未经审核** — in Chinese (`components/LocalizedText.tsx:13-17`).
4. The disclaimers at the bottom: Chinese (`lib/disclaimers.ts`, all five).
5. Before any of that, the consent screen (`components/CaptureCard.tsx:528-576`): hardcoded
   English + Chinese JSX. Not `LocalizedText`. There is no `bo` path to take.

So the state is not "Tibetan is degraded". It is: **the app tells the Tibetan user, in Chinese,
that it cannot speak Tibetan, and then asks them to consent — in Chinese — to sending a photograph
of their medical record to a US company.**

The engineering that has landed since April hardened the Chinese and English paths. That work was
correct and none of it is wasted. But the honest summary is that the product's core promise has
never been tested against a single reviewed Tibetan string, and none of the recent cycles moved it.

---

## 1. Four live defects, found while measuring. All four are pre-conditions.

None of these is blocked on a reviewer. All four must land **before the first `bo: reviewed()`
string exists anywhere in the repo**, because each one is a way for the first Tibetan string to do
harm on arrival.

### D1 — `bo` names are OCR **matching keys**, not display text. `lib/reference.ts:13-22`

```ts
const localizedNames = LANGS.map((lang) => resolveText(e.name, lang).text);
for (const token of [e.key, ...localizedNames, ...e.aliases]) m.set(normName(token), e);
```

`LANGS` is `['en','zh','bo']` (`lib/i18n.ts:1`). Today `bo` resolves through the fallback to the
`zh` string, so it writes a harmless duplicate key. **The moment a Tibetan `name` lands, that
Tibetan string becomes a live lookup token.** An OCR'd row name matching it selects the reference
entry and with it `refLow/refHigh/criticalLow/criticalHigh`, the classification, and the "Typical
range" chip.

This is the same class as the cross-specimen aliasing near-miss the repo has already fixed twice
(`GLU` specimen scoping, `RBC`→`rbc_count`), except the token would arrive through the *translation*
door rather than the alias door, where no alias review would ever look at it.

**Fix:** index only source languages. Build the name index from `SourceLang` (`lib/i18n.ts:10`,
already exists and already means exactly this), i.e. `['en','zh']`. Add a test that asserts a
Tibetan `name` string, if present, is **not** a key in `INDEX` or `SCOPED_INDEX`.

Do **NOT** "fix" this by gating on `review === 'reviewed'`. A reviewed Tibetan display name is still
not a validated OCR token — the reviewer is checking that the word means the analyte, not that no
other analyte's printed Chinese name normalises onto it.

### D2 — the unverified marker is saturated, and renders in Chinese. `components/LocalizedText.tsx:13-17, 61-73`

`UNVERIFIED_TRANSLATION_LABEL` has `bo: fallback('zh')`. `resolveText` fails closed
(`lib/i18n.ts:96`): any fallback resolution is `unverified`. Therefore **in `bo` mode every string
on screen already carries the badge, and the badge reads 翻译未经审核**.

Two consequences, both load-bearing for the rest of this plan:

- The marker currently carries **zero discriminative information**. It is on everything. Adding
  Tibetan content under the same badge would be visually indistinguishable from the Chinese
  fallback: the user cannot tell "this is a language I can't read" from "this is my language and it
  may be wrong."
- The warning about unreadability is itself unreadable. Same inversion already on file for
  disclaimers.

**Fix (engineering, no reviewer):** `LocalizedText` already computes `resolved.usedFallback` and
`resolved.resolvedLang`. Render **two distinct states**, not one:
- `usedFallback === true` → a *language-substitution* notice ("shown in Chinese"), keyed off
  `resolvedLang`.
- `usedFallback === false && review === 'unverified'` → the existing unverified-translation badge.

Also: `.translation-verification-marker` hardcodes `font-family: var(--font-cjk)`
(`app/globals.css:93`). It must use `--font-tibetan` when its own `resolvedLang` is `bo`, or the
first reviewed Tibetan badge renders in a CJK font with no Tibetan coverage.

### D3 — the consent screen has no localization plumbing at all. `components/CaptureCard.tsx:528-576`

It is hardcoded bilingual JSX (`Before we read your report` + `<span className="zh">`). It is not
falling back to Chinese; there is no `bo` branch to take. The 12 `fallback('zh')` sites in that file
are the *failure-presentation* messages (`FAILURE_PRESENTATION`), not the consent copy.

**Fix (engineering, no reviewer):** extract the consent heading, the two data bullets, the agree
button, and the back button into `defineText` entries in `lib/uiCopy.ts` (or a new
`lib/consentCopy.ts`), plumb `lang` into `CaptureCard`, and render through `LocalizedText`. This is
a mechanical refactor that must land with the ZH and EN strings **byte-identical** to today's JSX,
verified by a snapshot.

### D4 — `localizationBaseline.test.ts` does not lock `bo`, and the disclaimers have no `bo` audit

The received belief that "adding Tibetan breaks the SHA-256 baseline by design" is **false**.
`lib/localizationBaseline.test.ts:78,89,99,107,115` — `referenceText()` and `disclaimerText()` take
`SourceLang`, every assertion is `it.each(['en','zh'] as const)`, and both baselines are `{en, zh}`.
**A `bo: reviewed(...)` added anywhere today leaves every hash unchanged and every test green.**

The tripwires that *do* exist are narrower than the safety floor. `validation/silentAssertion.test.ts`
(`:74, :183, :256, :261, :285`) and `validation/b1VerdictLeakage.test.ts` (`:152, :320, :436`) walk
only summary-surfaced copy — `section.chip`, `section.flags`, and the card/glossary copies — and
several assert `bo` text is byte-equal to `zh`
(`expect(bo, '... bo must show the exact tested Chinese disclosure').toBe(zh)`).

**`lib/disclaimers.ts` is reached by neither.** The five most authoritative, most safety-critical
strings in the product — the exact target of the recorded authority-inversion finding — would accept
a direct `bo: reviewed()` with no test failing.

**Fix (engineering, no reviewer):**
1. Extend the direct-`bo` audit to enumerate `DISCLAIMER_TEXTS`, every `UI_COPY` key, the new
   consent copy, and every `REFERENCE_LABS` `name`/`definition`/`plain` field. Any direct `bo` entry
   must be an explicit, named opt-in in a list the test reads — never silently accepted.
2. Add `bo` to `REFERENCE_BASELINE` and `DISCLAIMER_BASELINE`. This is the source-drift lock: a ZH
   edit must invalidate the Tibetan review of that string, because the Tibetan was reviewed against
   the old Chinese.

**Positive finding, verified, no action needed:** `app/layout.tsx:2,19-24` loads Noto Serif Tibetan
via `next/font/google` with `subsets:['tibetan']`, which self-hosts at build time. The font ships
from our own origin, not Google's CDN — so it renders behind the GFW. `app/globals.css:76-84`
already declares LTR, `--font-tibetan`, and disables `word-break`, and `TibetanText` already inserts
`<wbr>` after each tsheg. **The rendering substrate is correct and is not a blocker.**

---

## 2. The split that has been missing: blocked vs not blocked

The recorded blocker — "a reviewer who is Tibetan-literate AND Chinese-literate AND medically
literate has not been recruited" — has been treated as one indivisible gate on all 439 strings for
months. It is not one gate. It is three different gates on three different sets, and **the largest
body of work in this plan is blocked on nobody.**

| work | blocked on a reviewer? |
|---|---|
| D1 — stop indexing `bo` names as OCR keys | **no** |
| D2 — split fallback-notice from unverified-badge; Tibetan badge font | **no** |
| D3 — consent-screen `LocalizedText` refactor | **no** |
| D4 — direct-`bo` audit + `bo` baseline hashes | **no** |
| Mechanical verification layer (§5, Classes A/B/C) | **no** |
| Glossary extraction + term-consistency tooling (§6) | **no** |
| Reviewer packet: the 116-name sheet, the ~200-sentence sheet (§6, §7) | **no** |
| Deciding *what* the Tibetan words are | **yes, absolutely, and no machine substitutes** |

Everything in the "no" column should start now. It is roughly a week of engineering, it makes the
reviewer's hour worth several times more when they arrive, and none of it can be done *after* the
reviewer without wasting their time.

---

## 3. The 439, tiered by value-per-string

Tiering by file is the wrong cut. These are the tiers.

### Tier 0 — 2 strings. ~20 Han characters. Ships this week.

`UI_COPY.tibetanUnavailable` (`lib/uiCopy.ts:19`) and `UNVERIFIED_TRANSLATION_LABEL`
(`components/LocalizedText.tsx:13`).

**What it buys:** the two strings whose *entire job* is to tell a Tibetan user what the product
cannot do are currently the two strings that user cannot read. Reviewing them requires a Tibetan
speaker with **no medical knowledge and no Chinese** — the English source is sufficient and
unambiguous ("Tibetan is not yet available; Chinese content is shown for now" / "Unverified
translation").

**The screen:** user taps བོད་ཡིག. One Tibetan sentence at the top: *Tibetan is not yet available;
the content below is in Chinese.* Every card below is Chinese, each with a small Tibetan badge.
Nothing else changes.

**Why better than today:** the user learns, in their own language, exactly what they are looking at
and why. That is strictly more than they get now, and it costs one email to one Tibetan speaker.
There is no coherent reason this has not shipped.

Also in Tier 0, and free: delete the `TIBETAN_TYPOGRAPHY_SAMPLE` probe from the user-facing result
page (`app/result/page.tsx:70-80`). It is test plumbing that ships to production. Keep the fixture in
`components/TibetanText.tsx` for the shaping tests; stop rendering meaningless glyphs to a patient.

### Tier 1 — the safety-and-usability floor. **99 strings, not 55.**

The floor as previously scoped (disclaimers 5 + uiCopy 25 + guard 13 + CaptureCard 12 = 55) **omits
34 strings that are the same kind of text**: `lib/notesGuard.ts` 23, `lib/notesSummary.ts` 6,
`lib/notesGrounding.ts` 2, plus `lib/summary.ts` 7, `lib/imageQuality.ts` 3, `lib/grounding.ts` 1,
`lib/crossRowChecks.ts` 1. Those are guard messages, abstention notices, and image-quality
instructions — every one of them is limiting text.

The complete non-content surface is exactly `439 − 334 (reference-labs) − 6 (tests) = 99` strings,
≈ 3,300 Han characters ≈ 2,100–2,400 translated words. Plus ~6 new consent strings from D3.

Sub-tiers, in the order a reviewer should work them:

| sub-tier | strings | Han | contents |
|---|---:|---:|---|
| **T1a — authority** | ~28 | ~480 | 5 disclaimers, the 6 consent strings, `qualitativeHint`, `decimalHint`, `reportRange`, `typicalRange`, `keptExactly`, `source`, Tier-0's 2 |
| **T1b — abstention** | ~25 | ~530 | `lib/guard.ts` 13, `lib/summary.ts` 7, `lib/imageQuality.ts` 3, `lib/grounding.ts` 1, `lib/crossRowChecks.ts` 1 |
| **T1c — notes mode** | 31 | ~750 | `lib/notesGuard.ts` 23, `lib/notesSummary.ts` 6, `lib/notesGrounding.ts` 2 |
| **T1d — chrome** | ~20 | ~190 | the remaining `UI_COPY` (Saved, Delete, Language, Lab report…) and the 12 `CaptureCard` failure messages |

**What it buys:** this is the configuration the project's own stated principle demands — **the
limiting text is the most legible on screen and the ungrounded text the least.** It is the exact
inverse of the failure mode already recorded as unsafe (fluent Tibetan advice above a Chinese
disclaimer).

**The screen:** the disclaimer block at the bottom of the summary is Tibetan prose. The consent
screen before the photo is sent is Tibetan. When a row abstains, the flag beneath it — *this test is
not in our reference set, so we are not interpreting it; confirm with your clinician* — is Tibetan.
The row names, values, chips, definitions and glossary are Chinese, each badged. The two range
labels are Tibetan so the user can tell *their report's* number from *our* band.

T1a and T1b genuinely require medical literacy: `lib/guard.ts:163` is worded under a leakage
constraint (it says 参考资料, deliberately not 我们的参考范围, because the latter implies a judgement we
did not make), and a translator with no access to that constraint will happily produce the banned
reading. T1d requires none — a Tibetan speaker can check "Delete" in seconds.

### Tier 2 — the 116 analyte names. 618 Han characters. Only after Tier 1 and only after D1.

**What it buys:** the first real comprehension value. A Tibetan reader can scan the report and find
the row the doctor mentioned. 116 short noun phrases = **26% of the whole app's localized surface
from 116 human decisions**, and every one of them is a glossary entry that propagates.

**The review is bounded and does not require a clinician** — a flat sheet of 116 noun phrases,
reviewable in one sitting by someone Tibetan-and-Chinese-literate with a medical glossary at hand.
That is a categorically easier recruit than the one that has been failing for months.

**Shipped before Tier 1, it is worse than today**: the user gets a Tibetan-labelled,
Chinese-explained, Chinese-disclaimed screen — legible enough to feel understood, with every
limiting statement still unreadable. That is the recorded inversion, executed at the row heading
instead of the summary. **Do not ship Tier 2 first because it is 116 strings and looks like
progress.**

### Tier 3 — 218 reference prose strings (116 `definition` + 102 `plain`). 7,629 Han. **Does not ship this year.**

`plain` is explicitly *directional* text ("low values indicate anemia" — the `plain`/`definition`
split at `lib/summary.ts:275` exists because the directional copy is glossary-only). Directional
clinical prose is where a polarity flip is simultaneously most likely and least detectable, and it is
~6,000 translated words of it. At two independent reviewers plus adjudication this is weeks of
qualified reviewer time and a four-to-six-figure budget.

Machine-translating this category first is the single worst available decision: it maximises
apparent fluency, maximises ungrounded clinical content, and does nothing for the safety layer.

**Honest conclusion: Tier 3 cannot ship in 2026.** Say so in the roadmap, keep `fallback('zh')`, and
route it through the co-authorship path in §7 as a 2027 item.

---

## 4. ZH→BO machine translation: NOT good enough for ANY tier. Do not design around it.

Stated plainly so no future cycle re-litigates it.

**The decision-relevant number:** the only published multi-domain Tibetan MT evaluation carrying a
医疗健康 (medical/health) test set scores **9.42 d-BLEU / 9.88 s-BLEU / 0.726 d-COMET** on the
*easier* direction (bo→zh), from a model scoring **61.5 d-BLEU on in-domain news**. Domain transfer
into health costs ~85% of quality. (CCL 2025, 藏汉篇章机器翻译研究及语料库构建.)

**The direction this product needs has no health evaluation at all.** zh→bo is reported in-domain
(news) only, at 52.5 BLEU, and **BLEU-only** — the authors state they cannot report COMET because
`wmt22-comet-da` does not cover Tibetan as a target. Tibetan BLEU is itself contested: there is no
standard tokenizer, because Tibetan has no word spaces and segmentation is dictionary-driven.

**Frontier LLMs are worse than intuition suggests.** On TLUE / Ti-MMLU (11,528 human-validated
questions), most frontier models score at or below the 25% random baseline: Claude-3.5-Sonnet 35.6%,
DeepSeek-V3 32.2%, GPT-4o 17.5%, Qwen2.5-72B 16.5%. The same-model drop from Chinese is the story:
Qwen2.5-72B goes 84.7% (CMMLU) → 16.5% (Ti-MMLU). On safety specifically, GPT-4 scores 89.2% on
Chinese SafetyBench and **32.9%** on Tibetan — below the 36.7% random baseline. Safety alignment does
not transfer to Tibetan. And the hypothesis that Chinese-trained models would do better because of
domestic corpora and policy incentives is **not supported** — Qwen is the worst model tested.

**The architectural reason this settles it, independent of the numbers:** the project's rule is "the
LLM proposes, a deterministic guard verifies." For ZH→BO you cannot build the verifier. There is no
COMET for Tibetan and no reliable BLEU. You would be shipping an output path with no source to verify
against *and* no metric to measure the gap — the precise thing this project refuses.

**Two traps to name explicitly:**

1. **Back-translation is not a gate.** Round-trip agreement is evidence about the composition
   `f⁻¹∘f`, not about `f`; `f⁻¹∘f ≈ id` is satisfied by an unbounded family of wrong `f`. Using a
   *different* model for the reverse leg does not restore independence — the accessible Tibetan
   corpus is small and heavily overlapping (Wikipedia, the Buddhist canon, government/news bitext,
   NLLB's `bod_Tibt`), so models are re-encodings of the same handful of corpora, none of which
   contains clinical Chinese–Tibetan register.
2. **Multi-model agreement is anti-correlated with correctness where it matters.** Agreement tracks
   corpus frequency. The terms carrying the clinical risk (阴性/阳性, 危急值, 恶性, negation, comparator
   direction) are exactly where the Tibetan corpus is thinnest and all models extrapolate from the
   same thin prior. A consensus gate looks *most* reassuring precisely where every model is guessing
   identically.

**One legitimate use, and it is the inverse of the tempting one:** N-model *disagreement* is a useful
**triage ranking** to order strings for the human reviewer's attention. Agreement is never a pass
condition. **A guard-passing `bo` string is `unverified()`, never `reviewed()`. No exceptions.**

**A corpus trap worth naming:** every "Tibetan medical corpus" that turns up is **Sowa Rigpa** —
traditional Tibetan medicine (the Four Medical Tantras, rlung/tripa/béken, pulse and urine
diagnosis). TIB-STC's "medicine" domain is almost certainly this. A model grounded in it will render
"creatinine" or "reference interval" by analogy to a traditional concept, fluently, with a
scholarly-looking corpus behind it. **Do not treat a Tibetan medical corpus hit as evidence of
biomedical coverage.** This applies equally to human reviewers sourced from Sowa Rigpa institutions.

---

## 5. The mechanical verification layer — build this now, it needs zero Tibetan competence

This is the part that ships immediately and shrinks the reviewer's residual. It is a
**well-formedness and invariant-preservation guard, not a translation-correctness guard.** It changes
the failure distribution; it does not reduce the trust requirement.

The architectural framing: `lib/notesGuard.ts` works because `detectImmutables(text, lang)` runs
independent detectors over the ZH source and the EN output and demands they agree — two detectors and
a diff. For ZH→BO there is a detector on the Chinese side and **nothing on the Tibetan side**.
Everything below is an answer to "what substitutes for the missing second detector?", and the honest
answer is: **a human-reviewed glossary, and nothing else. The glossary IS the Tibetan-side detector.**
Guard strength is bounded above by glossary coverage — which is measurable (% of `bo` output
codepoints covered by glossary entries) and therefore a shippable prioritisation metric.

### Class A — script well-formedness (Unicode only)

| # | check |
|---|---|
| A1 | Non-empty after trim |
| A2 | **Zero CJK**: no `[一-鿿㐀-䶿]` in a `bo` string. Catches the most likely LLM failure on long strings — a partial translation with a Chinese tail |
| A3 | Every non-ASCII codepoint in U+0F00–U+0FFF, plus an explicit allow-set: ASCII digits, Latin analyte tokens, whitelisted punctuation |
| A4 | No Devanagari / Sanskrit-transliteration bleed (a documented Tibetan-model artefact) |
| A5 | No unassigned/deprecated codepoints (U+0F48, U+0F6D–0F70, U+0F98); reject precomposed U+0F77/U+0F79 in favour of decomposed forms; assert NFC stability |
| A6 | Combining-mark well-formedness: subjoined consonants (U+0F90–0FBC) must follow a head consonant (U+0F40–0F6C); vowel signs (U+0F71–0F84) must attach to a consonant |
| A7 | Tsheg discipline: ≥1 tsheg in a multi-syllable string; no doubled U+0F0B; no leading tsheg |
| A8 | Shad parity: count of U+0F0D/0F0E matches the source's sentence-terminator count (。；) |
| A9 | No zero-width or bidi controls (U+200B–200F, U+202A–202E). Tibetan is **LTR**; a stray RLM is silent rendering corruption |
| A10 | **Font-cmap coverage**: every codepoint present in the shipped Noto Serif Tibetan subset. Build-time. Prevents shipping tofu to a user who cannot tell tofu from a word they don't know |

### Class B — source→output invariant preservation (the `notesGuard` idiom, ported)

| # | check | live example in this corpus |
|---|---|---|
| B1 | **Number multiset equality**, source vs output, with Tibetan-digit (U+0F20–0F29) normalisation; enforce ASCII digits only | `随机值达到11.1及以上`, `未服抗凝药者约为0.8-1.2` |
| B2 | Interval structure: count and order of `n–m` expressions preserved | `0.8-1.2`, `2-3个月` |
| B3 | **Comparator direction**: 低于/高于/超过/达到/以上/以下 counted and mapped through a *locked* Tibetan comparator lexicon. Direction inversion is the highest-value catchable failure and needs only the glossary, not fluency | hs-CRP, BNP, INR, homocysteine |
| B4 | Latin token verbatim preservation — analyte abbreviations must never be transliterated | `TSH`, `T3`, `T4`, `B12`, `INR`, `HbA1c` |
| B5 | Unit verbatim preservation (units already whitelisted in `data/unit-conversions.ts`) | every entry |
| B6 | **Negation parity**: source negators (不/无/未/非/否) counted against a locked Tibetan negator set | disclaimers, guard messages |
| B7 | Clause-count parity: source `。；：` clauses vs output shad count. A dropped subordinate clause is silent information loss | |
| B8 | Length-ratio band, **calibrated empirically on the reviewed Tier-0/1 seed set, never guessed** | |
| B9 | **No-added-claim**: the output may contain no locked glossary term whose ZH counterpart is absent from the source. The mechanical form of "no added clinical claim". **The single most valuable check here** | |
| B10 | Placeholder integrity: count-exact, order-preserved | `lib/grounding.ts` — `` `我们已将 ${converted.from} 换算为 ${converted.to}…` `` |
| B11 | **Cross-string term consistency**: the same ZH term receives the same BO rendering at all sites. This is what makes one glossary decision propagate | |
| B12 | **Name-collision**: all 116 ZH analyte names are distinct. Enforce distinctness in BO. `总T3` collapsing onto `游离T3` is trivially checkable and clinically catastrophic | |
| B13 | **Source-drift lock**: hash each ZH string alongside its BO translation; a ZH edit invalidates the BO review. Implemented as D4's `bo` baseline | |

### Class C — rendering (needs a shaper, not a reader)

| # | check |
|---|---|
| C1 | **HarfBuzz shaping against the shipped font: assert zero `.notdef` and zero inserted dotted-circle (U+25CC).** Dotted circle is HarfBuzz's own signal for an invalid combining sequence — a stronger and more trustworthy oracle than hand-rolled A6 |
| C2 | Headless layout: line breaks land only at tsheg/space boundaries at the app's narrow-viewport widths (exercises `TibetanText`'s `<wbr>`) |
| C3 | No clipping/overflow at 320px for every `bo` string |

**Build C1 first.** It is the only check in the whole list that is an *oracle* rather than a
heuristic.

### What the layer does and does not buy

**Protects against:** tofu and unrenderable stacks; half-translated strings with Chinese left in;
dropped/added/altered numbers, intervals, units and Latin analyte tokens; dropped clauses; inverted
comparators and negations drawn from the locked set; added glossary-term claims; term drift across
sites; analyte-name collisions; silent staleness when a ZH source string changes; broken line
breaking; overflow. That is a real list and most of it is genuinely likely.

**Does not protect against:** a fluent, well-formed, number-preserving, unit-preserving Tibetan
sentence that means something clinically different. That is the failure Khoong et al. (2019, *JAMA
Intern Med*) measured on machine-translated ED discharge instructions — meaning-altering errors at
~8% (Spanish) and ~19% (Chinese), a fraction judged potentially clinically harmful. No amount of
Class A/B/C machinery touches it.

**Therefore the layer's role is not to license shipping. It is to make the reviewer's hour worth
more:** reject mechanically broken candidates before a human sees them; propagate glossary decisions
across all sites so a term is reviewed once, not re-read 340 times; rank the residual by model
disagreement.

---

## 6. The glossary — the artifact that converts an unrecruitable ask into a recruitable one

**~150 entries: 116 analyte names + ~35 recurring clinical terms, comparators, negators and
boilerplate sentences.** That set mechanically locks 26% of the app outright (names are 35% of the
reference strings but only 7.8% of their character volume) and *constrains* every remaining string
via B3/B6/B9/B11.

The floor is even more favourable than the reference table because it is already partly
constant-factored: `lib/notesGuard.ts:20-23` hoists `CONFIRM_ZH` / `SHOWN_AS_WRITTEN_ZH`;
`lib/guard.ts:326,344` concatenates `CONFIRM_CLINICIAN_ZH` onto message bodies. Those recurring
sentences are glossary entries at *sentence* granularity.

**Implementation note that matters:** `CONFIRM_CLINICIAN_ZH` is concatenated as a suffix. Tibetan
must receive it as a **composed unit**, not a suffix — Tibetan clause juncture does not survive
naive concatenation. Restructure those call sites to select a whole composed `LocalizedText` before
any Tibetan lands.

**The reviewer packet to build now (no reviewer needed to build it):**
1. `glossary-names.csv` — 116 rows: `key, zh, en, unit, one-line context, [bo]`.
2. `glossary-terms.csv` — ~35 rows: recurring clinical nouns, the comparator set, the negator set,
   the boilerplate sentences.
3. `floor-strings.csv` — the 99 + 6 Tier-1 strings with `zh`, `en`, the screen it appears on, and a
   note on any leakage constraint that governs its wording (e.g. R1's 参考资料 rule).
4. A round-trip importer that writes reviewed rows back into `defineText` blocks and runs Classes
   A/B/C, so the reviewer never edits TypeScript.

**On sourcing the glossary from published work — the highest-leverage unverified lead in this
document.** 《汉藏英对照现代医学词汇》 (Chinese–Tibetan–English Modern Medical Vocabulary), 民族出版社, 2019,
reportedly **42,000+ standardised Tibetan renderings of modern biomedical terms**, seven years of
compilation, compiled by 青海大学藏医学院 leading 西藏藏医药大学, 西藏自治区藏医院, 青海藏医药研究所 and others, with
clinical medicine as the primary term base. There is also 《汉藏英科技大词典》 (民族出版社, Dec 2022, ~101,000
entries across 23 disciplines including medicine), and the standards body
**全国藏语新词术语标准化工作委员会**, whose secretariat sits at 中国藏学研究中心.

If that dictionary contains clinical-chemistry analyte names, **it changes the shape of the whole
project**: the reviewer's job drops from *translate* to *select and confirm against a published
state-blessed standard*, and — architecturally — the glossary stops being an ungrounded output path
and becomes a **cited source the deterministic guard verifies against**, exactly like
`data/reference-labs.ts` is for bands.

**This claim is UNVERIFIED.** It comes from search-index summaries; the primary pages did not fetch
(self-signed cert on one, `.gov.cn` firewalling on others). ISBN not obtained. **Whether it covers
lab analytes (GLU, ALT, CREA, HGB) is not confirmed and is the single most valuable thing to check.**
It costs one book purchase. **Do that before spending anything else.**

---

## 7. Recruiting — concrete, and the floor is a sub-$1,200 problem

### The cost measurement that reframes it

| | **Tier 0** | **Tier 1 floor** (99+6 strings, ~3,300 Han ≈ 2,100–2,400 words) | **Tier 3 depth** (218 strings, 7,629 Han ≈ ~5,000–6,000 words) |
|---|---|---|---|
| rate (rare-pair medical, $0.25–$0.40/word) + patient-safety premium (+75–150%) + 2 reviewers & adjudication (~2.5×) | ~$0 (a favour) | **≈ $1,500–$4,500** | **≈ $3,000–$12,000** |
| reviewer time | minutes | **2–4 working days** | 3–8 weeks |
| wall-clock | days | **3–8 weeks, dominated by recruiting, not translating** | 3–6 months |

Costs are derived from published rare-language medical translation rates and are **estimates, not
quotes**. Turnaround is derated from standard 2,000–2,500 word/day throughput and is **not sourced**.

The point stands regardless of the exact figure: the safety floor has never been a
translation-capacity problem. It has been a *finding-one-person* problem, and it was scoped as if it
were the same job as the 6,000-word content corpus. It is not.

### Named channels, best first

**Tier 1 (highest fit)**

1. **青海大学藏医学院 (Qinghai University Tibetan Medical College), Xining** — led the 42,000-term
   dictionary. Highest-fit institution for this task. Named route: **Dr. Kunchok Gyaltsen**,
   Professor there, Executive Director of Kumbum Tibetan Medical Hospital, UCLA PhD in Public Health,
   who ran the Tibetan Birth and Training Center delivering Tibetan-language health education to
   nomadic populations. He has an established UCLA collaboration — an academic-to-academic
   introduction via UCLA Fielding is a real route. (His UVA Tibet Center page is dead; use UCLA
   Fielding or his published-paper corresponding addresses.)
2. **西藏藏医药大学 (Tibetan Medical University), Lhasa** — dictionary co-compiler.
3. **全国藏语新词术语标准化工作委员会 / 中国藏学研究中心** — for *term ratification* rather than person-hours.
   Their imprimatur is the closest thing to an authoritative source-of-truth the guard architecture
   could point at.
4. **The Tibetan NPRS/GRoC validation team** (Liu, Chen, Tian, Tang, Shuai, Lin, Luo, Xu, An; *Sci
   Rep* 2024, PMID 38796571, DOI 10.1038/s41598-024-62777-7) — a working Chinese hospital group that
   has already solved this exact recruiting problem: forward/back translation, expert panel, pilot
   with 100 Tibetan patients. **Currency here is co-authorship, not cash.** Their stated difficulty
   is a direct warning: *"translation discrepancies from translators' diverse backgrounds and levels
   of expertise"* — one reviewer produces inconsistency; you need ≥2 plus an adjudicator.

**Tier 2 (diaspora, outside PRC jurisdiction — see the §8 policy item before using)**

5. **Men-Tsee-Khang Translation Department**, Dharamsala (`info@mentseekhang.org`). Caveat: a *Sowa
   Rigpa* translation shop (classical texts → English). Register mismatch, and they read
   Tibetan+English, not necessarily Chinese.
6. **Central Tibetan Administration Department of Health** (`tibetanhealth.org`) — a functioning
   Tibetan health-communication unit with plain-language experience (translated COVID awareness
   materials into Tibetan in 2020). The closest existing analogue to the register this product needs.

**Struck off, recorded so they are not re-attempted:** 84000 and Lotsawa House (Buddhist canon,
Tibetan→English, no Chinese, no biomedicine). US/EU Tibetan Studies departments (classical literary
Tibetan for Buddhist literature — useful only as a referral network to native-speaker grad students
from Amdo/Kham). Commercial LSPs advertising Tibetan medical translation (fast and buyable, and the
wrong instrument: you get a vendor's word, not a named accountable reviewer, and a vendor attestation
cannot stand behind `reviewed()`). CCHI holds no tested Tibetan credential.

### What the ask says

Not "translate our medical app." That is unrecruitable, and it is why this has stalled for months.

For Tier 0: *"Two sentences. One tells a Tibetan speaker that Tibetan isn't ready yet; the other is a
two-word badge meaning 'unverified translation.' English source is enough. Twenty minutes."*

For Tier 1: *"About 105 short strings — roughly 2,200 words — that are entirely safety and interface
copy: what the app does and doesn't do, the consent screen, and the messages we show when we decline
to interpret a result. No clinical content. Tooling guarantees you never see the same term twice and
checks every number, unit, and abbreviation is preserved. Two to four days. Paid."*

For Tier 2: *"116 analyte names as a flat glossary sheet, against a published Chinese–Tibetan medical
dictionary. One sitting."*

For Tier 3: **do not send a procurement ask at all.** Frame it as *"co-author the validation paper
for the first Tibetan-language lab-report comprehension tool,"* using the Sci Rep 2024 NPRS-Tib study
as the methodological template. This is what actually worked everywhere else: the Diné/Navajo COVID
education materials (Traditional Knowledge Holders → consensus panel of Navajo Nation Community
Health Representatives and Diné public health students, cost absorbed into a funded research
project); the Quechua instrument validations in Peru (translate → back-translate → expert committee →
comprehension focus group → pilot, recruited via community health workers). **Nobody bought this.
Everybody co-authored it or embedded it in a funded health program.**

---

## 8. POLICY — requires the owner's judgement. Engineering must not decide these silently.

### P1 — Does Mode 2 (doctor's notes) ship in Tibetan mode at all?

`lib/notesGuard.ts` (23 strings, 659 Han) + `lib/notesSummary.ts` (6) + `lib/notesGrounding.ts` (2) =
31 strings, ~32% of the entire floor by character count, and it is the *free-text* path — the one
where the LLM's output is longest and least templated.

**Recommendation: disable Mode 2 in `bo` until T1c is reviewed.** A Tibetan disclaimer above a
Chinese notes summary is the authority inversion again, one screen down. Disabling is honest, cheap,
reversible, and shrinks the Tier-1 reviewer ask from ~105 strings to ~74 — which materially improves
the odds of getting a first reviewer to say yes. If you disagree, the alternative is to keep Mode 2
Chinese-only *and label it as such in Tibetan*, which costs one more T1a string.

### P2 — Attribution of a mainland-based reviewer

China's revised Law on the Standard Spoken and Written Chinese Language passed 27 Dec 2025 and took
force 1 Jan 2026, strengthening Putonghua and standardised characters across education, public
services and cyberspace; a further ethnic-minority law prioritising Mandarin passed March 2026.
(Secondary sources; **not primary-verified in this repo** — same caveat class as the WHOOP/FDA
reasoning in the 2026-07-19 cycle.)

**Recommendation:** default to **institution-level or pseudonymous attribution** ("reviewed by
青海大学藏医学院"), with named attribution strictly opt-in and consented *for the specific venue*. Do not
put a mainland-based reviewer's name in a public repo, changelog, or credits without asking where
they are comfortable appearing. Attribution that is a career asset in a Western open-source project
is not the same object here.

### P3 — Never ship Tibetan-only. Tibetan is additive to Chinese.

**Recommendation: adopt as a hard product invariant, enforced by test.** Bilingual
Tibetan-alongside-Chinese is simultaneously the safe design (the recorded authority-inversion
finding), the guard-architecture-compatible design (the Chinese source stays on screen as the thing
the Tibetan is verifiable against), and the regulatorily defensible one. `resolvePrimarySecondary`
(`lib/i18n.ts:113`) already exists; `LANGUAGE_CONFIG.bo.secondary` is already `'en'` — **that should
probably be `'zh'`**, and it is a decision, not an oversight to be silently patched.

### P4 — Diaspora vs mainland reviewers

**Recommendation: prefer PRC-based institutional reviewers for mainland-shipped clinical strings.**
Diaspora review (Men-Tsee-Khang, CTA Dept. of Health) is far easier to contract and uses a different
orthographic and terminological register. Sourcing mainland patient-facing medical content from
Dharamsala creates risk for the mainland users the product exists to serve. If diaspora reviewers are
used, use them for the *English* side or for pilot comprehension testing — not as the attributed
source of mainland-shipped clinical strings.

### P5 — Dialect and register

Ü-Tsang literary vs Amdo vs Kham. A string can pass every check in §5 and be unreadable to the target
population. **Recommendation: state the target register explicitly in the reviewer brief** (written
standard Tibetan as used in PRC health education materials, i.e. the register of the CTA/PRC public
health pamphlet corpus), and record the choice in this spec. Do not leave it to the reviewer to
infer.

### P6 — Neologism vs loanword vs Chinese transliteration for analytes with no established Tibetan term

Mechanically undecidable. **Recommendation: adopt the published standard's rendering wherever
《汉藏英对照现代医学词汇》 has one, and where it does not, prefer the Chinese-term-plus-Tibetan-gloss form
over an invented neologism** — the user is reading a Chinese report and needs the Chinese token to
remain findable on the page. Record every such decision in the glossary with a reason.

---

## 9. Order of work, and pre-registered numbers

| # | item | blocked? | pre-registered |
|---|---|---|---|
| **W0** | D1 — index only `SourceLang` names in `lib/reference.ts` | no | `bo:reviewed` 0, fallbacks 439, corpus numbers **unchanged**, tests +2 |
| **W1** | D4 — direct-`bo` audit over `DISCLAIMER_TEXTS` / `UI_COPY` / consent / all `REFERENCE_LABS` fields; `bo` added to both baseline hashes | no | fallbacks 439; **new `bo` baselines recorded**; all existing en/zh hashes unchanged |
| **W2** | D2 — split fallback-notice from unverified-badge; Tibetan badge font | no | fallbacks 439; ZH/EN screens byte-identical |
| **W3** | D3 — consent screen onto `LocalizedText`, `lang` plumbed through `CaptureCard` | no | fallbacks 439 **+6** (the new consent entries, all `bo: fallback('zh')`) → 445 |
| **W4** | §5 Class A + C1 + Class B, running over an empty `bo` set | no | 0 findings (nothing to check yet); tests green |
| **W5** | §6 glossary extraction + reviewer packet + round-trip importer | no | 3 CSVs, 116 + ~35 + 105 rows |
| **W6** | §7 — buy the dictionary; verify analyte coverage; send the Tier-0 ask | **human** | one yes/no answer that resizes Tier 2 and 3 |
| **W7** | **Tier 0 ships** | reviewer (trivial) | `bo:reviewed` **2**, fallbacks **443**; `bo` baselines re-recorded |
| **W8** | P1–P6 decided and recorded in this spec | **owner** | — |
| **W9** | **Tier 1 ships** | reviewer (2–4 days, paid) | `bo:reviewed` **~74 or ~105** (per P1), fallbacks **340 or 340−31** |
| **W10** | **Tier 2 ships** (only after W0 and W9) | reviewer (one sitting) | `bo:reviewed` **+116**, fallbacks **218** |
| **W11** | Tier 3 | **not 2026** | — |

**W0 before everything.** Not because it is urgent today — with zero Tibetan strings it is inert —
but because it is the one defect whose window opens the instant a Tibetan name lands, and W10 is the
step that lands 116 of them.

**Any movement in `chipWrong`, CHIP%, or analyte-confirm gold on either corpus at any step in this
plan means the change was not as scoped.** Tibetan is display-only. The pipeline numbers must not
move. If W0 moves them, W0 found a second defect and it gets its own investigation.

---

## 10. Acceptance criteria

### Global (every step)

- `npx vitest run --pool=threads` green.
- `npx tsc --noEmit` clean.
- `npx tsx validation/real-corpus/run.ts` — MedRepBench and MIMIC-IV numbers **identical to
  `d49dec5`**, `chipWrong: 0` on both.
- **The `localizationBaseline` re-baseline ritual is respected**: en/zh hashes never change silently.
  When a `bo` hash changes, the PR body states which strings changed, who reviewed them, and against
  which ZH source revision. A `bo` hash change with no named reviewer is rejected on sight.
- **No existing safety gate weakened.** In particular: the `validation/silentAssertion.test.ts` and
  `validation/b1VerdictLeakage.test.ts` assertions that currently read `expect(bo).toBe(zh)` are
  **fallback-equality locks, not Tibetan locks**. When a `bo` string is reviewed, the corresponding
  assertion must be *replaced by a stronger Tibetan-side check* (Class A + B3 + B6 + B9 on that
  string), never deleted or loosened to `toBeTruthy()`.
- Every `bo` string that exists is either `fallback('zh')` or `reviewed()`. **`unverified()` on `bo`
  is forbidden in production copy** — it is the machine-translation shape, and it does not ship.

### Tier 0

- `bo: reviewed(` count is exactly **2**.
- `tibetanUnavailable` and `UNVERIFIED_TRANSLATION_LABEL` resolve with `usedFallback === false`,
  `resolvedLang === 'bo'`, `review === 'reviewed'`.
- Both strings pass Class A (A1–A10) and C1 (zero `.notdef`, zero U+25CC).
- The typography probe no longer renders on `app/result/page.tsx`; the fixture remains in the shaping
  test.
- Named reviewer recorded; their consent about attribution venue recorded (P2).

### Tier 1

- Every string in T1a/T1b/T1d (and T1c if P1 says so) is `reviewed()`; zero `unverified()`.
- Class A, B1–B13, C1–C3 pass on every one.
- **Two independent reviewers, with disagreements adjudicated and the adjudication recorded per
  string.** One reviewer is not sufficient for this tier — the Sci Rep 2024 team's stated failure
  mode is exactly single-reviewer inconsistency.
- The consent screen renders entirely in Tibetan in `bo` mode, with Chinese retained alongside (P3),
  and `CONSENT_VERSION` is bumped — the Tibetan consent is a new consent artifact, not a
  re-presentation of the old one.
- A screenshot test at 320px for every T1 string: no clipping, breaks only at tsheg.
- Glossary coverage metric recorded for the tier.

### Tier 2

- **W0 has landed and is locked by a test**: no Tibetan `name` string appears in `INDEX` or
  `SCOPED_INDEX`.
- All 116 names `reviewed()`; B12 (distinctness) passes; B11 (cross-string consistency) passes across
  every site.
- Each name records its glossary source (dictionary entry or standards-body ratification), or an
  explicit P6 decision with a reason.
- Corpus numbers unchanged. This is the criterion that proves the names stayed on the display side.

### Tier 3

- **Not accepted in 2026.** `data/reference-labs.ts` `definition` and `plain` remain
  `bo: fallback('zh')`, and the fallback notice (D2) tells the user so in Tibetan.

---

## 11. What cannot be solved without a human. No workaround exists for any of these.

1. **Whether a well-formed Tibetan sentence means the Chinese sentence.** Every check in §5 is
   presence, count, and structure. None is semantics. This is the whole thing.
2. **Whether a locked glossary term is itself correct.** The glossary is the trust root; every
   mechanical check assumes it. A wrong rendering of 血红蛋白 propagates to every string using it and
   passes every check. This concentrates the failure surface into ~150 items — which is exactly why
   it is the right design, and exactly why the human cannot be removed.
3. **Register and dialect** (P5). A string can pass everything and be unreadable to the target
   population.
4. **Neologism vs loanword vs transliteration** (P6). Mechanically undecidable.
5. **Pragmatic force.** B3/B6 catch *inversion*. Nothing catches *weakening* — a disclaimer that
   renders as a mild suggestion instead of a warning passes every structural check. Given the
   recorded authority-inversion finding, this is the residual that should worry you most, and it
   lands squarely on the five strings in `lib/disclaimers.ts`.
6. **Safe vs unsafe omission.** B7/B8 catch gross loss. A dropped subordinate clause inside the
   length band is invisible.
7. **Comprehensibility to a low-literacy patient** — the actual product goal. Not even the reviewer
   can certify this. It needs a comprehension pilot with real Tibetan patients: informed consent in
   Tibetan, IRB through the partnering university, and no collection of report images beyond what the
   pilot needs.

The one move that would be dishonest, stated once more because it is the move this plan exists to
prevent: **marking a `bo` string `reviewed()` because it passed the guard.**

---

## 12. Verification caveats, stated once and carried

- All in-repo measurements in §0–§3, §5 and §6 were verified by grep and by reading the named
  file:line at `d49dec5`. The two corrections to previously-held beliefs (the baseline test does not
  lock `bo`; the floor is 99 strings, not 55) were verified directly and should be treated as
  measured.
- The MT quality figures in §4 are from published papers (CCL 2025 藏汉篇章机器翻译研究及语料库构建; TLUE,
  arXiv 2503.12051; the Tibetan-language-and-AI survey, arXiv 2510.19144). Titles, venues and the
  direction of the findings are reliable; exact figures were not re-derived from the PDFs in this
  repo.
- **The recruiting and regulatory material in §6–§8 is the weakest evidence in this document.** The
  dictionary's existence, entry count, compiling institutions, and especially its coverage of
  clinical-chemistry analytes come from **search-index summaries only** — the primary Chinese pages
  did not fetch. The 2025/2026 language-law changes are likewise secondary. Treat every claim in
  those two sections as a lead to verify, not as established fact. §6 names the one purchase that
  resolves the most important of them.
- Cost and turnaround figures in §7 are estimates from published rate cards derated for terminology
  lookup. They are not quotes.
