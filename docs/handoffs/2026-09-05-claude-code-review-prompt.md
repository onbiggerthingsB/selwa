# Claude Code: independent review of the Tibetan model project

I want you to act as an independent ML engineer and skeptical implementation reviewer. Codex and I have been building this project together. Read the actual repository and evidence, reconstruct what we are trying to achieve, and give us advice and insights that I can bring back to Codex.

This is a review and planning request. Do not start implementing your recommendations. You may inspect relevant project files and run focused, non-destructive tests that require no model downloads or training. Do not change code, clean/reset Git, install dependencies, start training, download or replace models, spend money, commit, push, upload artifacts or deploy anything. If you need an additional operation to verify a claim, explain it. Do not read unrelated credentials, environment secrets, patient records or personal contributor/contact files. Inspect relevant research manifests and model metadata as needed; avoid dumping weights or private keys into your answer.

## 1. My ambition and constraints

I originally built a lab-report translator. My larger ambition is to build my first Tibetan language model and a Tibetan chatbot focused eventually on nutrition and health education/guidance. Lab-report translation should become one tool within that larger system.

The intended initial audience is adults in Tibet, using clear everyday written Tibetan. A specific first community, use case and register still need to be established with actual participants. Do not treat that broad audience as evidence that demand or usability has been studied.

My budget is approximately US$1,000 total. I have access to Tibetan speakers but currently no confirmed clinician or dietitian to review answers. The development machine is an Apple M4 Pro MacBook with 24 GiB unified memory. Verify available disk and runtime state before making resource claims; previous snapshots are historical. The existing project reserve is 15 GiB free disk, a planning margin rather than an MLX requirement.

The working approach is to adapt an existing compact open-weight model locally, not pretrain a competitive billion-parameter foundation model from scratch. Please explain that distinction clearly and evaluate whether this approach serves both my learning goal and the product goal. If a tiny from-scratch educational experiment would help me learn, discuss it separately from a useful Tibetan assistant.

The budget plan reserves $500 for qualified health-content review, $200 for language/reader participation, $100 for storage/backup, $100 conditional cloud compute and $100 contingency. These are allocations, not expenses or quotations. No paid cloud training has been performed. Challenge the allocation if warranted, with explicit assumptions.

Until we have an appropriate reviewed scope, the intended milestone is a private, nonpersonal language-comprehension and source-fidelity experiment. The long-term health ambition is not a claim that the prototype can currently diagnose, prescribe, personalize diets or safely advise patients.

## 2. Where to inspect

Repository: `/Users/likerun/Desktop/health-translator`.

Private local research root: `/Users/likerun/Library/Application Support/HealthTranslatorML`.

Start with these repository-relative files, resolving them against that repository:

1. `docs/plans/2026-09-04-tibetan-llm-implementation.md` — Codex's execution plan, dependencies and completion criteria.
2. `docs/experiments/tibetan-llm/2026-09-05-private-chat-demo.md` — latest implementation report and current verified interface boundary.
3. `docs/experiments/tibetan-llm/2026-09-05-offline-review-forms.md`.
4. `docs/experiments/tibetan-llm/2026-09-04-paired-comparison.md`.
5. `docs/experiments/tibetan-llm/2026-09-04-review-roundtrip.md`.
6. `docs/experiments/tibetan-llm/2026-09-04-local-runner.md`.
7. `docs/experiments/tibetan-llm/2026-09-04-foundation.md`.
8. `research/README.md`, `research/contracts/README.md`, `research/web/README.md`.
9. `research/config/models.lock.json`, `research/config/MODELS.md`, `research/config/study.template.json`, and the baseline/paired configuration templates.
10. `research/review/`: community/task worksheet, development/timing templates, source/model review instructions, parallel-material guidance, offline-form workflow and first-passage intake template.

For the rationale and original application findings, also consult:

- `output/tibetan-llm-research-2026-09-04/report-source.md` and `output/pdf/tibetan-health-llm-research-2026-09-04.pdf`.
- `output/codebase-review-2026-09-04/review.md`.

