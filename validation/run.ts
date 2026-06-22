// Validation runner (M4.4).
//
// For each corpus case: run OUR guarded pipeline and each pluggable baseline,
// score with metrics.ts, and emit a comparison report (report.md + report.json).
// Runs FULLY OFFLINE by default (offline baseline + fixture candidate
// translations); real MT/LLM baselines are key-gated and opt-in.
//
// NOT imported by the app — run only via `npm run validate` (tsx) and Vitest.

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CorpusCase } from './types';
import { totalImmutables } from './types';
import { CORPUS } from './corpus';
import {
  medicalTermFidelity,
  abstentionPrecision,
  abstentionRecall,
  type CaseResult,
  type GoldCase,
} from './metrics';
import { countMatchedImmutables } from './score';
import { BASELINE_UNAVAILABLE, type Lang, type MtBaseline } from './baseline/MtBaseline';
import { offlineAdapter } from './baseline/offlineAdapter';

import { groundNotes } from '@/lib/notesGrounding';
import { groundExtraction } from '@/lib/grounding';

// --- OURS: run a single corpus case through the guarded pipeline -------------
function runOursOnCase(c: CorpusCase): CaseResult {
  const candidate = c.candidateTranslation ?? c.goldTranslation;

  if (c.kind === 'labs') {
    // Drive the labs grounding path. The case's number immutable carries the
    // printed value+unit; the analyte name is read from the source line.
    const num = c.immutables.numbers[0];
    const name = c.sourceText.split(/\s+/)[0] ?? c.sourceText;
    const grounded = groundExtraction(
      {
        rows: [
          {
            name,
            value: num ? num.value : null,
            unit: num ? num.unit : null,
            printedRange: null,
            confidence: 'high',
          },
        ],
      },
      'unknown',
    );
    const row = grounded.rows[0];
    const abstained = row.action === 'abstain';
    return {
      id: c.id,
      abstained,
      emitted: !abstained,
      // For an emitted lab row the value survives (we display it verbatim);
      // an abstained row shows the source only, so nothing is "translated".
      matchedImmutables: abstained ? 0 : countMatchedImmutables(c, c.sourceText),
    };
  }

  // Notes / mixed → run the deterministic fidelity guard over the candidate.
  const grounded = groundNotes({
    segments: [{ sourceText: c.sourceText, translatedText: candidate, kind: 'other' }],
  });
  const abstained = grounded.overallAction === 'abstain';
  // When abstained the translation is blanked; nothing is emitted to score.
  const emittedText = abstained
    ? ''
    : grounded.segments.map((s) => s.translated).join(' ');
  return {
    id: c.id,
    abstained,
    emitted: !abstained,
    matchedImmutables: abstained ? 0 : countMatchedImmutables(c, emittedText),
  };
}

// --- BASELINE: translate the source, score the raw output (never abstains) ---
async function runBaselineOnCase(c: CorpusCase, baseline: MtBaseline): Promise<CaseResult> {
  const to: Lang = c.lang === 'zh' ? 'en' : 'zh';
  let translation: string;
  try {
    translation = await baseline.translate(c.sourceText, c.lang, to);
  } catch {
    // A misconfigured key-gated baseline contributes nothing (non-emission).
    return { id: c.id, abstained: false, emitted: false, matchedImmutables: 0 };
  }
  if (translation === BASELINE_UNAVAILABLE) {
    // Offline sentinel: no real translation → non-emission, scores 0 fidelity.
    return { id: c.id, abstained: false, emitted: false, matchedImmutables: 0 };
  }
  return {
    id: c.id,
    abstained: false, // a raw MT baseline never abstains
    emitted: true,
    matchedImmutables: countMatchedImmutables(c, translation),
  };
}

export interface PipelineScore {
  id: string;
  fidelity: number;
  abstentionPrecision: number;
  abstentionRecall: number;
  highStakesRecall: number;
  results: CaseResult[];
}

export interface ErrorAnalysisRow {
  caseId: string;
  abstainReason: string | undefined;
  highStakes: boolean;
  oursAbstained: boolean;
  baselineAbstained: boolean;
  // A highStakes gold-abstain case that OURS failed to abstain on.
  oursMissedHighStakes: boolean;
}

export interface ValidationReport {
  generatedAt: string;
  caseCount: number;
  gold: GoldCase[];
  ours: PipelineScore;
  baselines: PipelineScore[];
  errorAnalysis: ErrorAnalysisRow[];
  // True when OURS missed any highStakes gold-abstain case (release blocker).
  releaseBlocker: boolean;
}

function toGold(cases: CorpusCase[]): GoldCase[] {
  return cases.map((c) => ({
    id: c.id,
    shouldAbstain: c.shouldAbstain,
    highStakes: c.highStakes,
    immutables: totalImmutables(c),
  }));
}

function scorePipeline(id: string, results: CaseResult[], gold: GoldCase[]): PipelineScore {
  return {
    id,
    fidelity: medicalTermFidelity(results, gold),
    abstentionPrecision: abstentionPrecision(results, gold),
    abstentionRecall: abstentionRecall(results, gold),
    highStakesRecall: abstentionRecall(results, gold, { highStakesOnly: true }),
    results,
  };
}

