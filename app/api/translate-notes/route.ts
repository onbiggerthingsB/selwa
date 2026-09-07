import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Generated notes are disabled: the existing guard cannot establish semantic fidelity.
// Keep this endpoint for already-open/cached clients, but never inspect their headers or
// body and never initialize the rate limiter or a model client. New clients retain the
// actual entered text on-device, separately from historical model-derived segments.
export async function POST() {
  return NextResponse.json(
    { error: 'Generated notes translations are disabled', errorZh: '医生说明自动翻译已停用' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  );
}
