'use client';
import type { GroundedReport } from '@/lib/types';
import { buildSummary, type Lang } from '@/lib/summary';

export function SummaryView({ report, lang }: { report: GroundedReport; lang: Lang }) {
  const { sections, disclaimers } = buildSummary(report, lang);
  return (
    <div className="summary">
      <ul className="rows">
        {sections.map((s) => (
          <li key={s.key} className={`row status-${s.status}`}>
            <div className="row-head">
              <span className="row-title">{s.title}</span>
              <span className="row-value">{s.valueText}</span>
              <span className={`badge badge-${s.status}`}>{s.statusLabel}</span>
            </div>
            {s.plain && <p className="row-plain">{s.plain}</p>}
            {s.flags.map((f, i) => (
              <p key={i} className={`flag flag-${f.severity}`}>
                {f.message}
              </p>
            ))}
            {s.source && (
              <p className="row-source">
                {lang === 'zh' ? '来源：' : 'Source: '}
                {s.source}
              </p>
            )}
          </li>
        ))}
      </ul>
      <section className="disclaimers" aria-label={lang === 'zh' ? '免责声明' : 'Disclaimers'}>
        {disclaimers.map((d, i) => (
          <p key={i}>{d}</p>
        ))}
      </section>
    </div>
  );
}
