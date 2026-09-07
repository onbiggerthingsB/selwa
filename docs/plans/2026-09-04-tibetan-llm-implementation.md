# Tibetan language-model implementation plan

**Owner: Codex. Status: the bounded release, training, evaluation and independent-review workflow is implemented. A released synthetic Qwen run completed 20 updates and exact reload; its one-question paired evaluation did not pass the answer-format requirement. Real community material, the reviewer pilot, Tibetan comprehension and representative-sequence capacity remain pending. Research web development is frozen.**

Progress and evidence: [first engineering batch](../experiments/tibetan-llm/2026-09-04-foundation.md), [local model runner](../experiments/tibetan-llm/2026-09-04-local-runner.md), [model-output review workflow](../experiments/tibetan-llm/2026-09-04-review-roundtrip.md), [paired comparison path](../experiments/tibetan-llm/2026-09-04-paired-comparison.md) and [offline review forms](../experiments/tibetan-llm/2026-09-05-offline-review-forms.md).

September 4, 2026. This is the execution plan I will follow for the accepted Revision 3 research direction. It is not a prompt or handoff for another coding agent.

September 5 continuation: [private synthetic conversation demo and verification](../experiments/tibetan-llm/2026-09-05-private-chat-demo.md). This interface work does not complete the native-reviewed comparison or connect a model.

## September 5 revision after independent review — current execution order

This section supersedes conflicting sequencing below. The earlier reports remain historical evidence. See the [review reconciliation and training acceptance cases](../experiments/tibetan-llm/2026-09-05-independent-review-response.md) for verified findings, qualifications and work still unimplemented.

Earlier measured result: [first adapter mechanics report](../experiments/tibetan-llm/2026-09-05-first-adapter-mechanics.md). A1's small synthetic proof completed on Qwen: 20 updates, eight changed adapter tensors, 904 unchanged frozen tensors, saved checkpoint and verified fresh-process inference. Gemma stopped during loading on the unchanged swap-growth limit. Neither result selects a Tibetan candidate.

Earlier engineering continuation: [data safeguards report](../experiments/tibetan-llm/2026-09-05-data-safeguards.md). Unsupported language approval, contribution-permission revisions, exact/normalized duplicate content and recorded historical exposure gained enforced checks. Its test and inventory counts describe that historical batch.

Latest continuation: [released training and evaluation report](../experiments/tibetan-llm/2026-09-05-release-training-evaluation.md) and [operator workflow](../../research/release-workflow.md). Immutable releases isolate final-test references; training checks current permissions and selection evidence, owns tokens/masks and verifies reload per tensor. Base/adapter evaluation records explicit instruction language and model-specific budgets. Offline blinded reviews, agreement analysis and explicit candidate-selection receipts are implemented. All known source authors/coauthors are excluded from independent approval of their own contributions. The native release experiment completed 20 Qwen updates and reproduced loss on one validation example, but neither output on the single final question met the exact answer requirement. This demonstrates mechanics and failure accounting, not an improvement in Tibetan.

Further engineering repair: [evaluation planning and preregistration](../experiments/tibetan-llm/2026-09-05-evaluation-preregistration.md). The planner lists pilot output IDs without opening data or executing a model. Real study readiness now requires a bound development configuration and reviewed instructions/budgets; early target checks reject out-of-task answers. Reordering cases cannot silently change the registered pilot, and descriptive analysis retains failed generations and incomplete reviews. Actual native material and judgments remain pending.

Community update: the project owner identified **Lhasa** as the initial recruitment community. A separate private Lhasa study draft records that choice; the original generic template remains intact. The [first collection brief](../../research/review/lhasa-first-collection.md) proposes one writer and two independent non-author reviewers. Specific participants, permissions, local written-register choices and actual reviews remain unconfirmed.

The immediate research question is whether a candidate understands a short, permissioned Tibetan passage under a defined task and instruction language. The immediate engineering question is whether a bounded adapter update can be measured and reloaded on this Mac. These can proceed independently. A synthetic training exercise does not select a Tibetan model or establish permission to use anyone's contributions.

