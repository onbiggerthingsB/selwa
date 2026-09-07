# Tibetan language-model research

This is the private, Mac-first research workspace for the [implementation plan](../docs/plans/2026-09-04-tibetan-llm-implementation.md). The workspace supplies data/review tools, resource accounting, a tokenizer audit, pinned acquisition and a bounded local inference runner. No model comparison, training result or clinical validation is implied by these tools passing.

The first [synthetic adapter mechanics run](../docs/experiments/tibetan-llm/2026-09-05-first-adapter-mechanics.md) completed 20 actual Qwen updates and strict fresh-process reload. The subsequent [release-training and evaluation experiment](../docs/experiments/tibetan-llm/2026-09-05-release-training-evaluation.md) exercised immutable splits, another 20-update adapter, validation before/after/reload and paired base/adapter inference. These are small English engineering fixtures, not Tibetan adaptation. Both outputs on the single final question failed the exact task requirement; the base included the correct fact with extra explanation, while the adapter exhausted its output limit. Research web feature work is frozen.

The [release workflow](release-workflow.md) documents the implemented permission checks, releases, tokenizer accounting, bounded training, evaluation, blinded offline reviews and model-selection receipts. Real training requires actual permissioned material, a preregistered comprehension comparison and independent native review. The software does not supply those human judgments. Historical [data safeguards evidence](../docs/experiments/tibetan-llm/2026-09-05-data-safeguards.md) remains separate from the newer release experiment.

The [evaluation-planning continuation](../docs/experiments/tibetan-llm/2026-09-05-evaluation-preregistration.md) adds `plan-evaluation` to prepare exact pilot output IDs before model execution. Real preregistration binds the complete development configuration and reviewed instruction/budget evidence. Training and evaluation share target validation, and descriptive review analysis preserves incomplete ratings and failed generations.

The Python build root is `research/pyproject.toml`; Python source and dependency locks live under `research/ml/`. Keeping the contracts inside the build root makes both wheels and source archives self-contained. The production app excludes the whole research tree from TypeScript, Vitest and ESLint discovery. A separate Python CI job exercises the research core on Linux without MLX. The [private conversation demo](web/README.md) now has its own Next.js package, lockfile and CI job; it uses fixed synthetic responses and has no connected model.

## Local setup

Verified host: native Apple Silicon, Python 3.12.13. Use Python 3.12, not the system's Python 3.14 or an Intel interpreter. The Mac lock pins exact packages and wheel SHA-256 values for this platform; it is not a Linux lock. The core lock pins the smaller portable validation dependency set. Packaging uses setuptools 84.0.0 in a separate build environment.

```sh
export HT_ML_ROOT="$HOME/Library/Application Support/HealthTranslatorML"
python3.12 -m venv "$HT_ML_ROOT/envs/mlx-py312"
export HT_ML_PYTHON="$HT_ML_ROOT/envs/mlx-py312/bin/python"
"$HT_ML_PYTHON" -m pip install --no-cache-dir --require-hashes -r research/ml/requirements-macos-arm64.lock
"$HT_ML_PYTHON" -m pip install --no-deps -e research
export PATH="$HT_ML_ROOT/envs/mlx-py312/bin:$PATH"
```

Run setup from the repository root. The environment on this Mac is already installed; do not recreate it for each run. Large artifacts, contributor records and raw reviews belong under `HT_ML_ROOT`, outside the Desktop checkout. Nothing in module imports or core tests downloads or loads a model.

For portable core-only development, create a Python 3.12 environment and install `research/ml/requirements-core.lock` followed by `pip install --no-deps -e research`. A native MLX environment is required only for the explicitly separate GPU check and later model experiments.

## Available commands

```sh
ht-tibetan --help
ht-tibetan preflight --projected-bytes 0
ht-tibetan validate research/contracts/fixtures/synthetic-dataset.json
ht-tibetan audit-splits research/contracts/fixtures/synthetic-dataset.json
ht-tibetan fake-inference --run-id transport-example
ht-tibetan fake-inference --run-id timeout-example --outcome timeout
```

