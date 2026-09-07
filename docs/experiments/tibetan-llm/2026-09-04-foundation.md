# First engineering batch — September 4, 2026

Status: first engineering batch implemented and verified. Changes are local, with no commit, push, deployment or model publication.

## Delivered

- Native Python 3.12.13 environment on Apple M4 Pro, 24 GiB unified memory. MLX 0.32.2 and MLX-LM 0.31.3 are installed from the hashed macOS ARM64 lock; the smaller core dependency lock supports separate Linux CI.
- Installed `ht-tibetan` command: preflight, validation, split audit, review export/import, infrastructure manifests and explicit synthetic inference/failure results. Commands work outside the repository. Core imports/tests do not download or load models.
- Source/example/review/adjudication contracts with exact text hashes, permissions, independent ratings, incomplete-review revisions and transitive leakage checks. Both a source archive and a wheel were independently built and their packaged schemas tested outside the checkout.
- Blank community/task, development-screen and ten-example timing templates. No actual community, participant permissions or native ratings are asserted.
- Exact candidate repository revisions and file inventory. No weights acquired. The catalog preserves Qwen chat-template differences and unresolved Gemma conversion/provenance/loader details; see [candidate notes](../../../research/config/MODELS.md).
- Production notes endpoint always returns 410. Updated capture/save/result views preserve exact original text and suppress historical generated translations. Versioned records distinguish original text, empty entry and an unavailable legacy original, while retaining historical data.
- Storage failure handling and the pre-existing redaction-preview lint repair. New copy uses the existing explicit Chinese fallback for Tibetan; zero curated Tibetan entries remain asserted by the production tests.

## Measurements and validation

| Check | Result |
| --- | --- |
| Original production baseline | 1,217 passing tests, 41 skipped; TypeScript passed after sequential type generation |
| Original lint baseline | Three existing ref-during-render errors in CaptureCard |
| Updated complete production suite | 99 files; 1,252 passed, 41 skipped |
| Updated full production lint | Passed |
| Research core tests | 36 passed; no model/network work |
| Native MLX test | One small array computation executed successfully on Metal |
| Packaged CLI/reviewer round trip | Passed outside checkout; incomplete reviews remain incomplete |
| Source archive -> wheel -> packaged schema validation | Passed independently |
| Production build / final TypeScript | Both passed |
| Built app on localhost | Homepage 200; two synthetic notes POSTs 410 with no-store; advice POST 410 |

The production build completed after a transient synchronous read delay in `node_modules/caniuse-lite/data/features/webgpu.js`. A process sample identified the read; subsequent reads succeeded and the build finished without source or configuration changes. The exact cause of the transient delay is unproven. A temporary production server was used for four HTTP checks and stopped afterward.

The first full suite after the notes change found four inventory assertions: ten added Chinese-fallback strings changed the corpus from 619 to 629 and the reviewer floor from 162 to 172. These counts were updated with dated explanations; zero-curated-Tibetan and the other publication invariants were preserved. The complete rerun passed.

Read-only preflight at `2026-09-05T01:31:45Z` (September 4 local time) measured 35,056,078,848 bytes free, approximately 32.65 GiB, with the environment already installed. The preflight used zero projected additional bytes and is **not acquisition clearance**. Both proposed 4-bit snapshots total 5,718,869,709 bytes; future acquisition must account for temporary/cache copies and maintain the 15 GiB reserve. No model-fit or training-speed measurement exists.

Machine-local records are under `~/Library/Application Support/HealthTranslatorML/runs/foundation-20260904/`. This report contains no real contributor or patient data. The native GPU check confirms runtime execution only, not model capacity, Tibetan comprehension or clinical correctness.

## Remaining work

1. Select the first community/task and obtain permissioned passages plus independent Tibetan/bilingual reviews. Time ten complete examples before setting a training-data target.
2. Resolve candidate loader/provenance details and implement the complete tokenizer/model runner with exact templates, limits, acquisition verification and model-run manifests.
3. Run the shared baseline comparison before selecting or training an adapter. The current fake adapter and infrastructure manifest are not replacements for that measurement.
4. Continue the private chatbot, retrieval and lab-integrity integration stages in the implementation plan. Health-content correctness still requires qualified review.

Cloud spending is $0. No weights, adapters, actual baseline outputs or trained-model quality claims have been created. The production app still uses its existing cloud OCR path, advice quarantine and generated-Tibetan restriction. The notes fix takes effect in updated local code; an already-running old PWA can display previously cached content until refreshed, and no deployed instance has been updated in this batch.
