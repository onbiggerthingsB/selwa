# Research data contracts, version 1.0

The separate synthetic chat wire contract is `chat.schema.json`, with shared cases in `fixtures/chat-conformance.json`. Python `chat_contract.py` and the research web validators check the same requests, replies and catalogs, including exact source hashes/citations and bounded conversation ordering. Its fixed synthetic catalog does not grant eligibility to arbitrary source records or provide a model adapter.

`records.schema.json` is the self-contained JSON Schema 2020-12 contract with definitions for source cards, examples, independent review records, separate adjudications, datasets and reviewer packets. The smaller `*.schema.json` files select individual definitions. Load these local schemas into a resolver; do not fetch the `health-translator.local` identifiers over the network. Unknown fields, missing explicit review states and malformed IDs are rejected.

The Python implementation adds the semantic checks JSON Schema cannot provide: exact text hashes, version links, uniqueness across records, use permissions, review provenance, approval requirements and split exposure. A future TypeScript consumer must implement those semantic checks too; JSON Schema alone does not establish data eligibility. `fixtures/conformance.json` names shared valid and invalid fixtures and the expected semantic/schema error code. Every fixture is synthetic English plumbing data, never Tibetan gold, a real reader result or clinical evidence.

## Text and record identity

- `content_sha256` is SHA-256 of the exact original passage encoded as UTF-8. No trim, Unicode normalization, tsheg removal or punctuation replacement is performed.
- `source_id`, `example_id` and reviewer pseudonyms are stable ASCII identifiers. Store personal/contact and consent documents separately, outside the repository. `source_url` and `source_date` may be null when genuinely inapplicable; do not invent them.
- An example binds its source ID, integer version and exact original-content hash. Change content or source metadata under a new source version. Only one current version of each stable ID belongs in a dataset release; archive older releases separately.
- `example_sha256(example)` hashes canonical JSON of all example fields except `review_state`, `split` and `exposures`. Those workflow fields can change after review without pretending the text changed. Source links, contributor, groups, register, question, claims and answer are included. `record_sha256(record)` hashes the complete canonical JSON record.
- The field `approved_answer` may contain a proposed answer while `review_state=pending`; its name never grants approval. It may be null for an unfinished example. Review the complete proposed answer before approving it.
- Keep derivatives in separate versioned records linked by the same scenario/paraphrase groups. These contracts intentionally do not silently normalize originals.

## Permissions, review and exposure

`permitted_uses` is an explicit allowlist. `review` permits exporting to reviewers; it does **not** permit `train` or `smoke_training`. `private_research`, `development_screen`, `validation` and `final_test` are also separate uses. An empty list grants none. These fields record an operator's established permission; the software cannot verify a consent document or a contributor's identity.

Examples have an assigned `split` and a separate historical `exposures` list. Record actual development, smoke-training, training, validation and final-test use before relying on an unseen-data claim. Assignment is not evidence of prior exposure. Source ID, exact source-content hash, scenario, paraphrase and duplicate task-content connections are transitive: the whole connected component must share a split. Task fingerprints inspect the question/answer/claims and question/answer pairs, with exact and separate NFC/whitespace-normalized derivatives. Shared answers alone are not duplicate edges. Originals remain unchanged; near-overlap and semantic paraphrases are not cleared. The contributor policy is either `report` (report overlap) or `disjoint` (reject overlap). The audit does not manufacture a split when these constraints make a target infeasible. `unseen_final_test` in `audit_splits` is relative to supplied declarations, not proof of global independence.

Independent reviews retain reviewer pseudonym/role, content bindings, separate 1–5 dimension ratings, issues, minutes, completion state and a recommendation. Missing values stay null and incomplete. A `complete` language review needs all three ratings, minutes and a non-pending recommendation; a medical review needs fidelity/comprehension plus minutes and a recommendation, and a clinician/dietitian role. Declared roles do not establish credentials; the study owner verifies those separately.

Importing reviews **never** changes example/source approval. An explicit adjudication references the independent records and gives a rationale and separate language/medical outcome. Language approval requires two completed current reviews by distinct reviewers other than the example contributor, with at least one supporting approval. Two rejections cannot become approval. The example author cannot adjudicate their own example. A reviewer may adjudicate a disagreement with an explicit rationale; `adjudication_provenance` reports overlap and the actual reviewer count rather than implying a third independent judgment. Medical approval requires a completed supporting approval from a qualified medical reviewer; completion of a rejection does not grant approval. Raw ratings remain intact. Approval still does not grant an unpermitted use.

`contribution-permissions.schema.json` adds a separate versioned ledger without rewriting legacy dataset/reviewer records. `permissions.validate_permissions(dataset, ledger, purpose=..., as_of=...)` checks explicit source rights and each selected contributor's current exact-content grant. Community sources require declared source authors and their source-text grants. Additional question/answer authors must be declared; known authors from bound grant history cannot be hidden by removing a declaration. Revision chains retain revocations, expiry and scope changes. Restoring or expanding permission requires a new consent timestamp. Real consumers must require `evidence_kind=operator_recorded`; `synthetic_test` is never human consent. Opaque evidence references do not authenticate the evidence or contributor.

`exposure_inventory.build_exposure_inventory(runs_root)` reads bounded, hashed evidence from finalized baseline and mechanics runs, including failed attempts. Unfinished, unknown, corrupt, omitted or unsafe evidence blocks the audit. Recognized non-model engineering records remain explicitly classified; their basename-only external inputs are not reverified. `reconcile_exposures(dataset, inventory)` returns a copied dataset plus matched historical evidence, propagating content/group connections across runs. New baseline dispatch automatically combines this with permissions through `data_use.audit_data_use`; its receipt grants neither a dataset release nor training authority. Deleted/external runs, omitted grant history and semantic similarity still require operator controls and review.