| Order | Work | Acceptance and dependency |
| --- | --- | --- |
| A0, human track — Lhasa identified | Confirm participants and the proposed nonclinical comprehension task; agree register, questions and permission scope | Lhasa is the user-identified recruitment community. A completed study record and actual participant input are still required before a real language study |
| A1, engineering track — small proof complete | Validate the pinned training input/loss path and run approximately 20 adapter updates on short newly authored synthetic examples | Completed on Qwen; exact inputs, finite updates, frozen base, per-tensor reload and resource evidence. Representative sequence capacity and Tibetan quality remain unknown |
| A2 — accounting implemented; native material pending | Register eligible real Tibetan material and rerun complete tokenizer accounting | Exact text/source/contribution identities and use permissions; the reported 108 temporary strings are not eligible merely because they exist. New release audit measures exact instructions and complete sequences without opening test data |
| A3 — safeguards implemented | Repair data/review contracts before real releases | Current approvals and contribution ledgers, all known authors, exact/normalized duplicate edges and cumulative recorded exposures checked. Human consent, undeclared authors and semantic overlap require review |
| A4 — bounded release runner implemented and exercised | Extend the runner to eligible versioned releases and verify T1–T12 | Synthetic release completed training/validation/reload with exact tensor identity. Real study gates are enforced; representative Tibetan lengths and maximum capacity remain unmeasured. Exact optimizer-state resume is unsupported |
| A5 — implemented and exercised | Add adapted-model identity and instruction-language conditions to CLI evaluation | Native paired base/adapter dispatch uses matching prompts/accounting, exact checkpoint verification and honest failure denominators. One synthetic final question did not pass |
| B1 — tools implemented; actual pilot pending | Run a ten-item reviewer agreement and timing pilot on constrained answers | Blinded offline forms and agreement/timing analysis preserve incomplete fields. Collect actual independent ratings, coordination and adjudication time before fixing dataset size |
| B2 | Run the reviewed unadapted comprehension comparison | Balanced answer types, number/negation changes and unavailable information; exact-match labels/extractions where appropriate, native review where semantics remain open |
| B3 | Select a task/model, or record a stop decision | Compare task accuracy, critical errors, uncertainty, review burden and resources; token efficiency alone cannot choose the model |
| B4 — tooling implemented; real adaptation pending | Build permission-checked training/validation/locked-test releases, then run bounded adaptation | Immutable release builder and bounded trainer exist. Actual Tibetan contribution rights, reviewed candidate selection and representative capacity are still required |
| B5 — tooling implemented; real evaluation pending | Evaluate unchanged base versus saved adapter on the locked task | Same conditions, failed/missing cases and clustered denominators are implemented; actual native judgments and task results remain pending. Test inspection marks exposure; no automatic production promotion |

A1 begins with a minimal inspected program around the pinned trainer, not an unchecked bare CLI invocation. It need not wait for A0/B2 or the full release system. Its synthetic inputs, identity and exposure must still be recorded and permanently excluded from held-out claims. Gemma can be the first mechanics candidate only after local tensor/loader identity and its unresolved conversion declaration are addressed explicitly. A newer revision alone does not resolve provenance. If that work is blocked, use another already-verified compatible local candidate for a mechanics control without calling it the Tibetan winner.

For comparison, set equivalent task/output requirements first, then derive and record model-specific token ceilings from the exact tokenizer and representative permitted material. Report orthographic output length, actual tokens, truncation and wall time. A shared 128-token ceiling is only a bounded engineering probe. Tsheg-delimited segments are a declared length proxy, not a reliable semantic-equivalence guarantee. Include `instruction_language`, instruction text/hash and rendering policy as explicit conditions; the old English instructions remain recoverable in run artifacts.

Freeze `research/web/` feature work. The current contract is intentionally fake-only; a real transport, resident model process, token-aware context checks, lifecycle deadlines and versioned real-result schema are future work after B5. Defer retrieval and lab integration Stages 7–8D. Previously approved production containment remains in place.

