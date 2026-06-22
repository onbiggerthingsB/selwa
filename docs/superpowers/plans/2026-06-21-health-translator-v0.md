# Health Translator — Phase 1 / v0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Mode 1 (after-visit comprehension) for one language pair (Mandarin ↔ English) as a web/PWA: photograph a lab report → OCR → ground each value against curated reference ranges → plain-language, translated summary with an abstention / "confirm with your clinician" guard on high-stakes and uncertain items.

**Architecture:** The LLM (Claude vision) does **OCR/extraction only** — it reads printed analyte/value/unit/range rows off the photo into structured JSON. Everything downstream is **deterministic** TypeScript grounded in a curated reference table: reference lookup → unit check → numeric classification (low/normal/high/critical) → a deterministic safety guard (rules R1–R12) → a templated, bilingual plain-language summary. The model never assigns a range, never classifies, never diagnoses, never translates a clinical claim. This is what makes the product a *safety-guarded comprehension agent*, not a translator: the curated data is the single source of truth, and the guard biases toward "confirm with your clinician" on anything high-stakes or uncertain. PHI stays on-device (IndexedDB); the image transits the server only transiently to reach Claude and is never persisted.

**Tech Stack:** Next.js 16 (App Router, TypeScript) · `@anthropic-ai/sdk` with `claude-opus-4-8` (vision + structured output via `zodOutputFormat`) · `zod` · `idb` (IndexedDB) · `@serwist/next` + `serwist` (PWA) · Vitest + Testing Library (tests). SI units throughout (Chinese 体检 reports use SI). Anthropic API key is server-only; the extract route runs on the Node runtime.

---

## Data flow

```
photo (client)
  → downscale to ≤1600px JPEG (client, canvas)
  → POST /api/extract  (FormData; Node runtime; key server-only)
      → Claude vision → LabExtraction { rows: [{ name, value, unit, printedRange, confidence }] }   (EXTRACT ONLY)
  ← validated rows (Zod)
  → groundExtraction(rows, sex)         (deterministic)
       per row: findEntry → unitMatches → parseValue → classify → guard(R1–R12)
       → GroundedReport { rows: [{ entry?, valueNum?, classification, action, needsConfirm, flags[] }] }
  → Confirm-the-values step             (high-stakes / low-confidence / suspicious rows: user confirms or corrects)
  → buildSummary(report, lang)          (deterministic, bilingual, templated; always emits disclaimers + flags)
  → SummaryView  → SaveVisitButton → IndexedDB (on-device kept record)
```

The free-text doctor-notes path (which *would* need an LLM rendering step under the negation/dosage/drug fidelity rules R7–R9) is **out of scope for v0** (labs-only). R7–R9 are implemented as inert, tested no-ops so the guard's shape is complete and v0.1 can light them up.

---

## File structure

```
health-translator/
  app/
    layout.tsx                 # root layout; metadata; disclaimer banner; SW registration child
    page.tsx                   # home: capture entry point + saved-visits list (client)
    result/page.tsx            # confirm-values step + plain-language summary (client)
    manifest.ts                # PWA manifest (MetadataRoute.Manifest)
    ~offline/page.tsx          # offline fallback shell
    sw.ts                      # Serwist service worker source → public/sw.js
    api/extract/route.ts       # POST FormData image → Claude vision → validated rows (Node runtime)
    globals.css                # minimal styling
  components/
    CaptureCard.tsx            # camera/file input, preview, client downscale, POST, hand off to /result
    ConfirmValues.tsx          # review screen: confirm/correct flagged values
    SummaryView.tsx            # renders grounded summary, severity flags, disclaimers
    SaveVisitButton.tsx        # persist kept record to IndexedDB
    SavedVisits.tsx            # list/open kept records
    InstallPrompt.tsx          # iOS add-to-home-screen hint
    DisclaimerBanner.tsx       # always-visible "not medical advice"
  lib/
    types.ts                   # shared domain types
    extractionSchema.ts        # Zod LabExtraction + EXTRACTION_PROMPT (single source of truth)
    reference.ts               # name/unit normalization, findEntry, unitMatches, resolveBounds
    classify.ts                # parseValue, classify
    guard.ts                   # R1–R12 → { action, needsConfirm, flags }
    grounding.ts               # orchestrates lookup→unit→classify→guard per row
    summary.ts                 # deterministic bilingual templated summary
    disclaimers.ts             # required EN+ZH disclaimer strings
    downscaleImage.ts          # computeTargetSize (pure) + canvas downscale (browser)
    anthropic.ts               # server-only Anthropic client factory
    db.ts                      # idb wrapper for kept visit records (client-only)
    session.ts                 # sessionStorage handoff of in-progress report (client-only)
  data/
    reference-labs.ts          # curated reference table (~28 analytes, SI units, sourced)
  test/
    setup.ts                   # Testing Library jest-dom matchers
  public/                      # icons + generated sw.js
  vitest.config.ts
  next.config.ts
  .env.local.example
  README.md
```

Hard separation: `lib/anthropic.ts` and `app/api/extract/route.ts` are **server-only** (read `ANTHROPIC_API_KEY`); never import them from a client component. `lib/db.ts`, `lib/session.ts`, `lib/downscaleImage.ts` (the canvas half) are **client-only**. `lib/extractionSchema.ts` is the single Zod source imported by both the route (for `zodOutputFormat`) and the client (for types). `data/reference-labs.ts` is plain data bundled at build (offline-safe).

---

## Core domain types (defined in Task 2, referenced everywhere)

```ts
// lib/types.ts
export type Sex = 'male' | 'female' | 'unknown';

export type Bound = number | { male: number; female: number };

export interface ReferenceEntry {
  key: string;                 // stable id, e.g. 'fasting_glucose'
  nameEn: string;
  nameZh: string;
  aliases: string[];           // EN abbreviations + ZH names/synonyms, matched case-insensitively
  unit: string;                // canonical SI unit, e.g. 'mmol/L'
  allowedUnits: string[];      // exact equivalents accepted without conversion
  refLow: Bound | null;        // null when the analyte has only an upper decision cutoff
  refHigh: Bound | null;       // null when only a lower bound is meaningful (e.g. eGFR, HDL)
  criticalLow: number | null;  // SI; null when no panic band defined
  criticalHigh: number | null; // SI
  highStakes: boolean;         // any abnormal value always flagged for clinician
  populationSensitive: boolean;// range depends on sex/age/fasting/pregnancy
  plainEn: string;
  plainZh: string;
  source: string;
}

export type Classification = 'low' | 'normal' | 'high' | 'critical' | 'unclassified';
export type GuardAction = 'classify' | 'abstain' | 'confirm';
export type FlagSeverity = 'info' | 'caution' | 'urgent';

export interface GuardFlag {
  id: string;                  // rule id, e.g. 'R4-HIGH-STAKES-ANY-ABNORMAL'
  severity: FlagSeverity;
  messageEn: string;
  messageZh: string;
}

export interface ExtractedRow {
  name: string;
  value: string | null;        // kept as string to preserve exact decimal
  unit: string | null;
  printedRange: string | null; // reference range as printed on the report, if any
  confidence: 'low' | 'medium' | 'high';
}

export interface GroundedRow {
  extracted: ExtractedRow;
  entry: ReferenceEntry | null;
  valueNum: number | null;
  classification: Classification;
  action: GuardAction;
  needsConfirm: boolean;
  flags: GuardFlag[];
}

export interface GroundedReport {
  rows: GroundedRow[];
  sex: Sex;
  generatedAt: number;
}
```

---

### Task 1: Project scaffold + Vitest

**Files:**
- Create: `health-translator/` Next app (in the existing repo root)
- Create: `vitest.config.ts`, `test/setup.ts`, `test/smoke.test.ts`
- Modify: `package.json` (scripts), `.gitignore`
- Create: `.env.local.example`

- [ ] **Step 1: Scaffold Next.js in-place.** From the repo root (which already has `README.md`, `docs/`, `.git`):

```bash
# scaffold into a temp dir then move, to avoid create-next-app refusing a non-empty dir
npx create-next-app@latest ht-tmp --ts --app --eslint --src-dir=false --import-alias "@/*" --no-tailwind --turbopack --use-npm --yes
rsync -a --exclude .git ht-tmp/ ./
rm -rf ht-tmp
```

Expected: `app/`, `next.config.ts`, `tsconfig.json`, `package.json` now exist at repo root. If `create-next-app` flags differ by version, accept defaults for App Router + TypeScript and decline Tailwind.

- [ ] **Step 2: Install runtime + test deps.**

```bash
npm i @anthropic-ai/sdk zod idb @serwist/next serwist
npm i -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 3: Add Vitest config.**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
});
```

