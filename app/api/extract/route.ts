import { NextRequest, NextResponse } from 'next/server';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { getAnthropic } from '@/lib/anthropic';
import { LabExtractionSchema, EXTRACTION_PROMPT } from '@/lib/extractionSchema';
import { checkUpload } from '@/lib/uploadValidation';
import { CONSENT_HEADER, checkConsent } from '@/lib/consentGate';
import { enforcePaidRouteRateLimit } from '@/lib/rateLimit';

export const runtime = 'nodejs'; // REQUIRED: the SDK breaks on the edge runtime
export const dynamic = 'force-dynamic'; // never cache an upload handler

export async function POST(req: NextRequest) {
  // FIRST — before reading the body. The image is the sensitive payload; refusing after parsing it
  // would still have pulled it into this process. See lib/consentGate.ts for what this does and
  // does not guarantee (integrity control, not authentication).
  const consent = checkConsent(req.headers.get(CONSENT_HEADER));
  if (!consent.ok) return NextResponse.json({ error: consent.error }, { status: consent.status });

  const rateLimitResponse = await enforcePaidRouteRateLimit(req, 'extract');
  if (rateLimitResponse) return rateLimitResponse;

  const form = await req.formData();
  const file = form.get('image');
  const fileMeta = file instanceof File ? { type: file.type, size: file.size } : null;
  const check = checkUpload(fileMeta);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const bytes = Buffer.from(await (file as File).arrayBuffer());
  const base64 = bytes.toString('base64');

  try {
    const message = await getAnthropic().messages.parse({
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: check.mediaType, data: base64 } },
            { type: 'text', text: EXTRACTION_PROMPT },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(LabExtractionSchema) },
    });

    const parsed = message.parsed_output;
    // Zero rows is the same event as an unreadable page, not a successful empty report: a report
    // that OCRs to nothing must never present as one with nothing wrong. The schema deliberately
    // still permits `rows: []` (adding .min(1) would push minItems into the model's constrained
    // decoding and pressure it to invent a row on a blank image, attacking the OCR-only invariant).
    if (!parsed || !Array.isArray(parsed.rows) || parsed.rows.length === 0) {
      return NextResponse.json({ error: 'Could not read the report' }, { status: 422 });
    }
    return NextResponse.json({ data: parsed });
  } catch {
    // Swallow the raw SDK error: it may carry request payloads or key material.
    console.error('extract: model call failed');
    return NextResponse.json({ error: 'Could not read the report' }, { status: 502 });
  }
}
