import { NextRequest, NextResponse } from 'next/server';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { getAnthropic } from '@/lib/anthropic';
import { NotesTranslationSchema, NOTES_PROMPT, MAX_NOTES_CHARS } from '@/lib/notesSchema';
import { CONSENT_HEADER, checkConsent } from '@/lib/consentGate';
import { enforcePaidRouteRateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs'; // REQUIRED: the SDK breaks on the edge runtime
export const dynamic = 'force-dynamic'; // never cache a notes handler

export async function POST(req: NextRequest) {
  const consent = checkConsent(req.headers.get(CONSENT_HEADER));
  if (!consent.ok) return NextResponse.json({ error: consent.error }, { status: consent.status });

  const rateLimitResponse = await enforcePaidRouteRateLimit(req, 'translate-notes');
  if (rateLimitResponse) return rateLimitResponse;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const text = (body as { text?: unknown } | null)?.text;
  if (typeof text !== 'string' || text.trim().length === 0) {
    return NextResponse.json({ error: 'No notes provided' }, { status: 400 });
  }
  if (text.length > MAX_NOTES_CHARS) {
    return NextResponse.json({ error: 'Notes too long' }, { status: 413 });
  }

  try {
    const message = await getAnthropic().messages.parse({
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      messages: [{ role: 'user', content: NOTES_PROMPT + '\n\n' + text }],
      output_config: { format: zodOutputFormat(NotesTranslationSchema) },
    });

    const parsed = message.parsed_output;
    if (!parsed) return NextResponse.json({ error: 'Could not read the notes' }, { status: 422 });
    return NextResponse.json({ data: parsed });
  } catch {
    // Swallow the raw SDK error: it may carry request payloads or key material.
    console.error('translate-notes: model call failed');
    return NextResponse.json({ error: 'Could not translate the notes' }, { status: 502 });
  }
}
