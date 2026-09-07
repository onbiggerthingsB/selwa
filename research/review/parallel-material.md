# Preparing a paired language comparison

A pair contains two separately versioned source/example records: one Tibetan and one Chinese. The conditions control which member supplies the passage/question and which language the answer should use. This can help investigate input comprehension and output-language problems; a four-condition comparison alone does not prove a clean causal separation.

| Condition | Passage and question | Requested answer |
| --- | --- | --- |
| `bo_to_bo` | Tibetan | Tibetan |
| `bo_to_zh` | Tibetan | Chinese |
| `zh_to_bo` | Chinese | Tibetan |
| `zh_to_zh` | Chinese | Chinese |

Use the ordinary source/example records for both languages. Preserve exact Unicode text and source/version/hash links. Both examples must share the pair's scenario and paraphrase groups so their relationship survives even when the sidecar is absent. List translation contributors explicitly, in addition to the example contributors. Both versions must have the same nonclinical/health scope; translating health content does not make it nonclinical.

The `parallel-material.schema.json` sidecar adds:

- `pairs`: stable pair ID/version, the two exact member bindings, shared groups, translation contributor IDs and permission references.
- `permissions`: explicit source-bound permission for `translation` and `parallel_evaluation`, with grantor and evidence reference. Ordinary review permission alone does not grant derivative rights.
- `equivalence_reviews`: independent bilingual judgments bound to the exact pair hash. Reviewers separately assess facts, numbers, negation, question intent, answerability, allowed claims and reference-answer meaning. Preserve each person's checks, issues, time and recommendation.
- `equivalence_adjudications`: a separate decision that binds exact review hashes and records rationale and time. The adjudicator may be one reviewer after independent judgments are recorded, but cannot be a material contributor.

Real language eligibility requires approved ordinary source/example review in both languages and two distinct, independent supporting bilingual equivalence reviews. Reviewers must differ from source/question and translation contributors. Both sources also need `private_research`, `development_screen` and `review` permission, plus explicit derivative grants. Health scope keeps the separate qualified source/example medical approval requirement. These fields record declarations; the software cannot authenticate permissions, reviewer identities or true translation equivalence.

Use `parallel-material.template.json` as the empty sidecar and `paired-baseline.template.json` as the run configuration. The configuration must list every selected pair and both member example IDs, plus the intended condition set and study criteria before running. Build member hashes with `example_sha256` and `record_sha256`; do not type or repair hashes manually. `validate-parallel` checks records without loading a tokenizer or model.

Any selected pair connected to training, validation or final-test exposure is rejected. An attempted paired dispatch records development exposure for every connected example before generation, including the language variant that was not the input. A rejected context-overflow case is not dispatched and does not create exposure. Preserve the new exposure datasets for later split audits.

Version 1.1 run records bind the complete sidecar and each pair/condition into configuration, prompts, attempts, results and review provenance. Do not rewrite version 1.0 runs to add conditions retrospectively. Keep new runs under new directories.

The provided script probe is deliberately AI-authored and unreviewed. It has no reference answer, human equivalence review or approved language claim. Its permission records are synthetic fixture declarations, not human contributor consent. It cannot pass a real language-baseline gate or become training material by changing its run label.
