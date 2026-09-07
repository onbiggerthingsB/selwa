# Study and reviewer pilot workflow

This workflow records a private Tibetan comprehension experiment. It does not turn language ratings into clinical approval, training permission or permission to deploy a chatbot.

`ht_tibetan.study.blank_study()` creates a valid draft with the known audience (adults in Tibet), clear everyday written Tibetan and no clinical reviewer. Community, first task, exact instruction, model budgets, critical-error definitions, reviewers and review results remain unset. `validate_study()` distinguishes a valid draft from a complete preregistration.

Before the experiment, record the actual community, one constrained task, the exact answer labels or extraction rule, an explicit no-answer response, reviewed instruction and output budgets, and the critical-error definitions. Register ten expected **model output case IDs** for the agreement pilot. Ten outputs can include multiple outputs from the same source; they are not ten independent observations. The source, example and contributor permission workflow remains separate.

Use `ht-tibetan plan-evaluation CONFIG --output PLAN.json` to list the stable case IDs before model execution. Bind the plan's `config_sha256` in the study as `development_config_sha256`, then select the ten pilot IDs. The original draft template remains readable without this field; real preregistration now requires it alongside reviewed instruction/budget evidence. The hash binds example order, arm order, instructions and all other configuration fields, so unchanged numeric case IDs cannot conceal a changed pilot. Re-run with `--study STUDY.json` to inspect alignment. This planner does not open data, assess token fit, grant permissions or select a pilot for the operator.

## Independent reviews

`export_evaluation_review(report_path, reviewer_id, output, study=..., root=..., permissions_path=..., release_dir=..., key_path=...)` checks the finalized report, case hashes and run artifact inventory. For real material, it also rechecks current review-use permissions against the original dataset release. It exports exact passages, questions, instructions and answers with blank ratings, unknown review times and unassessed critical categories. No answers or recommendations are supplied on reviewers' behalf.

Supply a separate `key_path` to blind the comparison. Each reviewer gets independently randomized candidate aliases and case order. Model, arm, original case and report identities remain in the private key. Reviewer packet and operator key are published together into different directories; give reviewers only their packets. Exact text can still reveal an identity, so reviewers must mark compromised blinding when that happens.

Reviewers independently enter fidelity, comprehension and naturalness ratings (1–4), critical-category judgments (`present`, `absent`, `not_assessed`), observed minutes and candidate suitability recommendations. A complete review requires all fields; partial records remain incomplete. Suitability means suitable for the registered bounded adaptation experiment. It does not mean safe for health advice. Authors cannot independently judge their own evaluated contributions. Omitting the key produces an explicitly unblinded debugging packet that cannot support real model selection.

The CLI command `evaluation-review-form PACKET --study STUDY --report REPORT --key KEY --output FORM.html` creates a standalone offline form from a verified blinded packet. English/Chinese controls preserve exact source and answer text. Only the public packet enters the HTML; the key and decoded identities remain operator-only. Give reviewers their individual HTML files and validate their downloaded JSON with `validate-evaluation-review`. A blank download remains incomplete, with no invented ratings or review time. The [release workflow](../research/release-workflow.md) supplies complete commands and storage conventions.

`load_evaluation_review(..., key_path=...)` verifies and decodes returned records without approving them. Changes to source text, instructions, answers, aliases, case order, model conditions or study bindings are rejected. `analyze_evaluation_reviews(study, review_paths, report_path, review_keys=...)` describes two to eight distinct reviewer packets, including incomplete returns, without selecting a model. Failed generations and missing ratings remain in the planned denominator; ineligible judgments do not become agreement or zero minutes. `review_keys` aligns with `review_paths` and remains operator-only.

## Agreement and timing

`analyze_agreement()` also accepts structured pilot ratings, including missing and incomplete reviews, or an existing frozen review file plus a study roster. It reports the planned denominator, eligible paired or unanimous judgments, exact raw agreement, and nominal Cohen's kappa for exactly two reviewers when defined. Constant marginals and empty eligible samples produce an explicit unavailable result. More than two reviewers receive unanimous agreement, without an improvised kappa formula.

For debugging packets or compromised blinding, unblinded independent agreement is reported separately from the blinded-eligible denominator. Agreement does not establish language competence or correctness, and no threshold automatically selects a model.

Legacy frozen output reviews contain no recorded minutes and only free-text issues. Their timing and structured critical labels therefore remain unavailable unless supplied in a separate supplement bound to the exact study, freeze and case/reviewer IDs. Partial recorded time totals are labeled as partial; missing time is not zero. Unassessed critical categories are not counted as absent.

## Explicit candidate selection

`record_model_decision(study, evaluation_report_path, decision)` requires a complete real-material **development-screen** comparison, the originally bound preregistered study, two or more distinct complete independent blinded native reviews, and explicit user review of the criteria and pilot. Compromised or unblinded reviews cannot supply this selection evidence. Validation and final-test reports cannot select a training model. The gate rejects them using run metadata before opening their answer payloads.

The operator supplies `decision_id`, `selected_candidate_id`, `study_sha256`, `evaluation_report_sha256`, `review_paths`, aligned `review_keys`, `reviewed_by`, `reviewed_at`, `user_reviewed`, `rationale`, `criteria_reviewed` and `pilot_reviewed`. At least one native reviewer must explicitly support the selected base candidate under the exact registered condition. Unanimous rejection or requests for revision cannot become approval of unchanged evidence.

The returned receipt binds the exact base model revision, study instruction and budgets, report file hash, individual review file hashes, pilot results and explicit rationale. Before opening report answers, selection also checks that the run's configuration matches the preregistered `development_config_sha256`. `verify_model_selection(study_path, receipt_path, candidate_id, evaluation_report_path=..., model_identity=...)` rebuilds these checks before real training. Separate dataset-release, permission, conversion-provenance and runtime gates still apply. Human identity and independent judgment remain operator declarations, not authenticated signatures.

Synthetic fixtures can exercise export and agreement plumbing. They cannot satisfy the real model-selection gate. The repository tests create only temporary fabricated records; they are not collected Tibetan material or human review evidence.