```ts
// test/setup.ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: Add scripts to `package.json`.** Ensure these exist (Serwist needs `--webpack` on the SW-producing build):

```json
{
  "scripts": {
    "dev": "next dev",
    "dev:pwa": "next dev --webpack",
    "build": "next build --webpack",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 5: Write a smoke test.**

```ts
// test/smoke.test.ts
import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run tests — verify the toolchain.**

Run: `npm test`
Expected: PASS (1 test).

- [ ] **Step 7: Add env example and gitignore entries.**

```bash
# .env.local.example
ANTHROPIC_API_KEY=sk-ant-...
```

Append to `.gitignore` if not present: `.env.local`, `public/sw.js`, `public/swe-worker-*.js`.

- [ ] **Step 8: Commit.**

```bash
git add -A
git commit -m "chore: scaffold Next.js 16 app + Vitest toolchain"
```

---

### Task 2: Domain types + curated reference table

**Files:**
- Create: `lib/types.ts` (exactly the "Core domain types" block above)
- Create: `data/reference-labs.ts`
- Test: `data/reference-labs.test.ts`

- [ ] **Step 1: Write the failing test (table invariants).**

```ts
// data/reference-labs.test.ts
import { describe, it, expect } from 'vitest';
import { REFERENCE_LABS } from './reference-labs';

describe('reference table integrity', () => {
  it('has at least 25 analytes', () => {
    expect(REFERENCE_LABS.length).toBeGreaterThanOrEqual(25);
  });

  it('every entry has unique key and required fields', () => {
    const keys = new Set<string>();
    for (const e of REFERENCE_LABS) {
      expect(e.key).toMatch(/^[a-z0-9_]+$/);
      expect(keys.has(e.key)).toBe(false);
      keys.add(e.key);
      expect(e.unit.length).toBeGreaterThan(0);
      expect(e.allowedUnits).toContain(e.unit);
      expect(e.plainEn.length).toBeGreaterThan(0);
      expect(e.plainZh.length).toBeGreaterThan(0);
      expect(e.source.length).toBeGreaterThan(0);
      // at least one bound exists
      expect(e.refLow !== null || e.refHigh !== null).toBe(true);
    }
  });

  it('flags the five high-stakes analytes', () => {
    const hs = REFERENCE_LABS.filter((e) => e.highStakes).map((e) => e.key);
    for (const k of ['fasting_glucose', 'potassium', 'creatinine', 'ldl_cholesterol', 'hemoglobin']) {
      expect(hs).toContain(k);
    }
  });

  it('critical bounds, when present, are outside the reference band', () => {
    for (const e of REFERENCE_LABS) {
      const low = typeof e.refLow === 'number' ? e.refLow : e.refLow?.female ?? null;
      const high = typeof e.refHigh === 'number' ? e.refHigh : e.refHigh?.male ?? null;
      if (e.criticalLow !== null && low !== null) expect(e.criticalLow).toBeLessThanOrEqual(low);
      if (e.criticalHigh !== null && high !== null) expect(e.criticalHigh).toBeGreaterThanOrEqual(high);
    }
  });
});
```

Run: `npm test -- reference-labs` → Expected: FAIL ("Cannot find module './reference-labs'").

- [ ] **Step 2: Write `data/reference-labs.ts`.** Curated from clinical-laboratory-medicine sources (SI units; ranges are typical adult values and clinical decision cutoffs — the product shows source and defers abnormal interpretation to a clinician). Sex-specific bounds use `{ male, female }`. Critical bands are in SI and are deliberately conservative panic thresholds.

```ts
// data/reference-labs.ts
import type { ReferenceEntry } from '@/lib/types';

export const REFERENCE_LABS: ReferenceEntry[] = [
  {
    key: 'hemoglobin', nameEn: 'Hemoglobin', nameZh: '血红蛋白',
    aliases: ['HGB', 'Hb', '血色素', '血红蛋白'],
    unit: 'g/L', allowedUnits: ['g/L'],
    refLow: { male: 130, female: 115 }, refHigh: { male: 175, female: 150 },
    criticalLow: 70, criticalHigh: 200, highStakes: true, populationSensitive: true,
    plainEn: 'The oxygen-carrying protein in red blood cells; low values indicate anemia.',
    plainZh: '红细胞里携带氧气的蛋白，偏低提示贫血。',
    source: 'WS/T 405-2012; Han Chinese multicenter CBC study (PMC4358890)',
  },
  {
    key: 'wbc_count', nameEn: 'White blood cell count', nameZh: '白细胞计数',
    aliases: ['WBC', '白细胞', '白血球', '白细胞计数'],
    unit: '10^9/L', allowedUnits: ['10^9/L', '10*9/L', 'x10^9/L', '×10^9/L', 'G/L'],
    refLow: 3.5, refHigh: 9.5, criticalLow: 2.0, criticalHigh: 30, highStakes: false, populationSensitive: false,
    plainEn: 'Immune-system cells that fight infection; high or low values can signal infection or other conditions.',
    plainZh: '免疫细胞，用来对抗感染；过高或过低可能提示感染或其他问题。',
    source: 'WS/T 405-2012; Han Chinese multicenter CBC study (PMC4358890)',
  },
  {
    key: 'rbc_count', nameEn: 'Red blood cell count', nameZh: '红细胞计数',
    aliases: ['RBC', '红细胞', '红细胞计数'],
    unit: '10^12/L', allowedUnits: ['10^12/L', '10*12/L', 'x10^12/L', '×10^12/L', 'T/L'],
    refLow: { male: 4.3, female: 3.8 }, refHigh: { male: 5.8, female: 5.1 },
    criticalLow: null, criticalHigh: null, highStakes: false, populationSensitive: true,
    plainEn: 'The number of red blood cells, which carry oxygen around the body.',
    plainZh: '红细胞的数量，负责把氧气运送到全身。',
    source: 'WS/T 405-2012; Han Chinese multicenter CBC study (PMC4358890)',
  },
  {
    key: 'platelet_count', nameEn: 'Platelet count', nameZh: '血小板计数',
    aliases: ['PLT', '血小板', '血小板计数'],
    unit: '10^9/L', allowedUnits: ['10^9/L', '10*9/L', 'x10^9/L', '×10^9/L', 'G/L'],
    refLow: 125, refHigh: 350, criticalLow: 20, criticalHigh: 1000, highStakes: false, populationSensitive: false,
    plainEn: 'Cell fragments that help blood clot; very low counts raise bleeding risk.',
    plainZh: '帮助血液凝固的细胞碎片，过低会增加出血风险。',
    source: 'WS/T 405-2012; Han Chinese multicenter CBC study (PMC4358890)',
  },
  {
    key: 'hematocrit', nameEn: 'Hematocrit', nameZh: '红细胞压积',
    aliases: ['HCT', 'Hct', '血细胞比容', '红细胞压积'],
    unit: 'L/L', allowedUnits: ['L/L'],
    refLow: { male: 0.40, female: 0.35 }, refHigh: { male: 0.51, female: 0.46 },
    criticalLow: null, criticalHigh: null, highStakes: false, populationSensitive: true,
    plainEn: 'The proportion of blood volume made up of red blood cells.',
    plainZh: '红细胞在血液中所占的体积比例。',
    source: 'WS/T 405-2012; Han Chinese multicenter CBC study (PMC4358890)',
  },
  {
    key: 'fasting_glucose', nameEn: 'Fasting plasma glucose', nameZh: '空腹血糖',
    aliases: ['GLU', 'FPG', '血糖', '葡萄糖', '空腹血糖'],
    unit: 'mmol/L', allowedUnits: ['mmol/L'],
    refLow: 3.9, refHigh: 6.1, criticalLow: 2.8, criticalHigh: 22.2, highStakes: true, populationSensitive: true,
    plainEn: 'Blood sugar level after fasting; high values can indicate prediabetes or diabetes.',
    plainZh: '空腹时的血糖水平，偏高可能提示糖尿病前期或糖尿病。',
    source: 'WHO/ADA criteria (normal <6.1, diabetes ≥7.0); Tietz reference interval',
  },
  {
    key: 'hba1c', nameEn: 'Glycated hemoglobin (HbA1c)', nameZh: '糖化血红蛋白',
    aliases: ['HbA1c', 'GHb', '糖化血红蛋白'],
    unit: '%', allowedUnits: ['%'],
    refLow: 4.0, refHigh: 5.7, criticalLow: null, criticalHigh: null, highStakes: true, populationSensitive: false,
    plainEn: 'Average blood sugar over the past 2–3 months; used to screen for and monitor diabetes.',
    plainZh: '反映过去2-3个月的平均血糖，用于筛查和监测糖尿病。',
    source: 'ADA/WHO thresholds (diabetes ≥6.5%); NGSP-aligned reporting',
  },
  {
    key: 'total_cholesterol', nameEn: 'Total cholesterol', nameZh: '总胆固醇',
    aliases: ['TC', 'CHOL', '胆固醇', '总胆固醇'],
    unit: 'mmol/L', allowedUnits: ['mmol/L'],
    refLow: null, refHigh: 5.2, criticalLow: null, criticalHigh: null, highStakes: false, populationSensitive: false,
    plainEn: 'Total amount of cholesterol in the blood; high values raise heart-disease risk.',
    plainZh: '血液中胆固醇的总量，偏高会增加心血管疾病风险。',
    source: '2016 Chinese guidelines for dyslipidemia in adults (PMC5803534)',
  },
  {
    key: 'ldl_cholesterol', nameEn: 'LDL cholesterol', nameZh: '低密度脂蛋白胆固醇',
    aliases: ['LDL-C', 'LDL', '低密度脂蛋白', '低密度脂蛋白胆固醇'],
    unit: 'mmol/L', allowedUnits: ['mmol/L'],
    refLow: null, refHigh: 3.4, criticalLow: null, criticalHigh: null, highStakes: true, populationSensitive: false,
    plainEn: 'The "bad" cholesterol that builds up in arteries; targets are individualized by heart-disease risk.',
    plainZh: '会在血管壁堆积的"坏"胆固醇，目标值因个人心血管风险而异。',
    source: '2016 Chinese guidelines for dyslipidemia in adults (PMC5803534)',
  },
  {
    key: 'hdl_cholesterol', nameEn: 'HDL cholesterol', nameZh: '高密度脂蛋白胆固醇',
    aliases: ['HDL-C', 'HDL', '高密度脂蛋白', '高密度脂蛋白胆固醇'],
    unit: 'mmol/L', allowedUnits: ['mmol/L'],
    refLow: 1.0, refHigh: null, criticalLow: null, criticalHigh: null, highStakes: false, populationSensitive: false,
    plainEn: 'The "good" cholesterol that helps clear cholesterol from arteries; higher is protective.',
    plainZh: '帮助清除血管胆固醇的"好"胆固醇，越高越有保护作用。',
    source: '2016 Chinese guidelines for dyslipidemia in adults (PMC5803534)',
  },
  {
    key: 'triglycerides', nameEn: 'Triglycerides', nameZh: '甘油三酯',
    aliases: ['TG', 'TRIG', '三酰甘油', '甘油三酯'],
    unit: 'mmol/L', allowedUnits: ['mmol/L'],
    refLow: null, refHigh: 1.7, criticalLow: null, criticalHigh: null, highStakes: false, populationSensitive: false,
    plainEn: 'A type of fat in the blood; high levels raise heart-disease and pancreatitis risk.',
    plainZh: '血液中的一种脂肪，偏高会增加心血管疾病和胰腺炎风险。',
    source: '2016 Chinese guidelines for dyslipidemia in adults (PMC5803534)',
  },
  {
    key: 'creatinine', nameEn: 'Creatinine', nameZh: '肌酐',
    aliases: ['CREA', 'Cr', '血肌酐', 'Scr', '肌酐'],
    unit: 'umol/L', allowedUnits: ['umol/L', 'µmol/L', 'μmol/L'],
    refLow: { male: 59, female: 45 }, refHigh: { male: 104, female: 84 },
    criticalLow: null, criticalHigh: 354, highStakes: true, populationSensitive: true,
    plainEn: 'A waste product filtered by the kidneys; high values can indicate reduced kidney function.',
    plainZh: '由肾脏过滤的代谢废物，偏高可能提示肾功能下降。',
    source: 'Tietz Clinical Guide to Laboratory Tests (enzymatic method)',
  },
  {
    key: 'urea', nameEn: 'Urea', nameZh: '尿素',
    aliases: ['UREA', 'BUN', '尿素氮', '尿素'],
    unit: 'mmol/L', allowedUnits: ['mmol/L'],
    refLow: 2.9, refHigh: 7.1, criticalLow: null, criticalHigh: null, highStakes: false, populationSensitive: false,
    plainEn: 'A nitrogen waste product handled by the kidneys; reflects kidney function and hydration.',
    plainZh: '由肾脏处理的含氮废物，可反映肾功能和身体水分状态。',
    source: 'Tietz Textbook of Clinical Chemistry (serum urea)',
  },
  {
    key: 'egfr', nameEn: 'Estimated glomerular filtration rate', nameZh: '估算肾小球滤过率',
    aliases: ['eGFR', '肾小球滤过率', '估算肾小球滤过率'],
    unit: 'mL/min/1.73m2', allowedUnits: ['mL/min/1.73m2', 'mL/min/1.73m²', 'ml/min/1.73m2'],
    refLow: 90, refHigh: null, criticalLow: 15, criticalHigh: null, highStakes: true, populationSensitive: false,
    plainEn: 'An estimate of how well the kidneys filter blood; lower values indicate reduced kidney function.',
    plainZh: '估算肾脏过滤血液的能力，数值越低表示肾功能越差。',
    source: 'KDIGO CKD staging; CKD-EPI 2021 (normal ≥90)',
  },
  {
    key: 'sodium', nameEn: 'Sodium', nameZh: '钠',
    aliases: ['Na', 'Na+', '血钠', '钠'],
    unit: 'mmol/L', allowedUnits: ['mmol/L', 'mEq/L'],
    refLow: 137, refHigh: 145, criticalLow: 120, criticalHigh: 160, highStakes: true, populationSensitive: false,
    plainEn: 'A key electrolyte that controls fluid balance; abnormal levels affect nerves and the heart.',
    plainZh: '调节体液平衡的重要电解质，异常会影响神经和心脏。',
    source: 'Tietz Textbook of Clinical Chemistry',
  },
  {
    key: 'potassium', nameEn: 'Potassium', nameZh: '钾',
    aliases: ['K', 'K+', '血钾', '钾'],
    unit: 'mmol/L', allowedUnits: ['mmol/L', 'mEq/L'],
    refLow: 3.5, refHigh: 5.3, criticalLow: 2.5, criticalHigh: 6.5, highStakes: true, populationSensitive: false,
    plainEn: 'An electrolyte critical for heart rhythm and muscle function; abnormal levels can be dangerous.',
    plainZh: '对心律和肌肉功能至关重要的电解质，异常可能很危险。',
    source: 'Tietz Textbook of Clinical Chemistry',
  },
  {
    key: 'chloride', nameEn: 'Chloride', nameZh: '氯',
    aliases: ['Cl', 'Cl-', '血氯', '氯化物', '氯'],
    unit: 'mmol/L', allowedUnits: ['mmol/L', 'mEq/L'],
    refLow: 96, refHigh: 106, criticalLow: null, criticalHigh: null, highStakes: false, populationSensitive: false,
    plainEn: 'An electrolyte that works with sodium to maintain fluid and acid–base balance.',
    plainZh: '与钠协同维持体液和酸碱平衡的电解质。',
    source: 'Tietz Textbook of Clinical Chemistry',
  },
  {
    key: 'alt', nameEn: 'Alanine aminotransferase (ALT)', nameZh: '丙氨酸氨基转移酶',
    aliases: ['ALT', 'GPT', '谷丙转氨酶', '丙氨酸氨基转移酶'],
    unit: 'U/L', allowedUnits: ['U/L', 'IU/L'],
    refLow: { male: 9, female: 7 }, refHigh: { male: 50, female: 40 },
    criticalLow: null, criticalHigh: null, highStakes: false, populationSensitive: true,
    plainEn: 'A liver enzyme; elevated levels can indicate liver inflammation or damage.',
    plainZh: '一种肝脏酶，升高可能提示肝脏炎症或损伤。',
    source: 'First China multicenter liver function study (PMC3772807)',
  },
  {
    key: 'ast', nameEn: 'Aspartate aminotransferase (AST)', nameZh: '天冬氨酸氨基转移酶',
    aliases: ['AST', 'GOT', '谷草转氨酶', '天冬氨酸氨基转移酶'],
    unit: 'U/L', allowedUnits: ['U/L', 'IU/L'],
    refLow: { male: 15, female: 13 }, refHigh: { male: 40, female: 35 },
    criticalLow: null, criticalHigh: null, highStakes: false, populationSensitive: true,
    plainEn: 'An enzyme found in the liver and muscle; elevated levels can indicate liver or muscle injury.',
    plainZh: '存在于肝脏和肌肉的酶，升高可能提示肝脏或肌肉损伤。',
    source: 'First China multicenter liver function study (PMC3772807)',
  },
  {
    key: 'ggt', nameEn: 'Gamma-glutamyl transferase (GGT)', nameZh: '谷氨酰转移酶',
    aliases: ['GGT', '谷氨酰转肽酶', '谷氨酰转移酶'],
    unit: 'U/L', allowedUnits: ['U/L', 'IU/L'],
    refLow: { male: 10, female: 7 }, refHigh: { male: 58, female: 43 },
    criticalLow: null, criticalHigh: null, highStakes: false, populationSensitive: true,
    plainEn: 'A liver enzyme sensitive to bile-duct problems and alcohol; elevated levels prompt further liver evaluation.',
    plainZh: '对胆道问题和饮酒敏感的肝脏酶，升高时需进一步检查肝脏。',
    source: 'First China multicenter liver function study (PMC3772807)',
  },
  {
    key: 'total_bilirubin', nameEn: 'Total bilirubin', nameZh: '总胆红素',
    aliases: ['TBIL', 'T-BIL', '胆红素', '总胆红素'],
    unit: 'umol/L', allowedUnits: ['umol/L', 'µmol/L', 'μmol/L'],
    refLow: { male: 5.9, female: 5.0 }, refHigh: { male: 30.4, female: 23.8 },
    criticalLow: null, criticalHigh: null, highStakes: false, populationSensitive: true,
    plainEn: 'A yellow breakdown product of red blood cells processed by the liver; high levels cause jaundice.',
    plainZh: '红细胞分解后由肝脏处理的黄色物质，偏高会引起黄疸。',
    source: 'First China multicenter liver function study (PMC3772807)',
  },
  {
    key: 'albumin', nameEn: 'Albumin', nameZh: '白蛋白',
    aliases: ['ALB', '血清白蛋白', '白蛋白'],
    unit: 'g/L', allowedUnits: ['g/L'],
    refLow: 40, refHigh: 55, criticalLow: null, criticalHigh: null, highStakes: false, populationSensitive: false,
    plainEn: 'The main protein made by the liver; low levels can reflect liver disease, malnutrition, or kidney loss.',
    plainZh: '肝脏合成的主要蛋白，偏低可能与肝病、营养不良或肾脏丢失有关。',
    source: 'First China multicenter liver function study (PMC3772807)',
  },
  {
    key: 'total_protein', nameEn: 'Total protein', nameZh: '总蛋白',
    aliases: ['TP', '血清总蛋白', '总蛋白'],
    unit: 'g/L', allowedUnits: ['g/L'],
    refLow: 65, refHigh: 85, criticalLow: null, criticalHigh: null, highStakes: false, populationSensitive: false,
    plainEn: 'The total of albumin and other proteins in the blood, reflecting nutrition, liver, and immune status.',
    plainZh: '血液中白蛋白和其他蛋白的总和，反映营养及肝脏免疫状态。',
    source: 'Tietz Clinical Guide to Laboratory Tests',
  },
  {
    key: 'uric_acid', nameEn: 'Uric acid', nameZh: '尿酸',
    aliases: ['UA', '血尿酸', 'SUA', '尿酸'],
    unit: 'umol/L', allowedUnits: ['umol/L', 'µmol/L', 'μmol/L'],
    refLow: { male: 150, female: 100 }, refHigh: { male: 420, female: 360 },
    criticalLow: null, criticalHigh: null, highStakes: false, populationSensitive: true,
    plainEn: 'A waste product from purine breakdown; high levels can cause gout and are linked to kidney stones.',
    plainZh: '嘌呤代谢产生的废物，偏高可引起痛风，并与肾结石相关。',
    source: 'China hyperuricemia diagnostic criteria (M>420, F>360)',
  },
  {
    key: 'tsh', nameEn: 'Thyroid-stimulating hormone (TSH)', nameZh: '促甲状腺激素',
    aliases: ['TSH', '促甲状腺素', '促甲状腺激素'],
    unit: 'mIU/L', allowedUnits: ['mIU/L', 'uIU/mL', 'µIU/mL', 'μIU/mL'],
    refLow: 0.4, refHigh: 4.0, criticalLow: null, criticalHigh: null, highStakes: false, populationSensitive: true,
    plainEn: 'The pituitary hormone that regulates the thyroid; high suggests an underactive thyroid, low an overactive one.',
    plainZh: '调节甲状腺的垂体激素，偏高提示甲状腺功能减退，偏低提示亢进。',
    source: 'Standard assay reference intervals (assay- and age-dependent)',
  },
  {
    key: 'free_t4', nameEn: 'Free thyroxine (FT4)', nameZh: '游离甲状腺素',
    aliases: ['FT4', '游离T4', '游离甲状腺素'],
    unit: 'pmol/L', allowedUnits: ['pmol/L'],
    refLow: 9.0, refHigh: 25.0, criticalLow: null, criticalHigh: null, highStakes: false, populationSensitive: true,
    plainEn: 'The active thyroid hormone available to tissues; abnormal levels indicate thyroid dysfunction.',
    plainZh: '组织可利用的活性甲状腺激素，异常提示甲状腺功能异常。',
    source: 'Standard assay reference intervals (highly assay-dependent)',
  },
  {
    key: 'neutrophil_pct', nameEn: 'Neutrophil percentage', nameZh: '中性粒细胞百分比',
    aliases: ['NEUT%', 'NE%', '中性粒细胞比率', '中性粒细胞百分比'],
    unit: '%', allowedUnits: ['%'],
    refLow: 40, refHigh: 75, criticalLow: null, criticalHigh: null, highStakes: false, populationSensitive: false,
    plainEn: 'The share of white cells that are neutrophils (main bacteria-fighting cells); high often suggests bacterial infection.',
    plainZh: '中性粒细胞在白细胞中的比例，是抗细菌的主力，偏高常提示细菌感染。',
    source: 'WS/T 405-2012 differential ranges',
  },
  {
    key: 'lymphocyte_pct', nameEn: 'Lymphocyte percentage', nameZh: '淋巴细胞百分比',
    aliases: ['LYMPH%', 'LY%', '淋巴细胞比率', '淋巴细胞百分比'],
    unit: '%', allowedUnits: ['%'],
    refLow: 20, refHigh: 50, criticalLow: null, criticalHigh: null, highStakes: false, populationSensitive: false,
    plainEn: 'The share of white cells that are lymphocytes (which fight viruses); changes can accompany viral infections.',
    plainZh: '淋巴细胞在白细胞中的比例，主要对抗病毒，变化常见于病毒感染。',
    source: 'WS/T 405-2012 differential ranges',
  },
  {
    key: 'mcv', nameEn: 'Mean corpuscular volume (MCV)', nameZh: '平均红细胞体积',
    aliases: ['MCV', '红细胞平均体积', '平均红细胞体积'],
    unit: 'fL', allowedUnits: ['fL'],
    refLow: 82, refHigh: 100, criticalLow: null, criticalHigh: null, highStakes: false, populationSensitive: false,
    plainEn: 'The average size of red blood cells; helps classify the type of anemia (small, normal, or large cells).',
    plainZh: '红细胞的平均大小，有助于判断贫血类型（小细胞、正常或大细胞）。',
    source: 'WS/T 405-2012',
  },
];
```

Run: `npm test -- reference-labs` → Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add lib/types.ts data/reference-labs.ts data/reference-labs.test.ts
git commit -m "feat: domain types + curated SI reference-range table (28 analytes)"
```

---

### Task 3: Analyte + unit normalization and lookup (`lib/reference.ts`)

**Files:**
- Create: `lib/reference.ts`
- Test: `lib/reference.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// lib/reference.test.ts
import { describe, it, expect } from 'vitest';
import { findEntry, normalizeUnit, unitMatches, resolveBounds } from './reference';

describe('findEntry', () => {
  it('matches Chinese name', () => {
    expect(findEntry('空腹血糖')?.key).toBe('fasting_glucose');
  });
  it('matches an English abbreviation case-insensitively', () => {
    expect(findEntry('glu')?.key).toBe('fasting_glucose');
    expect(findEntry('LDL-C')?.key).toBe('ldl_cholesterol');
  });
  it('matches the canonical English name', () => {
    expect(findEntry('Potassium')?.key).toBe('potassium');
  });
  it('tolerates surrounding punctuation/whitespace', () => {
    expect(findEntry('  K+ ')?.key).toBe('potassium');
  });
  it('returns null for an unknown analyte', () => {
    expect(findEntry('homocysteine')).toBeNull();
  });
});

describe('unit matching', () => {
  it('normalizes micro sign variants', () => {
    expect(normalizeUnit('µmol/L')).toBe(normalizeUnit('umol/L'));
    expect(normalizeUnit('μmol/L')).toBe(normalizeUnit('umol/L'));
  });
  it('accepts an allowed equivalent unit', () => {
    const k = findEntry('potassium')!;
    expect(unitMatches('mEq/L', k)).toBe(true);
    expect(unitMatches('mmol/L', k)).toBe(true);
  });
  it('rejects a non-equivalent unit (no auto-conversion in v0)', () => {
    const glu = findEntry('fasting_glucose')!;
    expect(unitMatches('mg/dL', glu)).toBe(false);
  });
  it('treats a missing unit as not matching', () => {
    const glu = findEntry('fasting_glucose')!;
    expect(unitMatches(null, glu)).toBe(false);
  });
});

describe('resolveBounds', () => {
  it('uses sex-specific bounds when sex is known', () => {
    const hgb = findEntry('hemoglobin')!;
    expect(resolveBounds(hgb, 'female')).toEqual({ low: 115, high: 150, usedUnion: false });
    expect(resolveBounds(hgb, 'male')).toEqual({ low: 130, high: 175, usedUnion: false });
  });
  it('falls back to the wider union band when sex is unknown', () => {
    const hgb = findEntry('hemoglobin')!;
    expect(resolveBounds(hgb, 'unknown')).toEqual({ low: 115, high: 175, usedUnion: true });
  });
  it('passes through scalar bounds without a union flag', () => {
    const k = findEntry('potassium')!;
    expect(resolveBounds(k, 'unknown')).toEqual({ low: 3.5, high: 5.3, usedUnion: false });
  });
});
```

Run: `npm test -- reference` → Expected: FAIL.

- [ ] **Step 2: Implement `lib/reference.ts`.**

```ts
// lib/reference.ts
import type { ReferenceEntry, Sex } from '@/lib/types';
import { REFERENCE_LABS } from '@/data/reference-labs';

function normName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s　]+/g, '')        // collapse ASCII + ideographic spaces
    .replace(/[：:．.,()（）\[\]【】]/g, '');
}

const INDEX: Map<string, ReferenceEntry> = (() => {
  const m = new Map<string, ReferenceEntry>();
  for (const e of REFERENCE_LABS) {
    for (const token of [e.key, e.nameEn, e.nameZh, ...e.aliases]) {
      m.set(normName(token), e);
    }
  }
  return m;
})();

export function findEntry(rawName: string): ReferenceEntry | null {
  return INDEX.get(normName(rawName)) ?? null;
}

export function normalizeUnit(u: string): string {
  return u
    .trim()
    .replace(/µ|μ/g, 'u')               // micro sign variants → u
    .replace(/×/g, 'x')
    .replace(/\s+/g, '')
    .toLowerCase();
}

export function unitMatches(extractedUnit: string | null, entry: ReferenceEntry): boolean {
  if (!extractedUnit) return false;
  const u = normalizeUnit(extractedUnit);
  return entry.allowedUnits.some((a) => normalizeUnit(a) === u);
}

export interface ResolvedBounds {
  low: number | null;
  high: number | null;
  usedUnion: boolean;        // true when sex was unknown and a sex-specific band was widened
}

export function resolveBounds(entry: ReferenceEntry, sex: Sex): ResolvedBounds {
  const isSplit = (b: ReferenceEntry['refLow']) => b !== null && typeof b === 'object';
  const split = isSplit(entry.refLow) || isSplit(entry.refHigh);

  const pick = (b: ReferenceEntry['refLow'], which: 'lowUnion' | 'highUnion'): number | null => {
    if (b === null) return null;
    if (typeof b === 'number') return b;
    if (sex === 'male') return b.male;
    if (sex === 'female') return b.female;
    // unknown → widen: lowest low, highest high
    return which === 'lowUnion' ? Math.min(b.male, b.female) : Math.max(b.male, b.female);
  };

  return {
    low: pick(entry.refLow, 'lowUnion'),
    high: pick(entry.refHigh, 'highUnion'),
    usedUnion: split && sex === 'unknown',
  };
}
```

Run: `npm test -- reference` → Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add lib/reference.ts lib/reference.test.ts
git commit -m "feat: analyte/unit normalization, lookup, sex-aware bound resolution"
```

---

### Task 4: Value parsing + classification (`lib/classify.ts`)

**Files:**
- Create: `lib/classify.ts`
- Test: `lib/classify.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// lib/classify.test.ts
import { describe, it, expect } from 'vitest';
import { parseValue, classify } from './classify';
import { findEntry } from './reference';

describe('parseValue', () => {
  it('parses clean decimals', () => {
    expect(parseValue('5.5')).toBe(5.5);
    expect(parseValue(' 140 ')).toBe(140);
  });
  it('rejects comparators, ranges, and junk (returns null)', () => {
    expect(parseValue('<0.5')).toBeNull();
    expect(parseValue('3.5-5.1')).toBeNull();
    expect(parseValue('positive')).toBeNull();
    expect(parseValue(null)).toBeNull();
    expect(parseValue('')).toBeNull();
  });
});

describe('classify', () => {
  const glu = findEntry('fasting_glucose')!;
  const k = findEntry('potassium')!;
  const hgb = findEntry('hemoglobin')!;

  it('returns normal inside the band (bounds inclusive)', () => {
    expect(classify(5.5, glu, 'unknown')).toBe('normal');
    expect(classify(6.1, glu, 'unknown')).toBe('normal');
  });
  it('returns high above the band', () => {
    expect(classify(7.5, glu, 'unknown')).toBe('high');
  });
  it('returns low below the band', () => {
    expect(classify(3.0, glu, 'unknown')).toBe('low');
  });
  it('returns critical inside a panic band, taking precedence over high/low', () => {
    expect(classify(25, glu, 'unknown')).toBe('critical');
    expect(classify(2.0, glu, 'unknown')).toBe('critical');
    expect(classify(6.8, k, 'unknown')).toBe('critical');
  });
  it('uses sex-specific bounds for hemoglobin', () => {
    expect(classify(120, hgb, 'female')).toBe('normal'); // 115–150
    expect(classify(120, hgb, 'male')).toBe('low');      // 130–175
  });
  it('classifies high-only analytes (no refLow) correctly', () => {
    const ldl = findEntry('ldl_cholesterol')!;
    expect(classify(2.0, ldl, 'unknown')).toBe('normal'); // only upper bound 3.4
    expect(classify(4.0, ldl, 'unknown')).toBe('high');
  });
  it('returns unclassified when value is null', () => {
    expect(classify(null, glu, 'unknown')).toBe('unclassified');
  });
});
```

Run: `npm test -- classify` → Expected: FAIL.

- [ ] **Step 2: Implement `lib/classify.ts`.**

```ts
// lib/classify.ts
import type { Classification, ReferenceEntry, Sex } from '@/lib/types';
import { resolveBounds } from '@/lib/reference';

const NUMERIC = /^[+]?\d+(\.\d+)?$/;

export function parseValue(raw: string | null): number | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (!NUMERIC.test(s)) return null;     // comparators, ranges, words → null (handled by guard)
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function classify(valueNum: number | null, entry: ReferenceEntry, sex: Sex): Classification {
  if (valueNum === null) return 'unclassified';

  if (entry.criticalLow !== null && valueNum < entry.criticalLow) return 'critical';
  if (entry.criticalHigh !== null && valueNum > entry.criticalHigh) return 'critical';

  const { low, high } = resolveBounds(entry, sex);
  if (low !== null && valueNum < low) return 'low';
  if (high !== null && valueNum > high) return 'high';
  return 'normal';
}
```

Run: `npm test -- classify` → Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add lib/classify.ts lib/classify.test.ts
git commit -m "feat: deterministic value parsing + 4-tier classification"
```

---

### Task 5: The safety guard (`lib/guard.ts`)

**Files:**
- Create: `lib/guard.ts`
- Test: `lib/guard.test.ts`

Implements rules R1, R2, R3, R4, R5, R6, R10, R11, R12 (labs-relevant). R7–R9 (free-text negation/dosage/drug) are out of scope for labs-only v0 and are represented by an exported, tested no-op `freeTextFlags()` so v0.1 can extend without reshaping the guard.

- [ ] **Step 1: Write the failing test.**

```ts
// lib/guard.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateRow, freeTextFlags } from './guard';
import { findEntry } from './reference';
import { parseValue, classify } from './classify';
import type { ExtractedRow } from '@/lib/types';

function row(p: Partial<ExtractedRow>): ExtractedRow {
  return { name: '', value: null, unit: null, printedRange: null, confidence: 'high', ...p };
}
function ids(flags: { id: string }[]) {
  return flags.map((f) => f.id);
}

describe('evaluateRow', () => {
  it('R1: unknown analyte → abstain, no classification', () => {
    const ex = row({ name: 'homocysteine', value: '15', unit: 'umol/L' });
    const out = evaluateRow(ex, null, null, 'unclassified', 'unknown');
    expect(out.action).toBe('abstain');
    expect(ids(out.flags)).toContain('R1-UNKNOWN-ANALYTE');
  });

  it('R2: known analyte but mismatched unit → abstain', () => {
    const entry = findEntry('fasting_glucose')!;
    const ex = row({ name: '空腹血糖', value: '99', unit: 'mg/dL' });
    const out = evaluateRow(ex, entry, parseValue(ex.value), 'unclassified', 'unknown');
    expect(out.action).toBe('abstain');
    expect(ids(out.flags)).toContain('R2-UNIT-MISMATCH');
  });

  it('R3: critical value → confirm + urgent flag', () => {
    const entry = findEntry('potassium')!;
    const ex = row({ name: 'K+', value: '6.9', unit: 'mmol/L' });
    const cls = classify(parseValue(ex.value), entry, 'unknown');
    const out = evaluateRow(ex, entry, parseValue(ex.value), cls, 'unknown');
    expect(out.needsConfirm).toBe(true);
    expect(ids(out.flags)).toContain('R3-CRITICAL-PANIC-RANGE');
    expect(out.flags.some((f) => f.severity === 'urgent')).toBe(true);
  });

  it('R4: high-stakes mild abnormal → classify but flag clinician', () => {
    const entry = findEntry('ldl_cholesterol')!;
    const ex = row({ name: 'LDL-C', value: '3.8', unit: 'mmol/L' });
    const cls = classify(parseValue(ex.value), entry, 'unknown'); // high
    const out = evaluateRow(ex, entry, parseValue(ex.value), cls, 'unknown');
    expect(out.action).toBe('classify');
    expect(ids(out.flags)).toContain('R4-HIGH-STAKES-ANY-ABNORMAL');
  });

  it('R4: high-stakes NORMAL → no R4 flag', () => {
    const entry = findEntry('fasting_glucose')!;
    const ex = row({ name: 'GLU', value: '5.0', unit: 'mmol/L' });
    const cls = classify(parseValue(ex.value), entry, 'unknown'); // normal
    const out = evaluateRow(ex, entry, parseValue(ex.value), cls, 'unknown');
    expect(ids(out.flags)).not.toContain('R4-HIGH-STAKES-ANY-ABNORMAL');
  });

  it('R5: low OCR confidence on a numeric → confirm', () => {
    const entry = findEntry('total_cholesterol')!;
    const ex = row({ name: 'TC', value: '5.0', unit: 'mmol/L', confidence: 'low' });
    const cls = classify(parseValue(ex.value), entry, 'unknown');
    const out = evaluateRow(ex, entry, parseValue(ex.value), cls, 'unknown');
    expect(out.needsConfirm).toBe(true);
    expect(ids(out.flags)).toContain('R5-LOW-OCR-CONFIDENCE-NUMERIC');
  });

  it('R5: unparseable value (comparator) → confirm', () => {
    const entry = findEntry('tsh')!;
    const ex = row({ name: 'TSH', value: '<0.01', unit: 'mIU/L' });
    const out = evaluateRow(ex, entry, parseValue(ex.value), 'unclassified', 'unknown');
    expect(out.needsConfirm).toBe(true);
    expect(ids(out.flags)).toContain('R5-LOW-OCR-CONFIDENCE-NUMERIC');
  });

  it('R6: high-stakes analyte ALWAYS needs confirm even at high confidence + normal', () => {
    const entry = findEntry('potassium')!;
    const ex = row({ name: 'K', value: '4.0', unit: 'mmol/L', confidence: 'high' });
    const cls = classify(parseValue(ex.value), entry, 'unknown'); // normal
    const out = evaluateRow(ex, entry, parseValue(ex.value), cls, 'unknown');
    expect(out.needsConfirm).toBe(true);
    expect(ids(out.flags)).toContain('R6-HIGH-STAKES-MANDATORY-CONFIRM');
  });

  it('R11: report-printed range disagrees with ours → flag', () => {
    const entry = findEntry('fasting_glucose')!;
    const ex = row({ name: 'GLU', value: '5.0', unit: 'mmol/L', printedRange: '4.1-5.9' });
    const cls = classify(parseValue(ex.value), entry, 'unknown');
    const out = evaluateRow(ex, entry, parseValue(ex.value), cls, 'unknown');
    expect(ids(out.flags)).toContain('R11-RANGE-DISAGREEMENT');
  });

  it('R12: population-sensitive analyte with unknown sex → flag', () => {
    const entry = findEntry('hemoglobin')!;
    const ex = row({ name: 'HGB', value: '140', unit: 'g/L' });
    const cls = classify(parseValue(ex.value), entry, 'unknown');
    const out = evaluateRow(ex, entry, parseValue(ex.value), cls, 'unknown');
    expect(ids(out.flags)).toContain('R12-POPULATION-SENSITIVE');
  });

  it('a normal, low-stakes, sex-neutral row classifies with no flags and no confirm', () => {
    const entry = findEntry('chloride')!;
    const ex = row({ name: 'Cl', value: '100', unit: 'mmol/L' });
    const cls = classify(parseValue(ex.value), entry, 'unknown');
    const out = evaluateRow(ex, entry, parseValue(ex.value), cls, 'unknown');
    expect(out.action).toBe('classify');
    expect(out.needsConfirm).toBe(false);
    expect(out.flags).toHaveLength(0);
  });
});

describe('freeTextFlags (v0 no-op)', () => {
  it('returns no flags in v0 (R7–R9 deferred)', () => {
    expect(freeTextFlags('每日三次 metformin 0.5g 无异常')).toEqual([]);
  });
});
```

Run: `npm test -- guard` → Expected: FAIL.

- [ ] **Step 2: Implement `lib/guard.ts`.**

```ts
// lib/guard.ts
import type {
  Classification, ExtractedRow, GuardAction, GuardFlag, ReferenceEntry, Sex,
} from '@/lib/types';
import { unitMatches, resolveBounds } from '@/lib/reference';

const CONFIRM_CLINICIAN_EN = 'Confirm this with your clinician.';
const CONFIRM_CLINICIAN_ZH = '请与您的医生确认。';

function flag(
  id: string, severity: GuardFlag['severity'], messageEn: string, messageZh: string,
): GuardFlag {
  return { id, severity, messageEn, messageZh };
}

export interface GuardOutcome {
  action: GuardAction;
  needsConfirm: boolean;
  flags: GuardFlag[];
}

// Structural OCR suspicion: implausible/missing decimal or confusable glyphs unparsed upstream.
function structurallySuspicious(value: string | null, valueNum: number | null): boolean {
  if (value === null) return true;
  if (valueNum === null) return true;   // couldn't parse a clean number
  return false;
}

export function evaluateRow(
  extracted: ExtractedRow,
  entry: ReferenceEntry | null,
  valueNum: number | null,
  classification: Classification,
  sex: Sex,
): GuardOutcome {
  const flags: GuardFlag[] = [];

  // R1 — unknown analyte: abstain, never classify.
  if (!entry) {
    flags.push(flag(
      'R1-UNKNOWN-ANALYTE', 'caution',
      'This test is not in our reference set, so we are not interpreting it. ' + CONFIRM_CLINICIAN_EN,
      '该项目不在我们的参考范围内，因此我们不作解读。' + CONFIRM_CLINICIAN_ZH,
    ));
    return { action: 'abstain', needsConfirm: false, flags };
  }

  // R2 — unit mismatch: abstain (no auto-conversion in v0).
  if (!unitMatches(extracted.unit, entry)) {
    flags.push(flag(
      'R2-UNIT-MISMATCH', 'caution',
      `The unit on your report differs from our reference (we expect ${entry.unit}). ` + CONFIRM_CLINICIAN_EN,
      `报告上的单位与我们的参考单位不同（我们使用 ${entry.unit}）。` + CONFIRM_CLINICIAN_ZH,
    ));
    return { action: 'abstain', needsConfirm: false, flags };
  }

  let needsConfirm = false;

  // R3 — critical/panic band.
  if (classification === 'critical') {
    needsConfirm = true;
    flags.push(flag(
      'R3-CRITICAL-PANIC-RANGE', 'urgent',
      'This value is in a critical range that can be serious. Please seek medical advice promptly. ' + CONFIRM_CLINICIAN_EN,
      '该数值处于可能严重的危急范围，请尽快就医并' + CONFIRM_CLINICIAN_ZH,
    ));
  }

  // R4 — high-stakes analyte, any abnormal (even mild).
  if (entry.highStakes && (classification === 'low' || classification === 'high')) {
    flags.push(flag(
      'R4-HIGH-STAKES-ANY-ABNORMAL', 'caution',
      'This is an important test and your value is outside the usual range. ' + CONFIRM_CLINICIAN_EN,
      '这是一项重要指标，您的数值超出常规范围。' + CONFIRM_CLINICIAN_ZH,
    ));
  }

  // R5 — low OCR confidence or structurally suspicious numeric → confirm.
  if (extracted.confidence === 'low' || structurallySuspicious(extracted.value, valueNum)) {
    needsConfirm = true;
    flags.push(flag(
      'R5-LOW-OCR-CONFIDENCE-NUMERIC', 'caution',
      'We may have misread this number. Please check it against your report.',
      '我们可能读错了这个数字，请与您的报告核对。',
    ));
  }

  // R6 — high-stakes OR critical: ALWAYS confirm, regardless of reported confidence.
  if (entry.highStakes || classification === 'critical') {
    needsConfirm = true;
    flags.push(flag(
      'R6-HIGH-STAKES-MANDATORY-CONFIRM', 'info',
      'Because this test matters, please confirm the value we read.',
      '由于该指标很重要，请确认我们读取的数值。',
    ));
  }

  // R11 — report-printed range materially disagrees with ours.
  if (extracted.printedRange && printedRangeDisagrees(extracted.printedRange, entry, sex)) {
    flags.push(flag(
      'R11-RANGE-DISAGREEMENT', 'caution',
      'Your report’s own reference range differs from ours; ranges vary between labs. ' + CONFIRM_CLINICIAN_EN,
      '您报告上的参考范围与我们的不同；不同实验室的范围会有差异。' + CONFIRM_CLINICIAN_ZH,
    ));
  }

  // R12 — population-sensitive analyte with unknown sex (we widened the band).
  if (entry.populationSensitive && sex === 'unknown') {
    flags.push(flag(
      'R12-POPULATION-SENSITIVE', 'info',
      'The normal range for this test depends on sex/age, which we don’t have, so we used a wider range. ' + CONFIRM_CLINICIAN_EN,
      '该指标的正常范围与性别/年龄有关，我们缺少这些信息，因此使用了较宽的范围。' + CONFIRM_CLINICIAN_ZH,
    ));
  }

  return { action: 'classify', needsConfirm, flags };
}

function printedRangeDisagrees(printed: string, entry: ReferenceEntry, sex: Sex): boolean {
  const m = printed.match(/(-?\d+(?:\.\d+)?)\s*[-~–]\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return false;
  const pLow = Number(m[1]);
  const pHigh = Number(m[2]);
  const { low, high } = resolveBounds(entry, sex);
  const tol = 0.15;                       // 15% materiality threshold
  const off = (ours: number | null, theirs: number) =>
    ours !== null && Math.abs(ours - theirs) > Math.abs(ours) * tol;
  return off(low, pLow) || off(high, pHigh);
}

// R7–R9 (negation / dosage / drug-name) operate on free text — out of scope for labs-only v0.
// Kept as a tested no-op so the doctor-notes path in v0.1 slots in without reshaping the guard.
export function freeTextFlags(_text: string): GuardFlag[] {
  return [];
}
```

Run: `npm test -- guard` → Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add lib/guard.ts lib/guard.test.ts
git commit -m "feat: deterministic safety guard (R1-R6, R11-R12; R7-R9 deferred no-op)"
```

---

### Task 6: Grounding pipeline (`lib/grounding.ts`)

**Files:**
- Create: `lib/grounding.ts`
- Test: `lib/grounding.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// lib/grounding.test.ts
import { describe, it, expect } from 'vitest';
import { groundExtraction } from './grounding';
import type { LabExtraction } from '@/lib/extractionSchema';

const extraction: LabExtraction = {
  rows: [
    { name: '空腹血糖', value: '7.8', unit: 'mmol/L', printedRange: '3.9-6.1', confidence: 'high' },
    { name: '钾', value: '6.9', unit: 'mmol/L', printedRange: '3.5-5.3', confidence: 'high' },
    { name: '总胆固醇', value: '4.5', unit: 'mmol/L', printedRange: '<5.2', confidence: 'high' },
    { name: 'homocysteine', value: '15', unit: 'umol/L', printedRange: '5-15', confidence: 'medium' },
  ],
};

describe('groundExtraction', () => {
  it('produces one grounded row per extracted row', () => {
    const report = groundExtraction(extraction, 'unknown');
    expect(report.rows).toHaveLength(4);
    expect(report.sex).toBe('unknown');
  });

  it('classifies a high-stakes high value and requires confirmation', () => {
    const { rows } = groundExtraction(extraction, 'unknown');
    const glu = rows.find((r) => r.entry?.key === 'fasting_glucose')!;
    expect(glu.classification).toBe('high');
    expect(glu.needsConfirm).toBe(true);
    expect(glu.flags.map((f) => f.id)).toContain('R4-HIGH-STAKES-ANY-ABNORMAL');
  });

  it('marks a critical value urgent', () => {
    const { rows } = groundExtraction(extraction, 'unknown');
    const k = rows.find((r) => r.entry?.key === 'potassium')!;
    expect(k.classification).toBe('critical');
    expect(k.flags.some((f) => f.severity === 'urgent')).toBe(true);
  });

  it('abstains (no classification) on an unknown analyte', () => {
    const { rows } = groundExtraction(extraction, 'unknown');
    const hcy = rows.find((r) => r.extracted.name === 'homocysteine')!;
    expect(hcy.entry).toBeNull();
    expect(hcy.action).toBe('abstain');
    expect(hcy.classification).toBe('unclassified');
  });

  it('classifies a normal low-stakes value cleanly', () => {
    const { rows } = groundExtraction(extraction, 'unknown');
    const tc = rows.find((r) => r.entry?.key === 'total_cholesterol')!;
    expect(tc.classification).toBe('normal');
    expect(tc.action).toBe('classify');
  });
});
```

Run: `npm test -- grounding` → Expected: FAIL.

- [ ] **Step 2: Implement `lib/grounding.ts`.**

```ts
// lib/grounding.ts
import type { GroundedReport, GroundedRow, Sex } from '@/lib/types';
import type { LabExtraction } from '@/lib/extractionSchema';
import { findEntry } from '@/lib/reference';
import { parseValue, classify } from '@/lib/classify';
import { evaluateRow } from '@/lib/guard';

export function groundExtraction(extraction: LabExtraction, sex: Sex): GroundedReport {
  const rows: GroundedRow[] = extraction.rows.map((extracted) => {
    const entry = findEntry(extracted.name);
    const valueNum = parseValue(extracted.value);
    // classify only when grounded against a matched, unit-checked entry; guard owns abstention.
    const classification =
      entry ? classify(valueNum, entry, sex) : 'unclassified';
    const outcome = evaluateRow(extracted, entry, valueNum, classification, sex);
    return {
      extracted,
      entry,
      valueNum,
      classification: outcome.action === 'abstain' ? 'unclassified' : classification,
      action: outcome.action,
      needsConfirm: outcome.needsConfirm,
      flags: outcome.flags,
    };
  });

  return { rows, sex, generatedAt: 0 }; // generatedAt stamped by caller (Date is non-deterministic in tests)
}
```

Run: `npm test -- grounding` → Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add lib/grounding.ts lib/grounding.test.ts
git commit -m "feat: grounding pipeline wiring lookup→classify→guard per row"
```

---

### Task 7: Extraction Zod schema + prompt (`lib/extractionSchema.ts`)

**Files:**
- Create: `lib/extractionSchema.ts`
- Test: `lib/extractionSchema.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// lib/extractionSchema.test.ts
import { describe, it, expect } from 'vitest';
import { LabExtractionSchema, EXTRACTION_PROMPT } from './extractionSchema';

describe('LabExtractionSchema', () => {
  it('parses a well-formed extraction', () => {
    const ok = LabExtractionSchema.safeParse({
      rows: [{ name: 'GLU', value: '5.5', unit: 'mmol/L', printedRange: '3.9-6.1', confidence: 'high' }],
    });
    expect(ok.success).toBe(true);
  });
  it('allows nulls for absent fields', () => {
    const ok = LabExtractionSchema.safeParse({
      rows: [{ name: 'X', value: null, unit: null, printedRange: null, confidence: 'low' }],
    });
    expect(ok.success).toBe(true);
  });
  it('rejects an invalid confidence enum', () => {
    const bad = LabExtractionSchema.safeParse({
      rows: [{ name: 'X', value: '1', unit: 'mmol/L', printedRange: null, confidence: 'maybe' }],
    });
    expect(bad.success).toBe(false);
  });
  it('exposes an extract-only prompt that forbids inference', () => {
    expect(EXTRACTION_PROMPT).toMatch(/do not infer/i);
    expect(EXTRACTION_PROMPT).toMatch(/null/i);
  });
});
```

Run: `npm test -- extractionSchema` → Expected: FAIL.

- [ ] **Step 2: Implement `lib/extractionSchema.ts`.**

```ts
// lib/extractionSchema.ts
import { z } from 'zod';

export const ExtractedRowSchema = z.object({
  name: z.string().describe('Analyte name exactly as printed (Chinese or English), e.g. 空腹血糖 or GLU'),
  value: z.string().nullable().describe('The measured value exactly as printed, as a string to preserve the decimal. null if absent.'),
  unit: z.string().nullable().describe('The unit exactly as printed, e.g. mmol/L. null if absent.'),
  printedRange: z.string().nullable().describe('The reference range printed on the report, e.g. 3.9-6.1. null if absent.'),
  confidence: z.enum(['low', 'medium', 'high']).describe('Your confidence in reading THIS row correctly.'),
});

export const LabExtractionSchema = z.object({
  rows: z.array(ExtractedRowSchema),
});

export type ExtractedRowZ = z.infer<typeof ExtractedRowSchema>;
export type LabExtraction = z.infer<typeof LabExtractionSchema>;

export const EXTRACTION_PROMPT = [
  'You are an OCR/extraction engine for laboratory test reports. Extract EVERY analyte row you can read.',
  'Transcribe exactly what is printed — analyte name, numeric value, unit, and the printed reference range.',
  'Do NOT infer, calculate, convert units, translate, or supply values that are not printed. Use null for any field that is absent or unreadable.',
  'Do NOT classify results as normal/abnormal and do NOT add reference ranges from your own knowledge — only copy the range printed on the page.',
  'Preserve decimal points exactly (e.g. 7.0 is not 70). For each row, report your reading confidence as low, medium, or high.',
  'Return only the structured rows.',
].join(' ');
```

> Note: `lib/types.ts` `ExtractedRow` and the Zod `ExtractedRowSchema` describe the same shape; `grounding.ts` consumes `LabExtraction`. Keep the two in sync (both: name, value, unit, printedRange, confidence).

Run: `npm test -- extractionSchema` → Expected: PASS. Then run the full suite: `npm test` → Expected: all PASS.

- [ ] **Step 3: Commit.**

```bash
git add lib/extractionSchema.ts lib/extractionSchema.test.ts
git commit -m "feat: extract-only Zod schema + OCR prompt (no inference, no ranges)"
```

---

### Task 8: Disclaimers + summary assembly (`lib/disclaimers.ts`, `lib/summary.ts`)

**Files:**
- Create: `lib/disclaimers.ts`, `lib/summary.ts`
- Test: `lib/summary.test.ts`

- [ ] **Step 1: Create `lib/disclaimers.ts`.**

```ts
// lib/disclaimers.ts
export const DISCLAIMERS_EN: string[] = [
  'Not medical advice: this summary helps you understand your report in plain language. It is not a diagnosis or treatment recommendation. Always confirm with your clinician before making any health decision.',
  'Not a medical device: this app is an educational comprehension aid, not a medical device, and has not been reviewed by any regulator. It can make mistakes, including misreading numbers.',
  'We may misread your report: we use automatic photo reading (OCR), which can misread digits, decimal points, and units. Please check the values we show against your original report.',
  'Confirm flagged items: items marked “confirm with your clinician” are high-stakes or uncertain. Verify exact values and meaning with your doctor, nurse, or pharmacist.',
];

export const DISCLAIMERS_ZH: string[] = [
  '本工具不提供医疗建议：本摘要旨在用通俗语言帮助您理解您的报告，并非诊断或治疗建议。在做出任何健康决定之前，请务必与您的医生确认。',
  '本工具不是医疗器械：本应用是帮助理解的科普辅助工具，不是医疗器械，未经任何监管机构审核。它可能会出错，包括读错数字。',
  '我们可能读错您的报告：本工具使用自动图像识别（OCR），可能读错数字、小数点和单位。请将我们显示的数值与您的原始报告核对。',
  '请确认被标注的项目：标注“请与医生确认”的项目属于高风险或存在不确定性。请向您的医生、护士或药师核实具体数值与含义。',
];

export function disclaimers(lang: 'en' | 'zh'): string[] {
  return lang === 'zh' ? DISCLAIMERS_ZH : DISCLAIMERS_EN;
}
```

- [ ] **Step 2: Write the failing test for the summary.**

```ts
// lib/summary.test.ts
import { describe, it, expect } from 'vitest';
import { buildSummary } from './summary';
import { groundExtraction } from './grounding';
import type { LabExtraction } from '@/lib/extractionSchema';

const extraction: LabExtraction = {
  rows: [
    { name: '空腹血糖', value: '7.8', unit: 'mmol/L', printedRange: '3.9-6.1', confidence: 'high' },
    { name: 'homocysteine', value: '15', unit: 'umol/L', printedRange: '5-15', confidence: 'high' },
  ],
};

describe('buildSummary', () => {
  const report = groundExtraction(extraction, 'unknown');

  it('always includes disclaimers', () => {
    expect(buildSummary(report, 'en').disclaimers.length).toBeGreaterThan(0);
    expect(buildSummary(report, 'zh').disclaimers.length).toBeGreaterThan(0);
  });

  it('renders a known analyte with name, value, classification label, and plain meaning', () => {
    const { sections } = buildSummary(report, 'en');
    const glu = sections.find((s) => s.key === 'fasting_glucose')!;
    expect(glu.title).toContain('Fasting plasma glucose');
    expect(glu.valueText).toBe('7.8 mmol/L');
    expect(glu.statusLabel.toLowerCase()).toContain('high');
    expect(glu.plain).toMatch(/blood sugar/i);
    expect(glu.flags.length).toBeGreaterThan(0); // high-stakes
  });

  it('renders Mandarin labels when lang=zh', () => {
    const { sections } = buildSummary(report, 'zh');
    const glu = sections.find((s) => s.key === 'fasting_glucose')!;
    expect(glu.title).toContain('空腹血糖');
    expect(glu.plain).toMatch(/血糖/);
  });

  it('presents an unclassified (unknown) analyte neutrally, with no status judgment', () => {
    const { sections } = buildSummary(report, 'en');
    const hcy = sections.find((s) => s.title.includes('homocysteine'))!;
    expect(hcy.status).toBe('unclassified');
    expect(hcy.statusLabel.toLowerCase()).toContain('not interpreted');
    expect(hcy.plain).toBe(''); // no invented meaning
  });
});
```

Run: `npm test -- summary` → Expected: FAIL.

- [ ] **Step 3: Implement `lib/summary.ts`.**

```ts
// lib/summary.ts
import type { Classification, GroundedReport, GroundedRow } from '@/lib/types';
import { disclaimers } from '@/lib/disclaimers';

export type Lang = 'en' | 'zh';

export interface SummarySection {
  key: string;                 // entry key or a synthetic id for unknowns
  title: string;               // analyte name in the chosen language
  valueText: string;           // "7.8 mmol/L" or the raw printed value
  status: Classification;
  statusLabel: string;         // localized label
  plain: string;               // plain-language meaning ('' when unclassified)
  flags: { severity: string; message: string }[];
  source: string;
}

const STATUS_LABEL: Record<Classification, { en: string; zh: string }> = {
  low:          { en: 'Low',  zh: '偏低' },
  normal:       { en: 'Normal', zh: '正常' },
  high:         { en: 'High', zh: '偏高' },
  critical:     { en: 'Critical — seek care', zh: '危急 — 请就医' },
  unclassified: { en: 'Not interpreted', zh: '未作解读' },
};

function valueText(row: GroundedRow): string {
  const v = row.extracted.value ?? '—';
  const u = row.extracted.unit ? ` ${row.extracted.unit}` : '';
  return `${v}${u}`;
}

export function buildSummary(report: GroundedReport, lang: Lang): {
  sections: SummarySection[];
  disclaimers: string[];
} {
  const sections: SummarySection[] = report.rows.map((row, i) => {
    const entry = row.entry;
    const title = entry ? (lang === 'zh' ? entry.nameZh : entry.nameEn) : row.extracted.name;
    const plain = entry && row.action === 'classify'
      ? (lang === 'zh' ? entry.plainZh : entry.plainEn)
      : '';
    return {
      key: entry?.key ?? `row-${i}`,
      title,
      valueText: valueText(row),
      status: row.classification,
      statusLabel: STATUS_LABEL[row.classification][lang],
      plain,
      flags: row.flags.map((f) => ({
        severity: f.severity,
        message: lang === 'zh' ? f.messageZh : f.messageEn,
      })),
      source: entry?.source ?? '',
    };
  });

  return { sections, disclaimers: disclaimers(lang) };
}
```

Run: `npm test -- summary` → Expected: PASS. Then `npm test` → all PASS.

- [ ] **Step 4: Commit.**

```bash
git add lib/disclaimers.ts lib/summary.ts lib/summary.test.ts
git commit -m "feat: deterministic bilingual summary + required disclaimers"
```

---

### Task 9: Server-only Anthropic client + extract route (`lib/anthropic.ts`, `app/api/extract/route.ts`)

**Files:**
- Create: `lib/anthropic.ts`, `app/api/extract/route.ts`, `lib/uploadValidation.ts`
- Test: `lib/uploadValidation.test.ts`, `app/api/extract/route.test.ts`

- [ ] **Step 1: Extract the pure validation helper + test it (TDD).**

```ts
// lib/uploadValidation.ts
export const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB raw → ~5.3MB base64, under the 10MB API cap

export type UploadCheck =
  | { ok: true; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' }
  | { ok: false; status: 400 | 413 | 415; error: string };

export function checkUpload(file: { type: string; size: number } | null): UploadCheck {
  if (!file) return { ok: false, status: 400, error: 'No image provided' };
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) return { ok: false, status: 415, error: 'Unsupported image type' };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, status: 413, error: 'Image too large' };
  return { ok: true, mediaType: file.type as UploadCheck extends { ok: true } ? never : never };
}
```

Adjust the success return to a concrete type:

```ts
// (replace checkUpload's success branch)
  return { ok: true, mediaType: file.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' };
```

```ts
// lib/uploadValidation.test.ts
import { describe, it, expect } from 'vitest';
import { checkUpload, MAX_IMAGE_BYTES } from './uploadValidation';

describe('checkUpload', () => {
  it('rejects missing file', () => {
    expect(checkUpload(null)).toMatchObject({ ok: false, status: 400 });
  });
  it('rejects unsupported type', () => {
    expect(checkUpload({ type: 'application/pdf', size: 10 })).toMatchObject({ ok: false, status: 415 });
  });
  it('rejects oversize image', () => {
    expect(checkUpload({ type: 'image/jpeg', size: MAX_IMAGE_BYTES + 1 })).toMatchObject({ ok: false, status: 413 });
  });
  it('accepts a valid jpeg', () => {
    expect(checkUpload({ type: 'image/jpeg', size: 1000 })).toMatchObject({ ok: true, mediaType: 'image/jpeg' });
  });
});
```

Run: `npm test -- uploadValidation` → Expected: FAIL then (after writing the file) PASS.

- [ ] **Step 2: Create the server-only Anthropic client.**

```ts
// lib/anthropic.ts
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    client = new Anthropic({ apiKey });
  }
  return client;
}
```

(Install the guard package: `npm i server-only`.)

- [ ] **Step 3: Implement the route handler.**

```ts
// app/api/extract/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { getAnthropic } from '@/lib/anthropic';
import { LabExtractionSchema, EXTRACTION_PROMPT } from '@/lib/extractionSchema';
import { checkUpload } from '@/lib/uploadValidation';

export const runtime = 'nodejs';        // REQUIRED: the SDK breaks on the edge runtime
export const dynamic = 'force-dynamic'; // never cache an upload handler

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get('image');
  const fileMeta = file instanceof File ? { type: file.type, size: file.size } : null;
  const check = checkUpload(fileMeta);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const bytes = Buffer.from(await (file as File).arrayBuffer());
  const base64 = bytes.toString('base64');

  try {
    const message = await getAnthropic().messages.parse({
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: check.mediaType, data: base64 } },
            { type: 'text', text: EXTRACTION_PROMPT },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(LabExtractionSchema) },
    });

    const parsed = message.parsed_output;
    if (!parsed) return NextResponse.json({ error: 'Could not read the report' }, { status: 422 });
    return NextResponse.json({ data: parsed });
  } catch (err) {
    console.error('extract error', err); // never echo raw SDK errors to the client
    return NextResponse.json({ error: 'Could not read the report' }, { status: 502 });
  }
}
```

- [ ] **Step 4: Route test with a mocked SDK (TDD the wiring without a live key).**

```ts
// app/api/extract/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const parse = vi.fn();
vi.mock('@/lib/anthropic', () => ({
  getAnthropic: () => ({ messages: { parse } }),
}));

import { POST } from './route';

function reqWith(file: File | null): any {
  const form = new FormData();
  if (file) form.set('image', file);
  return { formData: async () => form };
}

describe('POST /api/extract', () => {
  beforeEach(() => parse.mockReset());

  it('415s an unsupported type', async () => {
    const res = await POST(reqWith(new File(['x'], 'a.pdf', { type: 'application/pdf' })));
    expect(res.status).toBe(415);
  });

  it('400s a missing image', async () => {
    const res = await POST(reqWith(null));
    expect(res.status).toBe(400);
  });

  it('returns validated rows on success', async () => {
    parse.mockResolvedValue({
      parsed_output: { rows: [{ name: 'GLU', value: '5.5', unit: 'mmol/L', printedRange: null, confidence: 'high' }] },
    });
    const res = await POST(reqWith(new File(['img'], 'lab.jpg', { type: 'image/jpeg' })));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.rows[0].name).toBe('GLU');
  });

  it('502s when the model call throws', async () => {
    parse.mockRejectedValue(new Error('boom'));
    const res = await POST(reqWith(new File(['img'], 'lab.jpg', { type: 'image/jpeg' })));
    expect(res.status).toBe(502);
  });
});
```

Run: `npm test -- route` → Expected: PASS (the SDK is mocked; no key needed).

- [ ] **Step 5: Commit.**

```bash
git add lib/anthropic.ts lib/uploadValidation.ts lib/uploadValidation.test.ts app/api/extract/route.ts app/api/extract/route.test.ts package.json package-lock.json
git commit -m "feat: server-only Claude vision extract route (Node runtime, mocked-SDK tests)"
```

---

### Task 10: Client capture + downscale (`lib/downscaleImage.ts`, `components/CaptureCard.tsx`, `lib/session.ts`)

**Files:**
- Create: `lib/downscaleImage.ts`, `lib/session.ts`, `components/CaptureCard.tsx`
- Test: `lib/downscaleImage.test.ts`

- [ ] **Step 1: TDD the pure resize math.**

```ts
// lib/downscaleImage.test.ts
import { describe, it, expect } from 'vitest';
import { computeTargetSize } from './downscaleImage';

describe('computeTargetSize', () => {
  it('does not upscale small images', () => {
    expect(computeTargetSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
  it('scales the long edge down to maxEdge, preserving aspect', () => {
    expect(computeTargetSize(3200, 2400, 1600)).toEqual({ width: 1600, height: 1200 });
  });
  it('handles portrait orientation', () => {
    expect(computeTargetSize(2400, 3200, 1600)).toEqual({ width: 1200, height: 1600 });
  });
});
```

Run: `npm test -- downscaleImage` → Expected: FAIL.

- [ ] **Step 2: Implement `lib/downscaleImage.ts`.**

```ts
// lib/downscaleImage.ts
export function computeTargetSize(w: number, h: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

// Browser-only: downscale + recompress to JPEG. (Not unit-tested; relies on canvas.)
export async function downscaleToJpeg(file: File, maxEdge = 1600, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = computeTargetSize(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', quality));
}
```

Run: `npm test -- downscaleImage` → Expected: PASS.

- [ ] **Step 3: Create the session handoff (in-progress report between capture and result).**

```ts
// lib/session.ts
'use client';
import type { GroundedReport } from '@/lib/types';

const KEY = 'ht:pending-report';

export function setPendingReport(report: GroundedReport): void {
  sessionStorage.setItem(KEY, JSON.stringify(report));
}
export function getPendingReport(): GroundedReport | null {
  const raw = sessionStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as GroundedReport) : null;
}
export function clearPendingReport(): void {
  sessionStorage.removeItem(KEY);
}
```

- [ ] **Step 4: Implement `components/CaptureCard.tsx`.** Captures the photo, downscales, POSTs, grounds the result client-side, stashes it, and routes to `/result`. Takes a `sex` selector (optional) feeding `groundExtraction`.

```tsx
// components/CaptureCard.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { downscaleToJpeg } from '@/lib/downscaleImage';
import { groundExtraction } from '@/lib/grounding';
import { LabExtractionSchema } from '@/lib/extractionSchema';
import { setPendingReport } from '@/lib/session';
import type { Sex } from '@/lib/types';

export function CaptureCard() {
  const router = useRouter();
  const [sex, setSex] = useState<Sex>('unknown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const small = await downscaleToJpeg(file);
      const fd = new FormData();
      fd.append('image', small, 'lab.jpg');
      const res = await fetch('/api/extract', { method: 'POST', body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Could not read the report');
      }
      const { data } = await res.json();
      const extraction = LabExtractionSchema.parse(data);
      const report = { ...groundExtraction(extraction, sex), generatedAt: Date.now() };
      setPendingReport(report);
      router.push('/result');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="capture">
      <label className="field">
        <span>Who is this report for? (optional, improves accuracy)</span>
        <select value={sex} onChange={(e) => setSex(e.target.value as Sex)}>
          <option value="unknown">Prefer not to say</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
        </select>
      </label>

      <label className="capture-btn">
        <input type="file" accept="image/*" capture="environment" onChange={onPick} hidden />
        {busy ? 'Reading your report…' : 'Photograph or upload a lab report'}
      </label>

      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 5: Commit.**

```bash
git add lib/downscaleImage.ts lib/downscaleImage.test.ts lib/session.ts components/CaptureCard.tsx
git commit -m "feat: client capture, downscale, extract→ground, hand off to result"
```

---

### Task 11: Confirm-the-values step + summary view (`components/ConfirmValues.tsx`, `components/SummaryView.tsx`, `app/result/page.tsx`)

**Files:**
- Create: `components/ConfirmValues.tsx`, `components/SummaryView.tsx`, `app/result/page.tsx`
- Test: `components/SummaryView.test.tsx`

- [ ] **Step 1: TDD `SummaryView` rendering (Testing Library).**

```tsx
// components/SummaryView.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SummaryView } from './SummaryView';
import { groundExtraction } from '@/lib/grounding';
import type { LabExtraction } from '@/lib/extractionSchema';

const report = (() => {
  const extraction: LabExtraction = {
    rows: [
      { name: '空腹血糖', value: '7.8', unit: 'mmol/L', printedRange: '3.9-6.1', confidence: 'high' },
      { name: 'homocysteine', value: '15', unit: 'umol/L', printedRange: null, confidence: 'high' },
    ],
  };
  return { ...groundExtraction(extraction, 'unknown'), generatedAt: 0 };
})();

describe('SummaryView', () => {
  it('shows the analyte, value, status and a clinician flag for a high-stakes high result', () => {
    render(<SummaryView report={report} lang="en" />);
    expect(screen.getByText(/Fasting plasma glucose/)).toBeInTheDocument();
    expect(screen.getByText('7.8 mmol/L')).toBeInTheDocument();
    expect(screen.getAllByText(/High/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/confirm this with your clinician/i)).toBeInTheDocument();
  });

  it('presents an unknown analyte without a normal/abnormal judgment', () => {
    render(<SummaryView report={report} lang="en" />);
    expect(screen.getByText(/homocysteine/)).toBeInTheDocument();
    expect(screen.getByText(/not interpreted/i)).toBeInTheDocument();
  });

  it('always renders the disclaimers', () => {
    render(<SummaryView report={report} lang="en" />);
    expect(screen.getByText(/not medical advice/i)).toBeInTheDocument();
  });
});
```

Run: `npm test -- SummaryView` → Expected: FAIL.

- [ ] **Step 2: Implement `components/SummaryView.tsx`.**

```tsx
// components/SummaryView.tsx
'use client';
import type { GroundedReport } from '@/lib/types';
import { buildSummary, type Lang } from '@/lib/summary';

export function SummaryView({ report, lang }: { report: GroundedReport; lang: Lang }) {
  const { sections, disclaimers } = buildSummary(report, lang);
  return (
    <div className="summary">
      <ul className="rows">
        {sections.map((s) => (
          <li key={s.key} className={`row status-${s.status}`}>
            <div className="row-head">
              <span className="row-title">{s.title}</span>
              <span className="row-value">{s.valueText}</span>
              <span className={`badge badge-${s.status}`}>{s.statusLabel}</span>
            </div>
            {s.plain && <p className="row-plain">{s.plain}</p>}
            {s.flags.map((f, i) => (
              <p key={i} className={`flag flag-${f.severity}`}>{f.message}</p>
            ))}
            {s.source && <p className="row-source">{lang === 'zh' ? '来源：' : 'Source: '}{s.source}</p>}
          </li>
        ))}
      </ul>
      <section className="disclaimers" aria-label={lang === 'zh' ? '免责声明' : 'Disclaimers'}>
        {disclaimers.map((d, i) => <p key={i}>{d}</p>)}
      </section>
    </div>
  );
}
```

Run: `npm test -- SummaryView` → Expected: PASS.

- [ ] **Step 3: Implement `components/ConfirmValues.tsx`.** The mandatory "confirm the values we read" gate: lists rows where `needsConfirm` is true, shows our reading, lets the user confirm or correct the value/unit; on submit it re-grounds the corrected rows and yields the confirmed report.

```tsx
// components/ConfirmValues.tsx
'use client';
import { useState } from 'react';
import type { GroundedReport, Sex } from '@/lib/types';
import { groundExtraction } from '@/lib/grounding';
import type { LabExtraction } from '@/lib/extractionSchema';

export function ConfirmValues({
  report, lang, onConfirmed,
}: {
  report: GroundedReport;
  lang: 'en' | 'zh';
  onConfirmed: (confirmed: GroundedReport) => void;
}) {
  const toConfirm = report.rows.filter((r) => r.needsConfirm);
  const [edits, setEdits] = useState<Record<number, { value: string; unit: string }>>(() => {
    const init: Record<number, { value: string; unit: string }> = {};
    report.rows.forEach((r, i) => {
      if (r.needsConfirm) init[i] = { value: r.extracted.value ?? '', unit: r.extracted.unit ?? '' };
    });
    return init;
  });

  const t = (en: string, zh: string) => (lang === 'zh' ? zh : en);

  function submit() {
    const rows = report.rows.map((r, i) =>
      edits[i] ? { ...r.extracted, value: edits[i].value, unit: edits[i].unit } : r.extracted,
    );
    const extraction: LabExtraction = { rows };
    const regrounded: GroundedReport = {
      ...groundExtraction(extraction, report.sex as Sex),
      generatedAt: report.generatedAt,
    };
    onConfirmed(regrounded);
  }

  if (toConfirm.length === 0) {
    // nothing to confirm — pass through unchanged
    onConfirmed(report);
    return null;
  }

  return (
    <div className="confirm">
      <h2>{t('Please check these readings', '请核对以下读数')}</h2>
      <p className="confirm-help">
        {t('Check the decimal point and units against your report (e.g. 7.0, not 70).',
           '请对照报告核对小数点和单位（例如 7.0，而不是 70）。')}
      </p>
      <ul>
        {report.rows.map((r, i) =>
          r.needsConfirm ? (
            <li key={i} className="confirm-row">
              <span className="confirm-name">
                {lang === 'zh' ? (r.entry?.nameZh ?? r.extracted.name) : (r.entry?.nameEn ?? r.extracted.name)}
              </span>
              <input
                aria-label={`value ${i}`}
                value={edits[i].value}
                onChange={(e) => setEdits({ ...edits, [i]: { ...edits[i], value: e.target.value } })}
              />
              <input
                aria-label={`unit ${i}`}
                value={edits[i].unit}
                onChange={(e) => setEdits({ ...edits, [i]: { ...edits[i], unit: e.target.value } })}
              />
            </li>
          ) : null,
        )}
      </ul>
      <button onClick={submit}>{t('Confirm and continue', '确认并继续')}</button>
    </div>
  );
}
```

- [ ] **Step 4: Implement `app/result/page.tsx`.** Reads the pending report, runs the confirm gate, then shows the summary with a language toggle and a save button.

```tsx
// app/result/page.tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { GroundedReport } from '@/lib/types';
import { getPendingReport } from '@/lib/session';
import { ConfirmValues } from '@/components/ConfirmValues';
import { SummaryView } from '@/components/SummaryView';
import { SaveVisitButton } from '@/components/SaveVisitButton';

export default function ResultPage() {
  const router = useRouter();
  const [report, setReport] = useState<GroundedReport | null>(null);
  const [confirmed, setConfirmed] = useState<GroundedReport | null>(null);
  const [lang, setLang] = useState<'en' | 'zh'>('en');

  useEffect(() => {
    const r = getPendingReport();
    if (!r) router.replace('/');
    else setReport(r);
  }, [router]);

  if (!report) return null;

  return (
    <main className="result">
      <div className="lang-toggle">
        <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
        <button aria-pressed={lang === 'zh'} onClick={() => setLang('zh')}>中文</button>
      </div>

      {!confirmed ? (
        <ConfirmValues report={report} lang={lang} onConfirmed={setConfirmed} />
      ) : (
        <>
          <SummaryView report={confirmed} lang={lang} />
          <SaveVisitButton report={confirmed} lang={lang} />
        </>
      )}
    </main>
  );
}
```

Run: `npm test` → Expected: all PASS.

- [ ] **Step 5: Commit.**

```bash
git add components/ConfirmValues.tsx components/SummaryView.tsx components/SummaryView.test.tsx app/result/page.tsx
git commit -m "feat: confirm-the-values gate + bilingual summary view + result page"
```

---

### Task 12: On-device persistence (`lib/db.ts`, `components/SaveVisitButton.tsx`, `components/SavedVisits.tsx`)

**Files:**
- Create: `lib/db.ts`, `components/SaveVisitButton.tsx`, `components/SavedVisits.tsx`

- [ ] **Step 1: Implement `lib/db.ts` (idb wrapper).**

```ts
// lib/db.ts
'use client';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { GroundedReport } from '@/lib/types';

export interface VisitRecord {
  id: string;
  createdAt: number;
  report: GroundedReport;
}

interface VisitDB extends DBSchema {
  visits: { key: string; value: VisitRecord; indexes: { 'by-date': number } };
}

let dbp: Promise<IDBPDatabase<VisitDB>> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB<VisitDB>('health-translator', 1, {
      upgrade(d) {
        const s = d.createObjectStore('visits', { keyPath: 'id' });
        s.createIndex('by-date', 'createdAt');
      },
    });
  }
  return dbp;
}

