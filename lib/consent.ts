// Cross-border / third-party transfer consent (privacy hygiene — see the beachhead memo,
// docs/superpowers/specs/2026-07-15-beachhead-pipl-fda-memo.md). The report image (which may
// carry a name, values, and hospital) is sent to Anthropic (US) for OCR/text extraction. US
// privacy law for a non-HIPAA consumer health app — FTC Act §5 (affirmative consent for
// sensitive health data) and WA My Health My Data Act (opt-in before collection/sharing) —
// requires the user to AFFIRMATIVELY opt in BEFORE that transfer. This records that opt-in.
//
// Persisted per-device (localStorage) and VERSIONED: if the disclosure materially changes,
// bump CONSENT_VERSION to force re-consent.

const KEY = 'ht:transfer-consent';
export const CONSENT_VERSION = 1;

export interface ConsentRecord {
  version: number;
  at: number; // epoch ms — kept as a record of when consent was given
}

export function hasConsent(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const rec = JSON.parse(raw) as ConsentRecord;
    return rec?.version === CONSENT_VERSION;
  } catch {
    return false;
  }
}

export function grantConsent(now: number = Date.now()): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version: CONSENT_VERSION, at: now } satisfies ConsentRecord));
  } catch {
    /* storage unavailable — the gate will simply ask again next time */
  }
}

export function revokeConsent(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
