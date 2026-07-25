import { describe, expect, it } from 'vitest';
import { ADVICE_CONSENT_VERSION } from './adviceConsent';
import { CONSENT_VERSION } from './consent';
import {
  ADVICE_CONSENT_HEADER,
  CONSENT_HEADER,
  checkConsent,
  checkConsentVersion,
} from './consentGate';

const CONSENT_REQUIRED = { ok: false, status: 403, error: 'Consent required' } as const;

describe('server consent gate', () => {
  it('keeps the existing lab-consent behavior byte-identical through the wrapper', () => {
    const cases: Array<[headerValue: string | null, expected: ReturnType<typeof checkConsent>]> = [
      [null, CONSENT_REQUIRED],
      ['', CONSENT_REQUIRED],
      ['   ', CONSENT_REQUIRED],
      ['1', CONSENT_REQUIRED],
      ['2.5', CONSENT_REQUIRED],
      ['not-a-version', CONSENT_REQUIRED],
      [String(CONSENT_VERSION), { ok: true }],
      [`  ${CONSENT_VERSION}  `, { ok: true }],
    ];

    for (const [headerValue, expected] of cases) {
      expect(checkConsent(headerValue)).toEqual(expected);
      expect(checkConsent(headerValue)).toEqual(checkConsentVersion(headerValue, CONSENT_VERSION));
    }
  });

  it('uses distinct headers and isolates the advice and lab consent versions', () => {
    expect(ADVICE_CONSENT_HEADER).toBe('x-ht-advice-consent-version');
    expect(CONSENT_HEADER).toBe('x-ht-consent-version');
    expect(ADVICE_CONSENT_HEADER).not.toBe(CONSENT_HEADER);

    expect(checkConsentVersion(String(ADVICE_CONSENT_VERSION), ADVICE_CONSENT_VERSION)).toEqual({ ok: true });
    expect(checkConsentVersion(String(CONSENT_VERSION), ADVICE_CONSENT_VERSION)).toEqual(CONSENT_REQUIRED);
    expect(checkConsentVersion(String(ADVICE_CONSENT_VERSION), CONSENT_VERSION)).toEqual(CONSENT_REQUIRED);
  });
});
