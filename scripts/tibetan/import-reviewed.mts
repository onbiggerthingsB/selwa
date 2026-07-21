import path from 'node:path';
import {
  formatRebaselineChecklist,
  importReviewedPacket,
} from '../../lib/tibetanImport';

const USAGE = 'Usage: npm run tibetan:import -- <packet-dir>';

function main(): void {
  const [packetDirectory, ...extra] = process.argv.slice(2);
  if (!packetDirectory || extra.length > 0) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  const result = importReviewedPacket(process.cwd(), path.resolve(packetDirectory));
  for (const row of result.rows) {
    if (row.status !== 'refused') continue;
    for (const diagnostic of row.diagnostics) {
      console.error(`REFUSED ${row.id} [${diagnostic.check}] ${diagnostic.message}`);
    }
  }
  console.log(
    `Import result: ${result.written} written, ${result.refused} refused, `
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
