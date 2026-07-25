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

// SAFETY QUARANTINE of Feature 2 — 2026-07-25. This is the load-bearing control: hiding the home
// entry and 404ing /advice are defence in depth, but a PWA-cached or already-open client can still
// POST here. Verified by running the shipped guard: applyAdviceSafetyFloors enforces only lexical
// and structural floors (emergency lexicon, dosing patterns, Tibetan script, the model's own
// outOfScope flag) and never medical truth, so a multi-day food-and-water-avoidance plan and a
// definite "not cancer, no biopsy needed" both returned presentation:'normal' with the prose
// copied verbatim, and "exercise through crushing chest pain" returned a banner with the harmful
// schools still populated underneath.
//
// Typed `boolean` rather than the literal `true` on purpose: a literal would let TypeScript mark
// the entire handler below as unreachable, and this is a DISABLE, not a delete — the T1-T4
// implementation must keep compiling as preserved research. Re-enabling requires deleting this
// constant AND the quarantine tests in ./route.test.ts, so it cannot happen silently.
const FEATURE_2_QUARANTINED: boolean = true;

export async function POST(req: NextRequest) {
  // FIRST statement, before the consent header is read, before the rate limiter's Redis round-trip,
  // before req.json(), and before getAnthropic() constructs a client. Nothing about the request is
  // inspected: the refusal is unconditional. 410 rather than the route's existing 403 shape so the
  // quarantine is distinguishable from a consent failure — a refactor that restored the consent
  // path would otherwise re-enable the portal for consenting users without failing a test.
  if (FEATURE_2_QUARANTINED) {
    return NextResponse.json(
      { error: 'Advice feature disabled', errorZh: '健康咨询功能已停用' },
      { status: 410, headers: { 'Cache-Control': 'no-store' } },
    );
  }

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
