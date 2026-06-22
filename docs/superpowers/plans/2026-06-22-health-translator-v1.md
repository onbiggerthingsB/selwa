# Health Translator — v1 Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend v0 (labs-only) into v1 — doctor-notes translation with deterministic fidelity guards (R7–R9), safe unit auto-conversion, an expanded reference table with age support, and a validation harness that measures the safety/comprehension delta vs a machine-translation baseline — **without weakening the v0 deterministic safety core.**

**Architecture:** The v0 invariant holds and extends: *the LLM never decides safety.* For labs it does OCR only. For notes (new) it translates, but a **pure, deterministic guard (`notesGuard`) owns fidelity** — it recomputes immutables (negations, dosages, drug names, numbers) from the **source** and demands they survive in the LLM output, abstaining or flagging on any mismatch. Every new safety-bearing unit is a small pure function, built test-first like the v0 core. Source text is always shown beside any translation.

**Tech Stack:** Next.js 16 App Router + TypeScript · `@anthropic-ai/sdk` (`claude-opus-4-8`, structured output via `zodOutputFormat`) · `zod` · `idb` · Vitest + Testing Library. Validation harness is plain TS run by Vitest/tsx, not shipped in the app bundle.

> **Source of truth for the safety-critical specifics in M2/M3/M4:** this plan's code blocks already encode the verified outputs of the v1 hardening workflow (conversion factors, the R7/R8/R9 guard contract, the 18 red-team failure modes, the metric formulas). Implement them as written.

---

## File structure (new / modified)

```
lib/
  types.ts                 # MODIFY: add AgeBand; Immutable/NoteSegment/GroundedSegment/GroundedNotes
  reference.ts             # MODIFY: resolveBounds(entry, sex, age?)
  classify.ts              # MODIFY: classify(valueNum, entry, sex, age?)
  guard.ts                 # MODIFY: thread age into R12; add R2b path; delegate freeText to notesGuard
  grounding.ts             # MODIFY: groundExtraction(extraction, sex, age?) + unit conversion
  convert.ts               # CREATE (M2): convertValue()
  notesDetect.ts           # CREATE (M3): detectImmutables() — negation/dosage/drug/number
  notesGuard.ts            # CREATE (M3): evaluateSegment() — R7/R8/R9
  notesGrounding.ts        # CREATE (M3): groundNotes()
  notesSchema.ts           # CREATE (M3): NotesTranslation Zod + NOTES_PROMPT
  notesSummary.ts          # CREATE (M3): buildNotesView()
data/
  reference-labs.ts        # MODIFY (M1): expand to ~80–120 analytes + ageBands where they matter
  unit-conversions.ts      # CREATE (M2): curated SI↔conventional factors
  medical-lexicon.ts       # CREATE (M3): negation/dose/freq markers, KNOWN_DRUGS, HIGH_RISK_PAIRS
app/
  api/translate-notes/route.ts   # CREATE (M3): text → Claude → NotesTranslation
  result/page.tsx                # MODIFY (M3): render notes section
components/
  CaptureCard.tsx          # MODIFY (M1 age, M3 notes textarea)
  NotesSection.tsx         # CREATE (M3): bilingual notes render with pinned immutables + flags
validation/                # CREATE (M4): corpus, baselines, metrics, runner, review (not in app bundle)
docs/superpowers/specs/
  2026-06-22-mode2-architecture.md   # CREATE (M5): interfaces + sequencing sketch
```

---

## Task 0: Shared v1 types

**Files:** Modify `lib/types.ts`

- [ ] **Step 1: Add the new types** (append to `lib/types.ts`; do not modify existing types except `ReferenceEntry`).

```ts
// --- M1: age support (additive; existing entries omit ageBands) ---
export interface AgeBand {
  ageMin: number; // inclusive, years
  ageMax: number; // inclusive, years
  refLow: Bound;
  refHigh: Bound;
}
// ReferenceEntry gains one optional field — add it to the interface:
//   ageBands?: AgeBand[];

// --- M3: doctor-notes immutables ---
export type ImmutableType = 'negation' | 'dosage' | 'drug' | 'number';
export type Polarity = 'present' | 'absent' | 'uncertain';

export interface Immutable {
  type: ImmutableType;
  raw: string;                 // verbatim source span
  finding?: string;            // negation: canonical finding key it scopes
  polarity?: Polarity;         // negation
  strength?: number;           // negation: hedge-ladder rank (higher = more certain)
  amount?: string;             // dosage/number: verbatim normalized digits
  unitDim?: string;            // dosage: normalized unit dimension key (mg, mL, mcg, IU, tablet…)
  frequency?: string;          // dosage: canonical frequency
  range?: { min: string; max: string }; // dosage range, e.g. 1–2 tablets
  drugId?: string | null;      // drug: canonical known id, or null = unknown-med
  numUnit?: string | null;     // number: trailing unit if any
}

export type SegmentKind = 'finding' | 'medication' | 'instruction' | 'followup' | 'other';
export type SegmentAction = 'render' | 'flag' | 'abstain';

export interface GroundedSegment {
  source: string;
  translated: string;          // '' when action === 'abstain'
  kind: SegmentKind;
  action: SegmentAction;
  flags: GuardFlag[];
  preserved: Immutable[];
}
export interface GroundedNotes {
  segments: GroundedSegment[];
  overallAction: SegmentAction; // max severity over segments (abstain > flag > render)
}
```

- [ ] **Step 2: Add `ageBands?` to `ReferenceEntry`.** Insert `ageBands?: AgeBand[];` after `populationSensitive` in the interface.

- [ ] **Step 3: Typecheck.** Run: `npx tsc --noEmit` — Expected: passes (the field is optional; nothing else changes yet).

- [ ] **Step 4: Commit.**

```bash
git add lib/types.ts
git commit -m "feat(v1): shared types — age bands + doctor-notes immutables"
```

---

# Milestone M1 — Expanded reference table + age support

### Task M1.1: Age-aware `resolveBounds`

**Files:** Modify `lib/reference.ts`, `lib/reference.test.ts`

- [ ] **Step 1: Add failing tests** (append to `lib/reference.test.ts`).

```ts
import { REFERENCE_LABS } from '@/data/reference-labs';

describe('resolveBounds with age bands', () => {
  // Synthetic entry with age bands for the test (independent of the data file).
  const banded = {
    ...findEntry('creatinine')!,
    ageBands: [
      { ageMin: 0, ageMax: 17, refLow: 20, refHigh: 60 },
      { ageMin: 18, ageMax: 200, refLow: { male: 59, female: 45 }, refHigh: { male: 104, female: 84 } },
    ],
  };

  it('picks the matching age band, then resolves sex within it', () => {
    expect(resolveBounds(banded, 'male', 40)).toEqual({ low: 59, high: 104, usedUnion: false });
    expect(resolveBounds(banded, 'female', 10)).toEqual({ low: 20, high: 60, usedUnion: false });
  });
  it('with age bands present but no age supplied, widens across bands AND sex, flags union', () => {
    const r = resolveBounds(banded, 'unknown');
    expect(r.usedUnion).toBe(true);
    expect(r.low).toBe(20);   // min across all bands + sexes
    expect(r.high).toBe(104); // max across all bands + sexes
  });
  it('entries without age bands behave exactly as before', () => {
    const k = findEntry('potassium')!;
    expect(resolveBounds(k, 'unknown')).toEqual({ low: 3.5, high: 5.3, usedUnion: false });
  });
});
```

