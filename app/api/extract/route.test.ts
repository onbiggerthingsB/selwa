import { describe, it, expect, vi, beforeEach } from 'vitest';

const parse = vi.fn();
vi.mock('@/lib/anthropic', () => ({
  getAnthropic: () => ({ messages: { parse } }),
}));

import { POST } from './route';

function reqWith(file: File | null): Parameters<typeof POST>[0] {
  const form = new FormData();
  if (file) form.set('image', file);
  return { formData: async () => form } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/extract', () => {
  beforeEach(() => parse.mockReset());

  it('415s an unsupported type', async () => {
    const res = await POST(reqWith(new File(['x'], 'a.pdf', { type: 'application/pdf' })));
    expect(res.status).toBe(415);
  });

  it('400s a missing image', async () => {
    const res = await POST(reqWith(null));
    expect(res.status).toBe(400);
  });

  it('returns validated rows on success', async () => {
    parse.mockResolvedValue({
      parsed_output: { rows: [{ name: 'GLU', value: '5.5', unit: 'mmol/L', printedRange: null, confidence: 'high' }] },
    });
    const res = await POST(reqWith(new File(['img'], 'lab.jpg', { type: 'image/jpeg' })));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.rows[0].name).toBe('GLU');
  });

  it('422s when the report is unreadable (no parsed output)', async () => {
    parse.mockResolvedValue({ parsed_output: null });
    const res = await POST(reqWith(new File(['img'], 'lab.jpg', { type: 'image/jpeg' })));
    expect(res.status).toBe(422);
  });
});
