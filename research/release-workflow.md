# Local release, training and evaluation workflow

The bounded local workflow is implemented: permission checks → immutable split releases → exact token accounting → adapter training and reload → paired evaluation → independent review. The [native experiment report](../docs/experiments/tibetan-llm/2026-09-05-release-training-evaluation.md) records an actual 20-update Qwen run on newly authored English fixtures. It does not establish Tibetan comprehension or a useful health model.

The next real experiment needs a reachable community, permissioned Tibetan passages and answers, and two independent native reviewers. The first task is proposed as extracting a short answer from a nonclinical passage, with an explicit response when information is absent. The checked-in study is a valid **draft**, not preregistration. No clinician is currently available.

## Environment and artifact locations

Run commands from the repository root using the already installed native Python 3.12 environment:

```sh
export HT_ML_ROOT="$HOME/Library/Application Support/HealthTranslatorML"
export HT_ML_PYTHON="$HT_ML_ROOT/envs/mlx-py312/bin/python"
export PATH="$HT_ML_ROOT/envs/mlx-py312/bin:$PATH"
ht-tibetan --help
ht-tibetan validate-study research/config/study.template.json
```

The study result separates `valid` from `ready_for_evaluation`; exit code zero for a draft does not grant readiness. Store contributor records, datasets, model snapshots, review packets, keys, releases and runs beneath the private root. Keep review keys in a separate operator-only directory. Commands write new files/directories and refuse replacement. The experiment lock allows one release/history-sensitive operation at a time; a crash releases the operating-system lock without erasing evidence.

The paths below describe future operator inputs. They have not been populated with Tibetan material. Do not create approvals, consent, reviewers or answers merely to make a command pass.

## 1. Prepare permissioned material and independent source reviews

Use [first passages](review/first-passages.md), the [community worksheet](review/community-task-worksheet.md), and the [data contracts](contracts/README.md). Every source and example has an exact version/hash. The separate contribution ledger binds each known author's grant to source text or the example bundle and to each allowed use. Review rights do not imply training rights.

```sh
ht-tibetan audit-data-use "$HT_ML_ROOT/datasets/development.json" \
  --permissions "$HT_ML_ROOT/permissions/current.json" --purpose review \
  --root "$HT_ML_ROOT" --output "$HT_ML_ROOT/audits/development-review-001.json"
```

Use the existing source-review export/import/adjudication workflow after a successful review-use audit. A real non-review use requires two complete independent language reviews and an explicit supported adjudication. All known source authors and example coauthors are excluded from those independent counts and cannot adjudicate their own material. Non-author reviewer/adjudicator overlap is disclosed. The software checks supplied records; it does not authenticate people, prove consent or discover undeclared coauthors.

Assign connected source/scenario/paraphrase groups to their roles before building a release. Exact and versioned-normalized source/task matches add grouping edges. The inventory reconciles recorded historical exposure. Semantic paraphrases and undisclosed or deleted runs remain limitations, so retain independent human grouping review and all run evidence.

## 2. Build immutable releases and audit tokens

```sh
ht-tibetan build-release "$HT_ML_ROOT/datasets/development.json" \
  --permissions "$HT_ML_ROOT/permissions/current.json" \
  --release-id development-v1 --evidence-kind human_review \
  --root "$HT_ML_ROOT" --output "$HT_ML_ROOT/releases/development-v1"

ht-tibetan verify-release "$HT_ML_ROOT/releases/development-v1" \
  --permissions "$HT_ML_ROOT/permissions/current.json" \
  --purpose development_screen --root "$HT_ML_ROOT"

ht-tibetan audit-release-tokens "$HT_ML_ROOT/releases/development-v1" \
  --permissions "$HT_ML_ROOT/permissions/current.json" \
  --lock research/config/models.lock.json \
  --condition "$HT_ML_ROOT/config/proposed-condition.json" \
  --candidate qwen3-4b-mlx-4bit --candidate gemma3-4b-it-mlx-4bit \
  --purpose development_screen --root "$HT_ML_ROOT" \
  --output "$HT_ML_ROOT/audits/development-tokens-001.json"
```

The release binds data, permissions, grouping and exposure snapshots. Final-test prompts are separated from their reference answers; train/validation verification does not open final-test payloads. The tokenizer audit permits only development, training or validation. It loads verified local tokenizers, never model weights, and records exact rendered prompt/target lengths, assistant offsets, instructions and hashes. `valid` means the measurement succeeded; `all_fit` separately says the measured records fit the declared bounds. A proposed ceiling is not an approved language-study budget.

`--offline-integrity-only` on `verify-release` skips current permissions/history and is only an artifact inspection. Actual model commands always recheck eligibility. Do not inspect final-test content while selecting prompts, token ceilings, candidates or training settings. Historical test payloads are hash-checked without parsing their answers during later training audits.

