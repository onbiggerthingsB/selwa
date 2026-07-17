'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { downscaleToJpeg } from '@/lib/downscaleImage';
import { assessQuality, toGray, escalateConfirm, RETAKE_GUIDANCE, type QualityVerdict } from '@/lib/imageQuality';
import { hasConsent, grantConsent } from '@/lib/consent';
import { applyRedactions, rectFromDrag, isMeaningful, type Rect } from '@/lib/redact';
import { groundExtraction } from '@/lib/grounding';
import { LabExtractionSchema } from '@/lib/extractionSchema';
import { NotesTranslationSchema } from '@/lib/notesSchema';
import { groundNotes } from '@/lib/notesGrounding';
import { setPendingReport } from '@/lib/session';
import type { GroundedNotes, Sex } from '@/lib/types';

type Phase = 'idle' | 'preview' | 'redact' | 'consent' | 'quality' | 'extracting' | 'error';

// Decode a Blob to a small grayscale image and score its quality on-device. Runs
// on the POST-downscale image actually sent to Claude. Returns null if decoding
// fails (never block the user on a decode error).
async function blobQuality(blob: Blob): Promise<QualityVerdict | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const maxDim = 400; // enough for blur/contrast/coverage; fast on low-end phones
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(3, Math.round(bitmap.width * scale));
    const h = Math.max(3, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    return assessQuality(toGray(data, w, h));
  } catch {
    return null;
  }
}

