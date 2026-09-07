// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { requestSchema, sameCitation, validateResponseForRequest, type ChatRequest } from '../lib/contracts';
import { validateCatalog } from '../lib/catalog';

type ConformanceCase = {
  name: string;
  kind: 'request' | 'response' | 'catalog';
  value: unknown;
  valid: boolean;
  request?: ChatRequest;
  catalog?: unknown;
};
const fixture = JSON.parse(readFileSync(new URL('../../contracts/fixtures/chat-conformance.json', import.meta.url), 'utf8')) as {
  schema_version: string;
  cases: ConformanceCase[];
};

describe('shared Python and TypeScript chat conformance cases', () => {
  it.each(fixture.cases)('$name', (item) => {
    let accepted = false;
    try {
      if (item.kind === 'request') {
        const request = requestSchema.parse(item.value);
        if (item.catalog !== undefined) {
          const catalog = validateCatalog(item.catalog);
          if (!catalog.sources.some((source) => sameCitation(source, request.source))) throw new Error('Unknown source');
        }
      } else if (item.kind === 'response') {
        if (!item.request) throw new Error('Missing response request');
        validateResponseForRequest(item.value, item.request);
      } else if (item.kind === 'catalog') {
        validateCatalog(item.value);
      } else {
        throw new Error('Unknown conformance case');
      }
      accepted = true;
    } catch {
      accepted = false;
    }
    expect(accepted).toBe(item.valid);
  });
});
