# Offline review forms — 5 September 2026

The research CLI can now turn a sealed assignment into a self-contained offline HTML form. Tibetan speakers can review the supplied text, enter ratings and issues, download a response JSON and reopen that draft without editing JSON manually. Source/example packets and model-output packets retain their separate import contracts and rating scales.

## Implemented

- `ht-tibetan review-form` verifies the public packet against the retained model key, or the source receipt and current dataset. Private proof files never enter the HTML.
- English/Chinese controls, fixed passages/questions/answers, per-item navigation, explicit source completion, model blinding disclosure, issue notes and completion counts. Uncertain scores remain blank. No Tibetan interface translation is represented as reviewed.
- Explicit JSON downloads and local draft resume. Resume rejects changed immutable fields, swapped/reordered items, unknown fields, duplicate keys, invalid values, oversized files and invalid UTF-8. Rejected resumes preserve current work. Preparing a download does not claim that the operating system saved it.
- No network calls, browser storage, external fonts or dependencies. Source text enters through a base64 UTF-8 envelope and is displayed with `textContent`. A content security policy restricts execution and styles to the bundled hashes and blocks network connections.
- Private, create-only exports outside Desktop and source-run folders; 1–1000 items, 32 MiB embedded payload and 48 MiB HTML bounds. Packaged assets are included in wheels and run-manifest code hashes.
- A three-passage collection guide and blank intake form, with separate permission choices for private review and local model evaluation. It does not grant training or publication rights. The larger development set and timed ten-example pilot remain pending.

Independent review found two import-compatibility defects during implementation: outdated review chains could generate unusable forms, and immutable JSON numbers written as `1.0` could change their bindings when the browser wrote `1`. Both are fixed and regression-tested. Existing incomplete assignments and valid successors remain usable; ordinary review time such as `2.0` remains allowed.

## Verification

| Check | Observed result |
| --- | --- |
| Full research Python suite | 212 passed, including 13 form-export tests |
| Reviewer DOM suite | 50 passed; added to Node CI |
| Actual generated model form | Seven items; untouched download equals original packet; synthetic Unicode issue preserved; all ratings still blank |
| Actual generated source form | Two synthetic examples; same exact download and issue-preservation checks |
| Existing importers | Source responses imported as incomplete; model response imported as `synthetic_test`, non-independent, zero completed items; no approval |
| Built wheel | All three assets and current exporter match source bytes; importing directly from the wheel outside the checkout successfully renders HTML |
| Whitespace check | `git diff --check` passed |
| Visual browser inspection | Not completed: the browser tool's URL policy blocked opening the local HTML. No alternate browser route was used. DOM tests do not verify visual rendering or live browser CSP enforcement. |

The final wheel SHA-256 is `3e5a37bd4bbcfbc8d7d2153933fbf19d97e9ddf66073901841007a100cf388df`.

## Local artifacts

Private root: `/Users/likerun/Library/Application Support/HealthTranslatorML`.

- `review-forms/paired-script-review.html`: the existing unreviewed seven-answer Tibetan/Chinese script probe. HTML SHA-256 `986929e6050292775e41e90b78f79abb0945266c6e377a060a3d82ca298066b0`.
- `review-forms/source-fixture-review.html`: two-example English engineering fixture. HTML SHA-256 `71343fe482e89001999897beb987abc49ab0f78ae957054a7169bf3fd4481bf1`.
- `review-checks/offline-form-20260905/`: retained source assignment/receipt and clearly synthetic import checks. No native judgment was created.
- `runs/reviewer-form-engineering-20260905/`: verification logs, check script and final engineering manifest. This is a software-verification record, not a model experiment or quality result.

Instructions: [offline form workflow](../../../research/review/offline-form.md), [first passage guide](../../../research/review/first-passages.md), [blank intake form](../../../research/review/first-passages-template.txt).

No model inference, training, candidate selection, production app changes, commit, push or deployment occurred in this batch. Real permissioned Tibetan passages, independent language judgments and the selected community/task remain the next evidence dependencies. This form supports that work; it does not establish Tibetan or health-guidance quality.
