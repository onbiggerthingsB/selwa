# Instructions for independent reviewers

The study tests understanding, source fidelity and everyday written Tibetan. A fluent answer can still change the meaning. Your language judgment is valuable on its own; it does not require you to judge medical correctness outside your qualifications.

## Before reviewing

1. Confirm that the assignment is permitted for this use and that you are comfortable with the language/register and task. Decline or flag material you cannot assess.
2. Check the packet ID and assigned example IDs. Work from the supplied version; do not replace the passage with a newer one or edit its hash.
3. Record your reviewer pseudonym and assigned role. Keep personal details out of the packet.
4. Review independently before seeing another reviewer's ratings or the model identity. Record any accidental exposure to those details.

Use the JSON packet and its defined fields as the authoritative submission. A blank CSV or worksheet is not an approved review. If a required rating is missing, leave the assignment incomplete rather than filling it with an inferred pass.

If you received an offline HTML form, open it in a browser and follow the [form instructions](offline-form.md). Download the response JSON to keep your work or resume it later. Switching the English/Chinese interface does not translate the assigned Tibetan text. Source/example reviews use the 1–5 rubric below; model-answer reviews use their separate 1–4 packet rubric.

## What to assess

Review the question, original source, allowed claims and answer together. Refer to exact phrases or positions when identifying an issue.

| Dimension | What to check |
| --- | --- |
| Task comprehension | Does the answer address what was asked, including corrections and unavailable information? |
| Source fidelity | Are claims supported by the assigned passage? Note additions, omissions and changed meaning. |
| Protected facts | Check numbers, units, comparisons, negation, conditions, named items and who a statement applies to. |
| Everyday Tibetan | Is the wording understandable and natural for the intended adult audience and selected register? Explain unfamiliar terms or ambiguity. |
| Uncertainty | Does the answer acknowledge missing information rather than inventing an answer? |
| Parallel material | Where assigned, do Tibetan and Chinese versions express equivalent information and questions? |

Keep source fidelity and language quality separate. Do not average a serious factual change into a reassuring overall language score. Use the packet's rating definitions; if the choices do not describe a case, explain the problem instead of inventing a new numeric scale.

The current packet uses integer scores from 1 to 5 for `naturalness`, `fidelity` and `comprehension`. Use these starting anchors consistently, and calibrate them together on separate practice material before independent study review. Record the rubric version used by the study. These anchors are not a validated clinical scale or an automatic approval threshold.

| Score | Naturalness | Fidelity to the supplied source | Comprehension of the assigned task |
| --- | --- | --- | --- |
| 1 | Meaning is largely unreadable or unclear | Central meaning is wrong or substantially invented | Does not meaningfully address the task |
| 2 | Major language problems obstruct understanding | Major factual changes or omissions | Misses a major requirement or condition |
| 3 | Understandable in part, with several substantial wording problems | Mixture of supported content and consequential errors | Addresses part of the task but needs substantial correction |
| 4 | Clear overall, with minor wording improvements needed | Meaning is preserved overall, with a minor issue to document | Addresses the task with a minor omission or ambiguity |
| 5 | Clear and natural for the assigned register | No unsupported addition, omission or meaning change identified | Correctly addresses the full task, including missing information |

Record critical changes separately in `issues` regardless of the numeric scores. A score of 5 means the reviewer did not identify a defect; it is not proof of correctness. Leave a dimension `null` if you cannot assess it and explain why. A completed language review requires all three ratings, time spent and a recommendation; do not invent a rating merely to make a submission complete.

For each issue, record the affected text, the meaning of the problem, its practical consequence and a suggested correction when you can provide one. A correction is a proposal until reviewed. Distinguish an unresolved interpretation from a definite error.

## Health-related material

A speaker may identify a mistranslated health term or a contradiction with the supplied source without certifying that the source is medically correct. If clinical or nutrition expertise is needed, flag that dependency. Do not mark medical review approved unless that is your assigned qualified role and the required medical review actually occurred. Language approval cannot replace medical approval or change permitted uses.

## Record time and submit

- Record active review minutes, rework minutes and unresolved questions. Include time spent checking a difficult passage; do not report only time spent typing the final judgment.
- Return the original assignment identity with your independent review. Do not change IDs, hashes, source text or another reviewer's response to make an import succeed.
- If the source, question or answer is wrong, report the issue. A corrected version needs a new assignment against its new content hash.
- Report duplicated assignments, missing fields or tool errors. Do not duplicate IDs or silently drop unfinished records.

## Separate adjudication

After independent submissions are preserved, the adjudicator reads both and creates a separate outcome. That record must identify the reviewed version and the submissions considered, summarize disagreements, and explain each resolution or remaining issue. Preserve the original independent ratings even when the final decision differs.

If agreement requires rewriting the source or approved answer, create a new version and obtain the necessary reviews for the changed text. If the disagreement cannot be resolved, keep the example pending or exclude it from the proposed use. Review completion does not automatically grant training or publication permission.
