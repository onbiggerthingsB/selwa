import { describe, it, expect, vi, beforeEach } from 'vitest';

const parse = vi.fn();
vi.mock('@/lib/anthropic', () => ({
  getAnthropic: () => ({ messages: { parse } }),
}));

import { POST } from './route';
import { CONSENT_HEADER } from '@/lib/consentGate';
import { CONSENT_VERSION } from '@/lib/consent';
import { MAX_NOTES_CHARS } from '@/lib/notesSchema';

function reqWith(body: unknown, consentHeader: string | null = String(CONSENT_VERSION)): Parameters<typeof POST>[0] {
  return {
    json: async () => body,
    headers: { get: (k: string) => (k.toLowerCase() === CONSENT_HEADER ? consentHeader : null) },
  } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/translate-notes', () => {
  beforeEach(() => parse.mockReset());

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
    parse.mockRejectedValueOnce(new Error('upstream 500: secret-key-leak'));
    const res = await POST(reqWith({ text: 'some notes' }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toMatch(/secret-key-leak/);
  });

  it('403s without consent — notes are also transferred to Anthropic, so they are gated too', async () => {
    const res = await POST(reqWith({ text: 'take one tablet daily' }, null));
    expect(res.status).toBe(403);
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