Training and smoke-training assignments require an approved answer, explicit example adjudication, source language approval and no unresolved source issues. Health training additionally requires both source medical approval and example medical adjudication. Pending health material remains restricted to its explicitly permissioned research roles. These checks do not establish clinical validity or readiness for deployment.

## Pure APIs and review round trip

```python
from ht_tibetan.records import load_dataset, validate_dataset
from ht_tibetan.splits import audit_splits
from ht_tibetan.review import export_review_packet, import_review_packet

dataset = load_dataset("/local-data/dataset.json")
validation = validate_dataset(dataset)  # {valid, errors: [{path, code, message}], counts}
split_report = audit_splits(dataset, contributor_policy="report")
packet = export_review_packet(dataset, "/local-data/reviewer-a.json", "reviewer-a",
                              example_ids=["example-001"])
# A reviewer edits only the allowed review response fields in the packet.
updated = import_review_packet(dataset, "/local-data/returned-a.json",
                               output_path="/local-data/dataset-reviewed-a.json",
                               receipt_path="/local-data/reviewer-a.json.receipt.json")
```

Export creates a packet and an original sibling `<packet>.receipt.json`. Keep the receipt under the operator's control and send only the packet to the reviewer. Import compares against the trusted original receipt and the current full example/source records. The hashes are tamper detection against that retained receipt, **not** cryptographic authentication of an untrusted receipt. Store returned submissions under new filenames and pass the original receipt path explicitly.

Only `ratings`, `issues`, `minutes_spent`, `status` and `recommendation` inside each `review` object may change. Duplicate/missing/substituted IDs, stale source/example versions, edited source text and conflicting/replayed imports fail. Other reviewers' completed imports do not make a still-current packet stale. A packet imported as incomplete stays incomplete in the history. Completing its returned packet appends a new `review_id` with incremented `revision` and `supersedes_review_id` pointing to the prior incomplete record. A fresh export can also continue the latest partial review. Forked revisions, replayed old packets and edits to completed reviews fail. Do not edit revision or supersession fields manually in a returned packet.

## Model-output review records

The model-output workflow has separate version 1.0 and 1.1 Python-validated contracts in `blind_review.py`, `output_review_import.py` and `output_review.py`. The source/example JSON schemas above do not cover these output-review records. A future TypeScript consumer needs explicit schema and semantic conformance support before using them.

`import_output_review` binds an exact blank packet to its retained operator key, allows changes only to ratings/issues/blinding declarations, and captures exact submitted bytes plus file hashes in a private imported record. Its `evidence_kind` explicitly distinguishes `human_review` from `synthetic_test`; `independent` is a declared boolean. Field-complete human submissions with `independent=false` remain incomplete. Completed item responses cannot change in later partial revisions. The loader rederives normalized fields from embedded inputs and validates the prior-import chain, capped at 32 records and 256 MiB aggregate input. Imported records can be up to 128 MiB. These are locally retained evidence, not cryptographic signatures or a global submission registry.

`freeze_output_reviews` binds 2–8 distinct completed independent reviewer imports to one exact finalized run and dataset. It revalidates every reviewed answer and case identity, preserves each ordinal 1–4 rating, and reports disagreement and compromised blinding separately. Full planned-request counts, failed/unrecorded cases and connected source/scenario clusters remain visible. Freezes are immutable, bounded to 32 MiB and revalidated against retained imports and run artifacts on load. They do not average scores or choose a candidate.

`export_output_adjudication` prepares blank decisions only after freeze. `adjudicate_output_reviews` requires one explicit rationale-bearing decision per frozen output: `meets_task_criteria`, `does_not_meet_task_criteria` or `unresolved`. Accepted task results must explicitly address reported issues/disagreements and cannot have compromised blinding. The original reviews remain unchanged, and every artifact retains `approval_granted=false`, `dataset_modified=false` and no selected model. No result modifies the source/example approval or permission contracts.

## Paired material and version 1.1 runs

`parallel-material.schema.json` is a standalone local JSON Schema for the paired sidecar. `parallel.validate_parallel_material` adds exact dataset/member/source hashes, source scope consistency, derivative permissions, independent bilingual review provenance and transitive exposure checks. `parallel.condition_jobs` expands the predeclared pair/condition order; `parallel.conversation_for_condition` includes only the actual passage/question and explicit output-language instruction.

Baseline config 1.1 adds `pair_ids` and `conditions` while retaining `example_ids` for both members. The full sidecar is embedded and hashed in the run manifest; every paired case/index/attempt records `pair_id`, `condition_id`, `input_language`, `output_language` and `parallel_pair_sha256`. Case identity is `(candidate, pair, condition)`, so the same input example can occur with different requested output languages. Version 1.0 config/prompt/artifact shapes remain supported.

Review packet/key 1.1 adds immutable public `input_language` and `requested_output_language`; private bindings retain all paired case fields, and the key records `parallel_material_sha256`. Import/revision records preserve the packet version. Successful exported outputs must match their hashed pre-dispatch attempt, including rendered prompt and exposure identity. Frozen/adjudicated 1.1 reports add condition-level denominators and decisions; unsuccessful and unrecorded cases remain visible. A normal model stop still says nothing about correctness or compliance with the requested language.

All generated JSON outputs use a private temporary file and atomic create-if-absent, with no overwrite. An interrupted export may leave only its receipt; choose a fresh output filename. Python API errors raise `RecordsError`, with `FileExistsError` for an existing output path. No API loads a model, normalizes text, downloads data or accesses the network.