`preflight` reads hardware, runtime and disk usage. Its default zero projected bytes is an inventory, **not clearance for a download**. Supply the full additional peak estimate before acquisition, conversion or training: new snapshots, download scratch space, cache copies and checkpoints. Already installed files are reflected in current free space. The initial reserve is 15 GiB; exceeding it returns exit status 2. Preflight explicitly leaves GPU execution, model fit and training speed untested; the separate native test below establishes only GPU execution.

`fake-inference` produces a clearly marked synthetic English fixture or an explicit timeout, cancellation, context-overflow or runtime failure. Failed results have no answer and return exit status 2. They must never be counted as model output or token measurements.

Every `--output` writes a new immutable JSON file. Existing paths cause a failure instead of overwriting prior evidence. The `manifest` command is an **infrastructure manifest**, with package source/schema/lock digests, package-bound Git identity, runtime versions and supplied input hashes. The `run-baseline` command creates the separate model-run manifest, with snapshot verification, prompt settings and per-case artifacts.

```sh
ht-tibetan manifest --run-id setup-001 --kind setup \
  --input research/config/models.lock.json \
  --outcome completed --output "$HT_ML_ROOT/runs/setup-001/manifest.json"
```

## Reviewer round trip

Reviewers can now use a self-contained offline HTML form instead of editing JSON. See [browser review and operator commands](review/offline-form.md). It exports the same response contract for the existing importers. The [three-passage intake guide](review/first-passages.md) and [blank form](review/first-passages-template.txt) help collect the first permissioned native material.

See [contracts and API details](contracts/README.md), [reviewer instructions](review/reviewer-instructions.md), and the [community/task worksheet](review/community-task-worksheet.md). The checked-in fixtures are synthetic English examples for software checks. They are not Tibetan gold data or real reviews.

```sh
ht-tibetan export-review research/contracts/fixtures/synthetic-dataset.json \
  --reviewer-id reviewer-a --output "$HT_ML_ROOT/reviews/fixture-a.json"
# Keep fixture-a.json.receipt.json under the operator's control.
# A reviewer edits allowed response fields in a separate returned packet.
ht-tibetan import-review research/contracts/fixtures/synthetic-dataset.json \
  "$HT_ML_ROOT/reviews/fixture-a-returned.json" \
  --receipt "$HT_ML_ROOT/reviews/fixture-a.json.receipt.json" \
  --output "$HT_ML_ROOT/reviews/fixture-a-imported.json"
```

Imports preserve independent ratings and leave incomplete reviews incomplete. Completing a partial review appends a revision; completed reviews cannot be rewritten. Approval requires a separate explicit adjudication. The toolkit records declared permissions and roles; the operator must establish consent and credentials. Language approval does not grant medical approval or training rights. Never substitute an existing unreconciled translator submission for a permissioned language experiment.

## Checks

The offline reviewer interface has a separate DOM suite, using the repository's installed Node dependencies:

```sh
node --test research/ml/tests_web/*.test.mjs
```

```sh
"$HT_ML_PYTHON" -m unittest discover -s research/ml/tests -v
# Separate opt-in native check: tiny array only, no model weights.
"$HT_ML_PYTHON" -m unittest discover -s research/ml/tests_mac -v
```

The core checks cover malformed records, exact Unicode hashes, stale versions, permissions, review tampering/replay, adjudication, transitive split leakage, missing ratings, disk limits, inference failure states and provenance independent of the calling directory. The native check explicitly requires a working Metal device. Linux CI covers only core tests.

## Next dependencies

The [private conversation demo](web/README.md) can be tested while real material is being prepared: run `npm run build` and `npm start` inside `research/web`, then open `http://127.0.0.1:38471`. It shows original source passages, validates citations and keeps conversations in page memory. It does not interpret questions, establish Tibetan quality or change the comparison/training prerequisites.

