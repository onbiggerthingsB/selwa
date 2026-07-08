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

import { severityWeightedFidelity, type SeverityEntry } from './severity';
import { riskCoveragePoint, riskCoverageCurve, aurc, type SelectiveCase, type CoveragePoint } from './coverage';
import { reliabilityBins, expectedCalibrationError } from './calibration';
import { agreementStats } from './agreement';
import { CALIBRATION_DEMO } from './calibration-demo';
import { AGREEMENT_DEMO } from './agreement-demo';
import { CHECKLIST } from './checklist/index';
import { runBehavioralCase, type CaseResult as ChecklistResult } from './checklist/run';
import { renderChecklist } from './checklist/render';

// A single OURS run: the scored CaseResult plus the exact string scored for
// immutable survival ('' when abstained). The candidate is threaded out so the
// severity-weighted fidelity (severity.ts) scores the SAME string as the primary
// term-weighted fidelity — labs → sourceText, notes → emittedText.
interface OursRun {
  result: CaseResult;
  candidate: string;
}

// --- OURS: run a single corpus case through the guarded pipeline -------------
function runOursOnCase(c: CorpusCase): OursRun {
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
    // For an emitted lab row the value survives (we display it verbatim); an
    // abstained row shows the source only, so nothing is "translated".
    const scored = abstained ? '' : c.sourceText;
    return {
      result: {
        id: c.id,
        abstained,
        emitted: !abstained,
        matchedImmutables: abstained ? 0 : countMatchedImmutables(c, c.sourceText),
      },
      candidate: scored,
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
    result: {
      id: c.id,
      abstained,
      emitted: !abstained,
      matchedImmutables: abstained ? 0 : countMatchedImmutables(c, emittedText),
    },
    candidate: emittedText,
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
  // MQM severity-weighted fidelity + risk-coverage operating point (OURS only;
  // baselines leave these NaN since they never abstain).
  severityWeightedFidelity: number;
  coverage: CoveragePoint;
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
  // CheckList behavioral-suite results + whether any safety-bearing (MFT/DIR) case failed.
  checklistResults: ChecklistResult[];
  checklistRegression: boolean;
  // True when OURS missed any highStakes gold-abstain case OR a CheckList safety case failed.
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
    severityWeightedFidelity: NaN, // OURS overwrites this in runValidation
    coverage: { coverage: NaN, selectiveRisk: NaN },
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

  const oursRuns = cases.map(runOursOnCase);
  const oursResults = oursRuns.map((r) => r.result);
  const ours = scorePipeline('ours', oursResults, gold);

  // MQM severity-weighted fidelity + the risk-coverage operating point (OURS).
  const severityEntries: SeverityEntry[] = cases.map((c, i) => ({
    case: c,
    emitted: oursResults[i].emitted,
    candidate: oursRuns[i].candidate,
  }));
  const selective: SelectiveCase[] = oursResults.map((r, i) => ({
    emitted: r.emitted,
    // emitted but wrong: dropped ≥1 immutable, or emitted where gold said abstain
    error: r.emitted && (r.matchedImmutables < totalImmutables(cases[i]) || cases[i].shouldAbstain),
  }));
  ours.severityWeightedFidelity = severityWeightedFidelity(severityEntries);
  ours.coverage = riskCoveragePoint(selective);

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

  // CheckList behavioral suite — a failing safety-bearing (MFT/DIR) case blocks release.
  const checklistResults = CHECKLIST.map(runBehavioralCase);
  const checklistRegression = checklistResults.some(
    (r) => !r.pass && (r.testType === 'MFT' || r.testType === 'DIR'),
  );

  const releaseBlocker =
    errorAnalysis.some((e) => e.oursMissedHighStakes) || checklistRegression;

  return {
    generatedAt: new Date().toISOString(),
    caseCount: cases.length,
    gold,
    ours,
    baselines: baselineScores,
    errorAnalysis,
    checklistResults,
    checklistRegression,
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

  // --- MQM severity-weighted fidelity (corpus, real) ---
  lines.push('## Severity-weighted fidelity (MQM, corpus)');
  lines.push('');
  lines.push(
    `OURS: ${fmt(report.ours.severityWeightedFidelity)} — a missed Critical immutable ` +
      `(flipped negation / altered dose / substituted drug / dropped high-stakes number) collapses the score.`,
  );
  lines.push('');

  // --- Risk–coverage: corpus operating point (real) + advisory-signal curve (demonstration) ---
  const demoCurve = riskCoverageCurve(CALIBRATION_DEMO.map((c) => ({ score: c.score, error: !c.correct })));
  lines.push('## Risk–coverage (selective prediction)');
  lines.push('');
  lines.push(
    `OURS operating point (corpus): coverage ${fmt(report.ours.coverage.coverage)}, ` +
      `selective risk ${fmt(report.ours.coverage.selectiveRisk)}. Abstaining lowers risk at the cost of coverage.`,
  );
  lines.push(`Advisory-signal curve (demonstration): AURC ${fmt(aurc(demoCurve))} over ${demoCurve.length} points.`);
  lines.push('');

  // --- Calibration of the advisory confidence signal (demonstration) ---
  lines.push('## Calibration of the advisory confidence signal (demonstration)');
  lines.push('');
  lines.push(
    `ECE ${fmt(expectedCalibrationError(CALIBRATION_DEMO, 10))} over ${CALIBRATION_DEMO.length} labelled points ` +
      `— the deterministic guard is NOT gated on this signal; this quantifies why (model confidence is miscalibrated).`,
  );
  lines.push('');
  lines.push('| score bin | mean score | accuracy | n |');
  lines.push('| --- | --- | --- | --- |');
  for (const b of reliabilityBins(CALIBRATION_DEMO, 5)) {
    if (b.count === 0) continue;
    lines.push(`| ${b.lo.toFixed(1)}–${b.hi.toFixed(1)} | ${fmt(b.meanScore)} | ${fmt(b.accuracy)} | ${b.count} |`);
  }
  lines.push('');

  // --- Inter-rater agreement (demonstration; paradox-resistant) ---
  const ag = agreementStats(AGREEMENT_DEMO);
  lines.push('## Inter-rater agreement (demonstration; paradox-resistant)');
  lines.push('');
  lines.push(
    `raw ${fmt(ag.rawAgreement)}, prevalence ${fmt(ag.prevalence)}, ` +
      `Cohen's κ ${fmt(ag.cohensKappa)}, Gwet's AC1 ${fmt(ag.gwetAC1)}, PABAK ${fmt(ag.pabak)}. ` +
      `On a skewed abstain/normal split κ deflates (the kappa paradox) while AC1/PABAK hold — report all four, never κ alone.`,
  );
  lines.push('');

  // --- CheckList behavioral suite ---
  lines.push(renderChecklist(report.checklistResults));

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

  // A release blocker fires on a missed high-stakes abstention OR a CheckList safety regression.
  if (report.releaseBlocker) {
    if (report.checklistRegression) {
      console.error('\nRELEASE BLOCKER: CheckList safety regression (an MFT/DIR case failed).');
    }
    if (report.errorAnalysis.some((e) => e.oursMissedHighStakes)) {
      console.error('\nRELEASE BLOCKER: high-stakes abstention recall < 1.0');
    }
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
