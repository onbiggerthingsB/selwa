import path from 'node:path';
import { INSTRUCTIONS_FILE, MANIFEST_FILE, writeTibetanReviewPacket } from '../../lib/tibetanImport';

// TWO PACKETS, ALWAYS. Tibetan copy can only be verified by humans, and one human reviewing their
// own translation is not verification. The exporter therefore refuses to produce a single packet:
// each reviewer gets their own directory with its own packet-id, and the two answers only ever meet
// inside the importer. See the two-person rule note in lib/tibetanImport.ts for what this does and
// does not actually prevent.
const USAGE = 'Usage: npm run tibetan:export -- <packet-dir-a> <packet-dir-b>';

function main(): void {
  const [directoryA, directoryB, ...extra] = process.argv.slice(2);
  if (!directoryA || !directoryB || extra.length > 0) {
    console.error(USAGE);
    console.error('Two directories are required — one per independent reviewer.');
    process.exitCode = 2;
    return;
  }

  const outputA = path.resolve(directoryA);
  const outputB = path.resolve(directoryB);
  if (outputA === outputB) {
    console.error('The two packet directories must be different.');
    process.exitCode = 2;
    return;
  }

  const packets = [outputA, outputB].map((output) => ({
    output,
    packet: writeTibetanReviewPacket(process.cwd(), output),
  }));

  for (const { output, packet } of packets) {
    const composition = packet.termComposition;
    console.log(`\nWrote Tibetan reviewer packet to ${output}`);
    console.log(`glossary-names.csv: ${packet.names.length} rows`);
    console.log(
      'glossary-terms.csv: '
        + `${composition.comparators}+${composition.coreNegators}+`
        + `${composition.polarityPairs}+${composition.boilerplate} components, `
        + `${packet.terms.length} distinct rows`,
    );
    console.log(`floor-strings.csv: ${packet.floor.length} rows`);
    console.log(`decisions.csv: ${packet.decisions.length} row`);
    console.log(`${MANIFEST_FILE}: reviewer must fill name, contact, and date`);
    console.log(`${INSTRUCTIONS_FILE}: reviewer instructions (Chinese + English)`);
    console.log('All bo cells are empty.');
  }

  console.log(
    '\nSend one directory to each reviewer. They must NOT compare answers before both are '
      + 'submitted — two independent answers are the only quality gate we have.',
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Could not export the reviewer packet.');
  process.exitCode = 1;
}
