# Data safeguards implementation, September 5, 2026

The next implementation batch repairs the data gates identified in the independent review. New real baseline runs now refuse missing contributor permissions, contradictory approvals and unusable run history before loading a model. No new training, human review or Tibetan capability measurement occurred in this batch.

## What changed

- Language approval requires two complete, current, distinct non-author reviewers and at least one supporting approval. The author cannot adjudicate their own example. A reviewer may resolve disagreement with a rationale; overlap and reviewer count remain explicit in the validation report.
- A separate contribution ledger binds each author's grant to the exact source or question/answer/claims bundle. It checks explicit uses, revision chains, expiry and withdrawal. Expanded/restored permission requires fresh recorded consent. Removing an author declaration cannot erase a known author's bound revocation. Community source authors need separate source-text grants; source rights remain independently required.
- Split checks join exact and normalized task-content duplicates as well as source/scenario/paraphrase groups. New identifiers do not hide unchanged task content. Shared answers alone do not join tasks. Original text is never normalized in place.
- The exposure inventory reads finalized baseline and mechanics artifacts, verifies recorded hashes and reconciles exposure through historical content/group links. Failed mechanics attempts remain smoke-exposed. Unknown/unfinished runs, changed or omitted evidence and unsafe paths block clearance. Existing historical records are read by their schema/content bindings rather than retroactively applying new approval semantics.
- `audit-data-use` combines current permissions, source/review checks, split checks and cumulative local history. New baseline runs require a current permission ledger for real material, keep outputs under the private `runs/` directory, preserve a hashed audit receipt and recheck permissions after rendering before each attempted dispatch. Legacy record-only validators and review workflows remain readable; they do not acquire release authority.

Implementation is in `records.py`, `permissions.py`, `duplicate_content.py`, `splits.py`, `exposure_inventory.py`, `data_use.py`, `baseline.py` and `cli.py`, with the new shared contribution-permission schema. The existing synthetic-only training runner and frozen research web app were not extended in this batch.

## Verification

All **368 Python core tests** pass using the pinned Python environment and `unittest discover`; all **50 reviewer-form DOM tests** pass using `node --test`. The Python total adds 106 tests to the prior 262, covering 16 approval checks, 15 duplicate cases, 31 contributor-permission cases, 31 inventory cases and 13 integration cases. Existing baseline, paired-run and blind-review tests also pass under the new runner gates.

Integration tests verify that a fresh dataset and new IDs cannot turn previously dispatched task content into unseen final-test evidence; corrupt history and missing/expired consent stop before model loading; a ledger changed during rendering cannot reach inference; a second baseline reads the first run's new hashed audit artifact. Tests use synthetic fixtures and mocked inference; their declared permission labels are not real consent.

An independent read-only audit of the current private run directory found **9 finalized manifests**, verified **84 manifest/artifact hashes**, read **1,239,320 bytes**, and produced **8 merged content entries**. It preserved exposure from both failed Gemma attempts and the completed Qwen mechanics run. Four known non-model engineering manifests were explicitly classified; their external basename-only input references were not reverified. Counts and the exact inventory digest are recorded in [the evidence receipt](2026-09-05-data-safeguards-evidence.json).

An independent implementation review reproduced one race where consent could change during prompt rendering. The permission check was moved after rendering, immediately before exposure reservation, and a regression confirms zero dispatches. A separate permission audit found and repaired stale-consent timestamp and hidden-coauthor withdrawal cases.

## Limits and next work

These checks establish consistency of supplied evidence. They cannot authenticate consent, discover omitted authors or revocations, recover deleted/external runs, or prove semantic independence. Exact/normalized fingerprints do not detect all paraphrases. Reviewer/adjudicator overlap is disclosed, not automatically prohibited when the adjudicator is one of the two independent reviewers.

The release/locked-test builder remains unimplemented. The next engineering step is to assemble immutable releases from current permission and exposure receipts, then extend the verified training path to consume those releases with equivalent inference conditions and strict adapter identity. Instruction-language conditions and representative sequence/resource measurements still need work. Real community/task selection, permissioned native passages and the ten-item reviewer agreement pilot remain human dependencies; the 108 temporary strings have not acquired permission through this implementation.

The earlier 20-update English synthetic adapter remains the only completed training result. No Tibetan comprehension, health correctness, model selection or production readiness is established. No commit, push or deployment was made; the previously dirty/untracked research, documentation and CI changes still need coherent repository delivery.