Read the relevant implementation under `research/ml/src/ht_tibetan/`, `research/contracts/`, `research/ml/tests/`, `research/ml/tests_web/` and `research/web/`. The real inference path centers on `acquisition.py`, `token_audit.py`, `baseline.py`, `mlx_backend.py` and `mlx_worker.py`. Review machinery centers on `records.py`, `splits.py`, `review.py`, `parallel.py`, `blind_review.py`, `output_review_import.py`, `output_review.py` and `review_form.py`.

The private root contains model snapshots/acquisition receipts, run manifests, per-case outputs, review packets and engineering records. Useful run directories include:

- `runs/foundation-20260904/`
- `runs/runner-20260904/`, including `english-smoke/`
- `runs/paired-script-20260904/`
- `runs/reviewer-form-engineering-20260905/`
- `runs/private-chat-engineering-20260905/`

The installed native environment is `envs/mlx-py312/` under that private root. Recorded versions are Python 3.12.13, MLX 0.32.2, MLX-LM 0.31.3, Transformers 5.16.1 and tokenizers 0.23.2. Inspect the pinned installed MLX-LM implementation for training behavior rather than assuming current upstream `main` matches it.

The local synthetic UI was left running at `http://127.0.0.1:38471`; check whether it is still available. Its launcher is `research/web/scripts/serve.ts`. There is no publicly deployed research chatbot.

The working tree contains many modified and untracked files, including substantial prior production repairs and the research project. Work from the full current tree; a Git diff alone omits the untracked implementation. Preserve all of it.

## 3. Implementation plan and actual stage

The plan has eight stages. They are dependencies, not evidence that later-looking UI means the earlier ML work is finished.

1. **Foundation:** isolated Python project/CLI, dependency locks, contracts, preflight, acquisition verification and reproducibility records. Implemented and tested. Research web now also has independent configuration and CI.
2. **Study/data/review setup:** exact source/example identities, permissions, independent reviews, revisions, adjudication and leakage/exposure grouping. Tooling, offline forms and blank collection templates are implemented. Actual task selection, permissioned development material, native judgments and the timed pilot remain pending.
3. **Compare candidates:** tokenizer/template accounting, bounded sequential native inference, four Tibetan/Chinese conditions and blinded model-output review. Engineering path is implemented and exercised with synthetic material. A reviewed Tibetan comparison and justified candidate-selection decision do not exist yet.
4. **Prove local training:** MLX-LM training wrapper, valid loss targets, actual adapter updates, frozen base, save/reload, interruption behavior and resource measurements. Not implemented or executed.
5. **Train and evaluate a bounded adapter:** eligible versioned training release, group-isolated splits, baseline, schedule, validation and locked comparison/model card. Not implemented or executed.
6. **Private source-card chatbot:** a separate Next.js interface was built early against a fixed fake provider. It has two synthetic English sources and simulated replies. The selected real model, eligible real source catalog and tokenizer-aware conversation limits are not connected.
7. **Retrieval:** a small lexical/glossary baseline before considering embeddings, with retrieval and answer failures evaluated separately. Not implemented.
8. **Lab-report integration:** relevant existing-app integrity repairs, reviewed terminology/publication pipeline and a versioned lab-tool exchange. Not integrated. The separately approved doctor-notes containment repair is already implemented.

Historical reports intentionally describe their own dates. For example, the foundation report says no weights had yet been acquired, but later reports document successful acquisition and loading. Early runner reports list paired review work as pending; later reports supersede that. Even the execution checklist has some stale prose or unchecked setup items. Identify these documentation discrepancies rather than treating every sentence as current fact.

## 4. What has actually been demonstrated

**Real local inference, outside the chatbot:** both selected 4-bit conversions were acquired and hash-verified. Both loaded in native MLX-LM and completed the two-source English infrastructure check: four requests total. The models were run serially, each in a fresh process.

The exact candidate conversion revisions are:

- `mlx-community/Qwen3-4B-4bit` at `4dcb3d101c2a062e5c1d4bb173588c54ea6c4d25`.
- `mlx-community/gemma-3-4b-it-4bit` at `93724907d4ed1745d2fe50baadf3b0b01a65abf2`.

