// Advice-question transfer consent. This is intentionally separate from the lab
// translator consent: each feature has a different processing purpose and disclosure.
//
// Persisted per-device (localStorage) and VERSIONED: if the disclosure materially changes,
// bump ADVICE_CONSENT_VERSION to force re-consent.

const KEY = 'ht:advice-consent';
export const ADVICE_CONSENT_VERSION = 1;

export interface AdviceConsentRecord {
  version: number;
  at: number; // epoch ms — kept as a record of when consent was given
}

export function hasAdviceConsent(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const rec = JSON.parse(raw) as AdviceConsentRecord;
    return rec?.version === ADVICE_CONSENT_VERSION;
  } catch {
    return false;
  }
}

export function grantAdviceConsent(now: number = Date.now()): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ version: ADVICE_CONSENT_VERSION, at: now } satisfies AdviceConsentRecord),
    );
  } catch {
    /* storage unavailable — the gate will simply ask again next time */
  }
}

export function revokeAdviceConsent(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
