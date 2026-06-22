'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { downscaleToJpeg } from '@/lib/downscaleImage';
import { groundExtraction } from '@/lib/grounding';
import { LabExtractionSchema } from '@/lib/extractionSchema';
import { setPendingReport } from '@/lib/session';
import type { Sex } from '@/lib/types';

export function CaptureCard() {
  const router = useRouter();
  const [sex, setSex] = useState<Sex>('unknown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy(true);
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
      const report = { ...groundExtraction(extraction, sex), generatedAt: Date.now() };
      setPendingReport(report);
      router.push('/result');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="capture">
      <label className="field">
        <span>Who is this report for? (optional, improves accuracy)</span>
        <select value={sex} onChange={(e) => setSex(e.target.value as Sex)}>
          <option value="unknown">Prefer not to say</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
        </select>
      </label>

      <label className="capture-btn">
        <input type="file" accept="image/*" capture="environment" onChange={onPick} hidden />
        {busy ? 'Reading your report…' : 'Photograph or upload a lab report'}
      </label>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
