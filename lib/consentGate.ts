// SERVER-SIDE consent enforcement for the two routes that transfer user content to Anthropic (US).
//
// WHY THIS EXISTS (Codex): consent was enforced ONLY in the browser. lib/consent.ts records the
// opt-in in localStorage and components/CaptureCard.tsx gates submit() behind a `consent` phase —
// but both API routes accepted any POST. The disclosure the user is shown is therefore a UI
// convention, and a UI convention is exactly the kind of thing a later refactor silently reorders.
// FTC §5 and WA MHMDA care about whether the transfer happened without affirmative opt-in, not
// about which layer was supposed to prevent it. So the transfer point itself now refuses.
//
// WHAT THIS IS NOT — read before relying on it. This is an INTEGRITY control, not authentication.
// The app is deliberately account-less (PHI stays on-device), so there is no session to bind
// consent to, and nothing stops a caller from simply sending the header. What it does buy:
//   • a client-side regression that reorders or drops the consent phase now FAILS LOUDLY (403)
//     instead of silently transferring a lab image
//   • the version is checked, so a stale v1 opt-in cannot authorise a v2-disclosure transfer —
//     the reason CONSENT_VERSION exists at all
//   • every accepted transfer carries an explicit assertion of consent at the boundary
// It does NOT prove a human consented. Do not describe it to users or counsel as if it does.

import { CONSENT_VERSION } from '@/lib/consent';

/** Header the client must send on any request that ships user content off-device. */
export const CONSENT_HEADER = 'x-ht-consent-version';

export type ConsentCheck = { ok: true } | { ok: false; status: 403; error: string };

/**
 * A header-only check so it works uniformly for both routes — /api/extract sends multipart
 * FormData and /api/translate-notes sends JSON, so there is no shared body field to key on.
 */
export function checkConsent(headerValue: string | null): ConsentCheck {
  if (headerValue === null || headerValue.trim() === '') {
    return { ok: false, status: 403, error: 'Consent required' };
  }
  const version = Number(headerValue.trim());
  // Reject a stale/rolled-back version explicitly rather than accepting "some consent exists":
  // bumping CONSENT_VERSION is how a materially changed disclosure invalidates prior opt-ins.
  if (!Number.isInteger(version) || version !== CONSENT_VERSION) {
    return { ok: false, status: 403, error: 'Consent required' };
  }
  return { ok: true };
}
