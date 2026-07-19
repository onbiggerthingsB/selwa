'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveVisit } from '@/lib/db';
import { clearPendingReport } from '@/lib/session';
import type { GroundedReport, GroundedNotes } from '@/lib/types';
import type { Lang } from '@/lib/i18n';
import { UI_COPY } from '@/lib/uiCopy';
import { LocalizedText } from '@/components/LocalizedText';

export function SaveVisitButton({
  report,
  notes,
  lang,
}: {
  report: GroundedReport;
  notes?: GroundedNotes;
  lang: Lang;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);

  async function onSave() {
    await saveVisit(report, notes);
    clearPendingReport();
    setSaved(true);
    router.push('/');
  }

  return (
    <button className="btn btn-primary btn-block save" onClick={onSave} disabled={saved}>
      <LocalizedText value={saved ? UI_COPY.saved : UI_COPY.saveOnDevice} lang={lang} />
    </button>
  );
}
