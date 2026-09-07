// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../app/api/chat/route';
import { GET } from '../app/api/catalog/route';
import { citationForSource } from '../lib/contracts';
import { getCatalog } from '../lib/catalog';
import { sessionConfig } from '../lib/security';

const config = sessionConfig(38471, 'a'.repeat(64));

function authorize() {
  vi.stubEnv('HT_RESEARCH_PORT', '38471');
  vi.stubEnv('HT_RESEARCH_SESSION', config.secret);
}

function headers() {
  return {
    host: config.authority,
    origin: config.origin,
    cookie: `${config.cookieName}=${config.secret}`,
    'content-type': 'application/json',
    'sec-fetch-site': 'same-origin',
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('research API route authorization order', () => {
  it('requires the launcher for both routes and does not parse a denied chat body', async () => {
    vi.stubEnv('HT_RESEARCH_PORT', '');
    vi.stubEnv('HT_RESEARCH_SESSION', '');
    const request = new Request(`${config.origin}/api/chat`, { method: 'POST', headers: headers(), body: 'not JSON' });
    const chat = await POST(request);
    expect(chat.status).toBe(503);
    expect(request.bodyUsed).toBe(false);
    expect(chat.headers.get('cache-control')).toBe('no-store');
    expect(GET(new Request(`${config.origin}/api/catalog`, { headers: headers() })).status).toBe(503);
  });

  it('rejects a missing session before any body parsing', async () => {
    authorize();
    const requestHeaders = headers();
    requestHeaders.cookie = '';
    const request = new Request(`${config.origin}/api/chat`, { method: 'POST', headers: requestHeaders, body: 'not JSON' });
    expect((await POST(request)).status).toBe(401);
    expect(request.bodyUsed).toBe(false);
    expect(GET(new Request(`${config.origin}/api/catalog`, { headers: requestHeaders })).status).toBe(401);
  });

  it('rejects a cross-origin request before any body parsing', async () => {
    authorize();
    const request = new Request(`${config.origin}/api/chat`, {
      method: 'POST', headers: { ...headers(), origin: 'https://other.example' }, body: 'not JSON',
    });
    expect((await POST(request)).status).toBe(403);
    expect(request.bodyUsed).toBe(false);
  });

  it('returns only the fixed verified synthetic catalog after authorization', async () => {
    authorize();
    const response = GET(new Request(`${config.origin}/api/catalog`, { headers: headers() }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(getCatalog());
  });

  it('runs the actual fake adapter through the authorized chat route', async () => {
    authorize();
    vi.useFakeTimers();
    const source = citationForSource(getCatalog().sources[0]);
    const request = new Request(`${config.origin}/api/chat`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ schema_version: '1.0', request_id: 'route-test', source, messages: [{ role: 'user', content: 'Demo question' }] }),
    });
    const pending = POST(request);
    await vi.advanceTimersByTimeAsync(250);
    const response = await pending;
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body.request_id).toBe('route-test');
    expect(body.answer).toContain('No language model was invoked');
    expect(body.citations).toEqual([source]);
  });
});