export function CaptureCard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [sex, setSex] = useState<Sex>('unknown');
  const [age, setAge] = useState<number | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [notesText, setNotesText] = useState('');
  const [quality, setQuality] = useState<QualityVerdict | null>(null);
  // On-device redaction: the user covers their own identifiers before the transfer.
  const redactBoxRef = useRef<HTMLDivElement>(null);
  const [rects, setRects] = useState<Rect[]>([]);
  // The in-flight drag lives in a REF (source of truth) and is mirrored to state only for
  // rendering — a pointer sequence can fire faster than React re-renders, and reading `drag`
  // from a stale closure would silently drop the box.
  const dragRef = useRef<{ ax: number; ay: number; bx: number; by: number } | null>(null);
  const [drag, setDrag] = useState<{ ax: number; ay: number; bx: number; by: number } | null>(null);
  const [redactError, setRedactError] = useState<string | null>(null);

  function dragPoint(e: React.PointerEvent) {
    const box = redactBoxRef.current?.getBoundingClientRect();
    return box ? { x: e.clientX - box.left, y: e.clientY - box.top } : { x: 0, y: 0 };
  }
  function onRedactDown(e: React.PointerEvent) {
    const p = dragPoint(e);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety — the drag still works without it */
    }
    dragRef.current = { ax: p.x, ay: p.y, bx: p.x, by: p.y };
    setDrag(dragRef.current);
  }
  function onRedactMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const p = dragPoint(e);
    dragRef.current = { ...dragRef.current, bx: p.x, by: p.y };
    setDrag({ ...dragRef.current });
  }
  function onRedactUp() {
    const d = dragRef.current;
    const box = redactBoxRef.current?.getBoundingClientRect();
    dragRef.current = null;
    setDrag(null);
    if (!d || !box) return;
    const r = rectFromDrag(d.ax, d.ay, d.bx, d.by, box.width, box.height);
    if (isMeaningful(r)) setRects((rs) => [...rs, r]);
  }
  // Burn the boxes into the PIXELS on-device, then continue with the redacted image only —
  // the un-redacted original is dropped here and never reaches the network.
  // FAILS CLOSED: if the burn-in fails we keep the user here with the boxes intact rather than
  // silently proceeding with the ORIGINAL image (which the consent screen promises never leaves).
  async function applyRedactionsAndBack() {
    if (!file) return;
    setRedactError(null);
    const res = await applyRedactions(file, rects);
    if (!res.ok) {
      setRedactError(res.reason);
      return; // stay on the redact screen; boxes preserved; original NOT sent
    }
    const redacted = new File([res.blob], 'lab.jpg', { type: 'image/jpeg' });
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(redacted);
    setPreviewUrl(URL.createObjectURL(redacted));
    setRects([]); // now part of the image itself
    setPhase('preview');
  }

  function openPicker() {
    inputRef.current?.click();
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setPhase('preview');
  }

  async function submit(overrideQuality = false) {
    if (!file) return;
    // Privacy gate: the image is about to be sent to Anthropic (US) for OCR. Require an
    // affirmative opt-in BEFORE anything leaves the device (FTC §5 / WA MHMDA).
    if (!hasConsent()) {
      setPhase('consent');
      return;
    }
    setPhase('extracting');
    try {
      const small = await downscaleToJpeg(file);

      // H4 pre-gate: score the downscaled image on-device BEFORE it reaches Claude.
      // A degraded photo makes the model fabricate digits, so prompt a retake unless
      // the user overrides — and an override escalates every value to the confirm gate.
      if (!overrideQuality) {
        const q = await blobQuality(small);
        if (q && !q.ok) {
          setQuality(q);
          setPhase('quality');
          return;
        }
      }

      const fd = new FormData();
      fd.append('image', small, 'lab.jpg');
      const res = await fetch('/api/extract', { method: 'POST', body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Could not read the report');
      }
      const { data } = await res.json();
      const extraction = LabExtractionSchema.parse(data);
      const base = { ...groundExtraction(extraction, sex, age), generatedAt: Date.now() };
      const report = overrideQuality ? escalateConfirm(base) : base;

      // Doctor notes are optional and best-effort: a translation failure must never
      // block the lab report. The notes text transits the server transiently only.
      let notes: GroundedNotes | undefined;
      const trimmed = notesText.trim();
      if (trimmed) {
        try {
          const nres = await fetch('/api/translate-notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: trimmed }),
          });
          if (nres.ok) {
            const { data: ndata } = await nres.json();
            notes = groundNotes(NotesTranslationSchema.parse(ndata), trimmed);
          }
        } catch {
          notes = undefined; // swallow: keep the report flow intact
        }
      }

      setPendingReport({ report, ...(notes ? { notes } : {}) });
      router.push('/result');
    } catch {
      setPhase('error');
    }
  }

  function retake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setQuality(null);
    setPhase('idle');
    openPicker();
  }

  return (
    <div className="capture">
      <input ref={inputRef} type="file" accept="image/*" capture="environment" onChange={onPick} hidden />

      {phase === 'idle' && (
        <>
          <label className="field">
            <span className="field-label">
              Who is this report for? <span className="zh" lang="zh">这份报告是给谁的？</span>{' '}
              <span style={{ opacity: 0.7 }}>(optional)</span>
            </span>
            <span className="select-wrap">
              <select value={sex} onChange={(e) => setSex(e.target.value as Sex)}>
                <option value="unknown">Prefer not to say · 不便透露</option>
                <option value="female">Female · 女</option>
                <option value="male">Male · 男</option>
              </select>
            </span>
          </label>

          <label className="field">
            <span className="field-label">
              Age <span className="zh" lang="zh">年龄</span>{' '}
              <span style={{ opacity: 0.7 }}>(optional · 可选)</span>
            </span>
            <span className="select-wrap">
              <select
                value={age === undefined ? '' : String(age)}
                onChange={(e) => setAge(e.target.value === '' ? undefined : Number(e.target.value))}
              >
                <option value="">Prefer not to say · 不便透露</option>
                <option value="10">Under 18 · 18 岁以下</option>
                <option value="40">18–64 · 18–64 岁</option>
                <option value="70">65 and over · 65 岁及以上</option>
              </select>
            </span>
          </label>

          <label className="field">
            <span className="field-label">
              What the doctor told you <span className="zh" lang="zh">医生说了什么</span>{' '}
              <span style={{ opacity: 0.7 }}>(optional · 可选)</span>
            </span>
            <textarea
              className="notes-textarea"
              rows={3}
              placeholder="Paste or type the doctor’s notes… · 粘贴或输入医生的说明…"
              value={notesText}
              onChange={(e) => setNotesText(e.target.value)}
            />
          </label>

          <button type="button" className="capture-card" onClick={openPicker}>
            <CameraGlyph />
            <span className="cap-title">
              Take a photo of your lab report
              <span className="zh" lang="zh">拍下您的化验单</span>
            </span>
            <span className="cap-sub">or choose from your photos · 或从相册选择</span>
            <span className="on-device">
              <LockGlyph /> Your results are saved only on this device · 结果只保存在本机
            </span>
          </button>
        </>
      )}

      {phase === 'preview' && previewUrl && (
        <div className="preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Your lab report" />
          <div className="preview-actions">
            <button className="btn btn-primary btn-block" onClick={() => submit()}>
              Use this photo · 使用这张
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => setPhase('redact')}>
              Cover personal details · 遮盖个人信息
            </button>
            <button className="btn btn-ghost" onClick={retake}>
              Retake · 重拍
            </button>
          </div>
        </div>
      )}

      {phase === 'redact' && previewUrl && (
        <div className="preview">
          <p className="extracting-note">
            Drag over anything you don’t want to send — your name, ID number, or hospital. It’s blacked out on
            this device before the photo is sent, and only the covered version leaves your phone.
            <span className="zh" lang="zh">
              拖动遮盖您不想发送的内容（姓名、证件号、医院）。在照片发送前，这些内容会在本机被涂黑，只有遮盖后的版本会离开您的手机。
            </span>
          </p>
          <div
            ref={redactBoxRef}
            style={{ position: 'relative', touchAction: 'none', cursor: 'crosshair', userSelect: 'none' }}
            onPointerDown={onRedactDown}
            onPointerMove={onRedactMove}
            onPointerUp={onRedactUp}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="Your lab report" style={{ display: 'block', width: '100%', pointerEvents: 'none' }} />
            {rects.map((r, i) => (
              <div
                key={i}
                style={{ position: 'absolute', background: '#000', left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
              />
            ))}
            {drag && redactBoxRef.current && (() => {
              const b = redactBoxRef.current.getBoundingClientRect();
              const r = rectFromDrag(drag.ax, drag.ay, drag.bx, drag.by, b.width, b.height);
              return (
                <div
                  style={{ position: 'absolute', background: 'rgba(0,0,0,0.6)', outline: '2px solid #fff', left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
                />
              );
            })()}
          </div>
          {redactError && (
            <p className="extracting-note" role="alert" style={{ color: 'var(--sev-critical)' }}>
              We couldn’t cover the details on this device, so we haven’t sent anything. Please retake the photo.
              <span className="zh" lang="zh">我们无法在本机遮盖这些内容，因此没有发送任何内容。请重新拍照。</span>
            </p>
          )}
          <div className="preview-actions">
            <button className="btn btn-primary btn-block" onClick={applyRedactionsAndBack}>
              {rects.length > 0 ? `Cover ${rects.length} area${rects.length > 1 ? 's' : ''} · 确认遮盖` : 'Done · 完成'}
            </button>
            {rects.length > 0 && (
              <button className="btn btn-ghost" onClick={() => setRects([])}>
                Start over · 重新开始
              </button>
            )}
          </div>
        </div>
      )}

      {phase === 'consent' && (
        <div className="callout-error" role="dialog" aria-label="Before we read your report">
          <div className="err-row">
            <LockGlyph />
            <span>
              Before we read your report
              <span className="zh" lang="zh">在读取您的化验单之前</span>
            </span>
          </div>
          <ul className="quality-tips">
            <li>
              Two things are sent to Anthropic (a US company): your photo — including any name, values, or hospital shown on it — so its text can be read; and anything you typed under “What the doctor told you”, so it can be translated.
              <span className="zh" lang="zh">有两项内容会发送给美国公司 Anthropic：您的照片（包括其中的姓名、数值或医院信息），用于识别其中的文字；以及您在“医生说了什么”中输入的内容，用于翻译。</span>
            </li>
            <li>
              The meaning of your results is worked out on this device. We don’t save either on our servers, and neither is ever used for advertising. Anthropic does not use them to train its models, though it may hold them briefly (up to 30 days) for safety checks.
              <span className="zh" lang="zh">结果的含义在本设备上计算。两者都不会保存在我们的服务器上，也绝不用于广告。Anthropic 不会用它们训练模型，但可能为安全检查短暂保留（最多 30 天）。</span>
            </li>
          </ul>
          <button className="btn btn-primary btn-block" onClick={() => { grantConsent(); submit(); }}>
            I agree — read my report · 我同意，读取报告
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => setPhase('preview')}>
            Back · 返回
          </button>
        </div>
      )}

      {phase === 'quality' && quality && (
        <div className="callout-error" role="alert">
          <div className="err-row">
            <CalmAlertGlyph />
            <span>
              This photo may be hard to read clearly.
              <span className="zh" lang="zh">这张照片可能不够清晰。</span>
            </span>
          </div>
          <ul className="quality-tips">
            {quality.reasons.map((r) => (
              <li key={r}>
                {RETAKE_GUIDANCE[r].en} <span className="zh" lang="zh">{RETAKE_GUIDANCE[r].zh}</span>
              </li>
            ))}
          </ul>
          <button className="btn btn-primary btn-block" onClick={retake}>
            Retake · 重拍
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => submit(true)}>
            Use it anyway · 仍然使用
          </button>
        </div>
      )}

      {phase === 'extracting' && (
        <div className="extracting" aria-live="polite">
          <div className="reading">
            <span className="breath" aria-hidden />
            <span>
              Reading your report… <span className="zh" lang="zh">正在读取您的化验单…</span>
            </span>
          </div>
          <div className="skeleton" aria-hidden>
            <div className="skel-card" />
            <div className="skel-card" />
            <div className="skel-card" />
          </div>
          <p className="extracting-note">This takes a few seconds. We’re reading the values and ranges printed on your report.</p>
        </div>
      )}

      {phase === 'error' && (
        <div className="callout-error" role="alert">
          <div className="err-row">
            <CalmAlertGlyph />
            <span>
              We couldn’t read this photo clearly. Try a brighter, flatter photo.
              <span className="zh" lang="zh">我们无法清楚读取，请换个更亮、更平整的角度重拍。</span>
            </span>
          </div>
          <button className="btn btn-primary btn-block" onClick={retake}>
            Try again · 重试
          </button>
        </div>
      )}
    </div>
  );
}

function CameraGlyph() {
  return (
    <svg className="glyph" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}
function LockGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
function CalmAlertGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ color: 'var(--sev-critical)', flex: 'none' }}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <path d="M12 16h.01" />
    </svg>
  );
}
