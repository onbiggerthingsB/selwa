# Private conversation demo — 5 September 2026

The separate research app now runs at `http://127.0.0.1:38471` using two fixed synthetic English passages. It implements source selection, a conversation view, source citations and failure/cancellation handling. **No language model is connected. Every reply explicitly states that the question was not interpreted.** This is an early implementation of the Stage 6 interface while native material and model-selection evidence are pending.

## Implemented behavior

- Independent Next.js app under `research/web`, with its own exact direct dependencies, lockfile, TypeScript, lint, tests, build and CI job. It imports no production advice route or browser report store.
- English/Chinese controls, responsive layout, original passages and review status, complete reply display and exact source citation navigation. System fonts display Tibetan text without claiming language review. Source choices have distinct numbered excerpts while full original titles and passages remain unchanged.
- Memory-only conversation and drafts. Cancelling, resetting or changing passages prevents late replies from reappearing. Failures retain the current draft and prior successful conversation. No token streaming, service worker, cloud calls, transcript logging or automatic training export.
- Shared chat JSON Schema and 73 conformance cases run by Python and TypeScript, plus server-only source hash verification. Requests cannot specify evidence text, arbitrary model paths or backend URLs. The fixed catalog reads no private dataset files.
- A launcher-issued HttpOnly, SameSite=Strict session cookie; exact inbound host/origin checks; proxy-header rejection; loopback-only binding. API routes fail if invoked without launcher configuration. Production WebSocket upgrades are denied; development HMR is gated before Next's automatically installed listener receives the upgrade.
- A 64 KiB body cap, five-second body-read deadline, 2,000 code points per message, 8,000 across at most nine alternating messages, ten-second generation deadline and one active generation. A timed-out/cancelled provider retains its slot until it actually settles. The client also limits serialized size and bounds catalog and reply/body waits.

The catalog is synthetic and nonclinical; a real reviewed-card adapter is not implemented. Character limits do not establish a model's token budget. Citations are checked structurally; the software does not infer semantic or clinical fidelity from a valid citation.

## Verification

| Check | Result |
| --- | --- |
| Research web tests | 243 passed across eight files |
| Portable Python research suite | 223 passed, including 11 new chat-contract tests and shared conformance cases |
| Web lint / TypeScript / production build | Passed |
| Independent dependency tree | `npm ls --all` passed with no invalid required peers |
| Real HTTP smoke check | Homepage/session bootstrap, catalog authentication, raw Host and Origin rejection, proxy rejection, exact citations, stale source rejection, invalid JSON/fields, byte bounds, no-store document/assets and production upgrade rejection passed |
| Unicode body regression | A synthetic Tibetan-script request larger than 16 KiB but within the declared conversation bounds completed under the 64 KiB cap; no language judgment made |
| Browser | Source loading, complete simulated reply, source citation/focus, English/Chinese controls, narrow 390-pixel layout, Tibetan glyphs/composer wrapping and passage switching inspected |
| Targeted production quarantine/notes checks | 17 passed, 41 existing skips. The initial parallel run timed out starting workers before executing tests; a serial retry completed. No production code changed in this batch. |
| Whitespace | `git diff --check` passed |

The live check script is [check-live.mjs](../../../research/web/scripts/check-live.mjs). It uses only synthetic questions, keeps the session credential in memory and prints no credential. The browser inspection was of this new local app; it does not retroactively verify the earlier offline reviewer HTML files whose preview was blocked.

## Defects caught and repaired

1. NextRequest normalizes a loopback IP to `localhost` internally, causing valid catalog calls to fail. The API now accounts for that internal representation while the actual inbound Host and browser Origin remain bound to `127.0.0.1` and the exact port. A test uses a real NextRequest.
2. Next automatically installs a separate WebSocket upgrade listener. The launcher now gates upgrade event dispatch itself, so a rejected request cannot continue to that listener. Production denies all upgrades.
3. The initial 16 KiB body cap rejected otherwise valid Tibetan conversations. The cap is now 64 KiB and shared with the client; code-point and message bounds remain enforced. The original failure and repaired path were reproduced.
4. An unresponsive catalog or response body could leave the interface waiting indefinitely. Explicit client deadlines now restore a usable state without accepting a late response.

Dependency installation initially hit an npm 10.9.8 optional peer-resolution crash. The app records `legacy-peer-deps=true` locally and explicitly pins its required Testing Library DOM and file-scanner peer; the final dependency tree and independent app checks passed. This setting does not affect the production package.

## Reproduce and remaining work

See [run instructions](../../../research/web/README.md). The final launcher is left running on `127.0.0.1:38471` for local inspection. It is not a public deployment. Restarting the launcher issues a new session credential; reopen the page after restarting.

Private verification logs and the engineering manifest are retained under `/Users/likerun/Library/Application Support/HealthTranslatorML/runs/private-chat-engineering-20260905/`. The manifest binds the web source/configuration/lockfile, shared contract, checks and report. It is an engineering record, not a model quality result.

No model call, adapter training, human review, candidate selection, paid compute, commit, push or public deployment occurred. Next evidence dependencies remain permissioned Tibetan passages, independent native judgments, task/community selection and the reviewed candidate comparison. Real-model connection, tokenizer-aware conversation limits and real reviewed-card eligibility are still pending.
