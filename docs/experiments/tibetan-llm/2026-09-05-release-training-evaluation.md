# Release, training and paired evaluation — September 5, 2026

The Mac completed a full **synthetic-data release → 20 Qwen adapter updates → exact fresh-process reload → paired base/adapter evaluation**. The engineering route works. The constrained evaluation did not show better answers: **base 0/1, adapter 0/1** on one final-test question. The base included the correct requested fact in an explanatory reply, which failed the declared exact-answer format. The adapter reached the 32-token limit; its partial output was preserved and no successful answer was returned.

These were four newly authored, nonclinical **English** fixtures: two training examples, one validation example and one final-test example. Their review and permission records are explicitly synthetic structural fixtures, not statements that people reviewed or consented to anything. No Tibetan training, Tibetan comprehension, native reviewer agreement or clinical correctness was measured. The two evaluation arms are repeated observations of one question and one connected cluster, not two independent test examples.

This report was prepared by reading existing artifacts. It did not load a model, use the GPU or rerun an experiment. Artifact timestamps are UTC on September 6; the runs occurred on the evening of **September 5 in America/New_York**, which determines the report date. Earlier reports remain historical records of their respective stages.

## Native attempts and outcomes

All paths below are relative to the private `HealthTranslatorML` research root.

| Artifact | Outcome | What it establishes |
| --- | --- | --- |
| `releases/engineering-release-20260905-v1` | Built; 2 train, 1 validation, 1 final-test example | Fixed split membership, exact content/permission/audit hashes and isolated final-test reference file. It remains `engineering_only: true`. |
| `runs/release-training-qwen-20260905` | Resource stop, **0 updates** | The last recorded stage was hashing the frozen base before training. Sampled swap grew by **1.772 GiB**, beyond the preset 1 GiB growth limit, and the worker was terminated. No checkpoint was created. |
| `runs/release-training-qwen-20260905-r2` | **20 updates and verified reload completed** | Eight adapter tensors changed; the recorded before/after inventories of all 904 frozen base tensors match. The saved adapter was reloaded in another process and validation loss matched exactly. |
| `runs/release-evaluation-qwen-20260905` | Both planned cases recorded; overall outcome `failed` | The base stopped normally but missed the exact-answer rule. The adapter reached its 32-token limit without stopping. Scoring completed with both attempts in the denominator; the failed generation was not discarded. |

The second training invocation used the same bounded configuration and a new output directory. It was a fresh run with a fresh optimizer, not a resumed checkpoint. The first failure remains intact. Its measurements concern available system headroom during that attempt; they do not isolate the child's contribution to all system swap changes or establish the Mac's maximum training capacity.

Release identity: `26c244ba812043e386df3b7d24c626416b0005ac608820855f548663c8132765`.

Base identity: `mlx-community/Qwen3-4B-4bit@4dcb3d101c2a062e5c1d4bb173588c54ea6c4d25`.

Adapter identity: `sha256:01c41f908da21ab0669a8169de7dc9511e696f4fffb429c5d9efaa0e6da82101`.

The model's exact cached payload was verified for the experiment. Its conversion provenance remains publisher-declared, with no pinned upstream source revision or independently reproduced conversion recipe. This run establishes a bounded local engineering result, not a language-based selection of Qwen over Gemma.

## Training and validation measurements

Hardware recorded by preflight: Apple M4 Pro, 24 GiB unified memory, macOS 26.3.1. The native runtime recorded Python 3.12.13, MLX 0.32.2 and MLX-LM 0.31.3.

| Setting or measurement | Recorded value |
| --- | --- |
| Objective | Final assistant answer plus template end-of-turn suffix; prompt and padding excluded |
| Training schedule | 20 batch-one updates, cycling over two examples |
| Training sequence sizes | 78 and 79 complete tokens; 5 and 7 supervised tokens |
| Training tokens over all updates | 1,570 complete; 120 supervised |
| LoRA | Rank 4, scale 8, dropout 0; q/v projections in final two layers |
| Trainable parameters | 81,920 across eight adapter tensors |
| Optimizer | Fresh Adam, learning rate 0.0001, seed 0 |
| Sequence ceiling | 256 tokens; no truncation |
| Training worker wall time | 7.65 seconds, including loading, base hashing, validation and saving |
| Training model-load time | 0.886 seconds |
| Gradient computation / optimizer-update checks | 3.159 seconds / 0.075 seconds total |
| Fresh reload worker wall time | 4.33 seconds, including verification, validation and a bounded training-prompt inference check |
| Peak MLX allocation | 2.527 GB training; 2.523 GB reload |
| Peak process RSS | 2.562 GB training; 2.534 GB reload |
| Sampled swap growth | 0.193 GiB in training; 0.133 GiB in reload |
| Lowest sampled free disk during successful train/reload | 19.57 GiB |
| Adapter file | 328,546 bytes |

GB above means decimal bytes; GiB means 2³⁰ bytes. These timings describe very short English examples and substantial existing system swap. They are not estimates for representative Tibetan sequence lengths, larger batches, more adapted layers or ordinary chatbot conversations.

