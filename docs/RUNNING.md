# Running Health Translator v0

## Prerequisites
- Node.js 20+ (Next.js 16 minimum).
- An Anthropic API key for the OCR/extraction call (only needed to read a real report).

## Setup
```bash
npm install
cp .env.local.example .env.local
# edit .env.local → ANTHROPIC_API_KEY=sk-ant-...
```

## Commands
| Command | What it does |
|---|---|
| `npm test` | Unit + component tests (Vitest). No API key needed. |
| `npm run test:watch` | Tests in watch mode. |
| `npm run dev` | Dev server on Turbopack at http://localhost:3000. Fast; the service worker is **not** active. |
| `npm run dev:pwa` | Dev server on **webpack** so the Serwist service worker is built and active (offline shell, install). |
| `npm run build` | Production build on **webpack** (Serwist requirement); emits `public/sw.js`. |
| `npm start` | Serve the production build. |
| `node scripts/generate-icons.mjs` | Regenerate the PWA icons. |

## Constraints & gotchas
- **Key is server-only.** Use `ANTHROPIC_API_KEY` (never `NEXT_PUBLIC_…`, which ships to the browser). It is read only in `lib/anthropic.ts` / `app/api/extract/route.ts`; never import those from a client component.
- **Node runtime required.** `app/api/extract/route.ts` sets `export const runtime = 'nodejs'` — the Anthropic SDK does not work on the edge runtime.
- **Serwist needs webpack.** Next 16 defaults to Turbopack, but the service-worker build only runs under webpack. Use `npm run dev:pwa` / `npm run build` for anything that exercises the PWA. `public/sw.js` is generated, not committed.
- **Image size.** The client downscales photos to ≤1600px JPEG before upload; the route also enforces a 4 MB cap (keeps base64 under Claude's 10 MB image limit).
- **PHI discipline.** The image is held in memory only for the duration of the Claude call and is never written server-side. The kept record lives in the browser's IndexedDB (`lib/db.ts`); clearing site data deletes it. Do not add server-side logging of the image, base64, or extracted values.

## Safety model (one paragraph)
Claude extracts printed rows only. `lib/grounding.ts` joins each row to the curated table (`data/reference-labs.ts`), checks units, classifies numerically (`lib/classify.ts`), and runs the deterministic guard (`lib/guard.ts`, rules R1–R12). Unknown analytes and unit mismatches abstain; high-stakes/critical values are re-confirmed by the user and flagged for a clinician. `lib/summary.ts` renders a templated bilingual summary from the table — the model never assigns meaning, ranges, or a diagnosis.
