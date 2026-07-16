// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { hasConsent, grantConsent, revokeConsent, CONSENT_VERSION } from './consent';

describe('transfer consent', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to NO consent (opt-in, never pre-granted)', () => {
    expect(hasConsent()).toBe(false);
  });

  it('grantConsent records an opt-in with the current version + a timestamp', () => {
    grantConsent(1_700_000_000_000);
    expect(hasConsent()).toBe(true);
    const rec = JSON.parse(localStorage.getItem('ht:transfer-consent')!);
    expect(rec.version).toBe(CONSENT_VERSION);
    expect(rec.at).toBe(1_700_000_000_000);
  });

  it('a stale consent version does NOT count (forces re-consent on disclosure change)', () => {
    localStorage.setItem('ht:transfer-consent', JSON.stringify({ version: CONSENT_VERSION - 1, at: 1 }));
    expect(hasConsent()).toBe(false);
  });

  it('revokeConsent clears it', () => {
    grantConsent();
    revokeConsent();
    expect(hasConsent()).toBe(false);
  });

  it('malformed storage is treated as no consent (never throws)', () => {
    localStorage.setItem('ht:transfer-consent', 'not json');
    expect(hasConsent()).toBe(false);
  });
});
