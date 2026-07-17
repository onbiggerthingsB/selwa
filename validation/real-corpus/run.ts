// Run: npx tsx validation/real-corpus/run.ts
// Grounding-on-real-content measurement, side by side:
//   • MedRepBench (Chinese lab-report images, SI units) — the original stress corpus
//   • MIMIC-IV demo (real US hospital labs, conventional units) — the BEACHHEAD corpus
// Each: the deterministic pipeline (groundExtraction → classify → guard), image-free, no API.
// Coverage work develops on TRAIN and is gated on HELD-OUT (which it never sees).
import { MEDREPBENCH_SAMPLE } from './sample';
import { MIMIC_US_SAMPLE } from './us-sample';
import { splitCorpus } from './corpus';
import { scoreRealCorpus, type RealCorpusSummary } from './realContentBench';
import type { RealReport } from './sample';

const pct = (n: number) => (Number.isNaN(n) ? 'N/A' : `${(n * 100).toFixed(1)}%`);

// B1 HEADLINE — what the user actually sees. (The old headline scored our INTERNAL
// classification, which under B1 nobody reads; it was blind to the chip-frame bug.)
function line(label: string, s: RealCorpusSummary): void {
  console.log(
    `${label.padEnd(9)} rows ${String(s.items).padStart(4)} · ` +
      `CHIP ${pct(s.chipCoverage).padStart(6)} (${s.chipReproduced} reproduced / ${s.chipDeferred} defer) · ` +
      `R6 ${pct(s.r6Coverage).padStart(6)} (${s.highStakesConfirmed}/${s.highStakesRows} high-stakes confirmed)`,
  );
}

// Internal guard-health — demoted: validates the guards' INPUTS, no longer the safety gate.
// The real gates are tests: b1VerdictLeakage (no verdict surfaces) + chipFidelity (chip matches
// the report's own frame).
function internalLine(label: string, s: RealCorpusSummary): void {
  console.log(
    `${label.padEnd(9)} recog ${pct(s.recognized / s.items).padStart(6)} · abstain ${pct(s.abstainRate).padStart(6)} · ` +
      `confirm ${pct(s.confirmRate).padStart(6)} · agree ${pct(s.confidentAgreement).padStart(6)} (n=${s.confidentScored}, wrong ${s.confidentlyWrong.length})`,
  );
}

function report(title: string, corpus: RealReport[]): RealCorpusSummary {
  const all = scoreRealCorpus(corpus);
  const { train, heldout } = splitCorpus(corpus);
  console.log(`\n=== ${title} ===`);
  line('combined', all);
  line('  train', scoreRealCorpus(train));
  line('  heldout', scoreRealCorpus(heldout));
  console.log('  — internal guard-health (not the gate) —');
  internalLine('combined', all);
  const reasons = Object.entries(all.abstainByReason).sort((a, b) => b[1] - a[1]);
  console.log('  abstain: ' + reasons.map(([k, v]) => `${v} ${k.replace(/^R\d+-|-VALUE$/g, '').toLowerCase()}`).join(' · '));
  return all;
}

console.log('\nGrounding on REAL content — Prove-the-Number, Half A (image-free, no API)');
report('MedRepBench — Chinese reports, SI units (stress corpus)', MEDREPBENCH_SAMPLE);
const us = report('MIMIC-IV demo — real US hospital labs, conventional units (BEACHHEAD)', MIMIC_US_SAMPLE);

if (us.confidentlyWrong.length) {
  console.log('\n⚠ confidently-wrong on US data (safety gate):');
  for (const d of us.confidentlyWrong) console.log(`  ${d.name} ${d.value} ${d.unit} ours=${d.ourClass} report=${d.datasetFlag}`);
} else {
  console.log('\n✓ US safety gate: 0 confidently-wrong rows (disagreements are all confirm-flagged).');
}
console.log('');