The [candidate catalog](config/MODELS.md) records exact snapshots and unresolved conversion details. Its file hashes and sizes do not establish that a checkpoint understands Tibetan. The study template is a valid `draft`, with `ready_for_evaluation=false`: fill in the first community/task, obtain permissioned development passages and independent language reviews, and define scoring criteria before the comparison. Time ten representative examples before choosing a substantive training set size. See the [study workflow](../docs/study-workflow.md) for preregistration and explicit candidate selection.

No weights, adapters, transcripts or real contributor records are added to the repository; acquired models and run artifacts stay under `HT_ML_ROOT`. No cloud compute or public deployment has been started. Production advice quarantine and the restriction against generated Tibetan remain separate from these research tools.

## Pinned acquisition, token audits and local model checks

The next commands are implemented. `acquire` is the only command here that downloads artifacts. Its default is tokenizer/configuration files; `--weights` explicitly includes safetensors. The inventory, sizes and payload hashes are checked against the catalog before a staged snapshot is published. Existing snapshots are reused only after verification. Model execution never triggers a missing download. See [acquisition details](config/ACQUISITION.md), including transfer timeout scope.

```sh
ht-tibetan acquire --lock research/config/models.lock.json --candidate qwen3-4b-mlx-4bit
ht-tibetan acquire --lock research/config/models.lock.json --candidate qwen3-4b-mlx-4bit --weights
```

The result prints the exact snapshot path. Repeat with `gemma3-4b-it-mlx-4bit` for the other catalogued conversion. No acquisition copies files to the Desktop or executes downloaded Python. The old catalog's `acquired=false` fields describe its metadata-only collection date; new machine-local receipts record acquisitions without rewriting that historical catalog.

```sh
ht-tibetan audit-tokens research/config/token-audit-fixture.json \
  --lock research/config/models.lock.json --candidate qwen3-4b-mlx-4bit \
  --snapshot "$HT_ML_ROOT/models/qwen3-4b-mlx-4bit/4dcb3d101c2a062e5c1d4bb173588c54ea6c4d25/tokenizer" \
  --context-limit 2048 --max-output-tokens 128 \
  --output "$HT_ML_ROOT/runs/token-audit-qwen.json"
```

This audit includes every role, supplied evidence, history, generation prefix and reserved answer budget. Complete training-form examples count the supplied target already in the sequence; this is not loss-mask validation or training. The Tibetan typography probe is synthetic test data, not a reviewed language benchmark. Qwen's thinking setting is accepted only when the pinned template demonstrably responds to it; unsupported settings fail explicitly.

```sh
ht-tibetan run-baseline research/contracts/fixtures/synthetic-dataset.json \
  --config research/config/infrastructure-smoke.json \
  --lock research/config/models.lock.json \
  --output "$HT_ML_ROOT/runs/english-smoke-001"
```

The smoke config runs two synthetic English questions on each acquired candidate, serially. Every case uses a fresh child process with a timeout covering loading and generation. The recorded generation timing excludes load time; worker wall time includes startup. Only a nonempty answer ending at a configured stop token counts as successful execution. Length exhaustion, timeout, cancellation, empty output and unexpected thinking markup do not become complete answers; raw partial output remains diagnostic evidence. Cancellation stops subsequent cases. Model source, tokenizer/template identities, prompts, decoding settings, effective stop tokens, memory measurements and output hashes are retained in the run.

A single-input language baseline uses `baseline.template.json` (version 1.0) with actual reviewed Tibetan examples, community/task and declared review criteria. New real runs require `--permissions` pointing to the complete current contribution ledger. Before model verification or tokenization, the runner checks source and contributor rights for both `development_screen` and `private_research`, adjudication, content grouping and recorded exposure history. It rechecks the ledger after rendering before each dispatch. Every new output must be below the private root's `runs/` directory; it contains a hashed `data-use-audit.json` receipt. Version 1.1 adds the paired path below. No reference answer enters the model prompt. Attempted dispatch is conservatively recorded in a new exposure dataset; never later present those examples as unseen test material.

