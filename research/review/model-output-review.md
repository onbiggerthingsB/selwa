# Reviewing generated answers

This workflow assesses a model answer against its supplied passage and question. Source/example review is a different workflow with a different rating scale. Neither workflow alone establishes medical correctness or grants training rights.

## Reviewer instructions

The operator gives each reviewer a separate packet with shuffled anonymous answer IDs. Keep that original packet and edit a new returned copy. Read the passage, question and answer as written. Do not change them, fix spelling in place, reorder items, or change packet metadata/status. Edit only each item's `ratings`, `issues` and `blind_compromised` fields.

Use the packet's **1–4** scale separately for fidelity to the passage, comprehension of the question and naturalness of the answer. A higher rating indicates fewer identified problems. Leave a rating `null` when you cannot assess it, and explain why in `issues`. Record concrete problems, especially unsupported statements, changed quantities, reversed negation, missing information and confusing wording. These remain independent judgments; the software does not average them into approval.

Set `blind_compromised` to `true` if you recognize or infer the candidate or have seen its identity; otherwise set it to `false`. The answer itself might disclose its identity, so blind packet metadata cannot guarantee successful blinding. Complete your first assessment without seeing another reviewer's ratings or discussing the answer with them. Tell the operator if the assessment was not independent.

The packet's outer `status` stays `unfilled`: completion is derived by the importer from the response fields. A complete item has all three ratings and an explicit blinding declaration. A fully completed packet may still report defects or compromised blinding; completion does not mean endorsement.

## Operator workflow

Keep the original packet and private key. The reviewer receives only the packet. The key, imported records, frozen report and adjudication belong in owner-private directories outside Desktop and the model run. Keep all original and returned files; outputs use new filenames and never overwrite evidence.

1. Export one `blind-review` packet per reviewer from the same finalized run and dataset.
2. Import returned copies with `import-output-review`, explicitly declaring whether the submission is actual human review or a synthetic software test, and whether review was independent.
3. If a packet is incomplete, retain that import and append a new import using `--previous`. Completed items cannot be rewritten. Never relabel synthetic test judgments as human review.
4. Freeze 2–8 distinct independently completed reviewer packets with `freeze-output-reviews`. Every reviewer must cover the same successful outputs. The report retains individual ratings, disagreements, blinding problems, generation failures, unrecorded requests and source/scenario clusters.
5. After freezing, prepare blank decisions with `export-output-adjudication`. An explicitly identified adjudicator records a decision and rationale per output, separately from the ratings. The adjudicator can be one of the original reviewers once independent ratings have been frozen; the tool records declared identity, not verified credentials.
6. Import those decisions with `adjudicate-output-reviews`. Available decisions are `meets_task_criteria`, `does_not_meet_task_criteria` and `unresolved`. Acceptance requires an explicit declaration that issues/disagreements were addressed. Compromised blinding cannot be accepted as a blinded task result. Unresolved judgments remain visible.

The freeze retains the criteria recorded before the model run. It does not choose numerical cutoffs or select a model. Generation failures are outside the reviewer packet but remain in the full planned-request denominator. Several questions about one passage are not several independent source observations. Model-output ratings are ordinal 1–4 judgments; do not mix them with the separate source-review 1–5 scale.

Hash checks detect changes relative to retained operator evidence. They are not signatures or proof of a reviewer's identity, independence, qualifications or honesty. Keep private records under operator control. Loading a frozen record revalidates its referenced imports, original run and dataset; those files must remain available and unchanged. Whitespace-only changes to immutable run/import files also change their byte identity.

## Current scope

The available demonstration uses synthetic English passages and actual local model answers. Any software-generated ratings used to test this workflow are explicitly `synthetic_test`. They establish only that import, freeze and adjudication mechanics work. No Tibetan judgments, medical judgments or model-selection results are implied.

Version 1.1 now supports paired Tibetan/Chinese conditions. Each packet item includes `input_language` and `requested_output_language`, where `bo` means Tibetan and `zh` means Chinese. These are immutable task labels: assess whether the answer follows the requested language as well as whether it preserves meaning. Bilingual ability is needed to assess cross-language fidelity; leave ratings blank when you cannot judge them. Frozen and adjudicated reports retain separate counts for every declared condition, including failures without complete answers.

The [paired-material workflow](parallel-material.md) binds exact example versions and hashes, independent bilingual equivalence review, derivative permissions and shared scenario/paraphrase groups. Ordinary language approval does not establish equivalence across languages. Existing version 1.0 records and prompt bytes remain verifiable. Actual permissioned paired passages and human judgments are still pending.
