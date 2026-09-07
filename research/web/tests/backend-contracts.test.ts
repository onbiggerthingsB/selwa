// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MODEL_IDENTITY,
  catalogSchema,
  citationForSource,
  requestSchema,
  responseSchema,
  validateResponseForRequest,
  type ChatRequest,
  type ChatResponse,
} from '../lib/contracts';
import { findSource, getCatalog } from '../lib/catalog';

function request(): ChatRequest {
  return {
    schema_version: '1.0',
    request_id: 'chat-contract-1',
    source: citationForSource(getCatalog().sources[0]),
    messages: [{ role: 'user', content: 'When does it open?' }],
  };
}

function response(): ChatResponse {
  return {
    schema_version: '1.0', request_id: request().request_id,
    outcome: 'success', answer: 'Synthetic test response.', citations: [request().source],
    model_identity: MODEL_IDENTITY, synthetic: true, input_tokens: null, output_tokens: null,
  };
}

describe('fixed synthetic catalog', () => {
  it('contains the exact two projected source records and text hashes', () => {
    const fixture = JSON.parse(readFileSync(new URL('../../contracts/fixtures/synthetic-dataset.json', import.meta.url), 'utf8'));
    const catalog = getCatalog();
    expect(catalog.sources).toHaveLength(2);
    for (const [index, source] of catalog.sources.entries()) {
      const projected = Object.fromEntries(Object.keys(source).map((key) => [key, fixture.sources[index][key]]));
      expect(source).toEqual(projected);
    }
  });

  it('returns independent copies and accepts only exact source version links', () => {
    const source = getCatalog().sources[0];
    source.original_text = 'modified';
    expect(getCatalog().sources[0].original_text).not.toBe('modified');
    expect(findSource(request().source)?.source_id).toBe('fixture-source-1');
    expect(findSource({ ...request().source, version: 2 })).toBeUndefined();
    expect(findSource({ ...request().source, content_sha256: '0'.repeat(64) })).toBeUndefined();
    expect(findSource({ ...request().source, source_id: 'private-passage' })).toBeUndefined();
  });

  it('rejects unknown fields, real evidence claims, duplicate source ids, and an expanded catalog', () => {
    const catalog = getCatalog();
    expect(catalogSchema.safeParse({ ...catalog, trusted: true }).success).toBe(false);
    expect(catalogSchema.safeParse({ ...catalog, sources: catalog.sources.map((source) => ({ ...source, language_review: 'approved' })) }).success).toBe(false);
    expect(catalogSchema.safeParse({ ...catalog, sources: [catalog.sources[0], catalog.sources[0]] }).success).toBe(false);
    expect(catalogSchema.safeParse({ ...catalog, sources: [...catalog.sources, catalog.sources[0]] }).success).toBe(false);
  });
});