/**
 * Run OURS + each baseline over `cases`, returning a structured comparison
 * report. Pure (no file I/O), so the smoke test can assert on the object.
 */
export async function runValidation(
  cases: CorpusCase[] = CORPUS,
  baselines: MtBaseline[] = [offlineAdapter],
): Promise<ValidationReport> {
  const gold = toGold(cases);

  const oursResults = cases.map(runOursOnCase);
  const ours = scorePipeline('ours', oursResults, gold);

  const baselineScores: PipelineScore[] = [];
  for (const baseline of baselines) {
    const results: CaseResult[] = [];
    for (const c of cases) results.push(await runBaselineOnCase(c, baseline));
    baselineScores.push(scorePipeline(baseline.id, results, gold));
  }

  const oursById = new Map(oursResults.map((r) => [r.id, r]));
  const primaryBaseline = baselineScores[0];
  const baseById = new Map((primaryBaseline?.results ?? []).map((r) => [r.id, r]));

  const errorAnalysis: ErrorAnalysisRow[] = cases.map((c) => {
    const o = oursById.get(c.id);
    const b = baseById.get(c.id);
    const oursMissedHighStakes =
      c.shouldAbstain && c.highStakes && o?.abstained !== true;
    return {
      caseId: c.id,
      abstainReason: c.abstainReason,
      highStakes: c.highStakes,
      oursAbstained: o?.abstained ?? false,
      baselineAbstained: b?.abstained ?? false,
      oursMissedHighStakes,
    };
  });

  const releaseBlocker = errorAnalysis.some((e) => e.oursMissedHighStakes);

  return {
    generatedAt: new Date().toISOString(),
    caseCount: cases.length,
    gold,
    ours,
    baselines: baselineScores,
    errorAnalysis,
    releaseBlocker,
  };
}

// --- Report rendering -------------------------------------------------------
function fmt(n: number): string {
  return Number.isNaN(n) ? 'N/A' : n.toFixed(3);
}

export function renderMarkdown(report: ValidationReport): string {
  const lines: string[] = [];
  lines.push('# Validation report — guarded pipeline vs MT baseline');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Cases: ${report.caseCount}`);
  lines.push('');
  lines.push('> Synthetic / public-style corpus — no real PHI. See `validation/corpus/README.md`.');
  lines.push('');
  lines.push('## Scores');
  lines.push('');
  lines.push('| Pipeline | Medical-term fidelity | Abstention precision | Abstention recall | High-stakes recall |');
  lines.push('| --- | --- | --- | --- | --- |');
  const row = (s: PipelineScore) =>
    `| ${s.id} | ${fmt(s.fidelity)} | ${fmt(s.abstentionPrecision)} | ${fmt(s.abstentionRecall)} | ${fmt(s.highStakesRecall)} |`;
  lines.push(row(report.ours));
  for (const b of report.baselines) lines.push(row(b));
  lines.push('');
  lines.push('Fidelity is term-weighted over emitted cases only. Abstention precision/recall');
  lines.push('are reported as N/A (never 1.0) when their denominator is empty.');
  lines.push('');
  lines.push('## High-stakes release gate');
  lines.push('');
  lines.push(
    report.releaseBlocker
      ? '**BLOCKED** — OURS failed to abstain on at least one high-stakes gold-abstain case.'
      : 'PASS — OURS abstained on every high-stakes gold-abstain case (recall 1.0).',
  );
  lines.push('');
  lines.push('## Error analysis');
  lines.push('');
  lines.push('| Case | Reason | High-stakes | OURS abstained | Baseline abstained | OURS missed high-stakes |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const e of report.errorAnalysis) {
    lines.push(
      `| ${e.caseId} | ${e.abstainReason ?? '—'} | ${e.highStakes ? 'yes' : 'no'} | ${
        e.oursAbstained ? 'yes' : 'no'
      } | ${e.baselineAbstained ? 'yes' : 'no'} | ${e.oursMissedHighStakes ? '**YES**' : 'no'} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

// --- CLI entrypoint (`npm run validate`) ------------------------------------
async function main(): Promise<void> {
  // Allow a baseline override via VALIDATE_BASELINE (offline | google | unguarded-llm).
  const baselines: MtBaseline[] = [offlineAdapter];
  const which = process.env.VALIDATE_BASELINE;
  if (which === 'google') {
    const { googleAdapter } = await import('./baseline/googleAdapter');
    baselines.push(googleAdapter);
  } else if (which === 'unguarded-llm') {
    const { unguardedLlmAdapter } = await import('./baseline/unguardedLlmAdapter');
    baselines.push(unguardedLlmAdapter);
  }

  const report = await runValidation(CORPUS, baselines);

  const here = dirname(fileURLToPath(import.meta.url));
  writeFileSync(join(here, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(here, 'report.md'), renderMarkdown(report));

  console.log(renderMarkdown(report));

  // High-stakes recall < 1.0 is a release blocker → non-zero exit.
  if (report.releaseBlocker) {
    console.error('\nRELEASE BLOCKER: high-stakes abstention recall < 1.0');
    process.exit(1);
  }
}

// Run only when invoked directly (not when imported by the smoke test).
const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