- [ ] **Step 2: Run — verify fail.** Run: `npm test -- reference` → Expected: FAIL (resolveBounds ignores age / 3rd arg).

- [ ] **Step 3: Implement.** Replace `resolveBounds` in `lib/reference.ts`:

```ts
import type { AgeBand, Bound, ReferenceEntry, Sex } from '@/lib/types';

function scalarFromBound(b: Bound, which: 'low' | 'high', sex: Sex): number {
  if (typeof b === 'number') return b;
  if (sex === 'male') return b.male;
  if (sex === 'female') return b.female;
  return which === 'low' ? Math.min(b.male, b.female) : Math.max(b.male, b.female);
}

export function resolveBounds(entry: ReferenceEntry, sex: Sex, age?: number): ResolvedBounds {
  const bands = entry.ageBands;
  if (bands && bands.length > 0) {
    if (age !== undefined) {
      const band = bands.find((b) => age >= b.ageMin && age <= b.ageMax);
      if (band) {
        const split = typeof band.refLow === 'object' || typeof band.refHigh === 'object';
        return {
          low: band.refLow === null ? null : scalarFromBound(band.refLow, 'low', sex),
          high: band.refHigh === null ? null : scalarFromBound(band.refHigh, 'high', sex),
          usedUnion: split && sex === 'unknown',
        };
      }
    }
    // No age (or no matching band): widen across ALL bands and sexes, flag union.
    const lows = bands.map((b) => scalarFromBound(b.refLow, 'low', 'female')).concat(
      bands.map((b) => scalarFromBound(b.refLow, 'low', 'male')),
    );
    const highs = bands.map((b) => scalarFromBound(b.refHigh, 'high', 'female')).concat(
      bands.map((b) => scalarFromBound(b.refHigh, 'high', 'male')),
    );
    return { low: Math.min(...lows), high: Math.max(...highs), usedUnion: true };
  }

  // No age bands: original v0 behaviour (sex split or scalar).
  const isSplit = (b: ReferenceEntry['refLow']) => b !== null && typeof b === 'object';
  const split = isSplit(entry.refLow) || isSplit(entry.refHigh);
  return {
    low: entry.refLow === null ? null : scalarFromBound(entry.refLow, 'low', sex),
    high: entry.refHigh === null ? null : scalarFromBound(entry.refHigh, 'high', sex),
    usedUnion: split && sex === 'unknown',
  };
}
```

- [ ] **Step 4: Run — verify pass.** Run: `npm test -- reference` → Expected: PASS (old + new tests).

- [ ] **Step 5: Commit.**

```bash
git add lib/reference.ts lib/reference.test.ts
git commit -m "feat(v1): age-aware resolveBounds (additive; v0 behaviour preserved)"
```

### Task M1.2: Thread age through classify → guard → grounding

**Files:** Modify `lib/classify.ts`, `lib/guard.ts`, `lib/grounding.ts` + their tests

- [ ] **Step 1: Add a failing classify test** (append to `lib/classify.test.ts`).

```ts
it('uses an age band when age is provided', () => {
  const banded = {
    ...findEntry('creatinine')!,
    ageBands: [
      { ageMin: 0, ageMax: 17, refLow: 20, refHigh: 60 },
      { ageMin: 18, ageMax: 200, refLow: { male: 59, female: 45 }, refHigh: { male: 104, female: 84 } },
    ],
  };
  expect(classify(70, banded, 'female', 10)).toBe('high');   // child band 20–60
  expect(classify(70, banded, 'female', 40)).toBe('normal'); // adult female 45–84
});
```

- [ ] **Step 2: Run — verify fail.** Run: `npm test -- classify` → Expected: FAIL.

