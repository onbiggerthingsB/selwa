# First local adapter mechanics result — September 5, 2026

## Result

The Mac completed **20 actual Qwen adapter updates**, saved the adapter and reloaded it in a separate process. All eight intended adapter tensors changed; all **904 frozen base tensors** retained identical shapes, dtypes and byte hashes. Reload checked every saved adapter tensor and then completed a bounded greedy inference request.

This is a mechanics result on four tiny, newly authored **English synthetic extraction examples**, repeated five times. It is not a Tibetan model, a language-quality result, a representative training-throughput estimate or a substantive dataset release. No contributor submissions were used. No downloads, cloud calls or paid compute were performed.

The research web app and production application were unchanged by this batch. The preview server remained running; its observed resident memory was only about 10 MB, so stopping it was not a useful resource intervention.

## What was built

- `research/ml/src/ht_tibetan/training_inputs.py`: complete rendering through the existing project tokenizer/template path; exact generation-prefix text and token equality; final-assistant offsets; decoded target inspection; no truncation; original-position supervision excludes padding. The built-in examples are explicitly synthetic and nonclinical.
- `training_worker.py`: batch-one LoRA updates using pinned MLX/MLX-LM components and a project-owned assistant/EOS loss. It checks finite losses, gradients and parameters, verifies every optimizer step changes an intended adapter tensor, hashes the frozen base before/after, writes private checkpoints and performs strict fresh-process reload.
- `training_mechanics.py`: explicit local snapshot verification, runtime-source hashes, preflight, immutable run records, pre-dispatch smoke exposure reservation, child supervision and resource stops. It requires measurable swap and live worker RSS, preserves failed runs and never downloads missing models.
- `ht-tibetan train-mechanics`: accepts only the built-in synthetic exercise. There is no contributor-dataset argument, resume mode or automatic model selection.

The checkpoint contains adapter weights, not a fused base model or optimizer/RNG state. A new invocation starts a fresh optimizer in a new directory. The generic contributed-data trainer and cumulative release/exposure ledger remain unimplemented.

## Attempts preserved

| Run under the private research root | Outcome | Evidence |
| --- | --- | --- |
| `runs/mechanics-gemma-20260905` | Failed validation, zero updates, before MLX import | The conversion omits explicit vocabulary size. The initial validator incorrectly required it. The corrected path derives 262,208 rows from the verified packed embedding header and checks the loaded vocabulary against that evidence. |
| `runs/mechanics-gemma-20260905-r2` | Interrupted during model loading, zero updates | Swap grew from 5,783,819,386 to 6,885,275,074 bytes, **1.026 GiB**. The unchanged 1 GiB growth stop terminated the worker after 2.17 seconds. Memory pressure was warning level 2. No checkpoint was created. |
| `runs/mechanics-qwen-20260905` | Completed 20 updates and fresh-process reload | The smaller already-cached Qwen conversion ran within the same limits. It was a mechanics control, not a Tibetan candidate winner. |

Gemma's stop concerns system headroom under the observed workload; it does not establish its eventual standalone training requirement or that Gemma cannot train on this Mac. The attempts occurred at different times and are not a controlled memory comparison; no user application or preview server was closed between them. Its PT/IT conversion declaration remains unresolved. Exact local payload identity had been verified and was explicitly sufficient only for this bounded engineering attempt. Both failed attempts remain intact.

## Successful configuration and measurements

Machine: Apple M4 Pro, 24 GiB unified memory, macOS 26.3.1. Native Python 3.12.13; MLX 0.32.2; MLX-LM 0.31.3.

Base: `mlx-community/Qwen3-4B-4bit@4dcb3d101c2a062e5c1d4bb173588c54ea6c4d25`.

Adapter SHA-256: `7075481097e1f01554aa690ce68a3cc5a7b98407c2ee311c6bcd561d407549ef`.

| Setting or measurement | Observed value |
| --- | --- |
| Objective | Final assistant answer plus the exact template-provided end-of-turn suffix; prompt is excluded |
| Training data | Four synthetic English extraction examples; no independent validation/test set |
| Sequence sizes | 26–27 complete tokens; 3–4 supervised tokens per example, including template endings |
| Updates | 20, batch size 1; fixed cycling over four examples |
| LoRA | Rank 4, scale 8, dropout 0; q/v projections in final two transformer layers |
| Trainable parameters | 81,920 in eight tensors |
| Optimizer | Fresh Adam, learning rate 0.0001; seed 0 |
| Total training tokens | 530 complete tokens; 65 supervised tokens |
| Training worker wall time | 5.55 seconds, including loading, hashing and saving |
| Training model-load time | 0.70 seconds |
| Gradient computation total | 1.88 seconds over 20 updates |
| Optimizer/update checks total | 0.10 seconds |
| Fresh reload worker wall time | 2.53 seconds, including verification and inference |
| Peak MLX allocations | 2.38 GB training; 2.41 GB reload (decimal bytes) |
| Peak process RSS | 2.58 GB training; 2.62 GB reload (decimal bytes) |
| Swap during successful train/reload samples | 6,876,886,466 bytes throughout; no sampled growth |
| Lowest sampled free disk | 23,431,143,424 bytes, approximately 21.82 GiB |
| Adapter file | 328,546 bytes, mode 0600 |
| Reload inference | Two generated token steps including stop; output `blue`, on a training prompt; no quality claim |

