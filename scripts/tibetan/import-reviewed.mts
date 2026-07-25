import path from 'node:path';
import {
  formatRebaselineChecklist,
  importReviewedPacket,
} from '../../lib/tibetanImport';

// Requires BOTH reviewers' packets. There is deliberately no single-packet path — see the
// two-person rule note in lib/tibetanImport.ts.
const USAGE = 'Usage: npm run tibetan:import -- <packet-dir-a> <packet-dir-b>';

function main(): void {
  const [directoryA, directoryB, ...extra] = process.argv.slice(2);
  if (!directoryA || !directoryB || extra.length > 0) {
    console.error(USAGE);
    console.error("Both reviewers' packets are required. One packet is not a review.");
    process.exitCode = 2;
    return;
  }

  const result = importReviewedPacket(
    process.cwd(),
    path.resolve(directoryA),
    path.resolve(directoryB),
  );

  // Names only, never contact details: the manifest keeps those, but they should not spill into
  // logs or CI output.
  console.log(`Reviewers: ${result.reviewers.join(' + ')}`);

  for (const row of result.rows) {
    if (row.status !== 'refused') continue;
    for (const diagnostic of row.diagnostics) {
      console.error(`REFUSED ${row.id} [${diagnostic.check}] ${diagnostic.message}`);
    }
  }

  if (result.disagreements.length > 0) {
    console.error(
      `\nDISAGREEMENTS (${result.disagreements.length}) — nothing was written for these:`,
    );
    for (const disagreement of result.disagreements) {
      console.error(`  ${disagreement.packet} ${disagreement.id} [${disagreement.reason}]`);
      console.error(`    A: ${disagreement.a || '(empty)'}`);
      console.error(`    B: ${disagreement.b || '(empty)'}`);
    }
    console.error(
      '\nThe importer does not choose between two translations. Have the reviewers agree on one '
        + 'form, record the adjudication in the PR, put the agreed form in BOTH packets, re-import.',
    );
  }

  if (result.drift.length > 0) {
    console.warn(
      `\nDRIFT: ${result.drift.length} source string(s) exist that neither packet covers — they `
        + 'were added after the packets were exported. Re-export to cover them:',
    );
    for (const id of result.drift) console.warn(`  ${id}`);
  }

  console.log(
    `\nImport result: ${result.written} written, ${result.refused} refused, `
      + `${result.skipped} left for reviewer.`,
  );
  if (result.checklist) console.log(formatRebaselineChecklist(result.checklist));
  if (result.refused > 0) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Could not import the reviewed packet.');
  process.exitCode = 1;
}
