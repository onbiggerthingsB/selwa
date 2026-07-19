// Google Cloud Translation baseline (M4.2): key-gated real MT.
//
// Calls the Google Cloud Translation v2 REST endpoint when
// GOOGLE_TRANSLATE_API_KEY is set. With no key it throws a clear, actionable
// error rather than silently degrading — the harness defaults to the offline
// adapter, and this adapter is only selected when a key is explicitly provided.

import type { SourceLang, MtBaseline } from './MtBaseline';

const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';

interface GoogleTranslateResponse {
  data?: {
    translations?: Array<{ translatedText?: string }>;
  };
}

export const googleAdapter: MtBaseline = {
  id: 'google',
  async translate(text: string, from: SourceLang, to: SourceLang): Promise<string> {
    const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (!apiKey) {
      throw new Error(
        'googleAdapter requires GOOGLE_TRANSLATE_API_KEY. ' +
          'Set it to run the Google baseline, or use the offline adapter.',
      );
    }

    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, source: from, target: to, format: 'text' }),
    });

    if (!res.ok) {
      throw new Error(`Google Translation API error: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as GoogleTranslateResponse;
    const translated = body.data?.translations?.[0]?.translatedText;
    if (typeof translated !== 'string') {
      throw new Error('Google Translation API returned no translation.');
    }
    return translated;
  },
};
