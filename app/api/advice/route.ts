import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { NextRequest, NextResponse } from 'next/server';
import { getAnthropic } from '@/lib/anthropic';
import { ADVICE_CONSENT_VERSION } from '@/lib/adviceConsent';
import { applyAdviceSafetyFloors, preScreenQuestion } from '@/lib/adviceGuard';
import {
  AdviceModelSchema,
  buildAdvicePrompt,
  MAX_ADVICE_QUESTION_CHARS,
} from '@/lib/adviceSchema';
import {
  ADVICE_CONSENT_HEADER,
  checkConsentVersion,
} from '@/lib/consentGate';
import { enforcePaidRouteRateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs'; // REQUIRED: the SDK breaks on the edge runtime
export const dynamic = 'force-dynamic'; // never cache an advice handler

export async function POST(req: NextRequest) {
  const consent = checkConsentVersion(
    req.headers.get(ADVICE_CONSENT_HEADER),
    ADVICE_CONSENT_VERSION,
  );
  if (!consent.ok) {
    return NextResponse.json(
      { error: consent.error },
      { status: consent.status },
    );
  }

  const rateLimitResponse = await enforcePaidRouteRateLimit(req, 'advice');
  if (rateLimitResponse) return rateLimitResponse;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const fields =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {};

  const question = fields.question;
  if (typeof question !== 'string' || question.trim().length === 0) {
    return NextResponse.json(
      { error: 'No question provided' },
      { status: 400 },
    );
  }
  if (question.length > MAX_ADVICE_QUESTION_CHARS) {
    return NextResponse.json({ error: 'Question too long' }, { status: 413 });
  }

  const gender = fields.gender;
  if (gender !== 'female' && gender !== 'male' && gender !== 'unknown') {
    return NextResponse.json({ error: 'Invalid gender' }, { status: 400 });
  }

  const languageMode = fields.languageMode;
  if (languageMode !== 'en' && languageMode !== 'zh') {
    return NextResponse.json(
      { error: 'Invalid language mode' },
      { status: 400 },
    );
  }

  const age = fields.age;
  if (
    age !== undefined &&
    (typeof age !== 'number' || !Number.isFinite(age) || age < 0 || age > 120)
  ) {
    return NextResponse.json({ error: 'Invalid age' }, { status: 400 });
  }

  const preScreen = preScreenQuestion(question, languageMode);
  if (preScreen.block) {
    return NextResponse.json({ data: preScreen.result });
  }

  try {
    const message = await getAnthropic().messages.parse({
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content:
            buildAdvicePrompt({ gender, age, languageMode }) +
            '\n\n' +
            question,
        },
      ],
      output_config: { format: zodOutputFormat(AdviceModelSchema) },
    });

    const parsed = message.parsed_output;
    if (!parsed) {
      return NextResponse.json({ error: 'Could not answer' }, { status: 422 });
    }

    const result = applyAdviceSafetyFloors(parsed, { question, languageMode });
    return NextResponse.json({ data: result });
  } catch {
    // Swallow the raw SDK error: it may carry request payloads or key material.
    console.error('advice: model call failed');
    return NextResponse.json(
      { error: 'Could not answer the question' },
      { status: 502 },
    );
  }
}