**Validation was only one example with four supervised tokens**, including the template suffix, in a 73-token complete sequence. Its token-weighted loss changed from **4.2890644073 before training to 1.5711755753 afterward**. The fresh reload produced the same **1.5711755753** validation loss. This is useful evidence that validation and checkpoint restoration execute consistently. It does not establish generalization or meaningful model improvement. The training token-weighted loss over the 20 updates was 1.8730037113; it aggregates a different set of examples and updates and should not be compared as if it were the same measurement.

The supervisor enforced a 300-second training deadline, a 180-second reload deadline, a 14 GiB worker-RSS ceiling, a 1 GiB swap-growth allowance and a 15 GiB free-disk reserve. MLX used a 12 GiB allocator guideline/observed-peak stop and a 128 MiB cache limit. The allocator guideline is advisory. Worker checks and approximately one-second parent sampling detect violations and terminate the child; they cannot guarantee that transient usage never crosses a threshold between samples. The first attempt's overshoot illustrates that distinction.

## What the paired result means

Both arms used the same native `bounded-greedy-v1` transport, identical 72-token prompt IDs, seed 0, greedy decoding, one explicit English instruction condition and a 32-token output ceiling. The condition records instruction language, output language, task answer kind, instruction hash and condition hash. Its budget basis is an engineering limit; it is not a reviewed Tibetan token-budget calibration.

| Arm | Native generation | Output token steps, including stop | Strict / normalized exact matches | Interpretation |
| --- | --- | --- | --- | --- |
| Base | Normal stop | 25 | 0/1 / 0/1 | Correct requested fact appears, but additional explanation violates the declared exact-answer format. This is not proof of a factual comprehension failure. |
| Adapter | Output limit | 32 | 0/1 / 0/1 | No stop within the budget; the successful-answer field is null. The partial reply cannot be counted as a completed answer. |

Base and adapter generation time was 0.637 and 0.574 seconds respectively; whole supervised worker time was 2.793 and 2.998 seconds. One case, different load/cache conditions and adapter-verification overhead do not establish a speed ranking. The adapter arm explicitly records successful adapter verification and its exact checkpoint identity.

The scoring artifact is valid and complete even though the run outcome is `failed`. That is the intended preservation of an unsuccessful model result, not evidence that the scoring route crashed. No confidence interval, statistical significance or held-out improvement is established. The rule and output cap were not revised after seeing this result.

The final-test group is now recorded as exposed. It cannot be presented as a fresh unseen test for subsequent tuning. Training verification never opens the locked release's test payloads. When checking historical evaluated runs, the cumulative inventory streams case/report bytes for integrity hashing without deserializing test text; only exposure fingerprints and required metadata are parsed.

The inference result field `synthetic: false` means a real model generated the output. It does **not** mean the examples came from people: the dataset, release and run remain explicitly synthetic and engineering-only.

## Implementation now available

- **Release and permission checks:** immutable, purpose-separated releases bind source/example contents, reviews, contributor grants and cumulative local exposure. Current grants are rechecked before real use; revoked or expired permissions cannot be replaced by an older snapshot. Engineering labels cannot be promoted into human evidence by changing one flag. A training load rejects orphan source cards and returns only its selected splits.
- **Authorship and review independence:** real non-review data-use checks combine the primary contributor with all known source writers and example coauthors from valid permission clearances. Two completed current language reviewers must be outside that entire author set, with supporting approval from at least one independent reviewer. Known authors cannot adjudicate. A nonauthor reviewer may adjudicate when the overlap is disclosed; draft material can still be sent for permitted review. Unknown authors and identity authenticity cannot be established by these local records.
- **Training and adapter execution:** the released-data trainer binds the instruction condition, rendered token IDs, assistant offsets, objective, validation set and checkpoint. Real-data training also requires the study/model-selection evidence. Training uses the selected train/validation payloads; the paired inference route verifies the actual adapter tensor set and base identity.
- **Condition and evaluation tools:** explicit instruction-language conditions, per-candidate token ceilings, fixed planned-case denominators, constrained scoring, distinct base/adapter identities and group-aware summaries replace informal comparisons. A content-preserving source span is not rejected merely because it copies the passage, and textual presence alone does not establish relevant or medically correct meaning.
- **Study and reviewer tools:** preregistration, declared pilot item rosters, agreement/timing/critical-category records, blinded evaluation review and explicit model-decision receipts can record the human evidence. These tools do not manufacture a community/task choice, native ratings, reviewer agreement, calibrated budgets or a selected Tibetan model.

The fake-backed web interface remains a separate demonstration. This batch does not connect it to the trained adapter, add retrieval, integrate generated lab-report explanations or enable public health guidance.

## T1–T12 acceptance status and limits

These rows update the acceptance cases in the [independent-review response](2026-09-05-independent-review-response.md). Portable checks and native measurements are different evidence; neither substitutes for a representative Tibetan trial.

