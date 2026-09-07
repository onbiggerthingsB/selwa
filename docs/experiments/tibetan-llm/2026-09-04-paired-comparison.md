# Paired comparison path — September 4, 2026

The paired runner, review exchange and condition-level reporting now work across Tibetan→Tibetan, Tibetan→Chinese, Chinese→Tibetan and Chinese→Chinese. All 199 research core tests passed. An actual local eight-request check on one AI-authored, unreviewed script probe produced seven normal stops and one bounded output-limit failure. This is infrastructure evidence, not a native-reviewed Tibetan benchmark or a model-selection result.

## What changed

The versioned paired-material sidecar binds exact source/example versions and hashes, shared scenario/paraphrase groups, translation contributors, derivative permissions and independent bilingual equivalence review. A real language run requires reviewed material in both languages and a separate equivalence adjudication. Synthetic fixtures cannot qualify by merely changing the run purpose. Health scope and medical-review requirements apply to both versions.

Baseline configuration 1.1 declares pairs and input/output conditions. Every attempt/result records that identity and the complete sidecar is sealed in both manifests. Before dispatch, all connected variants are marked development-exposed in a new dataset snapshot. Context overflow before dispatch creates no exposure. Prior version 1.0 prompts and records remain supported.

Version 1.1 review packets show the input and requested output language, while keeping model/pair identities in the private key. Import, freeze and adjudication preserve these identities and report denominators by condition, including failed and unrecorded requests. Nothing automatically selects a model or converts model outputs into approved training data.

## Actual local check

The fixture contains short synthetic Tibetan and Chinese text intended to describe three books, with a question about the count. The Tibetan wording and cross-language equivalence have **not** been checked by native speakers. Both source language reviews remain pending; there are no reference answers, source reviews, equivalence reviews or adjudications. Fixture permission fields explicitly describe synthetic test declarations, not human contributor consent.

Recipe: `research/config/paired-infrastructure-smoke.json`; data: `research/contracts/fixtures/paired-script-probe.json` and its `.parallel.json` sidecar. Each candidate ran all four conditions serially in fresh processes with a 2,048-token context budget, 128-output-token ceiling, 120-second load-plus-generation timeout, greedy temperature 0, seed 0 and reasoning disabled. The existing pinned local snapshots were used; no new weights were downloaded.

| Candidate | Input → output | Prompt tokens | Output steps | Worker wall time | Termination |
| --- | --- | ---: | ---: | ---: | --- |
| Qwen3-4B | Tibetan → Tibetan | 97 | 24 | 2.69s | normal stop |
| Qwen3-4B | Tibetan → Chinese | 97 | 8 | 5.84s | normal stop |
| Qwen3-4B | Chinese → Tibetan | 59 | 128 | 2.78s | output limit; no complete answer |
| Qwen3-4B | Chinese → Chinese | 59 | 5 | 3.29s | normal stop |
| Gemma3-4B | Tibetan → Tibetan | 81 | 46 | 8.32s | normal stop |
| Gemma3-4B | Tibetan → Chinese | 81 | 32 | 7.55s | normal stop |
| Gemma3-4B | Chinese → Tibetan | 62 | 25 | 7.19s | normal stop |
| Gemma3-4B | Chinese → Chinese | 62 | 41 | 7.28s | normal stop |

The native run's final outcome is **`failed`**, with all eight planned cases recorded, because one request exhausted its output budget. CLI exit status was 2, as intended. The failed response has `answer=null` and retains its raw partial output. That output repeats the same Tibetan fragment twelve times; the observed failure was not simply a long answer reaching a conservative limit. No larger-budget rerun was used to replace or hide it.

Both Tibetan-input/Chinese-output requests said the passage did not provide an answer. Gemma's Chinese-only response also appended pinyin and English explanation. These are observations of the saved outputs, not independently scored error rates. The probe's unreviewed Tibetan wording, one source scenario and tiny prompt set prevent conclusions about general Tibetan ability or a winner. A normal stop establishes neither correctness nor compliance with the requested language.

Observed peak MLX allocations ranged from approximately 2.33 to 2.55 GiB. These are not total machine memory use or training-headroom estimates. Wall times include startup/loading, and caches were not balanced; these measurements do not support a speed ranking. Preflight found 26,555,719,680 bytes free and reserved 15 GiB after projecting 10 MiB of additional artifacts.

## Verification and review artifacts

All **199 core tests passed**, including 16 parallel-material tests, 17 paired-runner tests, nine paired-import tests, seven paired review-flow tests and two paired CLI tests. Coverage includes stale material, missing permissions, duplicated contributors/reviewers, unapproved equivalence, medical-scope consistency, changed conditions/language labels, reference-answer exclusion, connected exposure, cancellation, partial runs and condition-level denominators.

Independent review found a pre-existing consistency gap: an edited rendered prompt in a result could be rehashed without checking its earlier dispatch attempt. Successful export now requires all immutable attempt fields—including rendered prompt, condition, settings and exposure—to match the result. The original reproducer now fails. The historical version 1.0 four-answer freeze and its imports still reload with their original hash unchanged.

The actual paired run exported a seven-item version 1.1 packet with input/requested-language labels and blank ratings. The failed eighth request remains listed in the private key and original run. Packet model names are absent, its file mode is 0600, and no review or approval was supplied.

This batch changed research code, tests, fixtures and documentation only. Earlier production checks were not rerun or represented as newly verified. No adapter training, paid compute, commit, push, publication or deployment occurred. Conversion-provenance limitations previously recorded for the candidates remain unresolved.

## Local evidence and next dependency

Native artifacts: `/Users/likerun/Library/Application Support/HealthTranslatorML/runs/paired-script-20260904/`, including both manifests, attempts, results, raw partial output and exposure snapshots. The packet is under `HealthTranslatorML/review-packets/paired-script-20260904.json`, with its separate key under `HealthTranslatorML/private-review-keys/`. Final code, report and verification hashes are recorded in `HealthTranslatorML/runs/paired-engineering-20260904/manifest.json`.

The next substantive experiment needs permissioned native-written or native-reviewed Tibetan development passages, independently checked Chinese equivalents, a chosen community/task and declared criteria. Review both the inputs and model answers before selecting a base or starting adaptation. The probe shows why those measurements are necessary; it does not settle whether either candidate can support the intended task.

See the [implementation plan](../../plans/2026-09-04-tibetan-llm-implementation.md), [commands](../../../research/README.md) and [paired-material instructions](../../../research/review/parallel-material.md).