## 3. Register the study and compare unchanged candidates

Follow the [study and pilot workflow](../docs/study-workflow.md). Review and record the exact instruction, its language, task answer rule, no-answer label, model-specific output ceilings, context ceiling, critical errors, ten planned output-case IDs and actual community. Freeze these decisions before the comparison. Instruction and budget review hashes bind operator-held evidence; they do not replace native review.

Create the evaluation configuration first, then list its output IDs without opening a dataset or running a model:

```sh
ht-tibetan plan-evaluation "$HT_ML_ROOT/config/development-comparison-v1.json" \
  --output "$HT_ML_ROOT/studies/development-case-plan-v1.json"
```

Select the ten pilot `case_id` values from this plan and record them in `pilot.expected_item_ids`. Record its `config_sha256` in the study's `development_config_sha256` field. The original draft template omits that field for historical compatibility; add it before preregistration. Five examples compared across two models produce ten output cases, not ten independent examples. The planner leaves the choice of pilot cases to the operator and does not infer source independence.

Run the planner again with `--study "$HT_ML_ROOT/studies/study-v1.json"` to check the roster and condition against the proposed study. A successful configuration check does not authorize evaluation; inspect `study_alignment.study_ready_for_evaluation` separately. Real preregistration requires reviewed instructions and calibrated budgets. Real development dispatch checks the exact configuration hash, all registered base candidates and the pilot ID roster; reordering examples or arms cannot silently remap the registered cases. A study timestamp in the future also blocks dispatch. Validation/final runs retain the selected study but use their own configuration and case IDs.

An evaluation configuration declares `schema_version`, `run_id`, `purpose`, `conditions`, `arms`, `example_ids`, `seed` and `timeout_seconds`. Each arm contains `candidate_id`, `arm_id` (`base` or `adapter`) and `checkpoint_dir` (null for base). For a development comparison, select only base arms. Every adapter comparison requires its corresponding unchanged base arm. Conditions record `instruction_language`, exact `instruction_text`, `output_language`, `task_answer_kind`, per-candidate token budgets and context limit. The initial release evaluator handles same-language comprehension; the earlier paired baseline remains a separate translation diagnostic.

```sh
ht-tibetan evaluate-release "$HT_ML_ROOT/releases/development-v1" \
  --permissions "$HT_ML_ROOT/permissions/current.json" \
  --lock research/config/models.lock.json --study "$HT_ML_ROOT/studies/study-v1.json" \
  --config "$HT_ML_ROOT/config/development-comparison-v1.json" \
  --root "$HT_ML_ROOT" --output "$HT_ML_ROOT/runs/development-comparison-v1"
```

The runner records conservative exposure reservations before dispatch, exact prompts and identities, complete outputs and typed failures. It refuses truncation. A token-limit exit is a failure with diagnostic partial text, not a completed answer. Missing and failed cases stay in the planned denominator. Exact answers, source-span/no-answer tasks, Unicode-normalized diagnostics and source/scenario clusters are reported separately. These are constrained task scores, not a semantic or clinical verifier.

## 4. Collect blinded reviews and make an explicit decision

```sh
ht-tibetan export-evaluation-review "$HT_ML_ROOT/runs/development-comparison-v1/report.json" \
  --reviewer-id reviewer-a --study "$HT_ML_ROOT/studies/study-v1.json" \
  --release "$HT_ML_ROOT/releases/development-v1" \
  --permissions "$HT_ML_ROOT/permissions/current.json" --root "$HT_ML_ROOT" \
  --key "$HT_ML_ROOT/review-keys/reviewer-a.json" \
  --output "$HT_ML_ROOT/review-packets/reviewer-a.json"

ht-tibetan evaluation-review-form "$HT_ML_ROOT/review-packets/reviewer-a.json" \
  --study "$HT_ML_ROOT/studies/study-v1.json" \
  --report "$HT_ML_ROOT/runs/development-comparison-v1/report.json" \
  --key "$HT_ML_ROOT/review-keys/reviewer-a.json" \
  --output "$HT_ML_ROOT/review-packets/reviewer-a.html"

ht-tibetan validate-evaluation-review "$HT_ML_ROOT/review-returns/reviewer-a.json" \
  --study "$HT_ML_ROOT/studies/study-v1.json" \
  --report "$HT_ML_ROOT/runs/development-comparison-v1/report.json" \
  --key "$HT_ML_ROOT/review-keys/reviewer-a.json"
```

Create a separate randomized packet/key for reviewer B. Give each reviewer only their HTML file. It runs offline with English/Chinese controls and contains exact public passages, questions, instructions and anonymous answers. It contains no private key or decoded model identities. Reviewers download a response JSON; the operator validates it with the original key. Blank downloads remain incomplete. Completing ratings does not itself grant approval. Preserve the original packet, HTML, key and returned file separately.

