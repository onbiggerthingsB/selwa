import path from 'node:path';
import { writeTibetanReviewPacket } from '../../lib/tibetanImport';

const USAGE = 'Usage: npm run tibetan:export -- <packet-dir>';

function main(): void {
  const [packetDirectory, ...extra] = process.argv.slice(2);
  if (!packetDirectory || extra.length > 0) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }

  const output = path.resolve(packetDirectory);
  const packet = writeTibetanReviewPacket(process.cwd(), output);
  const composition = packet.termComposition;
  console.log(`Wrote Tibetan reviewer packet to ${output}`);
  console.log(`glossary-names.csv: ${packet.names.length} rows`);
  console.log(
    'glossary-terms.csv: '
      + `${composition.comparators}+${composition.coreNegators}+`
      + `${composition.polarityPairs}+${composition.boilerplate} components, `
      + `${packet.terms.length} distinct rows`,
  );
  console.log(`floor-strings.csv: ${packet.floor.length} rows`);
  console.log(`decisions.csv: ${packet.decisions.length} row`);
  console.log('All bo cells are empty.');
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Could not export the reviewer packet.');
  process.exitCode = 1;
}
