'use client';
import { useEffect, useState } from 'react';
import { listVisits, deleteVisit, type VisitRecord } from '@/lib/db';
import { SummaryView } from '@/components/SummaryView';
import { NotesSection } from '@/components/NotesSection';
import { LocalizedText } from '@/components/LocalizedText';
import type { Lang } from '@/lib/i18n';
import { UI_COPY } from '@/lib/uiCopy';

export function SavedVisits({ lang }: { lang: Lang }) {
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    listVisits().then(setVisits);
  }, []);

  if (visits.length === 0) return null;

  return (
    <section className="saved">
      <h2>
        <LocalizedText value={UI_COPY.savedReports} lang={lang} />
      </h2>
      <ul className="saved-list">
        {visits.map((v) => (
          <li key={v.id} className="saved-item">
            <div className="saved-head">
              <button className="saved-open" onClick={() => setOpenId(openId === v.id ? null : v.id)}>
                {new Date(v.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                <span className="saved-meta">
                  {v.report.rows.length}{' '}
                  <LocalizedText value={UI_COPY.valuesOnDevice} lang={lang} />
                </span>
              </button>
              <button
                className="saved-del"
                onClick={async () => {
                  await deleteVisit(v.id);
                  setVisits(await listVisits());
                }}
              >
                <LocalizedText value={UI_COPY.delete} lang={lang} />
              </button>
            </div>
            {openId === v.id && (
              <div className="saved-body">
                <SummaryView report={v.report} lang={lang} />
                {v.notes && v.notes.segments.length > 0 && <NotesSection notes={v.notes} lang={lang} />}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
