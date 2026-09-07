'use client';
import { useEffect, useState } from 'react';
import { listVisits, deleteVisit, type VisitRecord } from '@/lib/db';
import { SummaryView } from '@/components/SummaryView';
import { NotesSection } from '@/components/NotesSection';
import { LocalizedText } from '@/components/LocalizedText';
import type { Lang } from '@/lib/i18n';
import { UI_COPY, savedVisitsCopy } from '@/lib/uiCopy';
import { REPORT_STORAGE_COPY } from '@/lib/reportStorageCopy';

export function SavedVisits({ lang }: { lang: Lang }) {
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [unreadableCount, setUnreadableCount] = useState(0);
  const [failure, setFailure] = useState<'load' | 'delete' | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    listVisits().then((result) => {
      if (!active) return;
      setVisits(result.visits);
      setUnreadableCount(result.unreadableCount);
      setFailure(null);
    }).catch(() => { if (active) setFailure('load'); });
    return () => { active = false; };
  }, [loadAttempt]);

  if (visits.length === 0 && !failure && unreadableCount === 0) return null;

  return (
    <section className="saved">
      <h2>
        <LocalizedText value={UI_COPY.savedReports} lang={lang} />
      </h2>
      {failure && (
        <div className="callout-error" role="alert">
          <p><LocalizedText value={failure === 'load' ? REPORT_STORAGE_COPY.loadFailed : REPORT_STORAGE_COPY.deleteFailed} lang={lang} /></p>
          {failure === 'load' && <button className="btn btn-ghost" onClick={() => setLoadAttempt((attempt) => attempt + 1)}><LocalizedText value={REPORT_STORAGE_COPY.retry} lang={lang} /></button>}
        </div>
      )}
      {unreadableCount > 0 && <p role="status"><LocalizedText value={REPORT_STORAGE_COPY.someUnreadable} lang={lang} /></p>}
      <ul className="saved-list">
        {visits.map((v) => (
          <li key={v.id} className="saved-item">
            <div className="saved-head">
              <button className="saved-open" onClick={() => setOpenId(openId === v.id ? null : v.id)}>
                {new Date(v.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                <span className="saved-meta">
                  {/* The count lives INSIDE the string: Tibetan places the numeral mid-phrase,
                      so prefixing it here would print it twice. See savedVisitsCopy. */}
                  <LocalizedText
                    value={savedVisitsCopy(v.report.rows.length).valuesOnDevice}
                    lang={lang}
                  />
                </span>
              </button>
              <button
                className="saved-del"
                onClick={async () => {
                  try {
                    await deleteVisit(v.id);
                    setVisits((current) => current.filter((visit) => visit.id !== v.id));
                    setFailure(null);
                  } catch {
                    setFailure('delete');
                  }
                }}
              >
                <LocalizedText value={UI_COPY.delete} lang={lang} />
              </button>
            </div>
            {openId === v.id && (
              <div className="saved-body">
                <SummaryView report={v.report} lang={lang} />
                <NotesSection originalNotes={v.originalNotes} lang={lang} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
