// Run: npx tsx validation/real-corpus/run.ts
// Grounding-on-real-content measurement over the MedRepBench sample (Prove-the-Number, A).
// Reports the combined baseline + the deterministic train / held-out split. Coverage work
// (Step 2) is developed on TRAIN and gated on HELD-OUT (which it never sees) so it can't
// overfit. Point MEDREPBENCH_CSV at the real downloaded CSV for the defensible number.
import { resolveCorpus, splitCorpus } from './corpus';
import { scoreRealCorpus, type RealCorpusSummary } from './realContentBench';

const pct = (n: number) => (Number.isNaN(n) ? 'N/A' : `${(n * 100).toFixed(1)}%`);

function line(label: string, s: RealCorpusSummary): void {
  console.log(
    `${label.padEnd(10)} reports ${String(s.reports).padStart(3)} · rows ${String(s.items).padStart(4)} · ` +
      `abstain ${pct(s.abstainRate).padStart(6)} · confirm ${pct(s.confirmRate).padStart(6)} · ` +
      `agree ${pct(s.agreement).padStart(6)} (n=${s.agreementScored}) · ` +
      `CONFIDENT-agree ${pct(s.confidentAgreement).padStart(6)} (n=${s.confidentScored}) · wrong ${s.confidentlyWrong.length}`,
  );
}

const { reports, source } = resolveCorpus();
const { train, heldout } = splitCorpus(reports);
const all = scoreRealCorpus(reports);

console.log('\n=== Grounding on REAL content — Prove-the-Number, Half A ===');
console.log(`source: ${source}`);
console.log(`recognized by our 89-analyte table: ${all.recognized}/${all.items} (${pct(all.recognized / all.items)})\n`);
line('COMBINED', all);
line('  train', scoreRealCorpus(train));
line('  heldout', scoreRealCorpus(heldout));

console.log('\n--- Why we abstained (combined) ---');
for (const [reason, n] of Object.entries(all.abstainByReason).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${reason}`);
}
if (Object.keys(all.confirmByRule).length) {
  console.log('\n--- Rules that drove confirm ---');
  for (const [id, n] of Object.entries(all.confirmByRule).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${id}`);
}

console.log('\n--- Interpreted rows (what a patient would actually see) ---');
for (const d of all.classifiedDetail) {
  const mark = d.agree === null ? '·' : d.agree ? '✓' : '✗';
  console.log(`  ${mark} ${d.name}  ${d.value}${d.unit ? ' ' + d.unit : ''}  → ours=${d.ourClass}  report=${d.datasetFlag}`);
}
if (all.disagreements.length) {
  console.log(`\n--- Disagreements (${all.disagreements.length}) ---`);
  for (const d of all.disagreements) console.log(`  ${d.name}  ${d.value}${d.unit ? ' ' + d.unit : ''}  ours=${d.ourClass}  report=${d.datasetFlag}`);
}
console.log('');