export async function saveVisit(report: GroundedReport): Promise<VisitRecord> {
  const rec: VisitRecord = { id: crypto.randomUUID(), createdAt: Date.now(), report };
  await (await db()).put('visits', rec);
  return rec;
}
export async function listVisits(): Promise<VisitRecord[]> {
  const all = await (await db()).getAllFromIndex('visits', 'by-date');
  return all.reverse(); // newest first
}
export async function getVisit(id: string): Promise<VisitRecord | undefined> {
  return (await db()).get('visits', id);
}
export async function deleteVisit(id: string): Promise<void> {
  await (await db()).delete('visits', id);
}
```

- [ ] **Step 2: Implement `components/SaveVisitButton.tsx`.**

```tsx
// components/SaveVisitButton.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveVisit } from '@/lib/db';
import { clearPendingReport } from '@/lib/session';
import type { GroundedReport } from '@/lib/types';

export function SaveVisitButton({ report, lang }: { report: GroundedReport; lang: 'en' | 'zh' }) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const t = (en: string, zh: string) => (lang === 'zh' ? zh : en);

  async function onSave() {
    await saveVisit(report);
    clearPendingReport();
    setSaved(true);
    router.push('/');
  }

  return (
    <button className="save" onClick={onSave} disabled={saved}>
      {saved ? t('Saved', '已保存') : t('Save this report to my device', '保存到本机')}
    </button>
  );
}
```

- [ ] **Step 3: Implement `components/SavedVisits.tsx`.**

```tsx
// components/SavedVisits.tsx
'use client';
import { useEffect, useState } from 'react';
import { listVisits, deleteVisit, type VisitRecord } from '@/lib/db';
import { SummaryView } from '@/components/SummaryView';

