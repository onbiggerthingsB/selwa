import { beforeEach, describe, expect, it, vi } from 'vitest';

const { parse, getAnthropic } = vi.hoisted(() => {
  const parseMock = vi.fn();
  return {
    parse: parseMock,
    getAnthropic: vi.fn(() => ({ messages: { parse: parseMock } })),
  };
});
vi.mock('@/lib/anthropic', () => ({ getAnthropic }));

const { enforcePaidRouteRateLimit } = vi.hoisted(() => ({
  enforcePaidRouteRateLimit: vi.fn(),
}));
vi.mock('@/lib/rateLimit', () => ({ enforcePaidRouteRateLimit }));

const { preScreenQuestion, applyAdviceSafetyFloors } = vi.hoisted(() => ({
  preScreenQuestion: vi.fn(),
  applyAdviceSafetyFloors: vi.fn(),
}));
vi.mock('@/lib/adviceGuard', () => ({
  preScreenQuestion,
  applyAdviceSafetyFloors,
}));

import { POST } from './route';
import { ADVICE_CONSENT_VERSION } from '@/lib/adviceConsent';
import { buildAdvicePrompt, MAX_ADVICE_QUESTION_CHARS } from '@/lib/adviceSchema';
import { ADVICE_CONSENT_HEADER, CONSENT_HEADER } from '@/lib/consentGate';

const MODEL_OUTPUT = {
  emergency: { detected: false, reason: null },
  outOfScope: false,
  tcm: {
    suggestions: ['RAW MODEL PROSE MUST NOT CROSS THE ROUTE UNGUARDED'],
    seekCare: 'raw tcm seek-care text',
  },
  tibetan: {
    suggestions: ['raw Tibetan-medicine perspective'],
    seekCare: 'raw Tibetan-medicine seek-care text',
  },
  western: {
    suggestions: ['raw Western-medicine perspective'],
    seekCare: 'raw Western-medicine seek-care text',
  },
};

const GUARDED_RESULT = {
  presentation: 'normal',
  banners: [],
  refused: null,
  schools: {
    tcm: { suggestions: ['guard-approved tcm'], seekCare: 'guard-approved tcm care' },
    tibetan: {
      suggestions: ['guard-approved Tibetan-medicine view'],
      seekCare: 'guard-approved Tibetan-medicine care',
    },
    western: {
      suggestions: ['guard-approved western view'],
      seekCare: 'guard-approved western care',
    },
  },
} as const;

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    gender: 'unknown',
    question: 'How can I sleep better?',
    languageMode: 'en',
    ...overrides,
  };
}

interface RequestOptions {
  adviceConsent?: string | null;
  labConsent?: string | null;
  bodyReader?: () => Promise<unknown>;
}