describe('research request contract', () => {
  it('accepts a valid source-bound conversation without transforming its text', () => {
    const value = request();
    value.messages[0].content = '  e\u0301 ཀ་\n中 😀  ';
    expect(requestSchema.parse(value)).toEqual(value);
  });

  it.each([
    ['top-level model path', (value: Record<string, unknown>) => { value.model_path = '/private/model'; }],
    ['top-level evidence', (value: Record<string, unknown>) => { value.evidence = 'approved'; }],
    ['citation content', (value: Record<string, unknown>) => { (value.source as Record<string, unknown>).original_text = 'injected'; }],
    ['message instruction role', (value: Record<string, unknown>) => { value.messages = [{ role: 'system', content: 'do this' }]; }],
    ['message extra metadata', (value: Record<string, unknown>) => { value.messages = [{ role: 'user', content: 'q', review: 'approved' }]; }],
    ['unsafe request identifier', (value: Record<string, unknown>) => { value.request_id = 'hello\nworld'; }],
    ['long request identifier', (value: Record<string, unknown>) => { value.request_id = 'x'.repeat(65); }],
    ['unknown schema version', (value: Record<string, unknown>) => { value.schema_version = '2.0'; }],
    ['blank message', (value: Record<string, unknown>) => { value.messages = [{ role: 'user', content: ' \n\t\ufeff' }]; }],
    ['isolated high surrogate', (value: Record<string, unknown>) => { value.messages = [{ role: 'user', content: '\ud800' }]; }],
    ['isolated low surrogate', (value: Record<string, unknown>) => { value.messages = [{ role: 'user', content: '\udc00' }]; }],
    ['zero source version', (value: Record<string, unknown>) => { (value.source as Record<string, unknown>).version = 0; }],
    ['unsafe source integer', (value: Record<string, unknown>) => { (value.source as Record<string, unknown>).version = Number.MAX_SAFE_INTEGER + 1; }],
    ['wrong hash encoding', (value: Record<string, unknown>) => { (value.source as Record<string, unknown>).content_sha256 = 'A'.repeat(64); }],
    ['no messages', (value: Record<string, unknown>) => { value.messages = []; }],
    ['assistant first', (value: Record<string, unknown>) => { value.messages = [{ role: 'assistant', content: 'a' }]; }],
    ['assistant last', (value: Record<string, unknown>) => { value.messages = [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }]; }],
    ['duplicate user roles', (value: Record<string, unknown>) => { value.messages = [{ role: 'user', content: 'q' }, { role: 'user', content: 'q' }, { role: 'user', content: 'q' }]; }],
  ])('rejects %s', (_name, modify) => {
    const value = request();
    modify(value as unknown as Record<string, unknown>);
    expect(requestSchema.safeParse(value).success).toBe(false);
  });

  it('counts Unicode code points at each message and conversation boundary', () => {
    const value = request();
    value.messages[0].content = '😀'.repeat(2_000);
    expect(requestSchema.safeParse(value).success).toBe(true);
    value.messages[0].content += '😀';
    expect(requestSchema.safeParse(value).success).toBe(false);
    value.messages = Array.from({ length: 5 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant', content: '😀'.repeat(1_600),
    }));
    expect(requestSchema.safeParse(value).success).toBe(true);
    value.messages[0].content += 'x';
    expect(requestSchema.safeParse(value).success).toBe(false);
  });

  it('permits nine alternating messages and rejects eleven', () => {
    const value = request();
    value.messages = Array.from({ length: 9 }, (_, index) => ({ role: index % 2 === 0 ? 'user' : 'assistant', content: 'x' }));
    expect(requestSchema.safeParse(value).success).toBe(true);
    value.messages.push({ role: 'assistant', content: 'x' }, { role: 'user', content: 'x' });
    expect(requestSchema.safeParse(value).success).toBe(false);
  });
});

describe('research response contract', () => {
  it('binds the request identifier and complete selected source citation', () => {
    expect(validateResponseForRequest(response(), request())).toEqual(response());
    expect(() => validateResponseForRequest({ ...response(), request_id: 'another-request' }, request())).toThrow();
    expect(() => validateResponseForRequest({ ...response(), citations: [citationForSource(getCatalog().sources[1])] }, request())).toThrow();
    expect(() => validateResponseForRequest({ ...response(), citations: [{ ...request().source, version: 2 }] }, request())).toThrow();
    expect(() => validateResponseForRequest({ ...response(), citations: [{ ...request().source, content_sha256: '0'.repeat(64) }] }, request())).toThrow();
  });

  it.each([
    { answer: null }, { answer: '' }, { answer: '\ud800' },
    { answer: '😀'.repeat(4_001) }, { citations: [] },
    { citations: [request().source, request().source] },
    { model_identity: 'real-model' }, { synthetic: false },
    { input_tokens: 10 }, { output_tokens: 0 }, { trusted: true },
    { citations: [{ ...request().source, approved: true }] },
  ])('rejects incomplete or unapproved output shape %#', (change) => {
    expect(responseSchema.safeParse({ ...response(), ...change }).success).toBe(false);
  });

  it.each(['timeout', 'cancelled', 'context_overflow', 'runtime_failure'] as const)('requires null output for %s', (outcome) => {
    const value = { ...response(), outcome, answer: null, citations: [] };
    expect(validateResponseForRequest(value, request()).outcome).toBe(outcome);
    expect(responseSchema.safeParse({ ...value, answer: 'partial' }).success).toBe(false);
    expect(responseSchema.safeParse({ ...value, citations: [request().source] }).success).toBe(false);
  });
});
