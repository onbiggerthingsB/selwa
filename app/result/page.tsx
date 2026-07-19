'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { GroundedReport, GroundedNotes } from '@/lib/types';
import { getPendingReport } from '@/lib/session';
import { ConfirmValues } from '@/components/ConfirmValues';
import { SummaryView } from '@/components/SummaryView';
import { NotesSection } from '@/components/NotesSection';
import { SaveVisitButton } from '@/components/SaveVisitButton';
import { LocalizedText } from '@/components/LocalizedText';
import { TibetanText, TIBETAN_TYPOGRAPHY_SAMPLE } from '@/components/TibetanText';
import { resolveText, type Lang } from '@/lib/i18n';
import { UI_COPY } from '@/lib/uiCopy';

export default function ResultPage() {
  const router = useRouter();
  const [report, setReport] = useState<GroundedReport | null>(null);
  const [notes, setNotes] = useState<GroundedNotes | undefined>(undefined);
  const [confirmed, setConfirmed] = useState<GroundedReport | null>(null);
  const [lang, setLang] = useState<Lang>('en');

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

  return (
    <main className="result">
      <div className="result-head">
        <div>
          <p className="eyebrow">
            <LocalizedText value={UI_COPY.resultEyebrow} lang={lang} />
          </p>
          <h2>
            <LocalizedText value={UI_COPY.labReport} lang={lang} />
          </h2>
        </div>
        <div
          className="lang-toggle"
          role="group"
          aria-label={resolveText(UI_COPY.language, lang).text}
        >
          <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
            EN
          </button>
          <button aria-pressed={lang === 'zh'} onClick={() => setLang('zh')}>
            中文
          </button>
          <button aria-pressed={lang === 'bo'} onClick={() => setLang('bo')}>
            TB
          </button>
        </div>
      </div>

      {lang === 'bo' && (
        <aside className="tibetan-availability" data-testid="tibetan-availability">
          <p>
            <LocalizedText value={UI_COPY.tibetanUnavailable} lang={lang} />
          </p>
          <div
            className="tibetan-typography-probe"
            aria-label={resolveText(UI_COPY.typographySample, lang).text}
          >
            <LocalizedText value={UI_COPY.typographySample} lang={lang} />
            <TibetanText
              className="tibetan-glyph-sample"
              data-testid="tibetan-typography-sample"
            >
              {TIBETAN_TYPOGRAPHY_SAMPLE}
            </TibetanText>
          </div>
        </aside>
      )}

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