export function SavedVisits({ lang }: { lang: 'en' | 'zh' }) {
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const t = (en: string, zh: string) => (lang === 'zh' ? zh : en);

  useEffect(() => { listVisits().then(setVisits); }, []);

  if (visits.length === 0) return null;

  return (
    <section className="saved">
      <h2>{t('Saved reports (on this device)', '已保存的报告（本机）')}</h2>
      <ul>
        {visits.map((v) => (
          <li key={v.id}>
            <button onClick={() => setOpenId(openId === v.id ? null : v.id)}>
              {new Date(v.createdAt).toLocaleString()} — {v.report.rows.length} {t('items', '项')}
            </button>
            <button onClick={async () => { await deleteVisit(v.id); setVisits(await listVisits()); }}>
              {t('Delete', '删除')}
            </button>
            {openId === v.id && <SummaryView report={v.report} lang={lang} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 4: Commit.**

```bash
git add lib/db.ts components/SaveVisitButton.tsx components/SavedVisits.tsx
git commit -m "feat: on-device IndexedDB persistence + saved-visits list"
```

---

### Task 13: Home page, layout, disclaimer banner, styling (`app/page.tsx`, `app/layout.tsx`, `components/DisclaimerBanner.tsx`, `app/globals.css`)

**Files:**
- Modify: `app/page.tsx`, `app/layout.tsx`, `app/globals.css`
- Create: `components/DisclaimerBanner.tsx`

- [ ] **Step 1: `components/DisclaimerBanner.tsx`.**

```tsx
// components/DisclaimerBanner.tsx
export function DisclaimerBanner() {
  return (
    <div className="banner" role="note">
      <strong>Not medical advice · 非医疗建议.</strong>{' '}
      This tool helps you understand a lab report and can misread it. Always confirm with your clinician.
    </div>
  );
}
```

- [ ] **Step 2: `app/page.tsx` (home).**

```tsx
// app/page.tsx
'use client';
import { useState } from 'react';
import { CaptureCard } from '@/components/CaptureCard';
import { SavedVisits } from '@/components/SavedVisits';
import { InstallPrompt } from '@/components/InstallPrompt';

export default function Home() {
  const [lang] = useState<'en' | 'zh'>('en');
  return (
    <main className="home">
      <header>
        <h1>Health Translator</h1>
        <p className="tagline">Understand your lab report in plain language — safely.</p>
      </header>
      <CaptureCard />
      <SavedVisits lang={lang} />
      <InstallPrompt />
    </main>
  );
}
```

- [ ] **Step 3: `app/layout.tsx` (metadata + banner).**

```tsx
// app/layout.tsx
import type { Metadata, Viewport } from 'next';
import { DisclaimerBanner } from '@/components/DisclaimerBanner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Health Translator',
  description: 'Plain-language, safety-guarded summaries of your lab reports (Mandarin ↔ English).',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Health Translator' },
};

export const viewport: Viewport = { themeColor: '#0f172a', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DisclaimerBanner />
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 4: `app/globals.css`.** Minimal, clean, readable, severity-colored badges/flags. (Full CSS provided here — keep it small and legible; large tap targets for mobile.)

```css
/* app/globals.css */
:root { --bg:#f8fafc; --fg:#0f172a; --muted:#64748b; --line:#e2e8f0;
  --low:#2563eb; --normal:#16a34a; --high:#d97706; --critical:#dc2626; --unclassified:#64748b;
  --urgent-bg:#fef2f2; --caution-bg:#fffbeb; --info-bg:#f1f5f9; }
* { box-sizing: border-box; }
body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
  color:var(--fg); background:var(--bg); line-height:1.5; }
main { max-width: 720px; margin: 0 auto; padding: 16px; }
.banner { background:#0f172a; color:#fff; font-size:13px; padding:8px 16px; text-align:center; }
h1 { font-size:24px; margin:16px 0 4px; }
.tagline { color:var(--muted); margin:0 0 16px; }
.capture { display:flex; flex-direction:column; gap:12px; margin-bottom:24px; }
.field { display:flex; flex-direction:column; gap:6px; font-size:14px; color:var(--muted); }
select, input { font-size:16px; padding:10px; border:1px solid var(--line); border-radius:8px; background:#fff; }
.capture-btn { display:block; text-align:center; padding:16px; border:2px dashed var(--line); border-radius:12px;
  background:#fff; cursor:pointer; font-weight:600; }
.error { color:var(--critical); }
.rows { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:12px; }
.row { border:1px solid var(--line); border-radius:12px; padding:12px; background:#fff; }
.row-head { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.row-title { font-weight:600; }
.row-value { font-variant-numeric: tabular-nums; }
.badge { margin-left:auto; font-size:12px; font-weight:700; padding:2px 8px; border-radius:999px; color:#fff; }
.badge-low{background:var(--low)} .badge-normal{background:var(--normal)} .badge-high{background:var(--high)}
.badge-critical{background:var(--critical)} .badge-unclassified{background:var(--unclassified)}
.row-plain { margin:8px 0 4px; }
.row-source { font-size:12px; color:var(--muted); margin:4px 0 0; }
.flag { font-size:13px; padding:8px 10px; border-radius:8px; margin:6px 0 0; }
.flag-urgent{background:var(--urgent-bg); color:var(--critical); font-weight:600;}
.flag-caution{background:var(--caution-bg); color:var(--high);}
.flag-info{background:var(--info-bg); color:var(--muted);}
.disclaimers { margin-top:24px; font-size:12px; color:var(--muted); border-top:1px solid var(--line); padding-top:12px; }
.lang-toggle { display:flex; gap:8px; margin-bottom:16px; }
.lang-toggle button[aria-pressed="true"] { background:var(--fg); color:#fff; }
.lang-toggle button, .save, .confirm button { font-size:16px; padding:10px 16px; border-radius:8px; border:1px solid var(--line); background:#fff; cursor:pointer; }
.save { width:100%; margin-top:16px; font-weight:600; }
.confirm-row { display:grid; grid-template-columns: 1fr auto auto; gap:8px; align-items:center; margin:8px 0; }
.saved h2, .confirm h2 { font-size:18px; }
```

- [ ] **Step 5: Manual check — dev server renders.**

Run: `npm run dev` then open `http://localhost:3000`. Expected: home page with disclaimer banner, capture card, sex selector. (Extraction needs `ANTHROPIC_API_KEY` in `.env.local`; without it, picking a file returns a 502 surfaced as an error — that's expected until the key is set.)

- [ ] **Step 6: Commit.**

```bash
git add app/page.tsx app/layout.tsx app/globals.css components/DisclaimerBanner.tsx
git commit -m "feat: home page, layout, always-on disclaimer banner, base styling"
```

---

### Task 14: PWA — manifest, service worker, offline shell, install prompt

**Files:**
- Create: `app/manifest.ts`, `app/sw.ts`, `app/~offline/page.tsx`, `components/InstallPrompt.tsx`
- Modify: `next.config.ts`
- Create: `public/icon-192x192.png`, `public/icon-512x512.png`, `public/apple-touch-icon.png`

- [ ] **Step 1: `app/manifest.ts`.**

```ts
// app/manifest.ts
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Health Translator',
    short_name: 'HealthXlate',
    description: 'Plain-language, safety-guarded summaries of your lab reports',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0f172a',
    icons: [
      { src: '/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
```

- [ ] **Step 2: `app/sw.ts` (Serwist source).**

```ts
// app/sw.ts
import { defaultCache } from '@serwist/next/worker';
import { Serwist } from 'serwist';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: { entries: [{ url: '/~offline', matcher: ({ request }) => request.destination === 'document' }] },
});

serwist.addEventListeners();
```

- [ ] **Step 3: `app/~offline/page.tsx`.**

```tsx
// app/~offline/page.tsx
export default function Offline() {
  return (
    <main className="home">
      <h1>You’re offline</h1>
      <p>Saved reports on this device are still available once you’re back online and the app reloads.</p>
    </main>
  );
}
```

- [ ] **Step 4: Wrap `next.config.ts` with Serwist.**

```ts
// next.config.ts
import withSerwistInit from '@serwist/next';

const withSerwist = withSerwistInit({
  swSrc: 'app/sw.ts',
  swDest: 'public/sw.js',
});

export default withSerwist({
  // existing Next config options (if any) go here
});
```

- [ ] **Step 5: `components/InstallPrompt.tsx` (iOS A2HS hint).**

```tsx
// components/InstallPrompt.tsx
'use client';
import { useEffect, useState } from 'react';

export function InstallPrompt() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true;
    setShow(isIos && !standalone);
  }, []);
  if (!show) return null;
  return (
    <p className="install-hint">
      Add to Home Screen: tap the Share button, then “Add to Home Screen”.
    </p>
  );
}
```

- [ ] **Step 6: Add icons.** Generate three PNGs (a simple flat icon — e.g. a document + check mark on `#0f172a`). Place `icon-192x192.png`, `icon-512x512.png`, `apple-touch-icon.png` (180×180) in `public/`. If no design tooling, create solid-color placeholders so the manifest validates:

```bash
# placeholder generation (requires ImageMagick); replace with real icons later
magick -size 192x192 xc:'#0f172a' -gravity center -pointsize 96 -fill white label:'H+' public/icon-192x192.png
magick -size 512x512 xc:'#0f172a' -gravity center -pointsize 256 -fill white label:'H+' public/icon-512x512.png
magick -size 180x180 xc:'#0f172a' -gravity center -pointsize 90 -fill white label:'H+' public/apple-touch-icon.png
```

- [ ] **Step 7: Build with the webpack flag (Serwist requirement) — verify SW + precache generate.**

Run: `npm run build` (this is `next build --webpack`).
Expected: build succeeds; `public/sw.js` is generated. If TypeScript flags `app/sw.ts` lib types, add `"WebWorker"` to `compilerOptions.lib` in `tsconfig.json` and exclude `app/sw.ts` from the app's DOM typecheck per Serwist docs.

- [ ] **Step 8: Commit.**

```bash
git add app/manifest.ts app/sw.ts "app/~offline/page.tsx" components/InstallPrompt.tsx next.config.ts public/icon-192x192.png public/icon-512x512.png public/apple-touch-icon.png tsconfig.json
git commit -m "feat: PWA (manifest, Serwist service worker, offline shell, iOS install hint)"
```

---

### Task 15: Docs, env, final verification

**Files:**
- Modify: `README.md`
- Create: `docs/RUNNING.md`

- [ ] **Step 1: Update `README.md`** — add a "Running v0 locally" section: prerequisites (Node 20+), `cp .env.local.example .env.local` and set `ANTHROPIC_API_KEY`, `npm install`, `npm test`, `npm run dev` (app) / `npm run dev:pwa` (to exercise the service worker), `npm run build` (must use `--webpack` for the SW). Document the safety model in one paragraph: LLM extracts only; grounding/classification/guard/summary are deterministic from `data/reference-labs.ts`; PHI stays on-device; high-stakes/uncertain items are flagged "confirm with your clinician."

- [ ] **Step 2: Create `docs/RUNNING.md`** with the same commands plus the known constraints (Serwist needs `--webpack`; route runs on Node runtime; key must be `ANTHROPIC_API_KEY`, never `NEXT_PUBLIC_`).

- [ ] **Step 3: Full verification.**

```bash
npm test            # all unit/component tests pass
npm run build       # production build (webpack) succeeds, sw.js generated
```

Expected: green tests; successful build. With a real `ANTHROPIC_API_KEY`, `npm run dev` → photograph a lab report → confirm values → bilingual summary with flags.

- [ ] **Step 4: Commit.**

```bash
git add README.md docs/RUNNING.md
git commit -m "docs: v0 running instructions + safety-model overview"
```

---

## Self-review (spec coverage)

- **Mode 1 / after-visit comprehension** → Tasks 9–12 (photo → extract → ground → summary → kept record). ✅
- **Mandarin ↔ English** → bilingual reference table (Task 2), bilingual summary + disclaimers + flags (Tasks 5, 8, 11), language toggle (Task 11). ✅
- **Web/PWA** → Next.js app (Task 1) + PWA (Task 14). ✅
- **Photograph a lab report** → `CaptureCard` with camera capture + downscale (Task 10). ✅
- **OCR** → Claude vision extract-only route (Tasks 7, 9). ✅
- **Ground each value against reference ranges** → `reference.ts` + `classify.ts` + `grounding.ts` over the curated SI table (Tasks 2–6). ✅
- **Plain-language translated summary** → deterministic templated bilingual summary from the table (Task 8). ✅
- **Abstention / "confirm with clinician" guard on high-stakes items** → guard R1–R6, R11–R12 (Task 5), confirm-the-values gate (Task 11), always-on disclaimers (Tasks 8, 13). ✅
- **Moat = comprehension + safety, never raw translation** → the model only OCRs; all meaning/ranges/classification/translation are deterministic from the curated table; the guard biases to defer; nothing free-floats. ✅
- **Validation-number readiness (v1)** → the confirm/correct events and per-row flags are the data the v1 fidelity/abstention metric will measure; structure is in place (noted, not built). ✅
- **PHI privacy** → image transits server transiently and is never persisted; kept record lives only in on-device IndexedDB (Tasks 9, 12). ✅
- **Out of scope (correctly deferred):** free-text doctor-notes translation + R7–R9 (negation/dosage/drug) — inert tested no-op in the guard so v0.1 extends cleanly; unit auto-conversion (R2 abstains instead); bbox crops in the confirm step (shows transcription + full image). ✅

**Type consistency check:** `ReferenceEntry`/`ExtractedRow`/`GroundedRow`/`GroundedReport`/`Classification`/`GuardAction`/`GuardFlag`/`Sex`/`Bound` are defined once in `lib/types.ts` (Task 2) and used verbatim across `reference.ts`, `classify.ts`, `guard.ts`, `grounding.ts`, `summary.ts`, components, and `db.ts`. The Zod `LabExtraction` (Task 7) mirrors `ExtractedRow` field-for-field (name, value, unit, printedRange, confidence) and is the type `groundExtraction` consumes. `buildSummary` returns `SummarySection` consumed only by `SummaryView`. No dangling references.

---

## Execution handoff

Plan complete. Per the user's instruction ("then build it commit by commit"), execution proceeds **inline** (superpowers:executing-plans), task by task, running the tests at each step and committing per task as specified above.
