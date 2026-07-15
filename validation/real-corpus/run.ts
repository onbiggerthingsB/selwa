// Run: npx tsx validation/real-corpus/run.ts
// Grounding-on-real-content measurement over the public MedRepBench sample.
import { MEDREPBENCH_SAMPLE } from './sample';
import { scoreRealCorpus } from './realContentBench';

const s = scoreRealCorpus(MEDREPBENCH_SAMPLE);
const pct = (n: number) => (Number.isNaN(n) ? 'N/A' : `${(n * 100).toFixed(1)}%`);

console.log('\n=== Grounding on REAL content — MedRepBench sample (Prove-the-Number, Half A) ===');
console.log(`reports: ${s.reports}   items: ${s.items}   recognized by our 89-analyte table: ${s.recognized} (${pct(s.recognized / s.items)})`);
console.log('\n--- The three product-defining numbers ---');
console.log(`ABSTAIN-RATE   ${pct(s.abstainRate)}   (${s.abstained}/${s.items} rows withheld → source only, no interpretation)`);
console.log(`CONFIRM-RATE   ${pct(s.confirmRate)}   (of the ${s.classified} interpreted rows, share sent to "confirm the values")`);
console.log(`AGREEMENT      ${pct(s.agreement)}   (of ${s.agreementScored} interpreted+scorable rows, normal/abnormal matches the report's own flag)`);

console.log('\n--- Why we abstained (breakdown) ---');
for (const [reason, n] of Object.entries(s.abstainByReason).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${reason}`);
}

if (Object.keys(s.confirmByRule).length) {
  console.log('\n--- Rules that drove confirm ---');
  for (const [id, n] of Object.entries(s.confirmByRule).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)}  ${id}`);
}

console.log('\n--- Interpreted rows (what a patient would actually see) ---');
for (const d of s.classifiedDetail) {
  const mark = d.agree === null ? '·' : d.agree ? '✓' : '✗';
  console.log(`  ${mark} ${d.name}  ${d.value}${d.unit ? ' ' + d.unit : ''}  → ours=${d.ourClass}  report=${d.datasetFlag}`);
}

if (s.disagreements.length) {
  console.log(`\n--- Disagreements (${s.disagreements.length}) — inspect: our band vs the lab's, or a real miss ---`);
  for (const d of s.disagreements) console.log(`  ${d.name}  ${d.value}${d.unit ? ' ' + d.unit : ''}  ours=${d.ourClass}  report=${d.datasetFlag}`);
}
console.log('');