Analyze the two returned reviews with `analyze-evaluation-reviews --review ... --key ...`; repeat each flag in corresponding order. You may analyze incomplete returned packets and failed generations: their missing ratings and failure counts stay in the planned denominator. This descriptive analysis cannot select a model. `analyze-agreement` additionally supports a structured pilot record. Missing ratings, unknown time and unassessed critical errors remain explicit. Two-reviewer kappa is unavailable when its denominator is undefined. Measure authoring, coordination and adjudication effort as well as rating time before setting a substantive dataset target.

After actually reviewing the pilot and comparison, create a decision using the fields in [study workflow](../docs/study-workflow.md), then use `record-model-decision`. Only a completed, preregistered, real development-screen comparison with independent complete blinded reviews can support selection. Unanimous rejection, synthetic evidence, compromised blinding, validation and final-test results cannot select the model. The receipt is revalidated before training.

## 5. Train and evaluate a bounded released adapter

Build a separate release from eligible training, validation and locked-test material. Training configuration contains `training`, the exact selected `condition`, and absolute `study_path`, `selection_path`, `evaluation_report_path`. The three receipts must describe the same selected base and condition. Gemma's conflicting conversion declaration currently prevents its use in real released training; loading successfully does not resolve provenance.

```sh
ht-tibetan train-release "$HT_ML_ROOT/releases/adaptation-v1" \
  --permissions "$HT_ML_ROOT/permissions/current.json" \
  --lock research/config/models.lock.json --candidate qwen3-4b-mlx-4bit \
  --config "$HT_ML_ROOT/config/training-v1.json" --timeout-seconds 300 \
  --root "$HT_ML_ROOT" --output "$HT_ML_ROOT/runs/training-v1"
```

The current runner deliberately accepts 1–16 examples per training/validation role, 1–20 updates, batch size 1, 16–512 complete tokens, 1–2 adapted layers and rank 1–8. It excludes prompt/padding from loss, refuses overlong records, checks finite gradients and updates, hashes the frozen base, and verifies every saved adapter tensor after a fresh-process reload. Before/after/reloaded validation uses the same assistant-token-weighted loss. These limits prove an initial experiment; representative Tibetan sequence capacity and larger training schedules are not measured.

Resource ceilings are 12 GiB observed MLX allocation, 14 GiB process RSS, 1 GiB sampled swap growth and at least 15 GiB free disk. Training defaults to a 300-second deadline and accepts an explicit deadline of at most 600 seconds; evaluation cases are capped at 300 seconds. Missing required telemetry fails closed. No optimizer-state resume is implemented or claimed. Failed/interrupted runs and exposure reservations must be retained. A retry uses a new run directory after diagnosing the failure; do not weaken resource bounds to force success.

Use validation for development. For a locked comparison, declare base and saved-adapter arms under identical conditions and the registered `final_test` IDs. Run `evaluate-release` once after choosing the configuration. The adapter must verify against the exact base and release. Once inspected, the test is exposed; a changed model or condition needs newly held-out material for a new independent claim.

```sh
ht-tibetan model-card "$HT_ML_ROOT/runs/training-v1/manifest.json" \
  "$HT_ML_ROOT/runs/final-comparison-v1/report.json" \
  --output "$HT_ML_ROOT/model-cards/training-v1.md"
```

The card reports measured limitations and failures. It does not authorize deployment. Real native ratings and a supported comparison remain necessary; any health-guidance capability additionally needs appropriate clinical review and a separately justified product boundary.

## Synthetic engineering fixtures and completed evidence

`contracts/fixtures/synthetic-release-dataset.json` and its permission sidecar contain only fabricated English software fixtures and declarations. Use `--evidence-kind synthetic_test`; changing that flag does not turn them into real evidence. `config/condition.engineering.json`, `training-release.engineering.json` and `evaluation-release.engineering.json` exercise the bounded APIs. They cannot support real model selection.

On this Mac the fixture release already exists at `releases/engineering-release-20260905-v1`. Its final example was exposed by `runs/release-evaluation-qwen-20260905`; renaming or rebuilding the same examples must not restore unseen status. The successful training checkpoint is under `runs/release-training-qwen-20260905-r2/checkpoint`. A prior zero-update resource failure remains at `runs/release-training-qwen-20260905`. The blank native-output form is `reviews/engineering-release-reviewer-a.html`; it is a synthetic workflow demonstration, not a collected human review.

Research web feature development remains frozen. Retrieval, real chat transport and lab integration are deferred until the comprehension/adaptation evidence supports a useful task. Existing production doctor-note containment and the Tibetan generation boundary remain in place. No cloud compute or public deployment was started.
