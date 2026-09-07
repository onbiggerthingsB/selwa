# Independent review reconciliation — September 5, 2026

## Outcome

Claude's central criticism is accepted: the project has substantial evaluation/review infrastructure and a simulated interface, but no training implementation, gradient steps, saved adapters, reviewed Tibetan comparison or selected task/community. The next work must establish local training mechanics and Tibetan comprehension, not extend the interface.

This turn changes the execution plan and records the review. It does **not** fix the code findings, train a model, register unknown-permission text, reallocate money or select a base. All acceptance cases below remain pending.

Scope: current working tree at base commit `d4303cd`, including untracked research files. Codex inspected the repository, the original Tibetan specification, the installed MLX-LM source and synthetic in-memory validator probes, with two independent bounded code inspections. No model or MLX runtime was loaded for this response.

## Evidence and qualifications

| Review finding | Current assessment | Consequence |
| --- | --- | --- |
| Training and real language evidence absent | Confirmed by current module inventory, study template and reports. Stage 6 is a fake-provider application. | Do not call the interface a model or describe engineering tests as model progress. |
| Research/CI delivery incomplete | `git status --short` shows `research/`, new experiment/plan/handoff docs and other files untracked. Modified `.github/workflows/ci.yml` requires research paths. | Deliver the required files with CI as one coherent reviewed change; do not commit a workflow whose inputs are absent. This turn makes no commit. |
| Available disk is no longer 35GiB | `df -k .` returned 23,819,616 KiB, approximately 22.7GiB. The old 35GiB figure was a historical snapshot. The swap query was denied by the sandbox. | Recheck before training and project peak storage. Claude's 5.6GB swap figure remains reported, not independently refreshed here. Missing telemetry cannot be described as healthy headroom. |
| Gemma has lower Tibetan token cost in Claude's sample | Claude reports approximately 1.45 codepoints/token versus Qwen's 0.73 on 108 strings. This response did not locate/register those strings, verify their permissions or reproduce the measurement. | Treat the figures as sample-specific external review evidence. Rerun on permitted exact text with composition and per-case results recorded; token cost is not comprehension or measured training speed. Vocabulary-entry counts alone are not a model ranking. |
| Typography fixture is not a language audit | Confirmed by its declared fixture purpose and prior reports. | Keep it a rendering test. It supplies no evidence of Tibetan task performance. |
| A common 128-token cap is unfair | Confirmed for the synthetic script probe; baseline templates also contain other limits. Equal token ceilings compare a resource budget, not equal answer capacity. | Specify a common task/output allowance, then candidate-specific token ceilings and explicit truncation outcomes. Tsheg segmentation remains a proxy. |
| English instructions unrecorded | Partly overstated. `baseline.py` and `parallel.py` hardcode English instructions; case `messages` preserve the full text. There is no explicit `instruction_language` condition. | Add condition metadata and exact instruction/template binding. Keep historical artifacts intact and describe them as English-instructed. |
| Fake-only chat schema and no model transport | Confirmed in `research/web/lib/contracts.ts`, `inference.ts` and shared contract. It requires fake identity, `synthetic:true` and null tokens. | Freeze features. A real bridge needs a separate versioned contract, resident model lifecycle and complete tokenizer accounting. Do not weaken the existing demo schema to appear connected. |
| Real replies fail silently | Narrow this claim: response validation errors become `runtime_failure` with null answer, rendered as failure. Diagnostic causes are collapsed, but fabricated success is not returned. | Preserve fail-closed behavior; future real transport needs useful typed failures and private diagnostics. |
| Ten-second deadline and character limits cannot serve as ML limits | Confirmed: fake inference permits at most ten seconds; `mlx_backend.py` has an 8,192-token local total bound and 512-output-token bound. | Before a future real bridge, tokenize the entire source/history/template and reserve output; measure resident inference, queue/load and generation separately. Existing inference workers already record load seconds; training-specific measurements are absent. |
| Identical text can cross train/test | Confirmed for identical question/claims/answer under different source hashes and declared groups. The in-memory probe was accepted with `unseen_final_test:true`. **Identical source passages are already connected by `source_sha256`**, with a regression test. | Add task-content fingerprints and inspectable overlap screening. Common answers such as “yes” must not alone connect the entire dataset. Preserve originals and adjudicate similarity flags rather than silently normalize them. |
| Exposure snapshots never read | Overstated literally: the CLI can audit a supplied snapshot and blind-review checks exposure artifact inventory. The real defect is absent cumulative reconciliation: a later run can use a stale dataset and omit earlier exposures. | Require a verified exposure inventory/ledger snapshot when creating training or locked-test releases; merge across source, content and connected-group identity. |
| Language approval over unanimous rejection | Confirmed. `records.py:198` counts two complete independent language reviews without requiring supporting recommendations. An approved training example with two rejects passes. | An unchanged example with unanimous rejection cannot be approved. Require revision/re-review or an explicitly defined escalation with supporting evidence; retain original judgments. |
| Adjudicator independence absent | Confirmed in the main example path: contributor-as-adjudicator and reviewer-as-adjudicator both pass. Some other workflows already reject contributor self-adjudication. | Reject author self-adjudication consistently. Define whether a reviewer may adjudicate; if allowed, record overlap and do not imply a third independent judgment. Do not invent a universal three-person rule without accounting for reviewer capacity. |
| Contributor permission missing | Confirmed: source permitted uses and some derivative permissions exist, but they do not bind each contributor's authored contribution to an explicit use grant. | Add versioned contributor/contribution grants and check source rights separately. Unknown or withdrawn permission blocks release; private evidence references remain outside model text. |
| No release/locked-test builder | Confirmed by module inventory. | Validator success is not a training-data release or proof of an unseen test. |

