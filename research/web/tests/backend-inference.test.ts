// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCatalog } from '../lib/catalog';
import { MODEL_IDENTITY, citationForSource, type ChatRequest, type ChatResponse } from '../lib/contracts';
import { BoundedInference, InferenceBusyError, fakeBackend, failureResponse, type InferenceInput } from '../lib/inference';

const source = getCatalog().sources[0];
const request: ChatRequest = {
  schema_version: '1.0', request_id: 'inference-test', source: citationForSource(source),
  messages: [{ role: 'user', content: 'Question' }],
};
function success(): ChatResponse {
  return {
    schema_version: '1.0', request_id: request.request_id, outcome: 'success',
    answer: 'Synthetic test only', citations: [request.source],
    model_identity: MODEL_IDENTITY, synthetic: true, input_tokens: null, output_tokens: null,
  };
}
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<unknown>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

afterEach(() => vi.useRealTimers());

describe('bounded synthetic inference', () => {
  it('passes the selected source and abort signal and validates complete success', async () => {
    const generate = vi.fn<(input: InferenceInput) => Promise<ChatResponse>>().mockResolvedValue(success());
    const inference = new BoundedInference({ generate });
    expect(await inference.run(request, source, new AbortController().signal)).toEqual(success());
    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0][0]).toMatchObject({ request, source });
    expect(generate.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
    expect(await inference.run(request, source, new AbortController().signal)).toEqual(success());
  });

  it('returns a controlled failure for thrown errors without exposing their text', async () => {
    const inference = new BoundedInference({ generate: async () => { throw new Error('private path and user text'); } });
    const result = await inference.run(request, source, new AbortController().signal);
    expect(result).toEqual(failureResponse(request, 'runtime_failure'));
    expect(JSON.stringify(result)).not.toContain('private path');
  });

  it('handles synchronous backend throws and releases the slot', async () => {
    const inference = new BoundedInference({ generate: () => { throw new Error('synchronous failure'); } });
    expect(await inference.run(request, source, new AbortController().signal)).toEqual(failureResponse(request, 'runtime_failure'));
    expect(await inference.run(request, source, new AbortController().signal)).toEqual(failureResponse(request, 'runtime_failure'));
  });

  it.each([
    { answer: null }, { citations: [] }, { request_id: 'different-request' },
    { citations: [citationForSource(getCatalog().sources[1])] },
    { outcome: 'timeout', answer: 'partial', citations: [] },
    { model_identity: 'unapproved-model' },
  ])('discards malformed or mismatched backend response %#', async (change) => {
    const inference = new BoundedInference({ generate: async () => ({ ...success(), ...change }) });
    expect(await inference.run(request, source, new AbortController().signal)).toEqual(failureResponse(request, 'runtime_failure'));
  });

  it('preserves a properly formed context overflow with no partial output', async () => {
    const inference = new BoundedInference({ generate: async () => failureResponse(request, 'context_overflow') });
    expect(await inference.run(request, source, new AbortController().signal)).toEqual(failureResponse(request, 'context_overflow'));
  });

  it('returns timeout promptly but keeps an ignored-abort worker slot until it settles', async () => {
    vi.useFakeTimers();
    const worker = deferred();
    let backendSignal: AbortSignal | undefined;
    const inference = new BoundedInference({ generate: ({ signal }) => { backendSignal = signal; return worker.promise; } }, 50);
    const first = inference.run(request, source, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(50);
    expect(await first).toEqual(failureResponse(request, 'timeout'));
    expect(backendSignal?.aborted).toBe(true);
    await expect(inference.run(request, source, new AbortController().signal)).rejects.toBeInstanceOf(InferenceBusyError);
    worker.resolve(success());
    await vi.advanceTimersByTimeAsync(0);
    expect(await inference.run(request, source, new AbortController().signal)).toEqual(success());
  });

  it('returns cancellation promptly but keeps an ignored-abort worker slot until rejection', async () => {
    const worker = deferred();
    const controller = new AbortController();
    let backendSignal: AbortSignal | undefined;
    const inference = new BoundedInference({ generate: ({ signal }) => { backendSignal = signal; return worker.promise; } });
    const first = inference.run(request, source, controller.signal);
    await Promise.resolve();
    controller.abort();
    expect(await first).toEqual(failureResponse(request, 'cancelled'));
    expect(backendSignal?.aborted).toBe(true);
    await expect(inference.run(request, source, new AbortController().signal)).rejects.toBeInstanceOf(InferenceBusyError);
    worker.reject(new Error('late private error'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(await inference.run(request, source, new AbortController().signal)).toEqual(failureResponse(request, 'runtime_failure'));
  });

  it('does not start a worker for a request already cancelled', async () => {
    const generate = vi.fn(async () => success());
    const inference = new BoundedInference({ generate });
    const controller = new AbortController();
    controller.abort();
    expect(await inference.run(request, source, controller.signal)).toEqual(failureResponse(request, 'cancelled'));
    expect(generate).not.toHaveBeenCalled();
  });

  it('admits only one concurrent generation and releases only the completed worker', async () => {
    const worker = deferred();
    const inference = new BoundedInference({ generate: () => worker.promise });
    const first = inference.run(request, source, new AbortController().signal);
    await expect(inference.run(request, source, new AbortController().signal)).rejects.toBeInstanceOf(InferenceBusyError);
    worker.resolve(success());
    expect(await first).toEqual(success());
    expect(await inference.run(request, source, new AbortController().signal)).toEqual(success());
  });

  it('limits the deadline to at most ten seconds', () => {
    for (const deadline of [0, -1, 10_001, Infinity, NaN]) {
      expect(() => new BoundedInference(fakeBackend, deadline)).toThrow();
    }
  });

  it('the actual fake adapter plainly describes its fixed demonstration and invokes no network', async () => {
    vi.useFakeTimers();
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network must not be used'));
    try {
      const inference = new BoundedInference();
      const pending = inference.run(request, source, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(250);
      const result = await pending;
      expect(result.outcome).toBe('success');
      expect(result.answer).toContain('No language model was invoked');
      expect(result.answer).toContain(source.original_text);
      expect(result.answer).not.toContain(request.messages[0].content);
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
    }
  });

  it('the fake adapter settles cancellation and frees its slot', async () => {
    vi.useFakeTimers();
    const inference = new BoundedInference();
    const controller = new AbortController();
    const pending = inference.run(request, source, controller.signal);
    await Promise.resolve();
    controller.abort();
    expect(await pending).toEqual(failureResponse(request, 'cancelled'));
    await vi.advanceTimersByTimeAsync(0);
    const next = inference.run(request, source, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(250);
    expect((await next).outcome).toBe('success');
  });
});