The production Tibetan [specification §4](../superpowers/specs/2026-07-20-tibetan-support.md#4-zhbo-machine-translation-not-good-enough-for-any-tier-do-not-design-around-it) remains the shipping boundary. Retrieval, number checks, citations, back-translation and model agreement do not provide a semantic verifier for unrestricted Tibetan generation. Passing a private comprehension study does not relax that boundary. A future product decision needs a separately justified task, human assessment and any required clinical review. The first useful outcome may be passage selection, constrained extraction or displaying reviewed text rather than generating an explanation.

This revision changes the order of engineering work; it does not authorize spending a new budget. Claude's proposed transfer of $350 from the clinical reserve to native review is retained as a proposal, to be sized from the pilot. No clinical capability is assumed while a clinician is unavailable.

Before a repository delivery, stage the research code, shared contracts, required documentation, locks and CI changes as one coherent change, and inspect the staged inventory for private data. The current dirty/untracked tree is not a reproducible commit. No commit, push or deployment is recorded by this revision.

## 1. What I will build

I will build a reproducible local experiment that tests compact models' comprehension of everyday Tibetan and proves local adapter-training mechanics. Substantive adaptation depends on that evidence. A useful private assistant remains the longer-term aim; its output design will follow the evidence rather than assume generated explanations are acceptable. Lab-report translation is a later possible tool after the relevant existing-app repairs.

The later candidate-adaptation milestone, if the comprehension evidence supports it, will contain:

- A working local evaluation runner comparing Qwen3-4B and Gemma3-4B-it on the same reviewed material.
- A recorded model-selection decision based on comprehension, fidelity, language quality, context requirements and resource measurements.
- A short successful adapter-training test, followed by a bounded substantive experiment if the language evidence supports it.
- A saved adapter, exact base/tokenizer identities, reviewed dataset manifest and held-out comparison with the unchanged model.
- A separately justified private interface for the tested task; generated explanations are not a condition for declaring the experiment useful.

If no candidate supports a useful task, I will deliver the measured failure analysis and working evaluation tools before proposing another base or training strategy. A poor result will not be concealed behind a larger dataset or a polished interface.

**Constraints:** Apple M4 Pro, 24GiB unified memory; 21.82GiB minimum available disk and 6.405GiB swap use sampled during the successful September 5 mechanics run, to be refreshed before further resource-heavy work; $1,000 total budget; Tibetan speakers available; no clinician or dietitian currently available. Native supervision now reads actual swap/RSS telemetry; unavailable required readings stop a run. Cloud spending remains $0. The first implementation is a private language and source-fidelity experiment, not a public health-advice service.

Planning sources: [Revision 3 research plan](/Users/likerun/Desktop/health-translator/output/pdf/tibetan-health-llm-research-2026-09-04.pdf), [codebase review](/Users/likerun/Desktop/health-translator/output/codebase-review-2026-09-04/review.md), and the current repository. This document adds implementation choices and acceptance checks; it does not turn proposed experiments into measured results.

## 2. Architecture I will implement

I will keep the existing production app and the research chatbot in separate Next.js applications within this repository. The research app will use its own route tree, package scripts and test configuration. This prevents experimentation from silently reopening the quarantined advice feature or changing the production rule against generated Tibetan.

```text
New permissioned language samples and source cards
                    |
         Python validation and review tools
                    |
       Tokenizer audit and model comparison
                    |
        Selected base -> adapter training
                    |
         Locked evaluation and model card
                    |
Later justified private UI -> fixed local MLX inference process
                    |
   Task-appropriate constrained or reviewed source output
                    |
       Later: repaired, confirmed lab facts
```

The command-line experiment now takes priority over further chatbot work. The fake UI was built early; that is not model progress. In the first model comparison, evidence will be selected explicitly. Retrieval remains deferred.

| Location | Planned responsibility |
| --- | --- |
| `research/ml/` | Isolated Python project, command-line tools, model loading, training and evaluation |
| `research/contracts/` | Versioned JSON schemas and shared valid/invalid fixtures |
| `research/config/` | Study configuration, candidate definitions and bounded experiment recipes |
| `research/review/` | Blank reviewer templates and instructions; no raw submissions |
| `research/web/` | Separate local Next.js application, chat API and source-card UI |
| `docs/experiments/tibetan-llm/` | Sanitized decisions, measured results, model card and failure summaries |
| `/Users/likerun/Library/Application Support/HealthTranslatorML/` | Model cache, Python environment, local datasets, reviewer submissions, runs and adapters |

Paths in the first six rows are relative to `/Users/likerun/Desktop/health-translator`. These directories now exist, including the fake-only research web app. The Python build root is `research/pyproject.toml`, so source archives include the shared contracts. The local data directory is configurable through `HT_ML_ROOT`; large files and contributor records stay outside the synced Desktop checkout. Repository delivery must include only code, schemas, permitted fixtures and appropriate sanitized results.

Both live processes will bind to `127.0.0.1`. The research app will use a distinct port and no service worker. The browser will call its own API; only that server will contact the fixed MLX endpoint. The browser will not choose model paths, adapter paths or arbitrary backend URLs.

## 3. Execution order and dependencies

| Stage | My implementation work | Required evidence before advancing |
| --- | --- | --- |
| 1. Foundation | Isolated project, contracts, preflight and fake inference adapter | Reproducible checks work without a model download |
| 2. Study and review setup | Contributor templates, source/example validation and review round trips | Target task, permitted samples and a reviewed development screen |
| 3. Compare candidates | Tokenizer audit and sequential local inference | Documented comparison and one suitable candidate, or a bounded failure decision |
| 4. Prove training works | Short training, adapter verification and fresh-process reload | Actual parameter updates, valid outputs and measured resource headroom |
| 5. Adapt and evaluate | Measured-size training export, bounded tuning and locked test | Reproducible comparison, failure catalogue and explicit limitations |
| 6. Build the private chatbot | Source-card UI, local API and validated inference interface | Complete private source-explanation workflow; no production activation |
| 7. Add retrieval | Small lexical/glossary baseline and separate retrieval evaluation | Measured difference from manually supplied evidence |
| 8. Integrate lab reports | Relevant repairs, versioned lab contract and private integration | Confirmed facts survive the full report-to-chat path |

The already-approved notes-containment repair is complete and remains in place while contributor material is prepared. Other existing-app repairs become prerequisites when their components enter the research workflow. An isolated experiment with new cards does not wait for every legacy defect to be repaired.

I will use small reviewable changes for these stages. I will not combine model selection, substantive training and production integration into one change.

## 4. Stage 1: build the experiment foundation

### Tasks

- [x] Create the Python project with a console entry point named `ht-tibetan`, core tests that do not require MLX, and a separate Mac-only model test group.
- [x] Use a native Apple Silicon Python environment compatible with the selected MLX release. Resolve and lock exact package versions; save the platform and Python version. Do not assume the bundled Python or an x86 environment is suitable for model training.
- [x] Implement `preflight`: capture hardware, OS, free disk, runtime versions, configured data root and projected peak storage.
- [x] Preserve at least 15GiB free as the initial project headroom target. Count model snapshots, environments, conversions, temporary downloads and checkpoints before each large operation. This is our planning margin, not an MLX requirement.
- [x] Add candidate definitions for Qwen3-4B and Gemma3-4B-it. Resolve exact upstream and quantized checkpoint revisions, terms and file sizes before acquisition. Prefer a suitable existing 4-bit conversion over an unnecessary full-precision conversion.
- [x] Implement a fake inference adapter and the same request/result interface that the real adapter will later use.
- [x] Add ignore rules for caches, raw reviews, generated datasets, transcripts, environments and model artifacts. Keep small licensed fixtures explicitly allowlisted.
- [x] Give research code its own type, lint and test configuration. Production checks now exclude research precisely; separate research checks cover it.

The model catalog pins candidate snapshots, sizes and declared terms. Both selected 4-bit snapshots have now been acquired, verified and loaded locally, with four successful synthetic English requests. The Gemma conversion's conflicting base-model declaration remains unresolved; its text loader worked in the observed checks. The 15GiB disk rule is implemented and boundary-tested; each future large operation still needs its own full storage projection. Free disk after that earlier batch was 23.56GiB. Separate Python core and research web checks exist; their untracked inputs must accompany the workflow on repository delivery.

### Planned interfaces

The fake and real model adapters will return a structured result containing the requested run ID, answer text, termination reason, timing, token counts and model/adapter identity. They will distinguish success, timeout, cancellation, context overflow and runtime failure. A transport error must not be converted into a plausible answer.

Core tests will cover malformed configuration, insufficient projected disk, incompatible or missing model identity, unexpected output and deliberate fake-adapter failure. They will not load weights or access the network.

**Done when:** a clean setup can run the core checks and create a truthful preflight report; no script starts a model download or a training job merely by importing a module or running unit tests.

## 5. Stage 2: make the data and review process usable

I can build this tooling without deciding Tibetan wording. Native speakers will provide or review the language evidence; I will not replace their judgments with model-generated ratings.

### Contracts

| Record | Required content |
| --- | --- |
| Source card | Stable ID, version, source URL/title/date, original passage, content hash, applicable scope, permitted uses, language review, medical review and unresolved issues |
| Example | Stable ID, source/version/hash, scenario and paraphrase groups, contributor pseudonym, register, question, allowed claims, approved answer, review state and split |
| Model lock | Repository/revision, upstream base, tokenizer/config/file hashes, quantization, conversion provenance and terms |
| Run manifest | Code version, runtime lock, model/adapter hashes, dataset hash, prompt/template hash, decoding/reasoning settings, seed, limits, timings and outcome |
| Review record | Example/version hash, reviewer pseudonym and role, independent ratings, issues, time spent and separate adjudication outcome |

I will use shared JSON schemas and conformance fixtures so Python and the later TypeScript app reject the same invalid records. Contact details and consent documents will not enter model exports.

### Tasks

- [x] Write a short community/task worksheet and contributor instructions for the intended adult audience. Compare possible first tasks without claiming that local demand has already been established.
- [x] Prepare a blank development-screen template for approximately 10-20 short passages with several kinds of questions. Start with everyday, nonclinical material where it can answer the language question.
- [x] Implement validation of IDs, source hashes, permitted uses, required fields and explicit review status. `medical_review=pending` remains distinct from language approval.
- [x] Preserve original Unicode text. Store any normalization as a versioned derivative; do not silently strip tsheg, punctuation or meaningful spelling variation.
- [x] Implement reviewer export/import with stable hashes, preserved independent ratings and an explicit adjudication record. Reject duplicate IDs, stale source versions and contradictory imports. Missing ratings remain incomplete; they do not become approval.
- [x] Add an offline form for source/example and blinded model-answer review, with English/Chinese controls, exact text, explicit response downloads and validated draft resume. Prepare a three-passage intake trial before the larger development set. Real submissions are still pending.
- [x] Implement source/scenario/paraphrase grouping before splits. Report contributor overlap and enforce the chosen contributor policy. If connected groups make the proposed split impossible, report the conflict instead of quietly weakening it.
- [x] Mark development-screen material, smoke-training examples, training, validation and final test as separate exposures. Smoke-training data cannot later be counted as unseen test data.
- [ ] Time ten representative examples through authoring, translation, independent review, coordination and adjudication. Reserve evaluation capacity before calculating the substantive training target.

Permission to review a translation does not automatically mean permission to use it for training. Existing unreconciled reviewer submissions will not be imported as a shortcut. Only eligible, permissioned and meaning-reviewed examples will enter training exports; health-related examples with pending medical review will remain explicitly restricted private research material.

The tooling and blank templates are implemented and tested on synthetic English fixtures. The September 5 approval, contribution-permission, task-content duplication and cumulative-exposure defects now have regression checks, including source/coauthor independence. Permission-checked immutable training exports exist. Real community/task selection, permissioned development material, native judgments and the timed ten-example pilot are still pending. Model-run manifests bind actual local English inference separately from infrastructure verification manifests.

**Done when:** the review process survives a complete export/import/adjudication round trip on safe fixtures, and the real development material has the permissions and language judgments needed for comparison. No fixed 300-600-example target will be reinstated without measured review capacity.

## 6. Stage 3: compare Tibetan ability before training

### Tasks

- [x] Implement `audit-tokens` against the exact candidate tokenizer and chat template. Report codepoints, defined tsheg-delimited segments, raw tokens, fully formatted sequence length and available answer budget.
- [x] Include system text, evidence, history, role markers and any reasoning budget. Audit complete training examples separately from generation prompts. The release audit additionally checks the implemented assistant offsets and explicit instruction conditions; native Tibetan material remains pending.
- [x] Implement `run-baseline` so Qwen and Gemma run sequentially on the same tasks and evidence. Save complete outputs and failures with provenance. Both models passed the two-source English infrastructure check; reviewed Tibetan execution remains pending.
- [x] Deliberately set and record Qwen reasoning/thinking behavior, stop tokens and generation limits. Use model-appropriate templates with equivalent task instructions. This recipe disables reasoning; it does not measure an enabled-reasoning condition. Expired answer budgets return failures, as verified with actual one-token truncation.
- [ ] Include direct extraction, balanced factual questions, negation, changed numbers, unavailable information and simple conversational corrections.
- [x] Implement paired Tibetan/Chinese input and output conditions, exact material/permission/equivalence bindings, condition-specific reports and connected exposure recording. Version 1.0 records remain compatible. Core fixtures and an unreviewed synthetic script probe verify engineering behavior only.
- [ ] Obtain reviewed parallel Chinese material and independent bilingual equivalence judgments, then run the native-reviewed comparison. The synthetic probe does not satisfy this requirement.
- [x] Implement blinded model-output export with source text, questions, answers and blank fidelity/comprehension/naturalness ratings. Verify it on the four English outputs and protect the model-name key separately.
- [x] Implement import, completion revisions and freeze of independent model-output ratings, retaining disagreements and separate explicit adjudication. The full workflow passed with declared synthetic ratings on the four English outputs; source/example approval and training permission remain unchanged.
- [ ] Produce real Tibetan comparison packets and obtain independent language ratings plus explicit adjudication. Existing source/example reviews are a different contract and cannot substitute for model-output ratings.
- [ ] Write a candidate-selection decision with case-level errors, task denominators, response times, context requirements, memory observations and reviewer disagreement.

I will not choose a model using tokenization alone, a universal tokens-per-syllable cutoff or a 50% yes/no threshold. I will record provisional task-specific success criteria before scoring, including which failures make the intended demonstration inappropriate. Repeated questions from one passage will be reported as clustered observations.

If both candidates are unsuitable, I will investigate configuration and register first, then assess another accessible Tibetan-adapted base. A stronger model comparison may be appropriate; immediate vocabulary expansion or a cloud training bill will not be the default response.

**Done when:** there is a reproducible comparison and a justified choice of candidate and bounded task, or a documented reason not to begin health adaptation.

## 7. Stage 4: prove the local training path

This stage establishes that the machinery works. It does not establish an improvement in Tibetan or health correctness. The initial isolated synthetic mechanics run can precede Stage 3. Real data and substantive adaptation still require the data and comprehension gates in the revised order above.

### Tasks

- [x] Implement a thin training wrapper around pinned MLX-LM components. The mechanics entry point is synthetic-only; the separate released-data entry point enforces immutable train/validation releases, permissions and real model-selection evidence.
- [x] Begin with batch size 1, a few adapted layers and roughly 20-50 updates. Qwen completed 20 updates on four complete 26–27-token English fixtures. This is not the final conversation-length specification.
- [x] Own the rendered token sequence and final-assistant offset. Inspect decoded loss-mask targets; exclude prompt and padding tokens. Require a nonempty meaningful target. Reject overlong examples. The worker uses a project-owned loss with boundary regression cases rather than the installed trainer's inclusive padding mask.
- [x] Record finite loss/gradients, trainable parameter count and nonzero updates in intended adapter tensors. All eight adapter tensors changed overall; 904 frozen base tensors matched before/after.
- [x] Save the adapter/config and reload them in a fresh process. Exact tensor names, shapes, dtypes, hashes and values matched; bounded adapter-enabled inference completed.
- [ ] Measure elapsed time per representative complete example, peak memory, memory pressure, swap growth and save/evaluation overhead. Record total sequence tokens separately from supervised tokens.
- [x] Test a bounded interruption. Gemma's resource stop terminated the real worker and preserved a failed zero-update run. Portable timeout/cancellation tests pass. No resume mode is exposed; optimizer/RNG continuation is not implemented.

MLX supports quantized adapter training and masking the final assistant response. The current trainer can truncate long sequences and reports throughput based on supervised loss tokens. I will verify behavior against the installed pinned release, not merely a changing `main` branch. [MLX training guide](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/LORA.md), [trainer source](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/tuner/trainer.py).

**Small mechanics proof complete.** Actual updates, save/reload and inference succeeded on tiny synthetic examples. This does not finish the unchecked representative-example resource task. The configuration and runtime estimate for substantive training must come from complete representative sequences, not an extrapolation of this micro-experiment.

## 8. Stage 5: train one bounded adapter and evaluate it

### Tasks

- [x] Implement versioned releases with exact source/review versions and group-based splits. Isolate locked test prompts/references and never open them in training. Exercised on synthetic fixtures; actual eligible Tibetan material remains pending.
- [x] Generate project-rendered records from released source-linked answers and validate every assistant offset/complete sequence. Real answer approval remains a prerequisite, not a generated artifact.
- [ ] Select a small bounded training schedule from measured throughput and dataset size. Record limits on elapsed time, updates, tokens, storage and checkpoint count before starting.
- [ ] Record the unchanged parent baseline before training. Use only development/validation results to choose settings and checkpoints.
- [ ] Monitor meaning fidelity and retained language abilities during training. Falling loss alone is not an objective, and critical degradation is a reason to stop or reject a checkpoint.
- [ ] Evaluate the final selected checkpoint against its unchanged parent with identical supplied evidence and matched decoding. Also retain the no-evidence condition and the human-translated-card baseline.
- [ ] Use independent human ratings where required. Report counts, denominators, missing reviews and source/scenario clustering. Do not combine fluency and critical factual changes into one reassuring score.
- [x] Implement local experiment reports, task-failure accounting and model cards covering exact base, adapter, data rights, intended use and measured results. A synthetic native report exists; the real Tibetan experiment report still depends on running that study.

The automatic evaluation code will check task-appropriate protected numbers, units, negation cases and citation identity. It will have adversarial fixtures for sign changes, decimal changes, reordered/missing facts and unsupported citations. These are defect screens, not semantic or clinical verification. I will not import the existing flawed fidelity scorer unchanged.

If results from the locked test guide a subsequent change, I will mark that test as exposed and reserve new held-out material for the next independent claim. Raw reviewer details and unpermitted content will stay out of public artifacts.

**Done when:** another local run can load the saved model configuration and reproduce the evaluation procedure, and the report honestly states whether the adapter improved the tested task. A training file existing on disk is not completion.

## 9. Stage 6: private source-card chatbot — feature work frozen

### Planned files

- `research/web/app/page.tsx`: conversation and evidence-card view.
- `research/web/app/api/chat/route.ts`: request validation, bounded execution and response handling.
- `research/web/lib/inference.ts`: fake and fixed-local-backend adapters.
- `research/web/lib/contracts.ts`: validation of the shared request/result contracts.
- `research/web/components/SourceCard.tsx` and `ChatTranscript.tsx`: original evidence and generated explanation rendered distinctly.
- Separate research package, lockfile, TypeScript, lint and test configuration.

### Tasks

- [x] Build and test the UI against fake inference first. The separate app runs with a fixed, explicitly synthetic provider; selected-model connection remains pending.
- [x] Implement a fixed two-passage synthetic catalog, shared Python/TypeScript request/result contracts and exact source-version checks. This does not implement a real reviewed-card catalog.
- [ ] Start with explicit source-card selection. The API resolves eligible card IDs and versions from the local catalogue; it will not trust client-supplied evidence, model identities or paths.
- [ ] Send a bounded conversation and authorized source passages to the local model. Reject or explicitly reset an overlong conversation rather than silently discarding important context.
- [x] Render completed demo answers after structural checks, with no token streaming. Invalid or failed output is never displayed as an answer.
- [x] Show original fixture evidence and its review status beside the reply. Exact citation IDs, versions and hashes must resolve to the selected catalog entry before display.
- [x] Keep transcripts in page memory. Reset, passage changes and page closure discard them; no automatic training export exists.
- [x] Validate loopback host/origin and launcher-issued session credentials; bound request size, concurrency, output and time; test cancellation and failures. Production WebSocket upgrades are rejected; development upgrades use the same exact session/origin check. The fake provider runs in-process with no configurable endpoint; a real fixed backend remains pending.
- [x] Use no service worker and `Cache-Control: no-store`. Inspect desktop/mobile wrapping, Chinese controls, Tibetan glyphs, text entry and keyboard/source focus locally. No native language judgment is inferred from font rendering.
- [x] Keep production advice and notes quarantine unchanged. The research app has independent build/test configuration, and the targeted production boundary checks still pass with their existing skips.

The fake interface was implemented early while language evidence is pending. Its 64 KiB request cap and character/message limits exercise transport behavior, not real model token/context limits. Real reviewed-card eligibility, selected-model connection and bounded inference in the intended local backend remain unfinished.

The first conversation scope is explaining supplied educational information, clarifying terms and preparing questions. A prompt or keyword filter cannot guarantee detection of every personal medical request. Until qualified review and a suitable operating scope exist, I will keep this a supervised private research prototype using permitted, nonpersonal examples.

**Done when:** a local user can select a card, ask follow-up questions, inspect the original source, cancel a request and recover from a backend failure. Production behavior remains unchanged by this stage.

## 10. Stage 7: add and measure retrieval

- [ ] Implement a small lexical/glossary retrieval baseline over eligible versioned cards. Avoid adding an embedding service before the simple baseline is measured.
- [ ] Record retrieved IDs, versions and ranking for each case. Source text is evidence, not instructions to the application.
- [ ] Add no-relevant-source and conflicting-source cases. The interface must expose missing evidence rather than fabricate a supporting card.
- [ ] Compare the adapted model with manually supplied correct evidence against the same model with retrieved evidence. Report retrieval failures separately from answer failures.

**Done when:** retrieval's effect is measured and the manually selected-card mode remains available as a diagnostic control. Citations alone will not count as evidence that an answer is supported.

## 11. Stage 8: repair and integrate the lab-report tool

I will not serialize the entire current `GroundedReport` into a model prompt. It contains internal interpretations and reference objects that the existing UI deliberately filters. I will create a narrow versioned contract for facts approved for display.

### A. Contain generated doctor notes and preserve actual originals

This behavior change was already approved by the user.

Files: [notes API](/Users/likerun/Desktop/health-translator/app/api/translate-notes/route.ts), [CaptureCard](/Users/likerun/Desktop/health-translator/components/CaptureCard.tsx), [NotesSection](/Users/likerun/Desktop/health-translator/components/NotesSection.tsx), [result page](/Users/likerun/Desktop/health-translator/app/result/page.tsx), [session storage](/Users/likerun/Desktop/health-translator/lib/session.ts), [visit storage](/Users/likerun/Desktop/health-translator/lib/db.ts), saved-visit rendering and related tests.

- [x] Return unconditional 410 from the translation endpoint before body parsing, rate-limit calls or model access.
- [x] Remove the capture flow's translation request and store new original notes separately, preserving the submitted text.
- [x] Version pending/saved records and render authoritative originals directly. Historical model-derived `source` strings cannot be relabeled as the user's original; represent that absence explicitly.
- [x] Test new-note save/reload, legacy records, empty notes, failed storage and stale clients reaching the disabled endpoint. Normal result and saved-visit views must suppress all historical generated translations, including those labeled unverified. Preserve legacy data without rendering those translations; show only authoritative originals or accurately state that the original is unavailable.

### B. Repair integrity and presentation prerequisites

Files: [guard](/Users/likerun/Desktop/health-translator/lib/guard.ts), [grounding](/Users/likerun/Desktop/health-translator/lib/grounding.ts), [confirmation UI](/Users/likerun/Desktop/health-translator/components/ConfirmValues.tsx), [row manifest](/Users/likerun/Desktop/health-translator/components/RowManifest.tsx), [result page](/Users/likerun/Desktop/health-translator/app/result/page.tsx), [reference data](/Users/likerun/Desktop/health-translator/data/reference-labs.ts), [summary](/Users/likerun/Desktop/health-translator/lib/summary.ts) and [summary rendering](/Users/likerun/Desktop/health-translator/components/SummaryView.tsx).

- [ ] Accumulate reading-integrity findings even when identity or interpretation abstains. Low confidence and mixed-unit conflicts must survive every branch.
- [ ] Preserve original extraction, corrections and field-level confirmation provenance. Re-evaluate the complete report after edits and surface newly unresolved problems.
- [ ] Remove unsupported fasting assumptions from generic glucose labels. Keep values, units and printed ranges separate through rendering and persistence.
- [ ] Repair the report-level evaluation path and any fidelity metrics used to judge this integration. Include alias variants, contradictory rows, edit-created discrepancies and planted decimal/sign changes.

### C. Repair Tibetan publication only where it is used

Files: [importer](/Users/likerun/Desktop/health-translator/lib/tibetanImport.ts), [invariants](/Users/likerun/Desktop/health-translator/lib/tibetanInvariants.ts), the [export script](/Users/likerun/Desktop/health-translator/scripts/tibetan/export-packet.mts), the [import script](/Users/likerun/Desktop/health-translator/scripts/tibetan/import-reviewed.mts), and related tests.

- [ ] Preserve the exported field and bind identity to key plus field. Support definitions throughout parsing, matching and field-specific context checks.
- [ ] Correct generated-copy context naming and the whitespace-sensitive clause check.
- [ ] Test real export/import round trips for names, definitions and interface rows. Keep independent reviewer agreement and fresh source hashes required.

These repairs unblock a process; they do not manufacture reviewer agreement or permission to publish generated Tibetan.

### D. Add the lab-tool contract

- [ ] Add a versioned `lib/labToolContract.ts` covering report/row IDs, pipeline version, printed name/value/unit/range, explicit corrections, confirmation state, permitted display state and unresolved reasons.
- [ ] Initially use synthetic report fixtures. Later require an explicit user action to attach a confirmed report through a validated exchange; the research app will not reach into production browser storage implicitly.
- [ ] Reject stale or inconsistent versions, unknown rows and unresolved required confirmations. Treat browser-supplied confirmation records as untrusted inputs rather than cryptographic proof of human verification.
- [ ] At the receiving server, validate original extraction and corrections and rerun the repaired whole-report pipeline. Recompute display eligibility and ignore client-supplied classifications or allowed/withheld flags. Bind confirmation acknowledgments to the exact report version and checked fields; a changed attachment must not reuse an earlier acknowledgment. This still does not prove that a human read the paper report correctly.
- [ ] Keep report values and status in deterministic UI elements; generated prose may explain reviewed terminology but cannot replace the record or restore a withheld interpretation.
- [ ] Test changes to numbers, units, report identity, citations and withheld states across the full route and renderer. A schema-valid attachment with forged display flags must not restore a status suppressed by the recomputed pipeline.

**Done when:** approved facts and unresolved states survive the complete report-to-chat workflow with provenance. The existing OCR service remains cloud-based; local chatbot inference does not change that. Personalized diets, diagnosis and medication guidance are outside this integration.

## 12. Checks, ownership and completion reporting

I will implement, run and inspect the engineering work. I can delegate bounded code or review tasks internally, but I remain responsible for integration and validation.

| Responsibility | Owner |
| --- | --- |
| Code, contracts, runtime setup, measurements and regression fixes | Codex |
| Access to the target community, participant coordination and permitted use decisions | User with contributors |
| Tibetan comprehension, naturalness and bilingual meaning judgments | Appropriate Tibetan/bilingual reviewers |
| Medical correctness and applicability judgments | Qualified clinician or dietitian, currently unavailable |

Human review is a dependency on evidence. While waiting for samples or ratings, prioritize the small training mechanics experiment and the confirmed data-contract repairs. Do not fill that wait with more interface or general-purpose review tooling. Report missing human input precisely and never invent ratings to continue.

For code changes, I will run focused meaningful tests first. At each integrated milestone I will run the relevant project checks. Existing production commands are `npm test -- --pool=threads`, `npx tsc --noEmit`, `npm run lint` and `npm run build`. The earlier review recorded existing lint failures; I will capture the current baseline and distinguish them from regressions. A pre-existing failure will remain visible rather than being described as a pass.

Research data checks will run without model downloads. MLX inference/training checks will run explicitly on the Mac; Linux CI will not pretend to have verified Metal training. The separate research web project will have its own tests, type checks and build. I will inspect the live local interface for its final acceptance check.

At each milestone I will report what changed, what was measured, what failed, what is waiting on review, and whether work is only local. Tests, commits, pushes, model publication and deployment will be reported as separate states. This plan does not schedule public deployment or a model upload.

## 13. Budget and first work batch

The budget remains $500 reserved for qualified health-content review, $200 for language review/reader participation, $100 for storage/backup, $100 conditional cloud compute and $100 contingency. These are allocations, not quotations or spending already made.

I will begin with local-only work. Cloud becomes a candidate only if representative complete examples cannot run after reasonable memory adjustments or measured runtime exceeds the experiment window. Any fallback proposal will specify a reproducible runtime, data inputs, projected hours, storage and total cost. I will not assume MLX adapters are interchangeable with another training runtime.

**Historical first batch (superseded for future work by the September 5 execution order):**

1. Record the current repository/test baseline and create the isolated research project and ignore boundaries.
2. Implement contracts, preflight, local run manifests and the fake inference adapter with core checks.
3. Prepare the community worksheet and review templates, then implement validation and review round trips.
4. Complete the already-approved original-notes preservation and generated-notes disable as a separate change while language material is being prepared.
5. Once the required development material is ready, run the tokenizer audit and Qwen/Gemma comparison before substantive adaptation. The original prohibition on any earlier adapter training is superseded by the isolated synthetic mechanics lane.

I will not promise a calendar date for trained-model quality before measuring reviewer effort, local throughput and the candidates' Tibetan ability. The first engineering batch can proceed without a clinician; health validity remains a separate unresolved requirement.