| Case | Portable / implementation evidence | Native evidence in this batch | Remaining limit |
| --- | --- | --- | --- |
| T1 Identity | Unknown/mutated model, tokenizer, template and checkpoint guards | Pinned cached base verification; release, condition and adapter hashes bound across stages | Conversion recipe not independently reproduced; no language-based candidate choice |
| T2 Rendering/offset | Exact project renderer/prefix/target checks | Runtime input IDs verified in train/reload and paired inference | Representative Tibetan supervision spans still need inspection |
| T3 Mask | Mixed-length and padding boundary checks | Batch-one assistant/template-suffix objective; explicit supervised-token counts | Native mixed-length padded batching was not exercised |
| T4 Length/empty target | Overlong, empty and entirely masked input rejection | Short 78/79-token training and 73-token validation sequences; no truncation | No representative long Tibetan training input |
| T5 Numerics | Nonfinite loss/gradient/configuration rejection | All 20 recorded steps have finite losses, gradients and updates | No deliberately injected native NaN experiment |
| T6 Updates | Expected trainable-set and update checks | Eight adapter tensors changed; 904 frozen tensor inventories identical before/after | Two examples do not establish useful adaptation |
| T7 Resources | Supervisor deadlines, telemetry requirements and resource stops | Load/update/validation/reload measurements; actual swap-growth termination before the first update | Long-sequence capacity and representative throughput remain unmeasured |
| T8 Checkpoint | Exact file/tensor names, shapes, dtypes and hash checks | Private checkpoint saved; this report independently rehashed all eight saved adapter tensor payloads | No optimizer/RNG/sampler state in this checkpoint |
| T9 Reload | Missing/extra/renamed/wrong-shaped checkpoint rejection | Fresh-process exact reload and exactly matching validation loss | No additional model-family reload trial in this batch |
| T10 Evaluation identity | Distinct checked base/adapter identities and matched transport | Both arms evaluated on identical prompt IDs; adapter verification recorded | Both scored 0/1; no claim of improvement |
| T11 Interruption | Portable timeout/cancellation handling | Real resource stop preserved a zero-update attempt and terminated its worker | No claim of exact recovery from an interrupted optimizer update |
| T12 Restart | Resume is not exposed; fresh optimizer/directory required | Successful retry was a new run | Exact optimizer/RNG/sampler continuation is unimplemented and unclaimed |

## Artifact verification and remaining work

The read-only report check verified hashes and sizes for **55 inventoried artifacts** across the release and three runs, plus recorded identities for the four manifests and release digest. It independently checked the actual eight saved adapter payload hashes, their shapes/dtypes and the adapter-file identity; all matched. It also checked equality of the recorded 904-entry frozen-base inventories. The full cached base model was **not** rehashed again for this report. Native worker evidence records the original before/after base checks and exact reload.

The [sanitized evidence JSON](2026-09-05-release-training-evaluation-evidence.json) contains numeric measurements, relative artifact paths and hashes. It omits passages, questions, references, reply text, token-ID arrays, private absolute paths and personal/consent details.

The root implementation run reported the following final checks; the package and exposure-inventory summaries were also read directly while preparing this report:

| Check | Result |
| --- | --- |
| Python core, `unittest` | **580 passed** |
| Offline reviewer DOM tests | **58 passed**, including eight new evaluation-form tests |
| Production tests | **1,252 passed; 41 existing skips** |
| Research web tests | **243 passed** |
| Research web lint, typecheck and build | Passed |
| Root TypeScript check | Passed |
| Production build | Passed, exit 0; eight static pages generated |
| Isolated wheel build/install outside checkout | Passed; imported from the installed wheel; **68 source/schema/fixture/asset files byte-identical** |
| Installed-package checks | Schema/study validation, offline HTML rendering and module CLI validation passed |
| Current cumulative exposure inventory | Valid: **12 finalized manifests, 156 scanned files, 133 hashed files and 12 merged exposure entries** |

Wheel SHA-256: `7934d70b07cb88ae381114cfea3502fe91f3f19e84d92a94e36dc92d527406cb`. Packaging and portable-test success do not replace the separately recorded native experiment or establish language quality.

The final source inventory contained 188 untracked research/documentation files, approximately 2.1 MB, with no model weights, environments, caches, private review keys or run artifacts included. The root run reported a clean whitespace/diff check. These are local implementation and packaging results; no commit, push or deployment was performed.

The CLI also exported the native evaluation review packet and a 20,492-byte standalone HTML form. Their checked SHA-256 values are `040bb1109f5b019467af92a45d566599b5a69f9e9930783b32248003164c309a` for the packet and `96dd1bcbe5139abf3de51098d90d690d760bf81cef8726e04abeda212ec24f1d` for the HTML. The DOM workflow exercised a separate ten-item synthetic form, downloaded its JSON through the actual form script and verified the round trip. These are blank/synthetic review exercises, not collected reviewer judgments. CUA's local-file URL policy blocked the attempted visual preview; no workaround was attempted and no real-browser visual inspection is claimed for this form.

Next, the project needs a specific reachable community and constrained comprehension task, genuinely permissioned Tibetan material, native review and a small agreement/timing pilot. Candidate-specific limits should then be calibrated on those exact materials, followed by a reviewed baseline and explicit model decision. A representative Tibetan training trial must measure complete sequence sizes and system headroom before choosing an adaptation schedule. Qualified clinical review is still needed before health guidance; none of these engineering results establishes that readiness.
