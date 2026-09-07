import {
  MODEL_IDENTITY,
  citationForSource,
  validateResponseForRequest,
  type ChatRequest,
  type ChatResponse,
  type SourceCard,
} from './contracts';

export type InferenceInput = {
  request: ChatRequest;
  source: SourceCard;
  signal: AbortSignal;
};

export interface ResearchBackend {
  generate(input: InferenceInput): Promise<unknown>;
}

export type FailureOutcome = Exclude<ChatResponse['outcome'], 'success'>;

export function failureResponse(request: ChatRequest, outcome: FailureOutcome): ChatResponse {
  return {
    schema_version: '1.0',
    request_id: request.request_id,
    outcome,
    answer: null,
    citations: [],
    model_identity: MODEL_IDENTITY,
    synthetic: true,
    input_tokens: null,
    output_tokens: null,
  };
}

function waitForDemo(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Demo cancelled'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new Error('Demo cancelled'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, 250);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Fixed in-process plumbing demo. No model, network client, or text analysis. */
export const fakeBackend: ResearchBackend = {
  async generate({ request, source, signal }) {
    await waitForDemo(signal);
    return {
      schema_version: '1.0',
      request_id: request.request_id,
      outcome: 'success',
      answer: 'Synthetic interface demonstration. No language model was invoked, and your question was not interpreted. '
        + 'The selected test passage is shown below to demonstrate the citation workflow.\n\n'
        + source.original_text,
      citations: [citationForSource(source)],
      model_identity: MODEL_IDENTITY,
      synthetic: true,
      input_tokens: null,
      output_tokens: null,
    };
  },
};

type Settlement = { kind: 'response'; value: unknown } | { kind: 'failure' };
type Interrupt = { kind: 'interrupt'; outcome: 'timeout' | 'cancelled' };

export class InferenceBusyError extends Error {
  constructor() {
    super('A research request is already running');
  }
}

/** A cancelled or timed-out worker keeps its slot until it actually settles. */
export class BoundedInference {
  private active = false;

  constructor(
    private readonly backend: ResearchBackend = fakeBackend,
    private readonly deadlineMs = 10_000,
  ) {
    if (!Number.isFinite(deadlineMs) || deadlineMs <= 0 || deadlineMs > 10_000) {
      throw new Error('Research inference deadline must be between zero and ten seconds');
    }
  }

  async run(request: ChatRequest, source: SourceCard, signal: AbortSignal): Promise<ChatResponse> {
    if (signal.aborted) return failureResponse(request, 'cancelled');
    if (this.active) throw new InferenceBusyError();
    this.active = true;

    const controller = new AbortController();
    let onAbort: () => void = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const interrupted = new Promise<Interrupt>((resolve) => {
      onAbort = () => {
        resolve({ kind: 'interrupt', outcome: 'cancelled' });
        controller.abort();
      };
      timer = setTimeout(() => {
        resolve({ kind: 'interrupt', outcome: 'timeout' });
        controller.abort();
      }, this.deadlineMs);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });

    const underlying: Promise<Settlement> = Promise.resolve()
      .then(() => this.backend.generate({ request, source, signal: controller.signal }))
      .then(
        (value) => ({ kind: 'response', value }),
        () => ({ kind: 'failure' }),
      );
    // This is the only release point. Promise.race finishing is insufficient.
    void underlying.then(() => { this.active = false; });

    try {
      const result = await Promise.race([underlying, interrupted]);
      if (result.kind === 'interrupt') return failureResponse(request, result.outcome);
      if (result.kind === 'failure') return failureResponse(request, 'runtime_failure');
      try {
        return validateResponseForRequest(result.value, request);
      } catch {
        return failureResponse(request, 'runtime_failure');
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }
}
