# Evaluation planning and preregistration repair

This continuation adds a configuration-only case planner and repairs checks that previously failed too late in the real-study workflow. It does not run a model or add Tibetan material, human reviews or a model-selection decision. The earlier [native release/training report](2026-09-05-release-training-evaluation.md) remains the measured adapter result.

## Changes

`ht-tibetan plan-evaluation CONFIG --output PLAN.json` lists the exact output IDs in the same condition/example/arm order as the execution runner. It records the configuration hash, instruction identities, per-arm output counts and number of distinct example IDs. It does not open datasets, load a tokenizer/model, reserve exposure, select pilot cases or grant permission. Source independence remains unknown because this operation deliberately has no source data.

The operator chooses the ten pilot IDs from that plan and records its `config_sha256` as `development_config_sha256` in the study. Supplying `--study STUDY.json` checks the condition, candidates and pilot roster. A complete real preregistration now requires that configuration binding, reviewed instructions and reviewed task budgets. A proposed draft may retain unresolved fields. The original checked-in draft template remains byte-for-byte unchanged so existing synthetic review packets bound to its hash stay readable; the configuration field is added when preparing a real registration.

The runner rejects a real development comparison if it omits a registered base candidate, names pilot outputs outside the plan, changes the bound configuration or uses a future registration timestamp. Validation/final comparisons keep the original study while using their own configuration and output IDs. Candidate selection rechecks the original development configuration hash from run metadata before opening report answers.

An independent review reproduced why the hash is necessary: reversing the example or arm order leaves numeric output IDs such as `run-0001` unchanged while changing what they refer to. Checking only the set of IDs allowed this remapping. The configuration hash now changes and both dispatch and selection reject the altered comparison. The binding covers configuration fields; it does not authenticate contributor identities or replace the separate immutable release and permission checks.

Training and evaluation now share one target validator. An exact-label reference must belong to the registered labels/no-answer rule. Extraction requires an exact source span or the registered no-answer label. This rejects malformed task targets before a model is dispatched or an exposure reservation is created. It does not establish that a permitted label/span correctly answers a Tibetan question; that still requires native judgment.

Descriptive `analyze-evaluation-reviews` now accepts incomplete returned packets and reports failed or unrecorded pilot generations. Missing ratings, unknown review time and failures stay in the planned denominator. A regression fixture with one failed generation among ten outputs reports nine eligible paired judgments and two missing review slots out of twenty planned slots. This descriptive path makes no selection. Real model selection still requires a completed comparison and complete, independent, uncompromised blinded reviews.

## Verification

- **605 Python tests passed** using `unittest`, including the planner/runner ID agreement, configuration remapping, early study/reference rejection and incomplete-review regressions.
- **58 reviewer DOM tests passed.** Form assets were unchanged.
- The planner reproduced both IDs and all job identities in the existing native Qwen base/adapter evaluation, without running either arm again.
- The original blank synthetic review packet still validates with its original study and private key; it remains incomplete.
- The cumulative local inventory remains valid across **12 finalized runs and 133 hashed files**.
- An isolated wheel build/install passed outside the checkout. All **70 source, schema, fixture and form-asset files** matched the source bytes; the installed planner and study-schema checks passed. Wheel SHA-256: `b0a9543d5f6d9815d87eb604322b64595bda051f5548c5c079fae64294a1664a`.
- An independent reader reproduced the ordering defect, verified the repair and found no additional confirmed issue within the reviewed changes.
- `git diff --check` passed. Production and research-web application code were unchanged in this continuation; their passing tests/builds are recorded in the preceding report.

The [operator guide](../../../research/release-workflow.md) and [study workflow](../../study-workflow.md) contain the commands and field requirements. The next substantive work remains collecting permissioned Tibetan material, obtaining independent native judgments and running the agreed comprehension/pilot study. No new training, spending or deployment result is claimed here.
