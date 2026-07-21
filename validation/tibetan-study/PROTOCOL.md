# ZH→BO translation validation study — protocol

**Pre-registered.** Written before any candidate is generated, so the data decides the
outcome and nobody gets to pick a branch after seeing the results. Corresponds to the
reorganization plan's §3 validation study and open questions **Q4** (threshold) and the
Chinese-vs-Claude model comparison.

## What this study answers

Is model-generated **Chinese→Tibetan** translation good enough to ship in the product, or
must Tibetan names/definitions be human-curated instead? This is the fork between:

- **Branch A — meets threshold:** model translation stands, with per-release reviewer
  spot-checks; the curated table holds names only.
- **Branch B — misses threshold:** a curated, human-reviewed Tibetan table for names and
  definitions; free-text surfaces stay labelled unverified.

We commit in advance to whichever branch the data picks.

## The two things a validation needs, and which is blocked

1. **Mechanical fidelity** — did the translation preserve the source's numbers, units,
   Latin tokens, and structure, and is it well-formed Tibetan? **Automatable, needs zero
   Tibetan competence.** This repo already has the checker (`mechanicalCheck.ts`, reusing
   the W4 verification layer). Run it on every candidate.
2. **Semantic quality** — does the Tibetan *mean* the right thing and read naturally, with
   no dangerous mistranslation? **No machine can do this**, and it is the whole point.
   Health-domain ZH→BO machine translation scores d-BLEU ~9.4, there is no COMET model for
   Tibetan, and back-translation / multi-model agreement are both invalid as quality gates.
   This requires a reviewer who reads **Chinese + Tibetan + medical terminology.**

**A clean mechanical pass is necessary, never sufficient.** A candidate can pass every
check in step 1 and still be a fluent, confident, dangerous mistranslation. Do not read a
green mechanical report as "the translation is good."

## The sample (frozen)

`sample.ts` — 36 items, deterministically selected and frozen:
- **20 analyte names** (high-stakes, by key order) — short, bounded vocabulary.
- **10 definitions** — 6 carrying numbers/units (the high-risk ones), 4 direction-neutral.
- **6 doctor-note strings** — the free-text 医嘱 surface, where a flipped negation or
  polarity is direct harm.

Do not edit the sample after generation begins.

## Step 1 — generate (needs model API access, not a reviewer)

```
npx tsx validation/tibetan-study/run.ts template
```

writes `generation-template.csv` with one empty `bo_<model>` column per model. Fill each
by calling that model's API on the `zh` cell with this exact prompt (identical across
models, so the comparison is fair):

> 你是一名医学翻译。把下面的中文医学文本准确翻译成藏文（Tibetan, bo）。
> 要求：完整保留所有数字、单位（如 mmol/L）、以及英文缩写（如 TSH、HbA1c）不变；
> 不要添加、省略或改变任何医学含义；不要输出中文或解释，只输出藏文译文。
> 中文原文：{{zh}}

Models to run, head-to-head (the plan's requirement): **claude, gemini, qwen, glm,
doubao.** The Chinese models are included for two independent reasons — they are
mainland-reachable (Q2) and plausibly better at ZH→BO, both being PRC languages with
dedicated corpora. Nobody has demonstrated Tibetan quality to us in either direction; this
study is the first actual test.

## Step 2 — mechanical check (automatable, run it before the reviewer sees anything)

```
npx tsx validation/tibetan-study/run.ts check validation/tibetan-study/generation-template.csv
```

Prints, per model, how many candidates are mechanically clean vs. have structural failures
(a dropped number, a flipped unit, stranded Chinese characters, malformed Tibetan). Any
candidate that fails here is disqualified before human scoring — no point paying a reviewer
to read a translation that already dropped a decimal. It also writes:

- `scoring-sheet.csv` — the reviewer's sheet, **blinded** (each row's candidates are
  labelled A–E in a rotating order, so the reviewer does not know which model produced which).
- `scoring-key.json` — which label was which model. **Do not show the reviewer.**

## Step 3 — semantic scoring (the reviewer; the blocked step)

The reviewer scores every candidate **0–2**:
- **0** — wrong, or dangerous (any error that could mislead a patient about their result).
- **1** — understandable but off (awkward, imprecise, non-idiomatic — not dangerous).
- **2** — correct and natural.

and writes a note in `dangerous_error_note` for any candidate scored 0 on danger grounds.

## Pre-registered pass/fail rule (Q4 — CONFIRM THE NUMBERS BEFORE GENERATING)

> **Proposed, pending sign-off:** a model passes if the reviewer scores **≥ 90% of its
> items at 2 (correct)** *and* flags **zero dangerous errors**. A single dangerous error
> fails that model outright, regardless of the percentage.

- If **any model passes** → **Branch A** (that model's translation stands, with per-release
  spot-checks). If several pass, prefer the mainland-reachable one (Q2).
- If **no model passes** → **Branch B** (human-curated Tibetan table).

Set these numbers with the project owner **before** step 1. Whatever they are, they are
fixed before the data exists.

## Honesty notes

- This study is one reviewer on one sample — a *screening* study, not a formal validation.
  Tier-2 (a real product) replaces it with multiple reviewers, an error taxonomy, and
  documented inter-reviewer agreement (see the reorganization plan's appendix).
- The mechanical checker and the frozen sample are ready now. Everything up to step 3 can
  run today. Step 3 is blocked only on recruiting the reviewer — and no engineering,
  metric, or model substitutes for it.