- [ ] **Step 3: Implement.** In `lib/classify.ts`, change the signature to `classify(valueNum, entry, sex, age?)` and pass `age` into `resolveBounds(entry, sex, age)`. Critical-band checks are unchanged (they're absolute, not age-scoped).

```ts
export function classify(valueNum: number | null, entry: ReferenceEntry, sex: Sex, age?: number): Classification {
  if (valueNum === null) return 'unclassified';
  if (entry.criticalLow !== null && valueNum < entry.criticalLow) return 'critical';
  if (entry.criticalHigh !== null && valueNum > entry.criticalHigh) return 'critical';
  const { low, high } = resolveBounds(entry, sex, age);
  if (low !== null && valueNum < low) return 'low';
  if (high !== null && valueNum > high) return 'high';
  return 'normal';
}
```

- [ ] **Step 4: Thread age into guard + grounding.** In `lib/guard.ts`, `evaluateRow(extracted, entry, valueNum, classification, sex, age?)` — pass `age` to the internal `resolveBounds` call in `printedRangeDisagrees`, and update R12 to also fire when `entry.ageBands` exists and `age === undefined`:

```ts
// R12 condition becomes:
if (entry.populationSensitive && (sex === 'unknown' || (entry.ageBands && age === undefined))) { ... }
// printedRangeDisagrees(printed, entry, sex, age) → resolveBounds(entry, sex, age)
```

In `lib/grounding.ts`, change `groundExtraction(extraction, sex, age?)` and thread `age` into `classify(...)` and `evaluateRow(...)`.

- [ ] **Step 5: Update existing call sites.** `components/CaptureCard.tsx`, `components/ConfirmValues.tsx`, and `lib/summary.ts` (`formatRefRange` calls `resolveBounds(entry, report.sex)` → add `report.age`). Add `age?: number` to `GroundedReport` (in `lib/types.ts`) and set it in CaptureCard. (Capture-side age input added in M1.4.)

- [ ] **Step 6: Run all tests.** Run: `npm test` → Expected: PASS (existing tests still green; `age` is optional everywhere).

- [ ] **Step 7: Commit.**

```bash
git add lib/classify.ts lib/classify.test.ts lib/guard.ts lib/grounding.ts lib/summary.ts lib/types.ts components/CaptureCard.tsx components/ConfirmValues.tsx
git commit -m "feat(v1): thread optional age through classify/guard/grounding"
```

### Task M1.3: Expand the reference table to ~80–120 analytes

**Files:** Modify `data/reference-labs.ts`, `data/reference-labs.test.ts`

> This is data assembly. The **integrity test is the contract**; populate entries to satisfy it, sourced. Add analytes in the grouped batches below, each entry matching the existing `ReferenceEntry` shape (SI canonical unit, sourced, sex bands where they matter, `ageBands` only where clinically real — e.g. ALP, creatinine/eGFR in children, some hormones).

- [ ] **Step 1: Strengthen the integrity test** (modify `data/reference-labs.test.ts`).

```ts
it('has at least 80 analytes', () => {
  expect(REFERENCE_LABS.length).toBeGreaterThanOrEqual(80);
});
it('every alias is unique across the whole table (no analyte collisions)', () => {
  const seen = new Map<string, string>();
  for (const e of REFERENCE_LABS) {
    for (const a of [e.nameZh, ...e.aliases]) {
      const key = a.trim().toLowerCase();
      if (seen.has(key) && seen.get(key) !== e.key) {
        throw new Error(`alias "${a}" maps to both ${seen.get(key)} and ${e.key}`);
      }
      seen.set(key, e.key);
    }
  }
});
it('age-banded entries are well-formed', () => {
  for (const e of REFERENCE_LABS) {
    if (!e.ageBands) continue;
    for (const b of e.ageBands) {
      expect(b.ageMin).toBeLessThanOrEqual(b.ageMax);
      expect(b.refLow !== null || b.refHigh !== null).toBe(true);
    }
  }
});
```

- [ ] **Step 2: Run — verify fail.** Run: `npm test -- reference-labs` → Expected: FAIL (only 28 analytes).

- [ ] **Step 3: Populate, batch by batch.** Add entries (keep v0's 28; append) for these groups, each sourced (Tietz / WS·T / relevant Chinese guideline). Run the integrity test after each batch; commit per batch.
  - **CBC + differential:** MCH, MCHC, RDW, monocyte %, eosinophil %, basophil %, neutrophil abs, lymphocyte abs, MPV.
  - **Metabolic / electrolytes:** calcium (total), magnesium, phosphate, bicarbonate/CO₂, anion gap, random glucose, fasting insulin.
  - **Lipids:** non-HDL cholesterol, ApoA1, ApoB, Lp(a).
  - **Liver:** ALP (age-banded — high in children), direct/indirect bilirubin, total bile acids, LDH.
  - **Renal:** cystatin C, urine ACR, β2-microglobulin.
  - **Thyroid:** T3, FT3, total T4, TPOAb, TgAb.
  - **Cardiac / inflammatory (mark high-stakes):** hs-CRP, ESR, NT-proBNP, BNP, troponin I/T, CK, CK-MB, homocysteine.
  - **Coagulation:** PT, INR, APTT, fibrinogen, D-dimer (D-dimer high-stakes).
  - **Iron / vitamins:** serum iron, ferritin, TIBC, transferrin saturation, vitamin B12, folate, 25-OH vitamin D.
  - **Diabetes / pancreas:** C-peptide, amylase, lipase.
  - **Common urinalysis (qualitative — store as reference entries that abstain on non-numeric):** urine protein, urine glucose, urine ketones, urine pH, urine specific gravity.

- [ ] **Step 4: Run — verify pass.** Run: `npm test -- reference-labs` → Expected: PASS (≥80, integrity holds).

- [ ] **Step 5: Commit (per batch is fine).**

```bash
git add data/reference-labs.ts data/reference-labs.test.ts
git commit -m "feat(v1): expand reference table to 80+ analytes with provenance + age bands"
```

### Task M1.4: Optional age input in capture

**Files:** Modify `components/CaptureCard.tsx`

- [ ] **Step 1:** Add an optional age field beside the sex selector (a small number input or age-band select: `<18, 18–64, 65+` mapped to a representative age, or a numeric input). Store `age?: number` in component state; pass to `groundExtraction(extraction, sex, age)`. Keep it optional — no age → unchanged behaviour (R12 widens + flags). Bilingual label "Age (optional) · 年龄（可选）".

- [ ] **Step 2: Verify in preview.** Run the dev server; confirm the capture screen shows the age field and the flow still works.

- [ ] **Step 3: Commit.**

```bash
git add components/CaptureCard.tsx
git commit -m "feat(v1): optional age capture feeds age-aware grounding"
```

---

# Milestone M2 — Unit auto-conversion

### Task M2.1: Curated conversion table

**Files:** Create `data/unit-conversions.ts`, `data/unit-conversions.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// data/unit-conversions.test.ts
import { describe, it, expect } from 'vitest';
import { UNIT_CONVERSIONS } from './unit-conversions';

describe('unit conversions integrity', () => {
  it('each conversion round-trips within 1%', () => {
    for (const c of UNIT_CONVERSIONS) {
      const round = 100 * c.factorConvToSI * c.factorSIToConv;
      expect(Math.abs(round - 100)).toBeLessThan(1); // factors are reciprocals
    }
  });
  it('covers glucose and creatinine with the documented factors', () => {
    const glu = UNIT_CONVERSIONS.find((c) => c.analyteKey === 'fasting_glucose')!;
    expect(glu.conventionalUnit).toBe('mg/dL');
    expect(glu.siUnit).toBe('mmol/L');
    expect(glu.factorConvToSI).toBeCloseTo(0.0555, 4);
    const cr = UNIT_CONVERSIONS.find((c) => c.analyteKey === 'creatinine')!;
    expect(cr.siUnit).toBe('umol/L'); // NOT mmol/L — the 1000x trap
    expect(cr.factorConvToSI).toBeCloseTo(88.42, 2);
  });
  it('every conversion carries a source', () => {
    for (const c of UNIT_CONVERSIONS) expect(c.source.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run — verify fail.** Run: `npm test -- unit-conversions` → Expected: FAIL.

- [ ] **Step 3: Implement** (verified factors from the hardening workflow).

```ts
// data/unit-conversions.ts
export interface UnitConversion {
  analyteKey: string;
  conventionalUnit: string; // e.g. 'mg/dL'
  siUnit: string;           // canonical SI on our reference table
  factorConvToSI: number;   // conventional × this = SI
  factorSIToConv: number;   // SI × this = conventional
  source: string;
}

export const UNIT_CONVERSIONS: UnitConversion[] = [
  { analyteKey: 'fasting_glucose', conventionalUnit: 'mg/dL', siUnit: 'mmol/L', factorConvToSI: 0.0555, factorSIToConv: 18.0182, source: 'IFCC molar conversion (glucose MW 180)' },
  { analyteKey: 'total_cholesterol', conventionalUnit: 'mg/dL', siUnit: 'mmol/L', factorConvToSI: 0.02586, factorSIToConv: 38.67, source: 'IFCC (cholesterol MW 386.65)' },
  { analyteKey: 'ldl_cholesterol', conventionalUnit: 'mg/dL', siUnit: 'mmol/L', factorConvToSI: 0.02586, factorSIToConv: 38.67, source: 'IFCC (same molecule as total cholesterol)' },
  { analyteKey: 'hdl_cholesterol', conventionalUnit: 'mg/dL', siUnit: 'mmol/L', factorConvToSI: 0.02586, factorSIToConv: 38.67, source: 'IFCC (same molecule as total cholesterol)' },
  { analyteKey: 'triglycerides', conventionalUnit: 'mg/dL', siUnit: 'mmol/L', factorConvToSI: 0.01129, factorSIToConv: 88.57, source: 'IFCC (triolein MW ~885)' },
  { analyteKey: 'creatinine', conventionalUnit: 'mg/dL', siUnit: 'umol/L', factorConvToSI: 88.42, factorSIToConv: 0.01131, source: 'IFCC (creatinine MW 113.12); SI is µmol/L' },
  { analyteKey: 'total_bilirubin', conventionalUnit: 'mg/dL', siUnit: 'umol/L', factorConvToSI: 17.10, factorSIToConv: 0.05848, source: 'IFCC (bilirubin MW 584.66); SI is µmol/L' },
  { analyteKey: 'uric_acid', conventionalUnit: 'mg/dL', siUnit: 'umol/L', factorConvToSI: 59.48, factorSIToConv: 0.01681, source: 'IFCC (uric acid MW 168.11); SI is µmol/L' },
  // NOTE: urea/BUN and calcium are DELIBERATELY EXCLUDED — see convert.ts ABSTAIN_TRAPS.
];
```

- [ ] **Step 4: Run — verify pass.** Run: `npm test -- unit-conversions` → Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add data/unit-conversions.ts data/unit-conversions.test.ts
git commit -m "feat(v1): curated SI<->conventional conversion factors (sourced)"
```

### Task M2.2: `convertValue` with abstain-traps

**Files:** Create `lib/convert.ts`, `lib/convert.test.ts`

- [ ] **Step 1: Write the failing test** (encodes the workflow's explicit traps).

```ts
// lib/convert.test.ts
import { describe, it, expect } from 'vitest';
import { convertValue } from './convert';
import { findEntry } from './reference';

describe('convertValue', () => {
  const glu = findEntry('fasting_glucose')!;   // SI mmol/L
  const cr = findEntry('creatinine')!;          // SI umol/L

  it('converts a conventional value to the canonical SI unit', () => {
    const r = convertValue(100, 'mg/dL', glu)!;
    expect(r.unit).toBe('mmol/L');
    expect(r.value).toBeCloseTo(5.55, 2);
  });
  it('returns null when already canonical (caller should not convert)', () => {
    expect(convertValue(5.5, 'mmol/L', glu)).toBeNull();
  });
  it('converts creatinine mg/dL to µmol/L (not mmol/L)', () => {
    const r = convertValue(1.0, 'mg/dL', cr)!;
    expect(r.unit).toBe('umol/L');
    expect(r.value).toBeCloseTo(88.4, 1);
  });
  it('ABSTAINS (null) on the urea/BUN ambiguity — no conversion entry exists', () => {
    const urea = findEntry('urea')!;
    expect(convertValue(14, 'mg/dL', urea)).toBeNull();
  });
  it('returns null for an unknown unit', () => {
    expect(convertValue(100, 'mg/dl-ish', glu)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — verify fail.** Run: `npm test -- convert` → Expected: FAIL.

- [ ] **Step 3: Implement.**

```ts
// lib/convert.ts
import type { ReferenceEntry } from '@/lib/types';
import { UNIT_CONVERSIONS } from '@/data/unit-conversions';
import { normalizeUnit, unitMatches } from '@/lib/reference';

export function convertValue(
  value: number,
  fromUnit: string,
  entry: ReferenceEntry,
): { value: number; unit: string } | null {
  if (unitMatches(fromUnit, entry)) return null; // already canonical/allowed — nothing to do
  const conv = UNIT_CONVERSIONS.find((c) => c.analyteKey === entry.key);
  if (!conv) return null; // no curated conversion (incl. deliberate abstain-traps) → caller abstains
  const from = normalizeUnit(fromUnit);
  if (from === normalizeUnit(conv.conventionalUnit)) {
    return { value: value * conv.factorConvToSI, unit: entry.unit };
  }
  return null; // unrecognized source unit for this analyte → abstain
}
```

- [ ] **Step 4: Run — verify pass.** Run: `npm test -- convert` → Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/convert.ts lib/convert.test.ts
git commit -m "feat(v1): convertValue — safe SI conversion, abstain on ambiguous/uncurated"
```

### Task M2.3: Integrate conversion into grounding (R2b)

**Files:** Modify `lib/grounding.ts`, `lib/guard.ts`, `lib/guard.test.ts`, `lib/grounding.test.ts`

- [ ] **Step 1: Add a failing grounding test.**

```ts
it('auto-converts a convertible unit mismatch and flags the conversion (R2b)', () => {
  const extraction = { rows: [{ name: 'GLU', value: '99', unit: 'mg/dL', printedRange: null, confidence: 'high' as const }] };
  const { rows } = groundExtraction(extraction, 'unknown');
  const glu = rows.find((r) => r.entry?.key === 'fasting_glucose')!;
  expect(glu.classification).toBe('normal');          // 99 mg/dL = 5.49 mmol/L
  expect(glu.valueNum).toBeCloseTo(5.49, 1);
  expect(glu.flags.map((f) => f.id)).toContain('R2b-UNIT-CONVERTED');
  expect(glu.action).toBe('classify');
});
it('still abstains when no safe conversion exists (urea mg/dL)', () => {
  const extraction = { rows: [{ name: '尿素', value: '14', unit: 'mg/dL', printedRange: null, confidence: 'high' as const }] };
  const { rows } = groundExtraction(extraction, 'unknown');
  const urea = rows.find((r) => r.entry?.key === 'urea')!;
  expect(urea.action).toBe('abstain');
  expect(urea.flags.map((f) => f.id)).toContain('R2-UNIT-MISMATCH');
});
```

- [ ] **Step 2: Run — verify fail.** Run: `npm test -- grounding` → Expected: FAIL.

- [ ] **Step 3: Implement in `lib/grounding.ts`.** Before classify/guard, attempt conversion; if it succeeds, replace the working value+unit and record a flag to inject.

```ts
import { convertValue } from '@/lib/convert';
// inside groundExtraction's row map, after `entry = findEntry(...)`:
let valueNum = parseValue(extracted.value);
let converted: { from: string; to: string } | null = null;
if (entry && valueNum !== null && extracted.unit && !unitMatches(extracted.unit, entry)) {
  const c = convertValue(valueNum, extracted.unit, entry);
  if (c) { converted = { from: `${extracted.value} ${extracted.unit}`, to: `${c.value.toFixed(2)} ${c.unit}` }; valueNum = c.value; }
}
const effectiveUnit = converted ? entry!.unit : extracted.unit;
// classify on valueNum; call evaluateRow with an extracted whose unit is the effectiveUnit so R2 doesn't fire when converted
const classification = entry ? classify(valueNum, entry, sex, age) : 'unclassified';
const outcome = evaluateRow({ ...extracted, unit: effectiveUnit }, entry, valueNum, classification, sex, age);
if (converted) outcome.flags.unshift({ id: 'R2b-UNIT-CONVERTED', severity: 'info',
  messageEn: `We converted ${converted.from} to ${converted.to} to compare with our reference range.`,
  messageZh: `我们已将 ${converted.from} 换算为 ${converted.to} 以便与参考范围比较。` });
```

(`unitMatches` is already exported from `lib/reference.ts`.) Keep `import { unitMatches }` in grounding.

- [ ] **Step 4: Run all tests.** Run: `npm test` → Expected: PASS (R2 abstain unchanged for unconvertible; R2b added for convertible).

- [ ] **Step 5: Surface the conversion in the UI.** In `lib/summary.ts`, the R2b flag already flows through `flags`; ensure the summary shows the converted value (it uses `valueText` from `extracted` — add a `convertedNote` field, or render the R2b flag, which already appears). Minimal: the flag renders in `SummaryView`. Confirm in preview.

- [ ] **Step 6: Commit.**

```bash
git add lib/grounding.ts lib/grounding.test.ts lib/guard.ts lib/guard.test.ts lib/summary.ts
git commit -m "feat(v1): auto-convert safe unit mismatches (R2b), abstain otherwise"
```

---

# Milestone M3 — Doctor-notes translation + R7–R9 fidelity guard

> The crux. Build the deterministic detectors and guard **first and test-first** using the 18 red-team failure modes; the LLM route comes last and is the untrusted input. The guard's worst case is a false abstention (over-caution), never a silent error.

### Task M3.1: Medical lexicon

**Files:** Create `data/medical-lexicon.ts`, `data/medical-lexicon.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// data/medical-lexicon.test.ts
import { describe, it, expect } from 'vitest';
import { NEGATION_MARKERS, DOSE_UNITS, FREQUENCY_TOKENS, KNOWN_DRUGS, HIGH_RISK_PAIRS } from './medical-lexicon';

describe('medical lexicon', () => {
  it('has EN and ZH negation/uncertainty markers with strength ranks', () => {
    expect(NEGATION_MARKERS.length).toBeGreaterThan(30);
    const wujian = NEGATION_MARKERS.find((m) => m.marker === '未见')!;
    expect(wujian.polarity).toBe('absent');
    const cannot = NEGATION_MARKERS.find((m) => m.marker === 'cannot exclude')!;
    expect(cannot.polarity).toBe('uncertain');
    expect(cannot.strength).toBeGreaterThan(0);
  });
  it('treats mg and 毫克 as the same dose-unit dimension', () => {
    const mg = DOSE_UNITS.find((u) => u.token === 'mg')!;
    const haoke = DOSE_UNITS.find((u) => u.token === '毫克')!;
    expect(mg.dim).toBe(haoke.dim);
  });
  it('maps known drugs by generic/zh/pinyin/brand to one canonical id', () => {
    const metf = KNOWN_DRUGS.find((d) => d.id === 'metformin')!;
    expect(metf.forms).toEqual(expect.arrayContaining(['metformin', '二甲双胍', 'glucophage', '格华止']));
  });
  it('flags the benign/malignant and positive/negative high-risk pairs', () => {
    const keys = HIGH_RISK_PAIRS.flatMap((p) => [p.zh]);
    expect(keys).toEqual(expect.arrayContaining(['良性', '恶性', '阳性', '阴性']));
  });
});
```

- [ ] **Step 2: Run — verify fail.** Run: `npm test -- medical-lexicon` → Expected: FAIL.

- [ ] **Step 3: Implement** from the hardening workflow output (the full marker/drug/pair lists are in the workflow result; transcribe them). Shape:

```ts
// data/medical-lexicon.ts
export interface NegationMarker { marker: string; lang: 'en' | 'zh'; polarity: 'absent' | 'uncertain'; strength: number; } // strength: hedge ladder, higher = more certain
export interface DoseUnit { token: string; dim: string; } // dim: normalized dimension key, mg≡毫克
export interface KnownDrug { id: string; forms: string[]; } // all lowercased EN + ZH + pinyin(no tones) + brands
export interface HighRiskPair { zh: string; en: string; note: string; }

export const NEGATION_MARKERS: NegationMarker[] = [ /* EN + ZH from workflow: no/not/denies/无/未见/否认/阴性/排除 (absent), cannot exclude/考虑/提示/待排/不除外 (uncertain) with strengths */ ];
export const DOSE_UNITS: DoseUnit[] = [ /* {mg,毫克}→'mg'; {mL,毫升}→'mL'; {mcg,µg,微克}→'mcg'; {IU,U,国际单位}→'IU'; {片}→'tablet'; … */ ];
export const FREQUENCY_TOKENS: string[] = [ /* QD/BID/TID/PRN/每日一次/一日三次/睡前/饭后/顿服… */ ];
export const KNOWN_DRUGS: KnownDrug[] = [ /* 21 seed drugs from workflow, forms lowercased */ ];
export const HIGH_RISK_PAIRS: HighRiskPair[] = [ /* 12 pairs incl. 良性/恶性, 阳性/阴性, 高血压/低血压, 占位, 待排 */ ];
```

- [ ] **Step 4: Run — verify pass.** Run: `npm test -- medical-lexicon` → Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add data/medical-lexicon.ts data/medical-lexicon.test.ts
git commit -m "feat(v1): curated medical lexicon (negation/dose/freq/drugs/high-risk pairs)"
```

### Task M3.2: Immutable detectors

**Files:** Create `lib/notesDetect.ts`, `lib/notesDetect.test.ts`

Implements `detectImmutables(text, lang, lexicon)` per the workflow's three detector algorithms (clause-level scoped negation; dose multiset with mg≡毫克 normalization; two-pass drug match with suffix heuristics) plus bare-number extraction.

- [ ] **Step 1: Write failing tests** (unit-level, feeding the guard).

```ts
// lib/notesDetect.test.ts
import { describe, it, expect } from 'vitest';
import { detectImmutables, splitClauses } from './notesDetect';

describe('detectImmutables', () => {
  it('extracts a ZH prefix negation scoping the finding to its right', () => {
    const im = detectImmutables('未见肝内占位', 'zh');
    const neg = im.find((i) => i.type === 'negation')!;
    expect(neg.polarity).toBe('absent');
    expect(neg.finding).toContain('占位');
  });
  it('extracts a ZH suffix hedge (待排) scoping the finding to its left', () => {
    const im = detectImmutables('占位待排', 'zh');
    const neg = im.find((i) => i.type === 'negation')!;
    expect(neg.polarity).toBe('uncertain');
    expect(neg.finding).toContain('占位');
  });
  it('extracts a dose with amount + unit dimension + frequency', () => {
    const im = detectImmutables('二甲双胍 850mg 每日两次', 'zh');
    const dose = im.find((i) => i.type === 'dosage')!;
    expect(dose.amount).toBe('850');
    expect(dose.unitDim).toBe('mg');
    expect(dose.frequency).toBeTruthy();
  });
  it('normalizes 毫克 to the same unit dimension as mg', () => {
    const a = detectImmutables('500 毫克', 'zh').find((i) => i.type === 'dosage')!;
    const b = detectImmutables('500 mg', 'en').find((i) => i.type === 'dosage')!;
    expect(a.unitDim).toBe(b.unitDim);
  });
  it('extracts a dose range 1-2片', () => {
    const dose = detectImmutables('布洛芬 1-2片 需要时', 'zh').find((i) => i.type === 'dosage')!;
    expect(dose.range).toEqual({ min: '1', max: '2' });
  });
  it('resolves a known drug to its canonical id and detects unknown med tokens', () => {
    const known = detectImmutables('继续服用二甲双胍', 'zh').find((i) => i.type === 'drug')!;
    expect(known.drugId).toBe('metformin');
    const unknown = detectImmutables('服用恩美曲妥珠单抗', 'zh').find((i) => i.type === 'drug')!;
    expect(unknown.drugId).toBeNull();
  });
});
```

- [ ] **Step 2: Run — verify fail.** Run: `npm test -- notesDetect` → Expected: FAIL.

- [ ] **Step 3: Implement** `lib/notesDetect.ts` per the workflow's detector algorithms. Key functions: `splitClauses(text)` (split on `。.；;!?\n` + 但/而/及/和/,/and/but), longest-match marker scan, the dose regex `/(?<amount>\d+(?:[.,]\d+)?)(?:\s*[-~–]\s*(?<amax>\d+(?:[.,]\d+)?))?\s*(?<unit>…)/giu` with the DOSE_UNITS dimension map, a drug trie/alias map from `KNOWN_DRUGS.forms`, the unknown-drug suffix heuristics (`/(?:olol|pril|sartan|statin|cillin|mycin|azole|pine|prazole|gliptin|formin|dipine)$/i` and ZH 唑/平/林/汀/坦/普利 adjacency to a dose/freq token), and bare-number extraction with trailing unit. Normalize ZH digits (一二三十/半) to Arabic before compare.

- [ ] **Step 4: Run — verify pass.** Run: `npm test -- notesDetect` → Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/notesDetect.ts lib/notesDetect.test.ts
git commit -m "feat(v1): deterministic immutable detectors (negation/dose/drug/number)"
```

### Task M3.3: `notesGuard.evaluateSegment` (R7/R8/R9) — the 18 failure modes

**Files:** Create `lib/notesGuard.ts`, `lib/notesGuard.test.ts`

- [ ] **Step 1: Write the failing test — all 18 red-team cases.** Transcribe each FM from the hardening workflow as a case. Representative subset (write all 18):

```ts
// lib/notesGuard.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateSegment } from './notesGuard';

function seg(source: string, translated: string, kind = 'finding' as const) {
  return evaluateSegment({ sourceText: source, translatedText: translated, kind });
}
const ids = (o: { flags: { id: string }[] }) => o.flags.map((f) => f.id);

describe('notesGuard — R7/R8/R9', () => {
  it('FM-01 negation drop → flag', () => {
    const o = seg('胸片未见明显占位性病变。', 'Chest X-ray shows a space-occupying lesion.');
    expect(o.action).toBe('flag');
    expect(ids(o)).toContain('R7-NEGATION-POLARITY-MISMATCH');
  });
  it('FM-02 negation reversal (asserted→negated) → abstain', () => {
    const o = seg('活检提示恶性肿瘤细胞。', 'Biopsy shows no malignant tumor cells.');
    expect(o.action).toBe('abstain');
    expect(ids(o)).toContain('R7-NEGATION-POLARITY-MISMATCH');
  });
  it('FM-04 hedge weakening (cannot exclude→no evidence) → abstain', () => {
    const o = seg('Cannot exclude early interstitial lung disease.', '无间质性肺病证据。');
    expect(o.action).toBe('abstain');
    expect(ids(o)).toContain('R7-HEDGE-STRENGTH-WEAKENED');
  });
  it('FM-05 dose rounding 850→1000 → flag', () => {
    const o = seg('二甲双胍 850mg 每日两次。', 'Metformin 1000 mg twice daily.');
    expect(o.action).toBe('flag');
    expect(ids(o)).toContain('R8-DOSE-NOT-PRESERVED');
  });
  it('FM-06 unit swap mcg→毫克 → abstain', () => {
    const o = seg('Levothyroxine 50 mcg once daily.', '左甲状腺素 50 毫克 每日一次。');
    expect(o.action).toBe('abstain');
    expect(ids(o)).toContain('R8-DOSE-UNIT-DIMENSION-MISMATCH');
  });
  it('FM-11 drug look-alike substitution → abstain', () => {
    const o = seg('继续服用氯硝西泮。', 'Continue clonidine.');
    expect(o.action).toBe('abstain');
    expect(ids(o)).toContain('R9-DRUG-SUBSTITUTED');
  });
  it('FM-16 positive/negative flip → abstain', () => {
    const o = seg('乙肝表面抗原 阳性。', 'Hepatitis B surface antigen negative.');
    expect(o.action).toBe('abstain');
    expect(ids(o)).toContain('R9-RESULT-POLARITY-FLIP');
  });
  it('FM-17 mg≡毫克 true transliteration → render (NO false positive)', () => {
    const o = seg('阿莫西林 500 毫克 每日三次。', 'Amoxicillin 500 mg three times daily.');
    expect(o.action).toBe('render');
    expect(o.flags).toHaveLength(0);
  });
  it('FM-18 garbled source → abstain', () => {
    const o = seg('处方：▮▮▮ 0.█ mg ▮▮ 每日', 'Prescription: medication 0.5 mg twice daily.');
    expect(o.action).toBe('abstain');
    expect(ids(o)).toContain('R8-DOSE-SOURCE-UNPARSEABLE');
  });
  // … FM-03, 07, 08, 09, 10, 12, 13, 14, 15 transcribed identically from the workflow.
});
```

- [ ] **Step 2: Run — verify fail.** Run: `npm test -- notesGuard` → Expected: FAIL.

- [ ] **Step 3: Implement `lib/notesGuard.ts`** per the guard contract. `evaluateSegment(segment)`:
  1. Infer `sourceLang`/`outLang`; `detectImmutables` on source and output.
  2. **R7:** match (polarity, finding) pairs across sides by canonical finding (via HIGH_RISK_PAIRS + a finding-synonym map). Polarity flip, retarget, scope-break, or hedge descent → flag id per the contract; crossing present/absent boundary, compound/uncertain polarity, or a high-risk finding → **abstain**; in-band divergence on a non-high-risk finding → **flag**.
  3. **R8:** compare dose multiset (amount string + unitDim + frequency + range) and the bare-number multiset. Unit-dimension mismatch / ≥2× magnitude / unparseable source dose → **abstain**; rounding / dropped frequency / incomplete range / missing bare number → **flag**. Surface the original dose verbatim always.
  4. **R9:** drug sets by canonical id; substitution / altered-unknown / result-polarity flip → **abstain**; dropped salt/release qualifier → **flag**; HIGH_RISK_PAIRS present → non-blocking info flag.
  5. **Aggregate:** segment action = max severity (abstain > flag > render); abstain → `translated = ''`. Return `{ action, flags, preserved, original: segment.sourceText }`.

- [ ] **Step 4: Run — verify pass.** Run: `npm test -- notesGuard` → Expected: PASS (all 18).

- [ ] **Step 5: Commit.**

```bash
git add lib/notesGuard.ts lib/notesGuard.test.ts
git commit -m "feat(v1): notesGuard R7/R8/R9 — passes all 18 red-team failure modes"
```

### Task M3.4: Replace the `freeTextFlags` no-op

**Files:** Modify `lib/guard.ts`, `lib/guard.test.ts`

- [ ] **Step 1: Update the guard test** — `freeTextFlags` now delegates to a single-segment `notesGuard` evaluation (the v0 no-op test changes to assert a real flag on a dangerous string).

```ts
it('freeTextFlags surfaces a fidelity flag for a dropped negation', () => {
  const flags = freeTextFlags('未见占位', 'Mass present.');
  expect(flags.map((f) => f.id)).toContain('R7-NEGATION-POLARITY-MISMATCH');
});
```

- [ ] **Step 2: Implement** — in `lib/guard.ts`, replace the no-op:

```ts
import { evaluateSegment } from '@/lib/notesGuard';
export function freeTextFlags(source: string, translated: string): GuardFlag[] {
  return evaluateSegment({ sourceText: source, translatedText: translated, kind: 'other' }).flags;
}
```

- [ ] **Step 3: Run — verify pass.** Run: `npm test -- guard` → Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add lib/guard.ts lib/guard.test.ts
git commit -m "feat(v1): wire freeTextFlags to notesGuard (R7-R9 now live)"
```

### Task M3.5: Notes schema + grounding + LLM route

**Files:** Create `lib/notesSchema.ts`, `lib/notesGrounding.ts` (+ tests), `app/api/translate-notes/route.ts` (+ test)

- [ ] **Step 1: `lib/notesSchema.ts`** (Zod + prompt; test mirrors `extractionSchema.test.ts`).

```ts
import { z } from 'zod';
export const NoteSegmentSchema = z.object({
  sourceText: z.string(),
  translatedText: z.string(),
  kind: z.enum(['finding', 'medication', 'instruction', 'followup', 'other']),
});
export const NotesTranslationSchema = z.object({ segments: z.array(NoteSegmentSchema) });
export type NotesTranslation = z.infer<typeof NotesTranslationSchema>;
export const NOTES_PROMPT = [
  'Translate and simplify these doctor’s notes for a patient, segment by clause.',
  'Translate + simplify ONLY. Preserve every number, dose (amount + unit + frequency), negation, and drug name EXACTLY — do not round, convert, drop, or substitute any of them.',
  'Do NOT add a diagnosis, recommendation, or reassurance that is not in the source. Keep the source clause in sourceText and your plain translation in translatedText.',
].join(' ');
```

- [ ] **Step 2: `lib/notesGrounding.ts`** — `groundNotes(translation): GroundedNotes` runs `evaluateSegment` per segment, aggregates `overallAction`. Test with a mixed translation (one clean, one dropped-negation) asserting per-segment actions + overall.

- [ ] **Step 3: `app/api/translate-notes/route.ts`** — `runtime = 'nodejs'`; accept `{ text }`; call `getAnthropic().messages.parse` with `NotesTranslationSchema` + `NOTES_PROMPT`; return validated segments. Same key-server-only + generic-error discipline as `/api/extract`. Test with a mocked SDK (mirror `extract/route.test.ts`): success returns segments; throw → 502; empty text → 400.

- [ ] **Step 4: Run.** Run: `npm test -- notesSchema notesGrounding translate-notes` → Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add lib/notesSchema.ts lib/notesSchema.test.ts lib/notesGrounding.ts lib/notesGrounding.test.ts app/api/translate-notes/route.ts app/api/translate-notes/route.test.ts
git commit -m "feat(v1): notes schema + grounding + server translate route (mocked-SDK tests)"
```

### Task M3.6: Notes UI

**Files:** Create `lib/notesSummary.ts`, `components/NotesSection.tsx`; modify `components/CaptureCard.tsx`, `app/result/page.tsx`, `lib/session.ts`

- [ ] **Step 1:** `lib/notesSummary.ts` → `buildNotesView(notes, lang)` returning per-segment view rows (source always present; translation only when `action !== 'abstain'`; flags; pinned immutables as chips). Unit-test that an abstained segment yields `translated === ''` and shows the source.
- [ ] **Step 2:** `components/NotesSection.tsx` — renders the notes view: source clause always shown; the simplified translation beside it (or "shown as written; we can't safely simplify this one" for abstained); dose/drug/negation chips; the same calm flag callouts as labs (reuse classes).
- [ ] **Step 3:** Add a bilingual "What the doctor told you (optional) · 医生说了什么（可选）" textarea to `CaptureCard`; on submit, if non-empty, POST to `/api/translate-notes`, run `groundNotes`, store alongside the report in `lib/session.ts` (extend `PendingReport` to `{ report, notes? }`).
- [ ] **Step 4:** In `app/result/page.tsx`, render `<NotesSection>` above or below the lab cards when notes exist; include notes in the saved record (`lib/db.ts` `VisitRecord` gains optional `notes`).
- [ ] **Step 5: Verify in preview** with a sample (inject via the same technique used in Part A): a clean note renders translated; a dropped-negation note shows source-only with a flag.
- [ ] **Step 6: Commit.**

```bash
git add lib/notesSummary.ts lib/notesSummary.test.ts components/NotesSection.tsx components/CaptureCard.tsx app/result/page.tsx lib/session.ts lib/db.ts
git commit -m "feat(v1): doctor-notes capture + bilingual notes section with fidelity guard"
```

---

# Milestone M4 — The validation number

> Lives under `validation/`, run by Vitest/tsx, **not** bundled in the app. Measures medical-term fidelity and abstention precision/recall for **our pipeline vs a pluggable MT baseline** on a shared corpus.

### Task M4.1: Corpus types + seed cases

**Files:** Create `validation/types.ts`, `validation/corpus/index.ts` (+ a few `*.case.ts`), `validation/types.test.ts`

- [ ] **Step 1:** `validation/types.ts` — Zod `CorpusCase` exactly per the workflow's shape:

```ts
import { z } from 'zod';
export const CorpusCaseSchema = z.object({
  id: z.string(),
  lang: z.enum(['zh', 'en']),
  kind: z.enum(['labs', 'notes', 'mixed']),
  sourceText: z.string(),
  goldTranslation: z.string(),
  immutables: z.object({
    negations: z.array(z.string()),
    dosages: z.array(z.string()),
    drugs: z.array(z.object({ surface: z.string(), canonicalId: z.string() })),
    numbers: z.array(z.object({ value: z.string(), unit: z.string() })),
  }),
  shouldAbstain: z.boolean(),
  highStakes: z.boolean(),
  abstainReason: z.enum(['dropped_negation', 'dose_mismatch', 'drug_ambiguous', 'number_unit_mismatch', 'unit_conversion_ambiguous']).optional(),
});
export type CorpusCase = z.infer<typeof CorpusCaseSchema>;
```

- [ ] **Step 2:** Seed ~30–50 cases (synthetic + public samples) under `validation/corpus/`, each Zod-validated; include a documented `README.md` "drop-in slot" for real de-identified reports. A test validates every case against the schema and asserts ≥30 cases and that `highStakes` includes the dropped-negation / dose / drug / conversion-trap families.
- [ ] **Step 3: Run + Commit.** `npm test -- validation/types` → PASS.

```bash
git add validation/types.ts validation/types.test.ts validation/corpus/
git commit -m "feat(v1): validation corpus types + seed cases (real-data drop-in slot)"
```

### Task M4.2: Pluggable MT baseline

**Files:** Create `validation/baseline/MtBaseline.ts`, `offlineAdapter.ts`, `googleAdapter.ts`, `unguardedLlmAdapter.ts` (+ test)

- [ ] **Step 1:** `interface MtBaseline { id: string; translate(text: string, from: 'zh'|'en', to: 'zh'|'en'): Promise<string>; }`.
- [ ] **Step 2:** `offlineAdapter` — returns a recorded "baseline unavailable" sentinel so the harness runs without keys; `googleAdapter` — calls Google Cloud Translation when `GOOGLE_TRANSLATE_API_KEY` is set (else throws a clear error); `unguardedLlmAdapter` — Claude translate **without** the guard, to isolate the safety delta.
- [ ] **Step 3:** Test the offline adapter deterministically; test the others with mocked fetch/SDK.
- [ ] **Step 4: Commit.**

```bash
git add validation/baseline/
git commit -m "feat(v1): pluggable MtBaseline (offline + Google + unguarded-LLM adapters)"
```

### Task M4.3: Metrics

**Files:** Create `validation/metrics.ts`, `validation/metrics.test.ts`

- [ ] **Step 1: Write the failing test — the workflow's worked example.**

```ts
// validation/metrics.test.ts
import { describe, it, expect } from 'vitest';
import { medicalTermFidelity, abstentionPrecision, abstentionRecall } from './metrics';

// 3 cases, gold shouldAbstain = [true, true, false]
const gold = [
  { id: '1', shouldAbstain: true, highStakes: true, immutables: 2 },
  { id: '2', shouldAbstain: true, highStakes: true, immutables: 3 },
  { id: '3', shouldAbstain: false, highStakes: false, immutables: 1 },
];

describe('abstention metrics (ours vs baseline)', () => {
  it('ours: abstains on 1 and 2, emits 3 → precision 1.0, recall 1.0', () => {
    const ours = [
      { id: '1', abstained: true, matchedImmutables: 0, emitted: false },
      { id: '2', abstained: true, matchedImmutables: 0, emitted: false },
      { id: '3', abstained: false, matchedImmutables: 1, emitted: true },
    ];
    expect(abstentionPrecision(ours, gold)).toBe(1);
    expect(abstentionRecall(ours, gold)).toBe(1);
    expect(medicalTermFidelity(ours, gold)).toBe(1); // term-weighted over emitted cases (case 3): 1/1
  });
  it('baseline emits everything → recall 0.0, fidelity 5/6 ≈ 0.83', () => {
    const base = [
      { id: '1', abstained: false, matchedImmutables: 1, emitted: true }, // dropped negation: 1/2
      { id: '2', abstained: false, matchedImmutables: 3, emitted: true },
      { id: '3', abstained: false, matchedImmutables: 1, emitted: true },
    ];
    expect(abstentionRecall(base, gold)).toBe(0);
    expect(medicalTermFidelity(base, gold)).toBeCloseTo(5 / 6, 3);
  });
});
```

- [ ] **Step 2: Run — verify fail.** Run: `npm test -- validation/metrics` → Expected: FAIL.

- [ ] **Step 3: Implement** the three formulas exactly per the workflow definitions (term-weighted fidelity over emitted cases only; precision `|A∩G|/|A|`; recall `|A∩G|/|G|`; undefined → `NaN`/`N/A`, never 1.0; report highStakes-subset recall separately).

- [ ] **Step 4: Run — verify pass.** Run: `npm test -- validation/metrics` → Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add validation/metrics.ts validation/metrics.test.ts
git commit -m "feat(v1): validation metrics — fidelity + abstention precision/recall"
```

### Task M4.4: Runner + report + review harness

**Files:** Create `validation/run.ts`, `validation/review/export.ts`, `validation/review/import.ts`

- [ ] **Step 1:** `validation/run.ts` — for each corpus case: run **our** pipeline (notes → `groundNotes`; labs → `groundExtraction`) and **each** baseline; score with `metrics.ts`; emit `validation/report.md` + `report.json` comparing ours vs baseline (fidelity, abstention precision/recall, highStakes recall, error analysis by failure type). Add an `npm run validate` script.
- [ ] **Step 2:** `validation/review/export.ts` — emit cases needing human verdicts to a CSV/JSON; `import.ts` — fold clinician/bilingual verdicts back into the corpus gold labels. Document the workflow in `validation/README.md`.
- [ ] **Step 3:** Smoke-test `run.ts` over a 2–3 case fixture (offline baseline) asserting it produces a report object; mark highStakes recall < 1.0 as a non-zero exit (release blocker).
- [ ] **Step 4: Commit.**

```bash
git add validation/run.ts validation/review/ validation/README.md package.json
git commit -m "feat(v1): validation runner + comparison report + clinician review harness"
```

---

# Milestone M5 — Mode 2 architecture sketch (no code tasks)

**Files:** Create `docs/superpowers/specs/2026-06-22-mode2-architecture.md`

- [ ] **Step 1:** Write the sketch (interfaces + sequencing, not implementation):
  - **Pipeline:** `AsrProvider` (streaming speech→text, multilingual) → segment → `translate(+confidence)` → **reuse `notesGuard.evaluateSegment`** for immutable fidelity + an "I'm unsure — confirm this" realtime uncertainty surface → `TtsProvider` / captions → append to the same on-device visit record.
  - **Interfaces (defined, not built):** `AsrProvider { start(stream): AsyncIterable<AsrSegment> }`, `TtsProvider { speak(text, lang): Promise<void> }`, a `LiveSession` state model, a realtime abstention/confirm UX, latency budget + on-device/privacy considerations (move the fast path on-device later).
  - **Reuse map:** notesGuard, the disclaimer/safety spine, the bilingual rendering, the record store.
  - **Sequencing & risk:** ASR/TTS provider selection, streaming latency, the realtime guard's "abstain" UX (you can't un-say audio — design the confirm-before-speak gate), and that full Mode 2 is its own brainstorm→plan cycle.
- [ ] **Step 2: Commit.**

```bash
git add docs/superpowers/specs/2026-06-22-mode2-architecture.md
git commit -m "docs(v1): Mode 2 architecture sketch (interfaces + sequencing)"
```

---

## Self-review (spec coverage)

- **Doctor-notes translation + R7–R9** → M3 (lexicon, detectors, notesGuard with all 18 FMs, schema/route, grounding, UI); replaces the `freeTextFlags` no-op. ✅
- **Constrained-translate + deterministic guard + immutable preservation** → notesGuard recomputes immutables from source, abstains/flags on mismatch, source always shown; LLM never decides safety. ✅
- **Unit auto-conversion** → M2 (`unit-conversions`, `convert`, R2b integration); abstain-traps (urea/BUN, creatinine µmol/L, calcium, uric acid scale) deliberately excluded → R2 abstain unchanged. ✅
- **Expanded reference table + sex/age provenance** → M1 (≥80 analytes, `ageBands`, age-aware `resolveBounds`/`classify`/`guard`, integrity tests). ✅
- **The validation number vs MT baseline** → M4 (corpus + real-data slot, pluggable `MtBaseline` with Google + offline + unguarded-LLM, metrics with the worked example, runner/report, clinician review). ✅
- **Mode 2** → M5 sketch only, reusing notesGuard + the safety spine. ✅
- **Safety invariants preserved** → LLM never assigns ranges/classifications; notes fidelity deterministic; conversion only when curated+unambiguous; high-stakes/uncertain → confirm-with-clinician; PHI on-device; every deterministic unit TDD'd; LLM routes mock the SDK. ✅

**Type consistency:** `AgeBand`, `Immutable`, `NoteSegment`/`SegmentKind`/`SegmentAction`, `GroundedSegment`, `GroundedNotes` defined once in Task 0 and used across M1/M3. `resolveBounds(entry, sex, age?)`, `classify(valueNum, entry, sex, age?)`, `evaluateRow(extracted, entry, valueNum, classification, sex, age?)`, `groundExtraction(extraction, sex, age?)`, `convertValue(value, fromUnit, entry)`, `evaluateSegment(segment)`, `groundNotes(translation)`, `freeTextFlags(source, translated)`, `CorpusCase`, `MtBaseline`, `medicalTermFidelity/abstentionPrecision/abstentionRecall` are named consistently throughout. Flag ids (`R2b-UNIT-CONVERTED`, `R7-*`, `R8-*`, `R9-*`) are stable across guard, tests, and metrics.

**Milestones are independently shippable** and ordered M1 → M2 → M3 → M4 → M5; M4 measures M1–M3; M5 reuses M3. No safety invariant from §3 of the spec is weakened by any task.
