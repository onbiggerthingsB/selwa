# Running Health Translator v0

## Prerequisites
- Node.js 20+ (Next.js 16 minimum).
- An Anthropic API key for live report extraction or notes translation.
- An Upstash Redis database for the shared paid-route rate limiter.

## Setup
```bash
npm install
cp .env.local.example .env.local
# edit .env.local and set ANTHROPIC_API_KEY plus the three required rate-limit secrets
```

The home page and automated tests run without these credentials. A live call to any
paid route requires all of them.

## Commands
| Command | What it does |
|---|---|
| `npm test` | Unit + component tests (Vitest). No API key needed. |
| `npm run test:watch` | Tests in watch mode. |
| `npm run dev` | Dev server on Turbopack at http://localhost:3000. Fast; the service worker is **not** active. |
| `npm run dev:pwa` | Dev server on **webpack** so the Serwist service worker is built and active (offline shell, install). |
| `npm run build` | Production build on **webpack** (Serwist requirement); emits `public/sw.js`. |
| `npm start` | Serve the production build. |
| `npm run rate-limit:set -- <target> <value>` | Set or clear a live Redis-backed limit override; see below. |
| `node scripts/generate-icons.mjs` | Regenerate the PWA icons. |

## Constraints & gotchas
- **Secrets are server-only.** Never prefix the Anthropic, Upstash, or rate-limit
  secrets with `NEXT_PUBLIC_`, which would ship them to the browser.
