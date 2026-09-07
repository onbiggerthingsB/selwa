# Local model runner — September 4, 2026

Both pinned community conversions loaded and generated successfully on the Apple M4 Pro, 24 GiB Mac. Four synthetic English requests completed: each model answered when a library opens and which notebook is on a table. This is an infrastructure check using two distinct source passages, not a Tibetan ability comparison, a model-selection decision, training or a health-advice demonstration.

## What was implemented

- `acquire` and `verify-model`: exact-revision public acquisition, separate tokenizer/model snapshots, measured hashes, strict inventory checks, private staging, no downloaded code execution, atomic publication and a 15 GiB free-disk reserve. Files remain outside the Desktop checkout. Expected LFS payload hashes are distinguished from Git pointer hashes.
- `audit-tokens`: complete model-specific templates, system/evidence/history turns, raw and rendered counts, exact Unicode hashes, declared output reservation and separate training-form sequence counts. Neither truncation nor a token-count threshold is presented as language validation.
- `run-baseline`: review/permission/split eligibility checks, source-and-question-only prompts, verified local snapshots, explicit greedy settings and stop tokens, one bounded child process per case, immutable output/exposure records and complete provenance manifests.
- Native failure handling: a one-token output limit preserves the partial output but produces no complete answer. A forced process timeout terminates the child and returns no answer. Cancellation also stops subsequent dispatches; that orchestration path is covered in core tests.
- `blind-review`: anonymous model-output packets with blank ratings and a separately protected model-name key. This export does not import ratings, freeze reviews, resolve disagreements or grant training approval.

## Actual local measurements

Recipe: `research/config/infrastructure-smoke.json`; original data: `research/contracts/fixtures/synthetic-dataset.json`. Settings: 2,048-token context budget, at most 128 output tokens, greedy temperature 0, seed 0, reasoning disabled, 120-second load-plus-generation timeout. The two models were run serially and every request used a fresh process.

| Snapshot | Example | Input tokens | Output steps | Worker wall time | Peak MLX allocations | End |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| qwen3-4b-mlx-4bit | fixture-example-1 | 75 | 8 | 3.73s | 2.35 GiB | stop |
| qwen3-4b-mlx-4bit | fixture-example-2 | 79 | 22 | 1.65s | 2.36 GiB | stop |
| gemma3-4b-it-mlx-4bit | fixture-example-1 | 76 | 8 | 3.68s | 2.54 GiB | stop |
| gemma3-4b-it-mlx-4bit | fixture-example-2 | 80 | 9 | 2.84s | 2.55 GiB | stop |

Output-step counts include the final stop step, following the pinned MLX-LM API. Worker wall time includes startup, imports, loading and generation. MLX allocations are not total machine memory use; peak process RSS is recorded separately and must not be added to MLX memory as if they were disjoint. File and shader caches were not balanced, and two tiny prompts do not support a speed ranking. Longer Tibetan conversations and adapter training can have substantially different requirements.

Both models answered the library question with “The community library opens at nine.” Both identified the blue notebook for the second question. The references were not supplied as hidden answers: the stated facts were present in each source passage, as this source-based task intends. No automatic score for Tibetan quality was computed.

Free disk after the checks was **23.56 GiB**, above the 15 GiB reserve. This is a whole-machine snapshot; changes in free space also reflect other activity. The model catalog remains a historical metadata snapshot; separate acquisition receipts now establish the selected downloaded file identities. No model upload, deployment or paid cloud compute occurred.

## Tokenizer checks

Each tokenizer passed four synthetic cases: one turn, system/evidence/history, a complete training-form example, and a Tibetan Unicode typography probe. All fitted the explicit 2,048-token test context with a 128-token generation reservation. Training-form cases already contain a target and reserve zero additional generation tokens; no training or loss masking was performed.

| Synthetic case | Qwen complete tokens | Gemma complete tokens |
| --- | ---: | ---: |
| Single turn | 21 | 18 |
| System, evidence and history | 70 | 63 |
| Complete training-form example | 28 | 24 |
| Tibetan typography probe | 52 | 44 |

The typography probe is not native-reviewed Tibetan gold. These counts establish tokenizer/template accounting only. They are not evidence that one model understands Tibetan better.

Qwen's selected template demonstrably consumes `enable_thinking=False` and emits the corresponding closed empty thinking prefix. The four smoke responses contained no unexpected thinking markup. Gemma used its unchanged template. Effective stop IDs were Qwen `[151645]` and Gemma `[1, 106]`; rendered prompt and tokenizer identities were recorded in every case.

## Verification and limits

- All 113 research core tests passed, including acquisition, tokenizer accounting, process failure handling, baseline eligibility/provenance and blinded export. They run without network access or loading model weights.
- Two real tokenizer audits passed; four real model requests ended normally.
- Native one-token truncation and forced process timeout both produced no complete answer.
- A four-item packet exported from the actual English model run. All ratings remain blank, model names are absent from packet metadata/text, both output files have mode 0600, and the separate private-key directory has mode 0700. No human review or approval occurred.
- This batch changes research code/configuration/documentation only. The previous production baseline remains 1,252 passing tests, 41 skipped, with lint, TypeScript and build passing; those unchanged app checks were not presented as newly rerun here.

The pinned MLX-LM loader supports Gemma's text component, discards vision components during sanitization and reads actual `model*.safetensors` files, so this conversion's stale index did not block the observed loads. Its model card still conflicts about instruction-tuned versus pretrained origin, and neither conversion supplies an exact source commit or complete reproducible conversion recipe. Successful loading does not resolve that provenance.

Real language comparison still requires the selected community/task, permissioned Tibetan development passages, independent meaning/naturalness judgments and declared review criteria. The first language runner accepts reviewed Tibetan sources; paired Chinese conditions and their equivalence checks remain to be added. Blinded model-output review import/adjudication is also pending. No native judgments were invented, no model was selected, and no adapter has been trained.

## Local evidence

The machine-local run directory is `/Users/likerun/Library/Application Support/HealthTranslatorML/runs/runner-20260904/`:

- `english-smoke/manifest.json`, per-case outputs and exposure snapshots;
- `qwen-token-audit.json` and `gemma-token-audit.json`;
- `native-boundary-checks.json` and `preflight-after.json`;
- `engineering-manifest.json`, binding the final implementation, verification log and evidence reports;
- acquisition receipts under the corresponding `HealthTranslatorML/models/` snapshots.

The demonstration review packet is `HealthTranslatorML/review-packets/english-smoke-fixture.json`; its key is separately stored under `HealthTranslatorML/private-review-keys/`. It tests packet preparation only and is not a Tibetan reviewer assignment.

The run artifacts retain hashes of code, configuration, dataset, snapshots, templates and outputs. They are local records, with no commit, push or publication performed. Use the [research commands](../../../research/README.md) and [implementation checklist](../../plans/2026-09-04-tibetan-llm-implementation.md) for the next steps.
