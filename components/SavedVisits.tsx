'use client';
import { useEffect, useState } from 'react';
import { listVisits, deleteVisit, type VisitRecord } from '@/lib/db';
import { SummaryView } from '@/components/SummaryView';

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
      <h2>{t('Saved reports (on this device)', '已保存的报告（本机）')}</h2>
      <ul>
        {visits.map((v) => (
          <li key={v.id}>
            <button onClick={() => setOpenId(openId === v.id ? null : v.id)}>
              {new Date(v.createdAt).toLocaleString()} — {v.report.rows.length} {t('items', '项')}
            </button>
            <button
              onClick={async () => {
                await deleteVisit(v.id);
                setVisits(await listVisits());
              }}
            >
              {t('Delete', '删除')}
            </button>
            {openId === v.id && <SummaryView report={v.report} lang={lang} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
