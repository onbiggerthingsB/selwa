import { NextRequest, NextResponse } from 'next/server';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { getAnthropic } from '@/lib/anthropic';
import { NotesTranslationSchema, NOTES_PROMPT } from '@/lib/notesSchema';

export const runtime = 'nodejs'; // REQUIRED: the SDK breaks on the edge runtime
export const dynamic = 'force-dynamic'; // never cache a notes handler

export async function POST(req: NextRequest) {
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