These are pre-release defects. There is no already-trained adapter or published held-out score here whose contamination was demonstrated.

Claude reports reproducing 223 Python core tests using `unittest`, 243 web tests, 50 reviewer DOM tests and 1,252 production tests with 41 skips. These counts agree with the supplied project history; this response did not rerun those full suites. The validator reproductions and installed-source inspection establish gaps that those suites do not cover. Python core verification uses `python -m unittest discover -s research/ml/tests -v`; pytest is not required for it.

## Installed training behavior

Inspected package root:

`/Users/likerun/Library/Application Support/HealthTranslatorML/envs/mlx-py312/lib/python3.12/site-packages/`

The following refer to the installed MLX-LM 0.31.3 implementation, not an assumption about upstream `main`.

| Behavior | Evidence | Required response |
| --- | --- | --- |
| Prompt masking defaults off | `mlx_lm/lora.py:42–75`, `tuner/datasets.py:50–77` | Define the intended assistant-only objective explicitly. Prompt prediction is a different legitimate objective, not an implicit substitute. |
| Trainer truncates lengths without updating assistant offsets | `tuner/trainer.py:143–170`; loss denominator at `95–97` | Reject overlong/empty-target records before execution. A printed warning is not a hard failure; all-masked batches can reach division by zero. |
| Padding target included by inclusive upper bound | `tuner/trainer.py:92–97` | Own the loss mask as well as the token/offset input. Use `offset <= target_position < token_count`, with explicit EOS policy. |
| Adapter loading uses `strict=False` | `tuner/utils.py:113–137`, `mlx/nn/layers/base.py:123–207` | Verify exact tensor names, shapes, dtypes and loaded values. Missing adapter tensors must fail, not quietly evaluate the base-equivalent zero-initialized adapter. |
| Training and validation aggregation differ | `tuner/trainer.py:205–213`, `325–335` | Report the objective and denominator. Equal weighting of batch means differs from token-weighted loss when lengths vary; this alone is not proof that optimization is wrong. |
| Resume restores weights only | `mlx_lm/lora.py:247–250`, `274–292`; `tuner/trainer.py:370–386` | Call it a warm restart. Exact resume requires saved and verified optimizer, sampler/RNG and update state. |

The extra padding finding was checked by reproducing the installed mask arithmetic with integers, without GPU execution: a six-token sequence has real target positions 1–5. With final-assistant offset 3 in a padded batch, the installed inclusive mask selects `[3,4,5,6]`, including the first pad. The intended selection is `[3,4,5]`. A 40-token example with offset 35 truncated to 32 has no supervised positions. These examples must become executable regression cases before the first training run; they are not measurements of real training.

## Decisions on Claude's proposed changes