function reqWith(
  body: unknown,
  {
    adviceConsent = String(ADVICE_CONSENT_VERSION),
    labConsent = null,
    bodyReader,
  }: RequestOptions = {},
): Parameters<typeof POST>[0] {
  return {
    json: bodyReader ?? (async () => body),
    headers: {
      get: (key: string) => {
        const normalized = key.toLowerCase();
        if (normalized === ADVICE_CONSENT_HEADER) return adviceConsent;
        if (normalized === CONSENT_HEADER) return labConsent;
        return null;
      },
    },
  } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/advice', () => {
  beforeEach(() => {
    parse.mockReset();
    parse.mockResolvedValue({ parsed_output: MODEL_OUTPUT });
    getAnthropic.mockClear();
    enforcePaidRouteRateLimit.mockReset();
    enforcePaidRouteRateLimit.mockResolvedValue(null);
    preScreenQuestion.mockReset();
    preScreenQuestion.mockReturnValue({ block: false, categories: [] });
    applyAdviceSafetyFloors.mockReset();
    applyAdviceSafetyFloors.mockReturnValue(GUARDED_RESULT);
  });

  it.each([null, '', '   '])(
    '403s missing or blank advice consent (%j) before every request side effect',
    async (adviceConsent) => {
      const bodyReader = vi.fn(async () => {
        throw new Error('the question must not be read without advice consent');
      });

      const res = await POST(
        reqWith(validBody(), { adviceConsent, bodyReader }),
      );

      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toEqual({ error: 'Consent required' });
      expect(enforcePaidRouteRateLimit).not.toHaveBeenCalled();
      expect(bodyReader).not.toHaveBeenCalled();
      expect(preScreenQuestion).not.toHaveBeenCalled();
      expect(getAnthropic).not.toHaveBeenCalled();
      expect(parse).not.toHaveBeenCalled();
      expect(applyAdviceSafetyFloors).not.toHaveBeenCalled();
    },
  );

  it('403s the lab consent version on the advice header', async () => {
    const res = await POST(
      reqWith(validBody(), {
        adviceConsent: '2',
        labConsent: '2',
      }),
    );

    expect(res.status).toBe(403);
    expect(enforcePaidRouteRateLimit).not.toHaveBeenCalled();
    expect(preScreenQuestion).not.toHaveBeenCalled();
    expect(getAnthropic).not.toHaveBeenCalled();
  });

  it('403s when only the distinct lab consent header is present', async () => {
    const res = await POST(
      reqWith(validBody(), { adviceConsent: null, labConsent: '2' }),
    );

    expect(res.status).toBe(403);
    expect(enforcePaidRouteRateLimit).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it('returns the rate-limit response before reading or screening the question', async () => {
    enforcePaidRouteRateLimit.mockResolvedValueOnce(
      Response.json(
        {
          error: 'Too many requests. Please try again later.',
          errorZh: '请求过于频繁，请稍后再试。',
        },
        { status: 429 },
      ),
    );
    const bodyReader = vi.fn(async () => {
      throw new Error('a rate-limited question must not be read');
    });
    const req = reqWith(validBody(), { bodyReader });

    const res = await POST(req);

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({
      error: 'Too many requests. Please try again later.',
      errorZh: '请求过于频繁，请稍后再试。',
    });
    expect(enforcePaidRouteRateLimit).toHaveBeenCalledWith(req, 'advice');
    expect(bodyReader).not.toHaveBeenCalled();
    expect(preScreenQuestion).not.toHaveBeenCalled();
    expect(getAnthropic).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    expect(applyAdviceSafetyFloors).not.toHaveBeenCalled();
  });

  it('400s malformed JSON before the safety seams or model', async () => {
    const res = await POST(
      reqWith(validBody(), {
        bodyReader: async () => {
          throw new SyntaxError('invalid json containing a private question');
        },
      }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Invalid request' });
    expect(preScreenQuestion).not.toHaveBeenCalled();
    expect(getAnthropic).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    expect(applyAdviceSafetyFloors).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', { gender: 'unknown', languageMode: 'en' }],
    ['empty', validBody({ question: '' })],
    ['whitespace', validBody({ question: ' \n\t ' })],
    ['number', validBody({ question: 42 })],
    ['null', validBody({ question: null })],
    ['null-body', null],
  ])('400s a %s question', async (_label, body) => {
    const res = await POST(reqWith(body));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'No question provided' });
    expect(preScreenQuestion).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    expect(applyAdviceSafetyFloors).not.toHaveBeenCalled();
  });

  it(`413s a question longer than MAX_ADVICE_QUESTION_CHARS (${MAX_ADVICE_QUESTION_CHARS}) without truncating or screening it`, async () => {
    const question = 'q'.repeat(MAX_ADVICE_QUESTION_CHARS + 1);

    const res = await POST(reqWith(validBody({ question })));

    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toEqual({ error: 'Question too long' });
    expect(preScreenQuestion).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    expect(applyAdviceSafetyFloors).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '', 'other', 1])(
    '400s invalid gender %j before screening or model use',
    async (gender) => {
      const res = await POST(reqWith(validBody({ gender })));

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: 'Invalid gender' });
      expect(preScreenQuestion).not.toHaveBeenCalled();
      expect(parse).not.toHaveBeenCalled();
    },
  );

  it("400s languageMode:'bo' so Tibetan-language generation is structurally unrequestable", async () => {
    const res = await POST(reqWith(validBody({ languageMode: 'bo' })));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Invalid language mode',
    });
    expect(preScreenQuestion).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '', 'fr', 1])(
    '400s invalid language mode %j before screening or model use',
    async (languageMode) => {
      const res = await POST(reqWith(validBody({ languageMode })));

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({
        error: 'Invalid language mode',
      });
      expect(preScreenQuestion).not.toHaveBeenCalled();
      expect(parse).not.toHaveBeenCalled();
    },
  );

  it.each([-1, 121, Number.NaN, Number.POSITIVE_INFINITY, '40', null])(
    '400s invalid age %j before screening or model use',
    async (age) => {
      const res = await POST(reqWith(validBody({ age })));

      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toEqual({ error: 'Invalid age' });
      expect(preScreenQuestion).not.toHaveBeenCalled();
      expect(parse).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, 0, 120])('accepts valid age boundary %j', async (age) => {
    const res = await POST(reqWith(validBody({ age })));

    expect(res.status).toBe(200);
    expect(preScreenQuestion).toHaveBeenCalledOnce();
    expect(parse).toHaveBeenCalledOnce();
    expect(applyAdviceSafetyFloors).toHaveBeenCalledOnce();
  });

  it('accepts a question exactly at the length limit', async () => {
    const question = 'q'.repeat(MAX_ADVICE_QUESTION_CHARS);

    const res = await POST(reqWith(validBody({ question })));

    expect(res.status).toBe(200);
    expect(preScreenQuestion).toHaveBeenCalledWith(question, 'en');
    expect(parse).toHaveBeenCalledOnce();
  });

  it.each(['I want to die', 'I want\n   to die'])(
    'returns a suppress-model pre-screen result with zero Anthropic invocations for %j',
    async (question) => {
      const actualGuard = await vi.importActual<
        typeof import('@/lib/adviceGuard')
      >('@/lib/adviceGuard');
      const blocked = {
        presentation: 'blocked',
        banners: ['emergency-self-harm'],
        refused: 'emergency-only',
      } as const;
      preScreenQuestion.mockImplementationOnce(actualGuard.preScreenQuestion);

      const res = await POST(reqWith(validBody({ question })));

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ data: blocked });
      expect(enforcePaidRouteRateLimit).toHaveBeenCalledOnce();
      expect(preScreenQuestion).toHaveBeenCalledWith(question, 'en');
      expect(getAnthropic).not.toHaveBeenCalled();
      expect(parse).not.toHaveBeenCalled();
      expect(applyAdviceSafetyFloors).not.toHaveBeenCalled();
    },
  );

  it('returns only the post-floor result on success, never raw parsed model output', async () => {
    const question = 'How can I sleep better?';
    const res = await POST(
      reqWith(
        validBody({
          gender: 'female',
          age: 40,
          question,
          languageMode: 'zh',
        }),
      ),
    );

    expect(res.status).toBe(200);
    const responseBody = await res.json();
    expect(responseBody).toEqual({ data: GUARDED_RESULT });
    expect(JSON.stringify(responseBody)).not.toContain(
      'RAW MODEL PROSE MUST NOT CROSS THE ROUTE UNGUARDED',
    );
    expect(preScreenQuestion).toHaveBeenCalledWith(question, 'zh');
    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-opus-4-8',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content:
              buildAdvicePrompt({
                gender: 'female',
                age: 40,
                languageMode: 'zh',
              }) +
              '\n\n' +
              question,
          },
        ],
        output_config: { format: expect.anything() },
      }),
    );
    expect(applyAdviceSafetyFloors).toHaveBeenCalledWith(MODEL_OUTPUT, {
      question,
      languageMode: 'zh',
    });
    expect(parse.mock.invocationCallOrder[0]).toBeLessThan(
      applyAdviceSafetyFloors.mock.invocationCallOrder[0],
    );
  });

  it('422s null parsed output without invoking the post-model floors', async () => {
    parse.mockResolvedValueOnce({ parsed_output: null });

    const res = await POST(reqWith(validBody()));

    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({ error: 'Could not answer' });
    expect(applyAdviceSafetyFloors).not.toHaveBeenCalled();
  });

  it('502s generically without exposing or logging an SDK error or question', async () => {
    const question = 'private question: secret-symptom';
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    parse.mockRejectedValueOnce(
      new Error(`upstream payload and secret-key-leak: ${question}`),
    );

    try {
      const res = await POST(reqWith(validBody({ question })));

      expect(res.status).toBe(502);
      const responseBody = await res.json();
      expect(responseBody).toEqual({
        error: 'Could not answer the question',
      });
      expect(JSON.stringify(responseBody)).not.toContain('secret-key-leak');
      expect(JSON.stringify(responseBody)).not.toContain(question);
      expect(consoleError).toHaveBeenCalledWith('advice: model call failed');
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        'secret-key-leak',
      );
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(question);
      expect(applyAdviceSafetyFloors).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('fails closed with a generic 502 if the post-model guard throws', async () => {
    const question = 'private guard-failure question';
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    applyAdviceSafetyFloors.mockImplementationOnce(() => {
      throw new Error(`unsafe raw result for: ${question}`);
    });

    try {
      const res = await POST(reqWith(validBody({ question })));

      expect(res.status).toBe(502);
      await expect(res.json()).resolves.toEqual({
        error: 'Could not answer the question',
      });
      expect(consoleError).toHaveBeenCalledWith('advice: model call failed');
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(question);
    } finally {
      consoleError.mockRestore();
    }
  });
});
