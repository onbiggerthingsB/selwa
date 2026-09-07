'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveVisit } from '@/lib/db';
import { clearPendingReport } from '@/lib/session';
import type { GroundedReport, GroundedNotes } from '@/lib/types';
import type { Lang } from '@/lib/i18n';
import { UI_COPY } from '@/lib/uiCopy';
import { REPORT_STORAGE_COPY } from '@/lib/reportStorageCopy';
import { LocalizedText } from '@/components/LocalizedText';

export function SaveVisitButton({ report, originalNotes, notes, lang }: {
  report: GroundedReport;
  originalNotes: string | null;
  notes?: GroundedNotes;
  lang: Lang;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<'save' | 'cleanup' | null>(null);

  function finishSavedVisit() {
    try {
      clearPendingReport();
    } catch {
      setFailure('cleanup');
      return;
    }
    setFailure(null);
    router.push('/');
  }

  async function onSave() {
    // Ref protection starts synchronously; two clicks before a React render must
    // not create two durable visits. A failed write may be retried deliberately.
    if (inFlight.current || saved) return;
    inFlight.current = true;
    setSaving(true);
    setFailure(null);
    try {
      await saveVisit(report, originalNotes, notes);
    } catch {
      inFlight.current = false;
      setFailure('save');
      return;
    } finally {
      setSaving(false);
    }
    // The write already succeeded. Cleanup failure is not a failed save, and its
    // recovery path must never write the visit again.
    setSaved(true);
    finishSavedVisit();
  }

  return (
    <>
      <button className="btn btn-primary btn-block save" onClick={onSave} disabled={saving || saved}>
        <LocalizedText value={saved ? UI_COPY.saved : UI_COPY.saveOnDevice} lang={lang} />
      </button>
      {failure && (
        <div className="callout-error" role="alert">
          <p><LocalizedText value={failure === 'save' ? REPORT_STORAGE_COPY.saveFailed : REPORT_STORAGE_COPY.cleanupFailed} lang={lang} /></p>
          {failure === 'cleanup' && (
            <button className="btn btn-ghost" onClick={finishSavedVisit}>
              <LocalizedText value={REPORT_STORAGE_COPY.cleanupRetry} lang={lang} />
            </button>
          )}
        </div>
      )}
    </>
  );
}
