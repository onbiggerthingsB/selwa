import { describe, it, expect, vi, beforeEach } from 'vitest';

const { parse, getAnthropic } = vi.hoisted(() => {
  const parseMock = vi.fn();
  return {
    parse: parseMock,
    getAnthropic: vi.fn(() => ({ messages: { parse: parseMock } })),
  };
});
vi.mock('@/lib/anthropic', () => ({
  getAnthropic,
}));

const { enforcePaidRouteRateLimit } = vi.hoisted(() => ({
  enforcePaidRouteRateLimit: vi.fn(),
}));
vi.mock('@/lib/rateLimit', () => ({
  enforcePaidRouteRateLimit,
}));

import { POST } from './route';
import { CONSENT_HEADER } from '@/lib/consentGate';
import { CONSENT_VERSION } from '@/lib/consent';
import { MAX_NOTES_CHARS } from '@/lib/notesSchema';

function reqWith(
  body: unknown,
  consentHeader: string | null = String(CONSENT_VERSION),
  bodyReader?: () => Promise<unknown>,
): Parameters<typeof POST>[0] {
  return {
    json: bodyReader ?? (async () => body),
    headers: { get: (k: string) => (k.toLowerCase() === CONSENT_HEADER ? consentHeader : null) },
  } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/translate-notes', () => {
  beforeEach(() => {
    parse.mockReset();
    getAnthropic.mockClear();
    enforcePaidRouteRateLimit.mockReset();
    enforcePaidRouteRateLimit.mockResolvedValue(null);
  });

  it('400s when text is missing', async () => {
    const res = await POST(reqWith({}));
    expect(res.status).toBe(400);
    expect(parse).not.toHaveBeenCalled();
  });

  it('400s when text is empty/whitespace', async () => {
    const res = await POST(reqWith({ text: '   ' }));
    expect(res.status).toBe(400);
    expect(parse).not.toHaveBeenCalled();
  });

  it('400s when text is not a string', async () => {
    const res = await POST(reqWith({ text: 42 }));
    expect(res.status).toBe(400);
    expect(parse).not.toHaveBeenCalled();
  });

  it('400s when the request body is not valid JSON', async () => {
    // Consent must still be granted here: the gate runs first, so without the header this would
    // 403 and stop testing the JSON path it is named for.
    const res = await POST({
      json: async () => { throw new Error('bad json'); },
      headers: { get: (k: string) => (k.toLowerCase() === CONSENT_HEADER ? String(CONSENT_VERSION) : null) },
    } as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
    expect(parse).not.toHaveBeenCalled();
  });

  it('returns validated segments on success', async () => {
    parse.mockResolvedValue({
      parsed_output: {
        segments: [
          { sourceText: '二甲双胍 850mg 每日两次。', translatedText: 'Metformin 850 mg twice daily.', kind: 'medication' },
        ],
      },
    });
    const res = await POST(reqWith({ text: '二甲双胍 850mg 每日两次。' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.segments[0].kind).toBe('medication');
    expect(body.data.segments[0].translatedText).toBe('Metformin 850 mg twice daily.');
  });

  it('422s when the model returns no parsed output', async () => {
    parse.mockResolvedValue({ parsed_output: null });
    const res = await POST(reqWith({ text: 'some notes' }));
    expect(res.status).toBe(422);
  });

  it('502s when the SDK throws (never echoes raw error)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    parse.mockRejectedValueOnce(new Error('upstream 500: secret-key-leak'));

    try {
      const res = await POST(reqWith({ text: 'some notes' }));
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(JSON.stringify(body)).not.toMatch(/secret-key-leak/);
      expect(consoleError).toHaveBeenCalledWith('translate-notes: model call failed');
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain('secret-key-leak');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('403s without consent before rate limiting, body reading, or the model', async () => {
    const bodyReader = vi.fn(async () => {
      throw new Error('body must not be read without consent');
    });
    const res = await POST(reqWith({ text: 'take one tablet daily' }, null, bodyReader));
    expect(res.status).toBe(403);
    expect(enforcePaidRouteRateLimit).not.toHaveBeenCalled();
    expect(bodyReader).not.toHaveBeenCalled();
    expect(getAnthropic).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it('429s a rate-limited request before reading the notes or calling the model', async () => {
    enforcePaidRouteRateLimit.mockResolvedValueOnce(Response.json({
      error: 'Too many requests. Please try again later.',
      errorZh: '请求过于频繁，请稍后再试。',
    }, { status: 429 }));
    const bodyReader = vi.fn(async () => {
      throw new Error('rate-limited notes must not be read');
    });
    const req = reqWith(
      { text: 'take one tablet daily' },
      String(CONSENT_VERSION),
      bodyReader,
    );

    const res = await POST(req);

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({
      error: 'Too many requests. Please try again later.',
      errorZh: '请求过于频繁，请稍后再试。',
    });
    expect(enforcePaidRouteRateLimit).toHaveBeenCalledWith(req, 'translate-notes');
    expect(bodyReader).not.toHaveBeenCalled();
    expect(getAnthropic).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it('403s a stale consent version', async () => {
    const res = await POST(reqWith({ text: 'take one tablet daily' }, '1'));
    expect(res.status).toBe(403);
    expect(parse).not.toHaveBeenCalled();
  });

  // Unbounded free text forwarded verbatim to the model is a cost/abuse vector. Rejected, never
  // truncated: half a note translated and then reconciled against the full "original" would
  // corrupt the R7-R9 fidelity check.
  it(`413s notes longer than MAX_NOTES_CHARS (${MAX_NOTES_CHARS}) without calling the model`, async () => {
    const res = await POST(reqWith({ text: 'a'.repeat(MAX_NOTES_CHARS + 1) }));
    expect(res.status).toBe(413);
    expect(parse).not.toHaveBeenCalled();
  });

  it('accepts notes exactly at the limit (the cap is not off by one)', async () => {
    parse.mockResolvedValue({ parsed_output: { segments: [] } });
    const res = await POST(reqWith({ text: 'a'.repeat(MAX_NOTES_CHARS) }));
    expect(res.status).toBe(200);
  });
});
