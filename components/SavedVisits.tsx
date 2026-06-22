'use client';
import { useEffect, useState } from 'react';
import { listVisits, deleteVisit, type VisitRecord } from '@/lib/db';
import { SummaryView } from '@/components/SummaryView';
import { NotesSection } from '@/components/NotesSection';

export function SavedVisits({ lang }: { lang: 'en' | 'zh' }) {
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const t = (en: string, zh: string) => (lang === 'zh' ? zh : en);

  useEffect(() => {
    listVisits().then(setVisits);
  }, []);

  if (visits.length === 0) return null;

  return (
    <section className="saved">
      <h2>{t('Saved reports', '已保存的报告')}</h2>
      <ul className="saved-list">
        {visits.map((v) => (
          <li key={v.id} className="saved-item">
            <div className="saved-head">
              <button className="saved-open" onClick={() => setOpenId(openId === v.id ? null : v.id)}>
                {new Date(v.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                <span className="saved-meta">
                  {v.report.rows.length} {t('values · on this device', '项 · 保存在本机')}
                </span>
              </button>
              <button
                className="saved-del"
                onClick={async () => {
                  await deleteVisit(v.id);
                  setVisits(await listVisits());
                }}
              >
                {t('Delete', '删除')}
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
