import { createHash } from 'node:crypto';
import {
  catalogSchema,
  sameCitation,
  type CatalogResponse,
  type Citation,
  type SourceCard,
} from './contracts';

// Deliberately projected from research/contracts/fixtures/synthetic-dataset.json.
// This fixed catalog never scans private datasets, review packets, or model paths.
const SOURCES: SourceCard[] = [
  {
    source_id: 'fixture-source-1',
    version: 1,
    title: 'Synthetic English plumbing fixture; not Tibetan or clinical evidence',
    original_text: 'The community library opens at nine. It closes on Monday.',
    content_sha256: '33e4123f6039073f4024cccf251e9dd22a76f1c47c9eb0eb79acb8c8f74515b7',
    language: 'en',
    source_kind: 'synthetic_fixture',
    scope: 'nonclinical',
    language_review: 'pending',
    medical_review: 'not_applicable',
  },
  {
    source_id: 'fixture-source-2',
    version: 1,
    title: 'Synthetic English plumbing fixture; not Tibetan or clinical evidence',
    original_text: 'A blue notebook is on the table. The red notebook is in the bag.',
    content_sha256: '4b3d0a19e04d5209249fc8ff16fe09d448ce8a61ccc183c05e0190027f320416',
    language: 'en',
    source_kind: 'synthetic_fixture',
    scope: 'nonclinical',
    language_review: 'pending',
    medical_review: 'not_applicable',
  },
];

export function validateCatalog(value: unknown): CatalogResponse {
  const catalog = catalogSchema.parse(value);
  for (const source of catalog.sources) {
    const digest = createHash('sha256').update(source.original_text, 'utf8').digest('hex');
    if (digest !== source.content_sha256) throw new Error('Synthetic catalog integrity check failed');
  }
  return catalog;
}

export function getCatalog(): CatalogResponse {
  return validateCatalog({ schema_version: '1.0', mode: 'synthetic_demo', sources: SOURCES });
}

export function findSource(citation: Citation): SourceCard | undefined {
  return getCatalog().sources.find((source) => sameCitation(source, citation));
}
