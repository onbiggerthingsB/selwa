# Model-output review workflow — September 4, 2026

The local model-output review workflow now supports returned-packet import, completion revisions, freezing independent ratings, disagreement reporting and separate explicit adjudication. It was exercised against the four existing English model answers using clearly labeled synthetic judgments. No human review, Tibetan comparison, new inference or training occurred in this batch.

## Implemented behavior

- Import binds the original blank packet, returned responses and retained private key. It rejects changed source/question/answer text, edited metadata, duplicate IDs, malformed ratings and unknown fields. Ratings stay on the output-review 1–4 scale, separate from source-review 1–5 ratings.
- Incomplete submissions remain incomplete. A new revision can finish a partial packet while preserving completed items and prior hashes. Evidence type and independence declarations cannot be rewritten through a revision. Embedded exact submissions preserve evidence if original return files move; prior imported records remain required at their recorded paths.
- Freeze requires 2–8 distinct completed independent reviewer packets for the same finalized model outputs. Synthetic test judgments cannot mix with declared human review. Original ratings, issue reports and blinding declarations remain separate.
- The frozen report retains the full planned denominator, generation failures, unrecorded requests and connected source/scenario/paraphrase clusters. It does not average ordinal scores, choose cutoffs or select a model.
- Adjudication starts from a separate blank decision file after freeze. It records explicit case decisions, rationale and whether disagreements/issues were addressed. Unresolved cases stay visible. Ratings remain unchanged; no source approval, training permission or clinical approval is granted.
- Private outputs use new files outside Desktop and model-run directories. Freeze output size is checked before publication so the loader can read every successfully written record.

## Verification

All **148 research core tests passed**. The new coverage includes 18 importer tests, 14 freeze/adjudication tests and three CLI tests. Existing acquisition, token audit, bounded inference and baseline tests remain passing. No core test downloads or loads a model.

A nine-operation CLI check used the four outputs under `runs/runner-20260904/english-smoke`:

1. Exported two new anonymous packets and imported deliberately synthetic responses.
2. Rejected freeze while one reviewer packet was incomplete; no frozen output was created.
3. Appended completion of the partial import, preserving the original import.
4. Froze both test reviewer packets, retaining deliberately different ratings on all four outputs and the two connected source clusters.
5. Exported blank decisions and recorded four explicitly unresolved synthetic decisions.

All generated JSON artifacts were owner-private. The original dataset and model run were not changed. No model requests were dispatched, no native judgments were supplied and no model was selected.

Independent code review found one concrete size mismatch: a valid 33,636,770-byte freeze could be written but exceeded the loader's 32 MiB input limit. The writer now checks the same encoded size limit before publication. The reviewer reran that full-size reproducer and confirmed rejection before creating either the file or its parent directory; the regression tests also pass.

This batch changes only research code, tests and documentation. The production app checks from the earlier repair batch were not rerun or represented as newly verified here. No commit, push, deployment or paid compute occurred.

## Evidence and remaining work

Machine-local evidence is under `/Users/likerun/Library/Application Support/HealthTranslatorML/review-checks/review-roundtrip-20260904/`: `workflow-check.json`, original/returned packets, separate private keys, imported revisions, `frozen/ratings.json` and `adjudication/recorded.json`. The workflow summary's historical field `independent_source_clusters` counts two connected fixture groups; it does not establish statistical independence. Final code and verification hashes are recorded separately in `engineering-checks.json`.

These tools record operator declarations; hashes do not authenticate a person's identity, independence, qualifications or honesty. Frozen evidence requires its referenced imports, dataset and run artifacts to remain available and unchanged. Import revision chains are bounded, and the toolkit does not implement a global submission registry. A selected frozen roster admits only one record per reviewer.

Actual language comparison still needs the chosen community/task, permissioned Tibetan passages, independent speaker judgments and criteria recorded before execution. Reviewed parallel Chinese conditions remain an implementation dependency; they must preserve version 1.0 run compatibility and add exact pair identity, bilingual equivalence review, derivative permission and shared exposure groups. No model-output review artifact becomes a training example automatically.

See the [commands](../../../research/README.md), [reviewer instructions](../../../research/review/model-output-review.md) and [implementation plan](../../plans/2026-09-04-tibetan-llm-implementation.md).