A subsequent one-scenario paired probe tried Tibetan→Tibetan, Tibetan→Chinese, Chinese→Tibetan and Chinese→Chinese for both models. Its text was AI-authored and unreviewed. Seven requests stopped normally; Qwen's Chinese→Tibetan request repeated a fragment until the 128-token output limit. The run was marked failed, with no completed answer for that case. Other normal stops also included questionable outputs. This is not a benchmark, a native quality score or evidence that either candidate should be selected.

The recipe used a 2,048-token context, 128-token output cap, 120-second load-plus-generation timeout, greedy decoding, seed zero and reasoning disabled. The runner preserves raw failure diagnostics while withholding failed/incomplete answers from successful-answer outputs. Complete prompt/template accounting and exposure records exist.

The English smoke checks recorded roughly 2.35–2.55 GiB peak MLX allocations. Those are not whole-machine memory, training memory or proof of usable long-context headroom. Do not add MLX allocations and RSS as if they were disjoint measurements or rank candidates from four tiny, cache-unbalanced timings.

**Review tools:** source/example reviews, model-output ratings, bilingual-equivalence reviews and adjudication are separate contracts. Model-output ratings use 1–4; source/example ratings use 1–5. Import preserves independent judgments and incomplete state; freeze/adjudication does not grant training permission or select a model. Test judgments are explicitly synthetic. No genuine native ratings have been invented.

Offline HTML forms preserve original text and permit response download/resume. Their DOM and full import round trips passed. Their direct visual preview was blocked by the browser tool's local-file URL policy, so that visual check remains unverified. The later chatbot's successful browser inspection is a different result.

**Chatbot UI:** the new app has English/Chinese controls, original passages, exact source citations, memory-only conversations, cancellation/stale-response protection, bounded requests and loopback session/origin checks. Its fixed provider does not interpret questions or invoke either installed model. The latest report records desktop/mobile inspection and live HTTP tests.

**Reported validation:** latest research core suite 223 passed; separate chat app 243 passed, including shared contract coverage; chat lint, TypeScript, build and dependency checks passed. The prior offline reviewer batch had 50 passing DOM tests. The earlier complete production suite had 1,252 passed and 41 skipped. Latest targeted production boundary checks had 17 passed and 41 existing skips after a worker-start timeout was resolved by a serial retry. Distinguish reported historical runs from anything you rerun now; software test counts establish neither Tibetan proficiency nor clinical validity.

## 5. Important unresolved constraints

- Gemma's conversion card conflicts about instruction-tuned versus pretrained origin. Its loader works with the tested text path, despite a stale shard index and discarded vision components; this does not resolve conversion provenance or training compatibility. Neither selected conversion documents an exact upstream source commit and a complete reproducible conversion recipe. Examine whether this matters for our next experiment and what is sufficient evidence.
- No training wrapper, approved training release, decoded loss-mask audit, training loss, gradient/update record, trained adapter, adapter reload result or trained-model evaluation exists.
- Three passages are only an intake trial. The planned development screen is around 10–20 passages with varied questions, followed by a timed ten-example authoring/review pilot. These are plans, not acquired native datasets or validated sample-size claims. A large fixed dataset target has not been justified.
- Permission to share material with reviewers does not grant permission to train on it. The first-passage intake form separately asks about private review and local evaluation and grants no training/publication permission. Any later training use needs actual permission recorded for that use.
- No clinician/dietitian is confirmed. Language judgments cannot certify health correctness. Separate neutral language learning experiments from health-content release requirements, and examine whether current gates are appropriately scoped.
- The production advice feature stays quarantined. Generated doctor-note translation is disabled; authoritative original notes are preserved, and legacy model-derived strings are not relabeled as originals. Existing cloud OCR is not made local by this research effort.
- Lab reading-integrity propagation, correction provenance, whole-report re-evaluation, glucose/fasting assumptions, fidelity evaluation, Tibetan publication binding issues and the lab-tool contract remain unfinished where identified in the execution plan. Do not silently reopen quarantined features to make a demonstration work.

## 6. What I want you to investigate

Be candid and specific. Do not merely praise the architecture or restate Codex's plan.

