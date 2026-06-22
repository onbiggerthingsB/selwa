import { describe, it, expect, vi, beforeEach } from 'vitest';

const parse = vi.fn();
vi.mock('@/lib/anthropic', () => ({
  getAnthropic: () => ({ messages: { parse } }),
}));

import { POST } from './route';

function reqWith(body: unknown): Parameters<typeof POST>[0] {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0];
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
    const res = await POST({ json: async () => { throw new Error('bad json'); } } as unknown as Parameters<typeof POST>[0]);
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
});
