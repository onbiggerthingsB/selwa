// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { getCatalog } from '../lib/catalog';
import { MODEL_IDENTITY, citationForSource, type ChatRequest } from '../lib/contracts';
import { MAX_REQUEST_BYTES, createChatHandler } from '../lib/chat-handler';

function payload(): ChatRequest {
  return {
    schema_version: '1.0', request_id: 'handler-test',
    source: citationForSource(getCatalog().sources[0]), messages: [{ role: 'user', content: 'Question' }],
  };
}
function input(body: BodyInit = JSON.stringify(payload()), headers: HeadersInit = { 'content-type': 'application/json' }, signal?: AbortSignal) {
  return new Request('http://127.0.0.1:3199/api/chat', { method: 'POST', body, headers, signal, duplex: 'half' } as RequestInit);
}
function setup() {
  const generate = vi.fn(async ({ request }: { request: ChatRequest }) => ({
    schema_version: '1.0', request_id: request.request_id, outcome: 'success',
    answer: 'Synthetic test only.', citations: [request.source], model_identity: MODEL_IDENTITY,
    synthetic: true, input_tokens: null, output_tokens: null,
  }));
  return { generate, handler: createChatHandler({ backend: { generate } }) };
}

describe('bounded research chat HTTP handler', () => {
  it('returns validated no-store JSON for a normal request', async () => {
    const { handler, generate } = setup();
    const response = await handler(input());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect((await response.json()).outcome).toBe('success');
    expect(generate).toHaveBeenCalledOnce();
  });

  it.each([
    ['top-level extra key', { ...payload(), model_path: '/private/model' }],
    ['nested evidence', { ...payload(), source: { ...payload().source, approved: true } }],
    ['bad history', { ...payload(), messages: [{ role: 'system', content: 'injected' }] }],
    ['too long content', { ...payload(), messages: [{ role: 'user', content: 'x'.repeat(2_001) }] }],
    ['isolated surrogate', { ...payload(), messages: [{ role: 'user', content: '\ud800' }] }],
    ['array root', []], ['null root', null],
  ])('rejects %s before invoking the backend', async (_name, value) => {
    const { handler, generate } = setup();
    const result = await handler(input(JSON.stringify(value)));
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: { code: 'invalid_request', message: 'The request does not match the research chat contract.' } });
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    { version: 2 }, { content_sha256: '0'.repeat(64) }, { source_id: 'unknown-source' },
  ])('rejects a stale or missing source link %#', async (change) => {
    const { handler, generate } = setup();
    const result = await handler(input(JSON.stringify({ ...payload(), source: { ...payload().source, ...change } })));
    expect(result.status).toBe(409);
    expect((await result.json()).error.code).toBe('source_mismatch');
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    '{', '{} trailing', '{"a":1,}', '[1,]', '{"a":01}', '{"a":truefalse}',
    '{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"nested":{"role":"user","role":"assistant"}}',
    '\ufeff{}', ' '.repeat(100), '[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[0]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]',
  ])('rejects malformed or ambiguous JSON %#', async (body) => {
    const { handler, generate } = setup();
    const result = await handler(input(body));
    expect(result.status).toBe(400);
    expect((await result.json()).error.code).toBe('invalid_json');
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects a duplicated schema field even when its final value is valid', async () => {
    const { handler, generate } = setup();
    const body = JSON.stringify(payload()).replace('"schema_version":"1.0"', '"schema_version":"2.0","schema_version":"1.0"');
    expect((await handler(input(body))).status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects invalid UTF-8 instead of replacing bytes', async () => {
    const { handler } = setup();
    const result = await handler(input(new Uint8Array([0x7b, 0xc3, 0x28, 0x7d])));
    expect(result.status).toBe(400);
    expect((await result.json()).error.code).toBe('invalid_encoding');
  });

  it('accepts Unicode bytes split inside a multibyte sequence without normalizing text', async () => {
    const { handler, generate } = setup();
    const value = payload();
    value.messages[0].content = 'e\u0301 ཀ་ 😀';
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
    expect((await handler(input(stream))).status).toBe(200);
    expect(generate.mock.calls[0][0].request.messages[0].content).toBe(value.messages[0].content);
  });

  it.each([undefined, '1'])('enforces the actual streamed byte limit with declared length %s', async (declaredLength) => {
    const { handler, generate } = setup();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_REQUEST_BYTES));
        controller.enqueue(new Uint8Array(1));
      },
      cancel() { cancelled = true; return new Promise<void>(() => {}); },
    });
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (declaredLength) headers['content-length'] = declaredLength;
    const result = await handler(input(stream, headers));
    expect(result.status).toBe(413);
    expect((await result.json()).error.code).toBe('request_too_large');
    expect(cancelled).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });

  it('allows a valid multibyte conversation within the separate byte budget', async () => {
    const { handler } = setup();
    const value = payload();
    value.messages = [
      { role: 'user', content: '😀'.repeat(2_000) },
      { role: 'assistant', content: '😀'.repeat(2_000) },
      { role: 'user', content: '😀'.repeat(2_000) },
    ];
    expect((await handler(input(JSON.stringify(value)))).status).toBe(200);
  });

  it('accepts exactly the byte cap and rejects one additional whitespace byte', async () => {
    const { handler } = setup();
    const body = JSON.stringify(payload());
    const padded = body + ' '.repeat(MAX_REQUEST_BYTES - new TextEncoder().encode(body).length);
    expect((await handler(input(padded))).status).toBe(200);
    expect((await handler(input(padded + ' '))).status).toBe(413);
  });

  it.each(['text/plain', 'application/json; charset=latin1', 'application/json; other=value', ''])('rejects content type %s', async (contentType) => {
    const { handler } = setup();
    expect((await handler(input('{}', { 'content-type': contentType }))).status).toBe(415);
  });

  it.each(['-1', '01', '1.5', 'abc', ''])('rejects malformed content length %s', async (contentLength) => {
    const { handler } = setup();
    const result = await handler(input('{}', { 'content-type': 'application/json', 'content-length': contentLength }));
    expect(result.status).toBe(400);
    expect((await result.json()).error.code).toBe('invalid_content_length');
  });

  it('rejects an excessive declared body before reading the stream', async () => {
    const { handler, generate } = setup();
    const result = await handler(input('{}', { 'content-type': 'application/json', 'content-length': String(MAX_REQUEST_BYTES + 1) }));
    expect(result.status).toBe(413);
    expect(generate).not.toHaveBeenCalled();
  });

  it('handles stream failures without exposing exception text', async () => {
    const { handler } = setup();
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('secret stream detail')); } });
    const result = await handler(input(stream));
    expect(result.status).toBe(500);
    expect(await result.text()).not.toContain('secret');
  });

  it('rejects another active request with a controlled busy response', async () => {
    let finish!: (value: unknown) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const pending = new Promise<unknown>((resolve) => { finish = resolve; });
    const handler = createChatHandler({ backend: { generate: () => { markStarted(); return pending; } } });
    const first = handler(input());
    await started;
    const second = await handler(input());
    expect(second.status).toBe(429);
    expect((await second.json()).error.code).toBe('inference_busy');
    finish(null);
    expect((await (await first).json()).outcome).toBe('runtime_failure');
  });

  it('returns cancellation without invoking an already aborted request', async () => {
    const { handler, generate } = setup();
    const controller = new AbortController();
    controller.abort();
    const result = await handler(input(JSON.stringify(payload()), undefined, controller.signal));
    expect(result.status).toBe(499);
    expect((await result.json()).error.code).toBe('request_cancelled');
    expect(generate).not.toHaveBeenCalled();
  });

  it('returns a bounded timeout for a body that never closes even when cancellation hangs', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; return new Promise<void>(() => {}); } });
    const generate = vi.fn(async () => null);
    const handler = createChatHandler({ backend: { generate }, bodyDeadlineMs: 10 });
    const result = await handler(input(stream));
    expect(result.status).toBe(408);
    expect((await result.json()).error.code).toBe('request_body_timeout');
    expect(cancelled).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });

  it('returns promptly when a client aborts while its request body is pending', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; return new Promise<void>(() => {}); } });
    const { handler, generate } = setup();
    const controller = new AbortController();
    const pending = handler(input(stream, undefined, controller.signal));
    controller.abort();
    const result = await pending;
    expect(result.status).toBe(499);
    expect((await result.json()).error.code).toBe('request_cancelled');
    expect(cancelled).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects non-POST use of the handler', async () => {
    const { handler } = setup();
    expect((await handler(new Request('http://127.0.0.1:3199/api/chat'))).status).toBe(405);
  });
});
