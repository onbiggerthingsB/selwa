'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { GroundedReport, GroundedNotes } from '@/lib/types';
import { clearPendingReport, getPendingReport } from '@/lib/session';
import { ConfirmValues } from '@/components/ConfirmValues';
import { RowManifest } from '@/components/RowManifest';
import { SummaryView } from '@/components/SummaryView';
import { NotesSection } from '@/components/NotesSection';
import { SaveVisitButton } from '@/components/SaveVisitButton';
import { LocalizedText } from '@/components/LocalizedText';
import { TibetanText, TIBETAN_TYPOGRAPHY_SAMPLE } from '@/components/TibetanText';
import { resolveText } from '@/lib/i18n';
import { useLangPreference } from '@/lib/langPreference';
import { UI_COPY } from '@/lib/uiCopy';
import { REPORT_STORAGE_COPY } from '@/lib/reportStorageCopy';

export default function ResultPage() {
  const router = useRouter();
  const [report, setReport] = useState<GroundedReport | null>(null);
  const [notes, setNotes] = useState<GroundedNotes | undefined>(undefined);
  const [originalNotes, setOriginalNotes] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmed, setConfirmed] = useState<GroundedReport | null>(null);
  const [lang, setLang] = useLangPreference();

  useEffect(() => {
    // Mount-time load of the in-progress report from sessionStorage (browser-only).
    // The default null render is what the server produced, so we update after mount
    // to stay hydration-safe; this is the intended use of an effect, not a render cascade.
    try {
      const pending = getPendingReport();
      if (!pending) {
        router.replace('/');
        return;
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReport(pending.report);
      setNotes(pending.notes);
      setOriginalNotes(pending.originalNotes ?? null);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [router, loadAttempt]);

  if (loadFailed) return (
    <main className="result">
      <div className="callout-error" role="alert">
        <p><LocalizedText value={REPORT_STORAGE_COPY.loadFailed} lang={lang} /></p>
        <button className="btn btn-ghost" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
          <LocalizedText value={REPORT_STORAGE_COPY.retry} lang={lang} />
        </button>
      </div>
    </main>
  );

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

      {!acknowledged ? (
        // COMPLETENESS GATE — must come FIRST, before ConfirmValues and before any interpretation.
        // ConfirmValues cannot serve this purpose: it only lists rows the guard already flagged
        // (and auto-skips entirely when none are flagged, which is ~64% of the Chinese corpus),
        // and its row set is immutable, so it has no way to say "you missed one".
        <RowManifest
          report={report}
          lang={lang}
          onAcknowledged={() => setAcknowledged(true)}
          onRetake={() => {
            clearPendingReport();
            router.replace('/');
          }}
        />
      ) : !confirmed ? (
        <ConfirmValues report={report} lang={lang} onConfirmed={setConfirmed} />
      ) : (
        <>
          <SummaryView report={confirmed} lang={lang} />
          <NotesSection originalNotes={originalNotes} lang={lang} />
          <SaveVisitButton report={confirmed} originalNotes={originalNotes} notes={notes} lang={lang} />
        </>
      )}
    </main>
  );
}