1. **Accept parallel mechanics and comprehension tracks.** A short synthetic mechanics exercise need not await a real community study or candidate winner. Do not fabricate native judgments to fit the existing production-data contract. Record the exercise's exact synthetic inputs and permanently exclude them from held-out evidence.
2. **Modify the bare-CLI recommendation.** Inspecting these defaults uncovered enough to require a minimal correct loss/input path, finite-loss checks and adapter verification before approximately 20 updates. This is a small mechanics entry point, not the full training/release platform.
3. **Accept comprehension first as the product research direction.** Start with constrained, inspectable answer types. Exact labels/extracted spans can test defined tasks; they do not verify unrestricted generated health explanations.
4. **Accept the interface freeze and deferral of retrieval/lab integration.** Repair the confirmed data issues and train locally before adding product surface area.
5. **Accept explicit instruction-language conditions and task-equivalent output allowances.** Do not use one global Tibetan syllable cap as proof of semantic parity. Keep the resource-limited interpretation of earlier probes explicit.
6. **Do not select Gemma from tokenization alone.** Its reported compression is encouraging. Exact local artifact verification and resolution or explicit bounded disposition of the PT/IT conversion ambiguity precede a mechanics run. A new commit hash alone supplies neither conversion provenance nor training compatibility; no new download is automatic.
7. **Remove blanket input-copy rejection as an acceptance rule.** Source extraction can legitimately copy input. If retained as a diagnostic, it must be task-specific and must not reject correct extraction answers. This turn does not remove source code; no such general rejection rule was located in the current execution plan.
8. **Keep the budget transfer proposed.** The plan records a possible $350 transfer from the clinical reserve to language review; no funds move and no cost estimate is asserted until the agreement/timing pilot informs scope. Health work still requires qualified review later.

The original [Tibetan specification §4](../../superpowers/specs/2026-07-20-tibetan-support.md#4-zhbo-machine-translation-not-good-enough-for-any-tier-do-not-design-around-it) supplies a real architectural constraint: deterministic structural checks cannot verify unrestricted Tibetan meaning. The updated execution plan explicitly preserves that production boundary. The historical benchmark numbers in that specification were not refreshed in this response and are not used as current model scores. Private experiments can investigate language ability without promising to ship generated medical prose.

## Training acceptance cases — pending

| Case | Required evidence |
| --- | --- |
| T1 Identity | Reject unknown or mutated base, tokenizer, template and adapter configuration; bind actual local payloads. |
| T2 Rendering/offset | Project-rendered IDs equal runtime inputs; inspect the assistant prefix and decoded supervised target independently. |
| T3 Mask | Mixed-length padded cases supervise only intended assistant/EOS positions; independently calculated token counts exclude prompt and padding. |
| T4 Length/empty target | Overlong, empty and entirely masked records fail before model execution. No truncation. |
| T5 Numerics | Nonfinite loss or gradients abort; an aborted run cannot write a successful manifest. |
| T6 Updates | An actual optimizer update changes intended adapter tensors; frozen base tensors stay identical; no unexpected trainables. |
| T7 Resources | Record load/update time, complete/supervised token counts, MLX allocations, process RSS, available system pressure/swap and free disk. Set concrete time/resource stop limits before execution; unavailable telemetry stays unavailable. |
| T8 Checkpoint | Save the expected tensor set, dimensions/dtypes, configuration and hashes; reject incomplete artifacts. |
| T9 Reload | Fresh-process reload matches every saved tensor; missing, extra, renamed or wrong-shaped tensors fail. |
| T10 Evaluation identity | Base and adapter arms bind distinct verified identities; adapter inference uses reloaded weights. Every prompt need not produce different wording. |
| T11 Interruption | Stop the worker within the declared bound, preserve diagnostics and mark the run incomplete. |
| T12 Restart | Label weights-only restart accurately. Claim exact resume only after equivalence of optimizer/RNG/sampler/update state is tested against an uninterrupted control. |

## Next implementation batch

1. Build the smallest training mechanics entry point covering correct rendered inputs/masks, numerics, identity, update/reload proof and hard resource limits; use newly authored synthetic nonclinical material only. Run approximately 20 updates once those checks and local artifact preflight pass.
2. Repair the confirmed review/permission/duplication/exposure holes and make release eligibility consume verified cumulative evidence. Avoid a larger framework than these concrete cases require.
3. In parallel with engineering, obtain a community/task decision and permissioned material for a ten-item agreement pilot and properly recorded Tibetan token/comprehension comparison. Unknown-permission temporary strings remain ineligible for reuse until their source and contributor scope are established.

No training throughput, Tibetan comprehension, reviewer agreement, adapter improvement or production readiness is claimed by this report.
