# Study and review templates

These blank templates support the private Tibetan language and source-fidelity experiment. They contain no contributor submissions, Tibetan gold answers or evidence of approval.

Start with the [community/task worksheet](community-task-worksheet.md). Use the two development-screen CSVs to plan a small comparison, follow the [source/example reviewer instructions](reviewer-instructions.md), then measure the complete review process with the [ten-example timing template](ten-example-timing.csv). Once models have answered, use the separate [model-output review workflow](model-output-review.md) to import, freeze and adjudicate their answers.

## Where completed material belongs

Keep completed worksheets, contact details, permissions, passages, answers, reviewer submissions and model outputs in the configured local data root, outside this repository. The planned default is `/Users/likerun/Library/Application Support/HealthTranslatorML/`. Only blank templates and explicitly permitted, nonpersonal fixtures belong here. Contributor pseudonyms must not contain names, phone numbers or other contact details. Keep the pseudonym-to-contact mapping separately with restricted access.

The CSVs are intake and planning aids, not training files or authoritative approval records. Save CSV as UTF-8, quote fields containing commas or newlines, and preserve text exactly. Import Tibetan text into spreadsheet cells as plain text so the spreadsheet does not reinterpret it. Do not remove punctuation or tsheg, replace spelling variants, or normalize original text silently. Any normalized text must be a separate versioned derivative.

## Development screen

Use `development-passages.csv` for approximately 10–20 short, permissioned passages. That is a starting point for a development screen, not a training-data target or a claim that the sample represents all adults in Tibet. Prefer everyday nonclinical material when it can answer the language question. Preserve the source URL, title and date where applicable; original contributor material still needs explicit permission and provenance.

Use `development-questions.csv` for questions linked to those passages. Include direct extraction, factual questions, negation, changed numbers, unavailable information and conversational corrections where they fit the chosen task. For questions with yes/no answers, balance the expected answers instead of relying on an all-yes set. Treat questions from one passage as related observations.

- Assign source, scenario and paraphrase groups before any split. An altered-number passage or paraphrase remains linked to its original scenario.
- Have speakers write or review the expected answers and allowed claims. Leave unknown answers empty and mark the record incomplete. A generated answer is not human approval.
- For parallel Chinese material, use the same parallel-group ID and have a reviewer check semantic equivalence. Do not assume that automatic translation preserves the task.
- Mark all screen records as exposed to development. Material used to debug a prompt, compare candidates or train a smoke adapter cannot later become an unseen final test.
- The `permission_record_ref` refers to a local permission record, not an approval inferred from availability online. Blank permission or review fields mean unresolved.
- Proposed CSV rows must become validated, versioned source/example records before use. The tooling computes hashes from the canonical records; do not type or repair hashes manually.

## Independent review and adjudication

The authoritative review exchange is a versioned JSON packet with stable record IDs and content hashes. Export separate assignments for independent reviewers. Each reviewer returns their own ratings and issues against the exact assigned example/source versions. Keep the model-name key separate until reviews are frozen.

Reviewer export requires the source card's `permitted_uses` to contain `review`. Other uses, including `train`, are separate explicit entries. The exporter creates the editable packet and a sibling named `<packet filename>.receipt.json`. Keep that original receipt under the study operator's control; send only the editable packet to the reviewer. The receipt is a local comparison baseline, not a digital signature. If a submission is returned with a different filename, import it against the original retained receipt.

Within each item's `review` object, the reviewer may edit only `ratings`, `issues`, `minutes_spent`, `status` and `recommendation`. The three rating keys are `naturalness`, `fidelity` and `comprehension`; an unfilled rating is JSON `null`. Scores are integers from 1 to 5. `issues` is a list of explanatory strings. `status` is `incomplete` or `complete`; `recommendation` is `pending`, `approve`, `revise` or `reject`. Do not edit packet identity, assigned reviewer role, source/example content or hashes. Only the study operator can issue a corrected assignment.

The CSVs intentionally include planning fields that are not accepted JSON properties, such as permission-document references and Chinese parallel-group notes. Preserve those in the local study records. When constructing a validated example, map CSV `scenario_group_id` to `scenario_group`, `paraphrase_group_id` to `paraphrase_group` and `contributor_pseudonym` to `contributor_id`. A `proposed_answer` remains a pending draft even when entered in the JSON field named `approved_answer`; only the explicit review and adjudication workflow can approve it. Do not copy extra CSV columns into JSON or drop their provenance from the local study records.

Do not merge reviewer rows by overwriting one opinion with another. Preserve both submissions, then create a distinct adjudication record that cites the submissions and resolves or records each disagreement. Missing ratings remain incomplete. A source or answer edit changes the content being reviewed and requires a fresh version and review assignment; it is not a reason to edit the old packet hash.

Language review, medical review and permitted uses are separate. A Tibetan-language approval does not establish medical accuracy or authorize training. Health-related material awaiting qualified review remains explicitly restricted private research material; it must not be presented as medically validated.

## Measure capacity before setting a dataset target

Fill the ten numbered rows in `ten-example-timing.csv` with representative examples, not ten deliberately easy ones. Include failed, revised and unresolved examples. Record active person-minutes for authoring, translation, each independent reviewer, coordination and adjudication, plus elapsed time and rework. Count simultaneous work by two people as two contributions of person-time.

Put initial work in the six activity columns and additional revision/review cycles in `rework_person_minutes`; do not count the same minutes in both places. `total_person_minutes` is the sum of those seven columns. Use ISO 8601 timestamps with a time-zone offset, and compute `elapsed_hours` from the start and end of the complete process, including waiting. Leave unfinished values blank rather than entering zero. In `evaluation_capacity_reserved`, record the person-time earmarked for separate evaluation, or explicitly say it is not yet decided. Describe any extra reviewer roles in `notes` and include their additional time in the appropriate total without discarding individual records.

Report the completed count, incomplete count, range of times and main sources of disagreement. Reserve time for separate evaluation and its independent reviews before proposing the size of a training set. Do not extrapolate a target from only the fastest examples. If no qualified medical reviewer is available, record that dependency explicitly; timing language review does not estimate medical-review capacity.