Each update had finite loss/gradients and changed at least four adapter tensors. All eight changed over the run. These are tiny training examples; falling training loss and answering a previously trained question do not demonstrate generalization. The timing must not be extrapolated to long Tibetan sequences, more adapted layers, larger batches or a real conversation dataset.

The supervisor enforced a 300-second training deadline, 120-second reload deadline, 14 GiB RSS ceiling, 1 GiB swap-growth allowance and 15 GiB free-disk reserve. MLX used a 12 GiB allocator guideline and 128 MiB cache limit. Because the allocator setting is advisory, the worker also checks observed MLX/RSS peaks and the parent terminates on sampled violations. These are detection-and-stop limits, not guarantees that transient system use can never cross a threshold. Resource samples do not attribute every system change to the child.

## Verification and remaining acceptance boundaries

**262 Python core tests passed** with the installed Python environment, including 39 new mechanics tests. These cover renderer/prefix failures, empty and overlong targets, off-by-one/padding cases, nonfinite configuration values, parameter/schema mismatches, checkpoint mutation, output-path escape, missing telemetry and process stops. Core tests import no MLX and load no model.

The successful run separately exercised real Metal loading, gradients, optimizer updates, frozen-base verification, checkpoint writing, exact reload and inference. An independent read rehashed all **18 inventoried run artifacts**, all eight actual saved adapter payloads, and all 904 frozen tensor payloads against the original pinned Qwen file without a mismatch. Run manifests bind the project code hashes, eight relevant installed runtime source files, exact model verification, configuration and synthetic inputs. All checkpoint files use mode 0600 inside a mode-0700 directory.

| Acceptance area | Status after this batch |
| --- | --- |
| T1 identity and T2 rendered inputs | Portable rejection cases pass; actual snapshot verification and loaded-tokenizer equality passed |
| T3 mask and T4 nonempty/untruncated target | Boundary tests pass; actual batch-one loss uses only audited final-assistant/template target tokens |
| T5 finite numerics and T6 real updates/frozen base | Checked on all 20 actual updates; 904 base tensor inventories matched |
| T7 resource accounting | Actual sampled/peak telemetry captured; Gemma stop exercised; representative long-example capacity remains unknown |
| T8 checkpoint and T9 fresh reload | Eight adapter tensors matched names/shapes/dtypes/hashes and values after assignment; checkpoint file hashes bound across processes |
| T10 adapter execution identity | Reload inference records the verified adapter identity; broader adapted-arm comparison harness remains pending |
| T11 bounded interruption | Actual Gemma resource stop preserved an incomplete run and terminated the worker; timeout/cancellation behavior has portable tests |
| T12 restart semantics | No resume path is exposed. Exact optimizer/RNG/sampler continuation is not implemented or claimed |

The production/web/DOM suites were not rerun because their code was unchanged. Earlier counts remain historical evidence. No commit or push was made; the research code and required documentation remain untracked alongside the existing dirty working tree and must accompany any CI delivery.

## Reproduction

Use the already-installed native environment. Choose a new output name; existing runs are never overwritten. The CLI verifies the cache and refuses missing/changed payloads or insufficient/unmeasurable resource headroom.

```sh
"/Users/likerun/Library/Application Support/HealthTranslatorML/envs/mlx-py312/bin/ht-tibetan" train-mechanics \
  --lock /Users/likerun/Desktop/health-translator/research/config/models.lock.json \
  --candidate qwen3-4b-mlx-4bit \
  --root "/Users/likerun/Library/Application Support/HealthTranslatorML" \
  --output "/Users/likerun/Library/Application Support/HealthTranslatorML/runs/mechanics-qwen-new-run" \
  --steps 20 --timeout-seconds 300
```

Private evidence: [successful run manifest](</Users/likerun/Library/Application Support/HealthTranslatorML/runs/mechanics-qwen-20260905/manifest.json>), [checkpoint proof](</Users/likerun/Library/Application Support/HealthTranslatorML/runs/mechanics-qwen-20260905/checkpoint/checkpoint-evidence.json>).

## Next work

Repair the confirmed approval, contribution-permission, duplicate-content and cumulative-exposure gaps before releasing real training or held-out evaluation material. Establish a reachable community/task and permissioned samples for the reviewer agreement pilot and Tibetan comprehension comparison. Then measure complete representative sequences before choosing a substantive adaptation schedule. The web app, retrieval and lab integration remain deferred.