`audit-splits` checks only the supplied dataset and its declared exposure. Before using real material, `audit-data-use` adds the configured run history and current contribution ledger without loading a model. It returns a reconciled copy internally and writes only the audit receipt; it does not edit inputs or create a released dataset. A successful review audit allows pending language ratings but still checks the recorded review/private-research permissions. The existing review packet commands remain legacy record-based workflows; run this audit before preparing a new real-material packet.

```sh
ht-tibetan audit-data-use "$HT_ML_ROOT/datasets/development.json" \
  --permissions "$HT_ML_ROOT/permissions/current.json" \
  --purpose review --root "$HT_ML_ROOT" \
  --output "$HT_ML_ROOT/audits/development-review-001.json"
```

Permission sidecars use [`contribution-permissions.schema.json`](contracts/contribution-permissions.schema.json). Declare community-source authors and any additional example authors. Each author's current grant binds exact material, use, status and dates; never relabel synthetic test fixtures as consent. These records do not authenticate identities or prove that the operator supplied every author or the newest ledger. The exposure inventory covers recorded local runs and exact/normalized task content; undisclosed/deleted runs and semantic paraphrases remain outside its evidence.

## Paired Tibetan/Chinese conditions

Use `paired-baseline.template.json` and `parallel-material.template.json` for a reviewed comparison. The four supported conditions are `bo_to_bo`, `bo_to_zh`, `zh_to_bo` and `zh_to_zh`. Declare the condition set before execution; changing the set requires a new run. The configuration must list both language members of every selected pair, even for a condition that uses only one input language. Up to ten pairs and both candidates can run serially under the existing per-request limits.

The sidecar binds exact versions/hashes of both sources and examples, shared scenario/paraphrase groups, translation contributors, explicit derivative permissions, independent bilingual equivalence reviews and a separate adjudication. Ordinary source language approval is not proof of translation equivalence. A language run needs separately approved material in both languages and the equivalence decision; health material retains its medical-review requirement. See [paired-material instructions](review/parallel-material.md).

```sh
ht-tibetan validate-parallel "$HT_ML_ROOT/datasets/development.json" \
  "$HT_ML_ROOT/datasets/development.parallel.json" \
  --purpose language_baseline --pair-id chosen-pair-id

ht-tibetan run-baseline "$HT_ML_ROOT/datasets/development.json" \
  --config "$HT_ML_ROOT/config/paired-baseline.json" \
  --permissions "$HT_ML_ROOT/permissions/current.json" \
  --lock research/config/models.lock.json \
  --parallel "$HT_ML_ROOT/datasets/development.parallel.json" \
  --output "$HT_ML_ROOT/runs/paired-baseline-001"
```

These real-study paths are illustrative and have not been populated. Before any paired worker dispatch, all connected language/scenario variants are marked development-exposed in a new dataset snapshot. Context overflow before dispatch records no exposure. Run manifests, attempts, results, review keys and frozen reports preserve pair/condition identity. Version 1.1 review packets show input and requested output language without revealing candidate identity; condition reports retain failed and unrecorded requests. Existing version 1.0 runs/reviews remain readable with unchanged prompt construction.

The checked-in `paired-script-probe.json` and its `.parallel.json` sidecar are **AI-authored, unreviewed synthetic text**, with pending language review, no equivalence reviews and no reference answers. They are eligible only for infrastructure checks:

```sh
ht-tibetan run-baseline research/contracts/fixtures/paired-script-probe.json \
  --config research/config/paired-infrastructure-smoke.json \
  --lock research/config/models.lock.json \
  --parallel research/contracts/fixtures/paired-script-probe.parallel.json \
  --output "$HT_ML_ROOT/runs/paired-script-new-run"
```

