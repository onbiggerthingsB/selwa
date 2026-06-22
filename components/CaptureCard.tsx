'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { downscaleToJpeg } from '@/lib/downscaleImage';
import { groundExtraction } from '@/lib/grounding';
import { LabExtractionSchema } from '@/lib/extractionSchema';
import { setPendingReport } from '@/lib/session';
import type { Sex } from '@/lib/types';

type Phase = 'idle' | 'preview' | 'extracting' | 'error';

export function CaptureCard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [sex, setSex] = useState<Sex>('unknown');
  const [age, setAge] = useState<number | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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

  async function submit() {
    if (!file) return;
    setPhase('extracting');
    try {
      const small = await downscaleToJpeg(file);
      const fd = new FormData();
      fd.append('image', small, 'lab.jpg');
      const res = await fetch('/api/extract', { method: 'POST', body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Could not read the report');
      }
      const { data } = await res.json();
      const extraction = LabExtractionSchema.parse(data);
      const report = { ...groundExtraction(extraction, sex, age), generatedAt: Date.now() };
      setPendingReport(report);
      router.push('/result');
    } catch {
      setPhase('error');
    }
  }

  function retake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
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

          <button type="button" className="capture-card" onClick={openPicker}>
            <CameraGlyph />
            <span className="cap-title">
              Take a photo of your lab report
              <span className="zh" lang="zh">拍下您的化验单</span>
            </span>
            <span className="cap-sub">or choose from your photos · 或从相册选择</span>
            <span className="on-device">
              <LockGlyph /> Your photo stays on this device · 照片只保存在本机
            </span>
          </button>
        </>
      )}

      {phase === 'preview' && previewUrl && (
        <div className="preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="Your lab report" />
          <div className="preview-actions">
            <button className="btn btn-primary btn-block" onClick={submit}>
              Use this photo · 使用这张
            </button>
            <button className="btn btn-ghost" onClick={retake}>
              Retake · 重拍
            </button>
          </div>
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
          <p className="extracting-note">This takes a few seconds. We’re matching each value to its reference range.</p>
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
