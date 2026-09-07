# Private conversation demo

This separate Next.js app implements the source-selection and conversation flow for the Tibetan research project. **Every response is a fixed synthetic demonstration. No language model interprets the question.** The two English passages are existing nonclinical engineering fixtures, not reviewed Tibetan or health material.

## Run on this Mac

```sh
cd /Users/likerun/Desktop/health-translator/research/web
npm ci --ignore-scripts
npm run build
npm start
```

Open `http://127.0.0.1:38471`. Stop with Ctrl-C. Use `npm run dev` for development, or `npm start -- --port 38472` for another loopback port. Use the launcher, not `next start`: the API stays unavailable without its session configuration. The production lab-report application has its own commands and routes.

Choose a passage, read its original wording and review status, and enter a question. A complete demo response includes a link to its exact selected source. English/Chinese controls do not translate the passages. Cancel stops the pending conversation request; changing passages or starting a new conversation clears the current thread. Transcripts and drafts remain in page memory and are lost when the page closes or reloads. No automatic training export or transcript persistence exists.

## Current boundary

The server catalog is fixed to two checked-in fixtures and verifies their exact UTF-8 hashes. Requests contain a source ID/version/hash and conversation, never arbitrary evidence text, model paths or backend URLs. The fake provider runs in process and returns an explicitly synthetic result; it has no external endpoint, question-triggered commands, tokenizer or model loader.

The launcher binds only `127.0.0.1` and starts a new random session credential for each process. A direct page visit receives a host-only, HttpOnly, SameSite=Strict session cookie, scoped by a port-specific name. The API checks the exact host, origin and session. Cross-site requests, forwarded proxy headers and stale session credentials fail. Cookies are used only for local session access; they contain no conversation or study data. These checks do not isolate the app from other programs running as the same user on the Mac.

Production rejects WebSocket upgrades. Development permits only the authenticated HMR path with the exact same origin and port, before Next's upgrade listener receives the request. The API accounts for NextRequest's internal loopback-URL normalization while preserving checks on the actual incoming Host and browser Origin.

The API limits request bodies to 64 KiB, each message to 2,000 Unicode code points, and total conversation text to 8,000 code points and nine alternating messages ending in a user turn. These are transport limits, not tokenizer measurements. Body reads and generation have separate deadlines. One generation can run at a time; cancellation or timeout does not free its slot before the underlying provider actually stops. A future provider must support bounded execution in its own process.

Failed or structurally invalid responses contain no answer. Successful responses must bind the current request and the complete selected-source identity. Unknown, missing, duplicated or stale citations fail before answer display. This detects structural errors; it does not determine whether prose faithfully explains a passage. The UI ignores late responses after cancellation/reset/source changes.

The app sets `Cache-Control: no-store`, uses system fonts, registers no service worker and performs no telemetry or cloud inference. This implementation does not establish real-model token limits, Tibetan comprehension, reviewed source eligibility or medical validity. Connecting a selected model and real reviewed source catalog remain separate work.

## Verification

```sh
npm test
npm run lint
npm run build
npm run typecheck
npm ls --all
# Explicit opt-in HTTP check after npm start, using only synthetic questions:
node scripts/check-live.mjs
```

The app has its own dependency lock, TypeScript, lint, test and CI settings. `.npmrc` disables automatic peer installation because npm 10.9.8 crashed while resolving optional browser-test peers. Required Testing Library DOM and file-scanner peers are explicitly pinned; `npm ls --all` verifies the resulting dependency tree. No test requires model weights or GPU access.

`../contracts/chat.schema.json` and its shared conformance fixture define the versioned wire contract. Portable Python validation and the TypeScript validators exercise the same cases, with semantic checks for conversation ordering/length, exact citations and source hashes. The web catalog remains limited to engineering fixtures regardless of what files exist elsewhere on the Mac.