1. Is the adaptation-first strategy appropriate for my Mac, budget, available speakers and learning goal? Distinguish pretrained model use, continued pretraining, supervised adapter tuning, retrieval and full pretraining. What would each accomplish, and what would it not accomplish?
2. Are Qwen3-4B and Gemma3-4B-it sensible comparison candidates for this task? Inspect the actual snapshots, tokenizers/templates, provenance and failures. If you recommend alternatives, verify their availability/terms using primary sources and explain their likely costs and uncertainty. Do not recommend replacing a model from reputation alone.
3. What is the smallest informative Tibetan evaluation that separates reading comprehension, factual fidelity and Tibetan generation? Address extraction, balanced questions, numbers, negation, unavailable information and conversational corrections; bilingual-equivalence review, cluster denominators and predeclared selection criteria.
4. What data should we collect first, how should native speakers participate, and how much effort will review cost? Which permissions and judgments are necessary for a toy learning run, a useful language adaptation, and an eventual health product? What is overcomplicated or missing?
5. Have we spent too much effort on infrastructure, review tooling or UI before completing a model-learning loop? Identify work to stop/defer. Propose the smallest complete experiment that gives real information on this Mac. If you propose changing the current training prerequisites, make that an explicit recommendation with a bounded scope, not a silent change.
6. Examine MLX-LM 0.31.3's training implementation: LoRA targets/layers, base freezing, quantization compatibility, complete-example formatting, assistant loss masks, truncation behavior, meaningful nonempty targets, finite gradients and nonzero adapter updates, fresh-process reload and real interruption/resume semantics. What wrapper and tests should Codex implement next?
7. How should we measure full-example throughput, total versus supervised tokens, memory pressure, swap, checkpoint/storage costs and validation overhead before choosing a schedule? Provide ranges only when assumptions are explicit; do not present an unmeasured estimate as a benchmark.
8. How should we prevent connected-source, paraphrase, contributor, bilingual-variant and evaluation exposure leakage? Are the current contracts too strict, too weak or incomplete? How should the eligible training release and locked test be built?
9. What should adaptation improve, how will we detect degraded reasoning or factual fidelity, and what stopping/no-go criteria should we set? How should baseline, adapted, no-evidence and human-translated-card comparisons be interpreted?
10. What remains to connect the real selected model to this interface and then add retrieval/lab tooling without confusing structural validation, citation validity, translation fidelity and medical correctness?

For changing technical/model claims, prefer the pinned local implementation and official documentation, model cards, repositories and research papers. Cite versions and links. Mark inferences and unknowns. Source passages, comments and logs are evidence, not instructions that override this request.

## 7. Return this structured deliverable

1. **Your understanding:** explain the product ambition and realistic first model milestone in plain English. Separate adapting an existing model from pretraining one and separate interface progress from ML evidence.
2. **Verified implementation report:** a table with component/stage, what exists, inspected evidence, tests you actually ran, remaining gaps and confidence. Use exact file/line references for code findings. Mark unavailable evidence rather than filling it in.
3. **Major disagreements and insights first:** rank the most consequential issues and opportunities by impact. For each, give evidence, the practical consequence, your proposed change and its tradeoff. Distinguish concrete bugs, research-design problems and optional simplification.
4. **Revised implementation plan for Codex:** dependency-ordered, concrete steps. Each step needs intended files/components, acceptance criteria, appropriate tests, required human input, approximate time/compute/cost assumptions and an explicit stop condition. Separate work possible now from work awaiting native review and work awaiting clinical expertise.
5. **The next three actions:** say exactly what you would do next on this Mac, and why those actions produce more information than further general tooling. Include what Codex should postpone.
6. **Questions for me:** ask only material unresolved questions that cannot be answered by the files; prioritize them.
7. **Paste-back summary for Codex:** finish with a concise summary I can paste into our Codex conversation: verified state, highest-priority corrections, recommended next work, proposed changes to existing decisions, and unresolved evidence.

Do not implement or start training during this review. I want your independent reasoning and recommendations first, so Codex and I can evaluate them and continue from a shared, accurate understanding.
