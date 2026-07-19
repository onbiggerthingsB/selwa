import { describe, it, expect, vi, beforeEach } from 'vitest';

const parse = vi.fn();
vi.mock('@/lib/anthropic', () => ({
  getAnthropic: () => ({ messages: { parse } }),
}));

import { POST } from './route';
import { CONSENT_HEADER } from '@/lib/consentGate';
import { CONSENT_VERSION } from '@/lib/consent';

// consentHeader defaults to a VALID opt-in so the pre-existing cases keep testing what they mean
// to; pass null/a wrong version to exercise the gate itself.
function reqWith(file: File | null, consentHeader: string | null = String(CONSENT_VERSION)): Parameters<typeof POST>[0] {
  const form = new FormData();
  if (file) form.set('image', file);
  return {
    formData: async () => form,
    headers: { get: (k: string) => (k.toLowerCase() === CONSENT_HEADER ? consentHeader : null) },
  } as unknown as Parameters<typeof POST>[0];
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

  // SERVER-SIDE consent (Codex): the route previously accepted any POST, leaving the opt-in as a
  // browser-only convention. The image is the sensitive payload, so the refusal must come BEFORE
  // the body is read — asserted via `parse` never being reached.
  it('403s when the consent header is absent — and never calls the model', async () => {
    const res = await POST(reqWith(new File(['img'], 'lab.jpg', { type: 'image/jpeg' }), null));
    expect(res.status).toBe(403);
    expect(parse).not.toHaveBeenCalled();
  });

  it('403s a STALE consent version (a v1 opt-in cannot authorise a v2 disclosure)', async () => {
    const res = await POST(reqWith(new File(['img'], 'lab.jpg', { type: 'image/jpeg' }), '1'));
    expect(res.status).toBe(403);
    expect(parse).not.toHaveBeenCalled();
  });

  it('403s a malformed consent header', async () => {
    for (const bad of ['', '  ', 'yes', 'true', '2.5', 'v2']) {
      const res = await POST(reqWith(new File(['img'], 'lab.jpg', { type: 'image/jpeg' }), bad));
      expect(res.status, `header "${bad}" must not pass`).toBe(403);
    }
    expect(parse).not.toHaveBeenCalled();
  });

  it('consent is checked BEFORE upload validation (no body parsing without opt-in)', async () => {
    // An unsupported type would 415 if validation ran first; consent must pre-empt it.
    const res = await POST(reqWith(new File(['x'], 'a.pdf', { type: 'application/pdf' }), null));
    expect(res.status).toBe(403);
  });
});