That command performs real local inference if explicitly run; it is not a native-reviewed benchmark. The first run recorded one output-limit failure and seven normal stops. A normal stop does not establish a correct answer or the requested language. See the [measured paired-path check](../docs/experiments/tibetan-llm/2026-09-04-paired-comparison.md).

## Blinded model-output review

`blind-review` exports only completed, non-synthetic model answers whose run artifacts, dataset bindings and review permissions verify. The underlying English smoke data is synthetic, even though its model outputs are actual generations. Neither is native language evidence.

```sh
ht-tibetan blind-review "$HT_ML_ROOT/runs/english-smoke-001" \
  research/contracts/fixtures/synthetic-dataset.json --reviewer-id fixture-reviewer \
  --output "$HT_ML_ROOT/review-packets/fixture-reviewer.json" \
  --key "$HT_ML_ROOT/private-review-keys/fixture-reviewer.json"
```

Give a reviewer only the packet. Model/run identities live in the separate operator-owned key directory. Original passages, questions and answer text are preserved; answers themselves could disclose a model identity, so reviewers can flag compromised blinding. Ratings start blank. `blind-review` performs export only. The following commands complete the separate model-output review workflow; the earlier source-review importer must not receive these packets.

```sh
# Only use human_review for an actual returned human assessment.
# Software fixtures must use synthetic_test, even when the model answers are real.
ht-tibetan import-output-review "$HT_ML_ROOT/review-packets/reviewer-a.json" \
  "$HT_ML_ROOT/review-returns/reviewer-a.json" \
  --key "$HT_ML_ROOT/private-review-keys/reviewer-a.json" \
  --evidence-kind human_review --independent \
  --output "$HT_ML_ROOT/review-imports/reviewer-a.json"

# After both reviewers have independently finished all their assigned outputs:
ht-tibetan freeze-output-reviews "$HT_ML_ROOT/runs/language-baseline-001" \
  "$HT_ML_ROOT/datasets/development.json" \
  --review "$HT_ML_ROOT/review-imports/reviewer-a.json" \
  --review "$HT_ML_ROOT/review-imports/reviewer-b.json" \
  --output "$HT_ML_ROOT/review-freezes/baseline-001.json"

ht-tibetan export-output-adjudication "$HT_ML_ROOT/review-freezes/baseline-001.json" \
  --output "$HT_ML_ROOT/adjudication/baseline-001-blank.json"
# An adjudicator completes a new returned copy after seeing the frozen judgments.
ht-tibetan adjudicate-output-reviews "$HT_ML_ROOT/review-freezes/baseline-001.json" \
  "$HT_ML_ROOT/adjudication/baseline-001-returned.json" \
  --output "$HT_ML_ROOT/adjudication/baseline-001-recorded.json"
```

These illustrative language-study paths do not exist yet. Original and returned packets must have different filenames/locations. Only response fields may change; keep the outer packet status unchanged. Partial imports remain incomplete. Use `--previous /absolute/path/to/prior-import.json` to append completion of a partial packet; completed responses and independence/evidence declarations cannot change. `--no-independent` records a non-independent submission, which cannot be frozen.

Freeze requires 2–8 distinct independent completed reviewers covering the same outputs. It preserves individual 1–4 ratings, disagreements, blinding flags, generation failures, unrecorded requests and connected source/scenario clusters. Synthetic ratings cannot mix with human reviews. Frozen files are bounded to 32 MiB before writing; oversized reports fail without publishing an unreadable artifact. Freeze reload checks the original run/dataset and immutable imported records, so retain those inputs at their recorded paths.

Adjudication records an explicit decision and rationale for every output; unresolved cases remain unresolved. It neither overwrites the independent ratings nor changes source/example approval, training permissions, medical status or model selection. See [reviewer and operator instructions](review/model-output-review.md) and the [verified workflow check](../docs/experiments/tibetan-llm/2026-09-04-review-roundtrip.md).
