// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { grantConsent, hasConsent } from './consent';
import {
  ADVICE_CONSENT_VERSION,
  grantAdviceConsent,
  hasAdviceConsent,
  revokeAdviceConsent,
} from './adviceConsent';

describe('advice consent', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a versioned opt-in record on the advice-only key', () => {
    grantAdviceConsent(1_700_000_000_000);

    expect(hasAdviceConsent()).toBe(true);
    expect(JSON.parse(localStorage.getItem('ht:advice-consent')!)).toEqual({
      version: ADVICE_CONSENT_VERSION,
      at: 1_700_000_000_000,
    });

    revokeAdviceConsent();
    expect(hasAdviceConsent()).toBe(false);
  });

  it('treats a mismatched consent version as no consent', () => {
    localStorage.setItem(
      'ht:advice-consent',
      JSON.stringify({ version: ADVICE_CONSENT_VERSION + 1, at: 1 }),
    );

    expect(hasAdviceConsent()).toBe(false);
  });

  it('treats corrupt storage as no consent without throwing', () => {
    localStorage.setItem('ht:advice-consent', 'not json');

    expect(hasAdviceConsent()).toBe(false);
  });

  it('granting lab consent does not grant or overwrite advice consent', () => {
    grantConsent(1_700_000_000_000);

    expect(hasConsent()).toBe(true);
    expect(hasAdviceConsent()).toBe(false);

    grantAdviceConsent(1_700_000_000_001);
    expect(hasConsent()).toBe(true);
    expect(hasAdviceConsent()).toBe(true);
  });

  it('granting advice consent does not grant or overwrite lab consent', () => {
    grantAdviceConsent(1_700_000_000_000);

    expect(hasAdviceConsent()).toBe(true);
    expect(hasConsent()).toBe(false);

    grantConsent(1_700_000_000_001);
    expect(hasAdviceConsent()).toBe(true);
    expect(hasConsent()).toBe(true);
  });
});
