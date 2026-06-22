'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { GroundedReport, GroundedNotes } from '@/lib/types';
import { getPendingReport } from '@/lib/session';
import { ConfirmValues } from '@/components/ConfirmValues';
import { SummaryView } from '@/components/SummaryView';
import { NotesSection } from '@/components/NotesSection';
import { SaveVisitButton } from '@/components/SaveVisitButton';

export default function ResultPage() {
  const router = useRouter();
  const [report, setReport] = useState<GroundedReport | null>(null);
  const [notes, setNotes] = useState<GroundedNotes | undefined>(undefined);
  const [confirmed, setConfirmed] = useState<GroundedReport | null>(null);
  const [lang, setLang] = useState<'en' | 'zh'>('en');

  useEffect(() => {
    // Mount-time load of the in-progress report from sessionStorage (browser-only).
    // The default null render is what the server produced, so we update after mount
    // to stay hydration-safe; this is the intended use of an effect, not a render cascade.
    const pending = getPendingReport();
    if (!pending) router.replace('/');
    else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReport(pending.report);
      setNotes(pending.notes);
    }
  }, [router]);

  if (!report) return null;

  const t = (en: string, zh: string) => (lang === 'zh' ? zh : en);

  return (
    <main className="result">
      <div className="result-head">
        <div>
          <p className="eyebrow">{t('Your results', '您的结果')}</p>
          <h2>{t('Lab report', '化验单')}</h2>
        </div>
        <div className="lang-toggle" role="group" aria-label={t('Language', '语言')}>
          <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
            EN
          </button>
          <button aria-pressed={lang === 'zh'} onClick={() => setLang('zh')}>
            中文
          </button>
        </div>
      </div>

      {!confirmed ? (
        <ConfirmValues report={report} lang={lang} onConfirmed={setConfirmed} />
      ) : (
        <>
          <SummaryView report={confirmed} lang={lang} />
          {notes && notes.segments.length > 0 && <NotesSection notes={notes} lang={lang} />}
          <SaveVisitButton report={confirmed} notes={notes} lang={lang} />
        </>
      )}
    </main>
  );
}
