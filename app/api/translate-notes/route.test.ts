import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAnthropic: vi.fn(),
  enforcePaidRouteRateLimit: vi.fn(),
  checkConsent: vi.fn(),
}));
vi.mock('@/lib/anthropic', () => ({ getAnthropic: mocks.getAnthropic }));
vi.mock('@/lib/rateLimit', () => ({ enforcePaidRouteRateLimit: mocks.enforcePaidRouteRateLimit }));
vi.mock('@/lib/consentGate', () => ({ checkConsent: mocks.checkConsent }));

import { POST } from './route';

describe('POST /api/translate-notes containment', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['current client', { text: 'Continue medicine 5 mg daily.' }, '2'],
    ['stale client', { text: 'typed original' }, '1'],
    ['missing consent', { text: 'private text' }, null],
    ['oversized body', { text: 'x'.repeat(50_000) }, '2'],
    ['malformed body', null, null],
  ])('unconditionally returns 410 for %s without reading input or calling services', async (_name, body, consent) => {
    const json = vi.fn(async () => { if (!body) throw new Error('invalid JSON'); return body; });
    const getHeader = vi.fn(() => consent);
    // Exercise a request argument although the disabled handler has no request parameter.
    const response = await Reflect.apply(POST, undefined, [{ json, headers: { get: getHeader } }]);
    expect(response.status).toBe(410);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      error: 'Generated notes translations are disabled', errorZh: '医生说明自动翻译已停用',
    });
    expect(json).not.toHaveBeenCalled();
    expect(getHeader).not.toHaveBeenCalled();
    expect(mocks.checkConsent).not.toHaveBeenCalled();
    expect(mocks.enforcePaidRouteRateLimit).not.toHaveBeenCalled();
    expect(mocks.getAnthropic).not.toHaveBeenCalled();
  });

  it('does not even access properties on a hostile request object', async () => {
    const request = new Proxy({}, { get: () => { throw new Error('request accessed'); } });
    expect((await Reflect.apply(POST, undefined, [request])).status).toBe(410);
  });
});
