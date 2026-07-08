import { describe, it, expect } from 'vitest';
import { runValidation, renderMarkdown } from './run';
import { offlineAdapter } from './baseline/offlineAdapter';
import type { CorpusCase } from './types';
import { CHECKLIST } from './checklist/index';
import { runBehavioralCase } from './checklist/run';

// A 3-case fixture mirroring the worked example shape: two should-abstain
// (high-stakes) notes cases the guard genuinely abstains on, and one faithful
// case it renders. Run fully offline (offline baseline).
const FIXTURE: CorpusCase[] = [
  {
    id: 'fx-1-reversed-mass',
    lang: 'zh',
    kind: 'notes',
    sourceText: '超声提示占位性病变。',
    goldTranslation: 'Ultrasound suggests a space-occupying lesion.',
    immutables: { negations: ['占位 present'], dosages: [], drugs: [], numbers: [] },
    shouldAbstain: true,
    highStakes: true,
    abstainReason: 'dropped_negation',
    candidateTranslation: 'Ultrasound shows no space-occupying lesion.',
  },
  {
    id: 'fx-2-unit-swap',
    lang: 'en',
    kind: 'notes',
    sourceText: 'Levothyroxine 50 mcg once daily.',
    goldTranslation: '左甲状腺素 50 微克 每日一次。',
    immutables: {
      negations: [],
      dosages: ['50 mcg'],
      drugs: [{ surface: 'levothyroxine', canonicalId: 'levothyroxine' }],
      numbers: [{ value: '50', unit: 'mcg' }],
    },
    shouldAbstain: true,
    highStakes: true,
    abstainReason: 'number_unit_mismatch',
    candidateTranslation: '左甲状腺素 50 毫克 每日一次。',
  },
  {
    id: 'fx-3-faithful',
    lang: 'zh',
    kind: 'notes',
    sourceText: '阿莫西林 500 毫克 每日三次。',
    goldTranslation: 'Amoxicillin 500 mg three times daily.',
    immutables: {
      negations: [],
      dosages: ['500 毫克'],
      drugs: [{ surface: '阿莫西林', canonicalId: 'amoxicillin' }],
      numbers: [{ value: '500', unit: 'mg' }],
    },
    shouldAbstain: false,
    highStakes: false,
    candidateTranslation: 'Amoxicillin 500 mg three times daily.',
  },
];

describe('runValidation (offline smoke test)', () => {
  it('produces a structured report object over a small fixture', async () => {
    const report = await runValidation(FIXTURE, [offlineAdapter]);

    expect(report.caseCount).toBe(3);
    expect(report.ours.id).toBe('ours');
    expect(report.baselines).toHaveLength(1);
    expect(report.baselines[0].id).toBe('offline');
    expect(report.errorAnalysis).toHaveLength(3);
  });

  it('OURS abstains on both high-stakes cases and emits the faithful one', async () => {
    const report = await runValidation(FIXTURE, [offlineAdapter]);
    const byId = new Map(report.ours.results.map((r) => [r.id, r]));

    expect(byId.get('fx-1-reversed-mass')!.abstained).toBe(true);
    expect(byId.get('fx-2-unit-swap')!.abstained).toBe(true);
    expect(byId.get('fx-3-faithful')!.abstained).toBe(false);
    expect(byId.get('fx-3-faithful')!.emitted).toBe(true);
  });

  it('OURS scores precision/recall/highStakesRecall = 1.0 and fidelity 1.0', async () => {
    const report = await runValidation(FIXTURE, [offlineAdapter]);
    expect(report.ours.abstentionPrecision).toBe(1);
    expect(report.ours.abstentionRecall).toBe(1);
    expect(report.ours.highStakesRecall).toBe(1);
    // The one emitted case (faithful) preserves all 3 immutables → fidelity 1.0.
    expect(report.ours.fidelity).toBe(1);
  });

  it('the offline baseline is a non-emission: no abstention, NaN fidelity', async () => {
    const report = await runValidation(FIXTURE, [offlineAdapter]);
    const base = report.baselines[0];
    // Offline never abstains and never emits → recall over gold-abstain is 0,
    // and fidelity has no emitted case so it is N/A (NaN).
    expect(base.abstentionRecall).toBe(0);
    expect(Number.isNaN(base.fidelity)).toBe(true);
    expect(base.results.every((r) => !r.emitted && !r.abstained)).toBe(true);
  });

  it('marks no release blocker when high-stakes recall is 1.0', async () => {
    const report = await runValidation(FIXTURE, [offlineAdapter]);
    expect(report.releaseBlocker).toBe(false);
    expect(report.ours.highStakesRecall).toBe(1);
  });

  it('flags a release blocker when OURS misses a high-stakes gold-abstain case', async () => {
    // A high-stakes should-abstain case whose candidate is FAITHFUL — the guard
    // renders it, so OURS fails to abstain → release blocker.
    const leaky: CorpusCase = {
      ...FIXTURE[0],
      id: 'fx-leaky',
      candidateTranslation: 'Ultrasound suggests a space-occupying lesion.',
    };
    const report = await runValidation([leaky], [offlineAdapter]);
    expect(report.ours.highStakesRecall).toBeLessThan(1);
    expect(report.releaseBlocker).toBe(true);
  });

  it('renders a markdown report with the scores table and release gate', async () => {
    const report = await runValidation(FIXTURE, [offlineAdapter]);
    const md = renderMarkdown(report);
    expect(md).toContain('# Validation report');
    expect(md).toContain('Medical-term fidelity');
    expect(md).toContain('| ours |');
    expect(md).toContain('High-stakes release gate');
    expect(md).toContain('PASS');
  });
});

describe('report + checklist gate', () => {
  it('report renders all four metric families + the checklist table', async () => {
    const report = await runValidation();
    const md = renderMarkdown(report);
    expect(md).toContain('Severity-weighted fidelity'); // corpus (real)
    expect(md).toContain('Risk–coverage');              // corpus point + demo curve/AURC
    expect(md).toContain('Calibration');                // ECE demo
    expect(md).toContain('Inter-rater agreement');      // agreement demo
    expect(md).toContain('CheckList behavioral suite');
    expect(report.ours.severityWeightedFidelity).toBeDefined();
    expect(report.ours.coverage.coverage).toBeGreaterThanOrEqual(0);
  });

  it('checklistRegression is false when every behavioral case passes', () => {
    const failed = CHECKLIST.map(runBehavioralCase).filter((r) => !r.pass);
    expect(failed).toHaveLength(0);
  });
});
