'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveVisit } from '@/lib/db';
import { clearPendingReport } from '@/lib/session';
import type { GroundedReport, GroundedNotes } from '@/lib/types';

export function SaveVisitButton({
  report,
  notes,
  lang,
}: {
  report: GroundedReport;
  notes?: GroundedNotes;
  lang: 'en' | 'zh';
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const t = (en: string, zh: string) => (lang === 'zh' ? zh : en);

  async function onSave() {
    await saveVisit(report, notes);
    clearPendingReport();
    setSaved(true);
    router.push('/');
  }

  return (
    <button className="btn btn-primary btn-block save" onClick={onSave} disabled={saved}>
      {saved ? t('Saved', '已保存') : t('Keep this report on my device', '保存到本机')}
    </button>
  );
}