- **Node runtime required.** The paid Anthropic routes set `export const runtime = 'nodejs'` — the Anthropic SDK does not work on the edge runtime.
- **Serwist needs webpack.** Next 16 defaults to Turbopack, but the service-worker build only runs under webpack. Use `npm run dev:pwa` / `npm run build` for anything that exercises the PWA. `public/sw.js` is generated, not committed.
- **Image size.** The client downscales photos to ≤1600px JPEG before upload; the route also enforces a 4 MB cap (keeps base64 under Claude's 10 MB image limit).
- **PHI discipline.** The image is held in memory only for the duration of the Claude call and is never written server-side. The kept record lives in the browser's IndexedDB (`lib/db.ts`); clearing site data deletes it. Do not add server-side logging of the image, base64, or extracted values.

## Paid-route rate limiting

Rate limiting is required before Vercel Authentication is removed. It covers all
routes that can spend Anthropic credits:

- `POST /api/extract`
- `POST /api/translate-notes`
- `POST /api/advice` — **QUARANTINED 2026-07-25: returns `410` unconditionally.** The refusal is
  the first statement in the handler, so this route no longer reads a body, calls the model, or
  consumes any rate-limit allowance. The rate-limit config and tests are retained deliberately.

The consent assertion is checked first and remains unchanged. Consent is an integrity
control, not authentication. After consent succeeds, the route checks its limits
before reading the image or JSON body and before constructing or calling the Anthropic
client. A rejected request returns `429`; a missing or unavailable limiter fails closed,
so the paid route does not read the payload or reach Anthropic.

### What it guarantees

Upstash Redis, rather than a module-level counter, is the source of truth. Counters
are therefore shared across concurrent Vercel function instances and survive cold
starts and redeploys while the database, namespace, and IP-hash secret stay stable.
Each IP-derived identifier has:

- a route-specific short-window burst limit; and
- one shared daily pool of cost units across all paid routes.

At the defaults, an extract costs 5 units, advice costs 3 units, notes translation
costs 1 unit, and the shared pool contains 60 units per day. An IP could therefore
make at most 12 extract requests, 20 advice requests, 60 notes requests, or a weighted
combination, subject to the separate burst limits.

This raises the cost of abuse; it does not eliminate it. IPs can be spoofed or changed,
distributed callers can use many IPs, and unrelated users behind the same NAT can share
one quota. This is not authentication, a global spending ceiling, or a substitute for
Vercel Firewall/WAF controls. The application HMACs the observed IP before using it as
a Redis identifier. Raw IPs, request bodies, images, notes, model responses, and SDK
errors are never stored in Redis. Upstash analytics and the SDK's per-instance
ephemeral cache are disabled.

### Environment variables

All variables are server-only.

| Variable | Required | Default | Purpose |
|---|---:|---:|---|
| `UPSTASH_REDIS_REST_URL` | yes | — | REST endpoint for the shared Upstash Redis database. |
| `UPSTASH_REDIS_REST_TOKEN` | yes | — | Server-only token for that database. |
| `RATE_LIMIT_IP_HASH_SECRET` | yes | — | HMAC secret for IP-derived identifiers; must be at least 32 characters and must not reuse another credential. |
| `RATE_LIMIT_NAMESPACE` | no | `VERCEL_ENV`, then `NODE_ENV`, then `development` | Separates counter keys by environment. Set this explicitly when an operator command targets a deployed environment. |
| `RATE_LIMIT_BURST_WINDOW_SECONDS` | no | `60` | Duration of each short burst window. |
| `RATE_LIMIT_DAILY_WINDOW_SECONDS` | no | `86400` | Duration of the shared long window. |
| `RATE_LIMIT_EXTRACT_BURST` | no | `3` | Extract requests allowed per IP-derived identifier per burst window. |
| `RATE_LIMIT_TRANSLATE_NOTES_BURST` | no | `10` | Notes requests allowed per IP-derived identifier per burst window. |
| `RATE_LIMIT_ADVICE_BURST` | no | `5` | Advice requests allowed per IP-derived identifier per burst window. |
| `RATE_LIMIT_DAILY_UNITS` | no | `60` | Shared daily cost-unit allowance. |
| `RATE_LIMIT_EXTRACT_COST_UNITS` | no | `5` | Units charged for an extract request. |
| `RATE_LIMIT_TRANSLATE_NOTES_COST_UNITS` | no | `1` | Units charged for a notes request. |
| `RATE_LIMIT_ADVICE_COST_UNITS` | no | `3` | Units charged for an advice request. |
| `RATE_LIMIT_STORE_TIMEOUT_MS` | no | `1500` | Maximum wait for the shared store before the route fails closed. |

Invalid required values or non-positive numeric settings are configuration errors; the
paid routes fail closed rather than silently falling back to an in-memory limiter.

### Provisioning on Vercel

1. Create an Upstash Redis database or link an existing one through the Upstash
   integration in the Vercel Marketplace.
2. Confirm that the integration added `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN` to the Health Translator project. Enable them for
   Production and for Preview if preview deployments will exercise paid routes.
3. Generate a separate high-entropy HMAC secret, for example with
   `openssl rand -hex 32`, and set it as `RATE_LIMIT_IP_HASH_SECRET`.
4. Add any non-default limit values required for that environment.
5. Redeploy, then exercise all paid routes and confirm that a limited request returns
   `429` without an Anthropic call.

Vercel environment-variable changes apply only to new deployments. Environment
variables make the limits configurable without a code change, but changing one still
requires a Vercel redeployment.

### Live overrides without a redeploy

Operators can change the four primary ceilings directly in Redis:

```bash
RATE_LIMIT_NAMESPACE=production npm run rate-limit:set -- extract-burst 2
RATE_LIMIT_NAMESPACE=production npm run rate-limit:set -- translate-notes-burst 5
RATE_LIMIT_NAMESPACE=production npm run rate-limit:set -- advice-burst 3
RATE_LIMIT_NAMESPACE=production npm run rate-limit:set -- daily-units 30
```

The accepted names are `extract-burst`, `translate-notes-burst`, `advice-burst`, and
`daily-units`. The value must be a positive integer. A Redis override takes precedence
over the deployment's environment-backed default and is immediately shared by all
function instances. Clear an override to return to the deployed default:

```bash
RATE_LIMIT_NAMESPACE=production npm run rate-limit:set -- extract-burst default
```

The operator command itself needs `UPSTASH_REDIS_REST_URL`,
`UPSTASH_REDIS_REST_TOKEN`, and `RATE_LIMIT_IP_HASH_SECRET` in its environment. Set
`RATE_LIMIT_NAMESPACE` to the target deployment (`production` or `preview`); otherwise
a local command defaults to the `development` namespace and cannot alter production
counters. Window durations, request cost weights, and the store timeout remain
environment settings and require redeployment to change.

### Local 429 smoke test

Configure the required values in `.env.local`, start `npm run dev`, and temporarily
set the extract burst to one:

```bash
npm run rate-limit:set -- extract-burst 1
curl -i -H 'x-ht-consent-version: 2' -F 'image=@README.md;type=text/plain' http://localhost:3000/api/extract
curl -i -H 'x-ht-consent-version: 2' -F 'image=@README.md;type=text/plain' http://localhost:3000/api/extract
curl -i -H 'x-ht-consent-version: 2' -F 'image=@README.md;type=text/plain' http://localhost:3000/api/extract
npm run rate-limit:set -- extract-burst default
```

The first request is allowed through the limiter and rejected as an unsupported upload.
One of the next two returns `429` before its body is read; the extra attempt makes the
check robust if the first pair happens to straddle an Upstash window boundary. The
response contains only the bilingual client-facing message, never store details or
request content. If `CONSENT_VERSION` changes in `lib/consent.ts`, update the test
header accordingly.

The same check for notes translation uses an empty note so the allowed request stops
at validation rather than reaching Anthropic:

```bash
npm run rate-limit:set -- translate-notes-burst 1
curl -i -H 'x-ht-consent-version: 2' -H 'content-type: application/json' --data '{"text":""}' http://localhost:3000/api/translate-notes
curl -i -H 'x-ht-consent-version: 2' -H 'content-type: application/json' --data '{"text":""}' http://localhost:3000/api/translate-notes
curl -i -H 'x-ht-consent-version: 2' -H 'content-type: application/json' --data '{"text":""}' http://localhost:3000/api/translate-notes
npm run rate-limit:set -- translate-notes-burst default
```

> **OBSOLETE — Feature 2 quarantine, 2026-07-25.** The commands below no longer exercise rate
> limiting. `POST /api/advice` now returns `410 {"error":"Advice feature disabled","errorZh":"健康咨询功能已停用"}`
> unconditionally, before the consent check, the rate limiter, and the body read — so all three
> curls return `410`, none consumes an allowance, and validation is unreachable. Retained as the
> pre-quarantine procedure in case the route is ever restored.

The advice route can be checked without a model call by sending an empty question so
the allowed request stops at validation:

```bash
npm run rate-limit:set -- advice-burst 1
curl -i -H 'x-ht-advice-consent-version: 1' -H 'content-type: application/json' --data '{"gender":"unknown","question":"","languageMode":"en"}' http://localhost:3000/api/advice
curl -i -H 'x-ht-advice-consent-version: 1' -H 'content-type: application/json' --data '{"gender":"unknown","question":"","languageMode":"en"}' http://localhost:3000/api/advice
curl -i -H 'x-ht-advice-consent-version: 1' -H 'content-type: application/json' --data '{"gender":"unknown","question":"","languageMode":"en"}' http://localhost:3000/api/advice
npm run rate-limit:set -- advice-burst default
```

A request without the consent header must continue to return `403` before consuming a
rate-limit allowance — true for `/api/extract` and `/api/translate-notes`. **Not for
`/api/advice` while quarantined:** it returns `410` regardless of the consent header, because the
refusal precedes and supersedes the consent gate.

## Safety model (one paragraph)
Claude extracts printed rows only. `lib/grounding.ts` joins each row to the curated table (`data/reference-labs.ts`), checks units, classifies numerically (`lib/classify.ts`), and runs the deterministic guard (`lib/guard.ts`, rules R1–R12). Unknown analytes and unit mismatches abstain; high-stakes/critical values are re-confirmed by the user and flagged for a clinician. `lib/summary.ts` renders a templated bilingual summary from the table — the model never assigns meaning, ranges, or a diagnosis.
