'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { GroundedReport } from '@/lib/types';
import { getPendingReport } from '@/lib/session';
import { ConfirmValues } from '@/components/ConfirmValues';
import { SummaryView } from '@/components/SummaryView';
import { SaveVisitButton } from '@/components/SaveVisitButton';

export default function ResultPage() {
  const router = useRouter();
  const [report, setReport] = useState<GroundedReport | null>(null);
  const [confirmed, setConfirmed] = useState<GroundedReport | null>(null);
  const [lang, setLang] = useState<'en' | 'zh'>('en');

  useEffect(() => {
    const r = getPendingReport();
    if (!r) router.replace('/');
    else setReport(r);
  }, [router]);

  if (!report) return null;

  return (
    <main className="result">
      <div className="lang-toggle">
        <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
          EN
        </button>
        <button aria-pressed={lang === 'zh'} onClick={() => setLang('zh')}>
          中文
        </button>
      </div>

      {!confirmed ? (
        <ConfirmValues report={report} lang={lang} onConfirmed={setConfirmed} />
      ) : (
        <>
          <SummaryView report={confirmed} lang={lang} />
          <SaveVisitButton report={confirmed} lang={lang} />
        </>
      )}
    </main>
  );
}
