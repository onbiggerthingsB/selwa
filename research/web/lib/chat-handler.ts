import { findSource } from './catalog';
import { MAX_REQUEST_BYTES, requestSchema } from './contracts';
import { BoundedInference, InferenceBusyError, type ResearchBackend } from './inference';

export { MAX_REQUEST_BYTES } from './contracts';
export const MAX_BODY_READ_MS = 5_000;

export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export function apiError(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}

class RequestBodyError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
  }
}

// JSON.parse alone silently accepts duplicate object keys. Validate structure first
// so no peer can interpret a duplicated role/source/request identifier differently.
function strictJson(text: string): unknown {
  let offset = 0;
  const whitespace = () => {
    while (offset < text.length && /[\t\n\r ]/.test(text[offset])) offset += 1;
  };
  const string = (): string => {
    const start = offset;
    if (text[offset++] !== '"') throw new Error('Expected string');
    while (offset < text.length) {
      const character = text[offset++];
      if (character === '"') return JSON.parse(text.slice(start, offset)) as string;
      if (character === '\\') offset += 1;
    }
    throw new Error('Unterminated string');
  };
  const value = (depth: number): void => {
    if (depth > 32) throw new Error('JSON depth exceeded');
    whitespace();
    if (text[offset] === '"') {
      string();
    } else if (text[offset] === '{') {
      offset += 1;
      whitespace();
      const keys = new Set<string>();
      if (text[offset] !== '}') {
        while (true) {
          whitespace();
          const key = string();
          if (keys.has(key)) throw new Error('Duplicate JSON key');
          keys.add(key);
          whitespace();
          if (text[offset++] !== ':') throw new Error('Expected colon');
          value(depth + 1);
          whitespace();
          if (text[offset] !== ',') break;
          offset += 1;
        }
      }
      if (text[offset++] !== '}') throw new Error('Expected object end');
    } else if (text[offset] === '[') {
      offset += 1;
      whitespace();
      if (text[offset] !== ']') {
        while (true) {
          value(depth + 1);
          whitespace();
          if (text[offset] !== ',') break;
          offset += 1;
        }
      }
      if (text[offset++] !== ']') throw new Error('Expected array end');
    } else {
      const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(offset));
      if (!match) throw new Error('Expected value');
      offset += match[0].length;
    }
  };
  value(0);
  whitespace();
  if (offset !== text.length) throw new Error('Trailing JSON content');
  return JSON.parse(text);
}

export async function readBoundedJson(request: Request, bodyDeadlineMs = MAX_BODY_READ_MS): Promise<unknown> {
  if (!Number.isFinite(bodyDeadlineMs) || bodyDeadlineMs <= 0 || bodyDeadlineMs > MAX_BODY_READ_MS) {
    throw new Error('Body read deadline must be between zero and five seconds');
  }
  if (request.signal.aborted) throw new RequestBodyError('request_cancelled', 'The request was cancelled.', 499);
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(contentType)) {
    throw new RequestBodyError('unsupported_content_type', 'Send a UTF-8 application/json request.', 415);
  }
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(declaredLength)) {
      throw new RequestBodyError('invalid_content_length', 'The request length is invalid.');
    }
    if (Number(declaredLength) > MAX_REQUEST_BYTES) {
      throw new RequestBodyError('request_too_large', 'The request exceeds the byte limit.', 413);
    }
  }
  if (!request.body) throw new RequestBodyError('invalid_json', 'A JSON request body is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let onAbort: () => void = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let complete = false;
  const interrupted = new Promise<{ error: RequestBodyError }>((resolve) => {
    onAbort = () => resolve({ error: new RequestBodyError('request_cancelled', 'The request was cancelled.', 499) });
    request.signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => resolve({ error: new RequestBodyError('request_body_timeout', 'The request body was not received in time.', 408) }), bodyDeadlineMs);
    if (request.signal.aborted) onAbort();
  });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), interrupted]);
      if ('error' in chunk) throw chunk.error;
      if (chunk.done) {
        complete = true;
        break;
      }
      total += chunk.value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        throw new RequestBodyError('request_too_large', 'The request exceeds the byte limit.', 413);
      }
      chunks.push(chunk.value);
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    request.signal.removeEventListener('abort', onAbort);
    // Neither pending reads nor an adversarial cancel hook can hold the response.
    // Promise.race already observes a rejected pending read after releaseLock.
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    // A BOM is not JSON whitespace and is rejected rather than silently stripped.
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new RequestBodyError('invalid_encoding', 'The request must contain valid UTF-8.');
  }
  try {
    return strictJson(text);
  } catch {
    throw new RequestBodyError('invalid_json', 'The request must contain one JSON object without duplicate keys.');
  }
}

export function createChatHandler(options: { backend?: ResearchBackend; deadlineMs?: number; bodyDeadlineMs?: number } = {}) {
  const inference = new BoundedInference(options.backend, options.deadlineMs);
  const bodyDeadlineMs = options.bodyDeadlineMs ?? MAX_BODY_READ_MS;
  if (!Number.isFinite(bodyDeadlineMs) || bodyDeadlineMs <= 0 || bodyDeadlineMs > MAX_BODY_READ_MS) {
    throw new Error('Body read deadline must be between zero and five seconds');
  }
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return apiError('method_not_allowed', 'Use POST for a chat request.', 405);
    try {
      const raw = await readBoundedJson(request, bodyDeadlineMs);
      const parsed = requestSchema.safeParse(raw);
      if (!parsed.success) return apiError('invalid_request', 'The request does not match the research chat contract.', 400);
      const source = findSource(parsed.data.source);
      if (!source) return apiError('source_mismatch', 'The selected source is missing or has changed. Reload the catalog.', 409);
      const response = await inference.run(parsed.data, source, request.signal);
      return jsonResponse(response);
    } catch (error) {
      if (error instanceof RequestBodyError) return apiError(error.code, error.message, error.status);
      if (error instanceof InferenceBusyError) return apiError('inference_busy', 'A research request is still running. Try again after it finishes.', 429);
      return apiError('request_failed', 'The research request could not be completed.', 500);
    }
  };
}

export const handleChatRequest = createChatHandler();
