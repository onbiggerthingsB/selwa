'use client';
import type { GroundedReport } from '@/lib/types';
import { buildSummary, type Lang, type SummaryFlag, type SummarySection } from '@/lib/summary';

function FlagIcon({ severity }: { severity: string }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className: 'flag-icon', 'aria-hidden': true };
  if (severity === 'urgent') {
    // a protective hand — "held, not flagged"
    return (
      <svg {...common}>
        <path d="M12 21c4-2.5 7-5.5 7-9.5V6l-7-3-7 3v5.5c0 4 3 7 7 9.5z" />
        <path d="m9 11.5 2 2 4-4" />
      </svg>
    );
  }
  if (severity === 'caution') {
    return (
      <svg {...common}>
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
        <path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function Section({ s, lang }: { s: SummarySection; lang: Lang }) {
  const en = lang === 'en';
  const namePrimary = en ? s.nameEn : s.nameZh;
  const nameSecondary = en ? s.nameZh : s.nameEn;
  const labelPrimary = en ? s.chipEn : s.chipZh;
  const labelSecondary = en ? s.chipZh : s.chipEn;
  const plainPrimary = en ? s.plainEn : s.plainZh;
  const plainSecondary = en ? s.plainZh : s.plainEn;

  return (
    <li className={`row status-${s.tone}`}>
      <div className="row-head">
        <div className="row-name">
          <div className={`name-primary ${en ? '' : 'zh'}`} lang={en ? 'en' : 'zh'}>
            {namePrimary}
          </div>
          {nameSecondary !== namePrimary && (
            <div className={`name-secondary ${en ? 'zh' : ''}`} lang={en ? 'zh' : 'en'}>
              {nameSecondary}
            </div>
          )}
        </div>
        <div className="row-value num">
          <span className="v">{s.valueText.replace(/\s\S+$/, '')}</span>
          {/\s\S+$/.test(s.valueText) && <span className="u">{s.valueText.split(' ').slice(1).join(' ')}</span>}
        </div>
      </div>

      <span className="chip">
        <span className="dot" aria-hidden />
        <span>{labelPrimary}</span>
        <span className="zh" aria-hidden>
          · {labelSecondary}
        </span>
      </span>

      {plainPrimary && (
        <p className="row-plain">
          {plainPrimary}
          {plainSecondary && plainSecondary !== plainPrimary && (
            <span className={`plain-secondary ${en ? 'zh' : ''}`} lang={en ? 'zh' : 'en'}>
              {plainSecondary}
            </span>
          )}
        </p>
      )}

      {s.flags.length > 0 && (
        <div className="flags">
          {s.flags.map((f: SummaryFlag, i) => (
            <div key={i} className={`flag flag-${f.severity}`}>
              <FlagIcon severity={f.severity} />
              <span lang={en ? 'en' : 'zh'} className={en ? '' : 'zh'}>
                {en ? f.messageEn : f.messageZh}
              </span>
            </div>
          ))}
        </div>
      )}

      {(s.reportRange || s.typicalRange || s.source) && (
        <div className="row-foot">
          {s.reportRange && (
            <span className="ref num">
              {en ? 'Your report’s range ' : '报告所列范围 '}
              {s.reportRange}
            </span>
          )}
          {s.typicalRange && (
            <span className="ref num">
              {en ? 'Typical range, varies by lab ' : '一般范围（各实验室不同） '}
              {s.typicalRange}
            </span>
          )}
          {s.source && (
            <span className="src">
              {en ? 'Source: ' : '来源：'}
              {s.source}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

export function SummaryView({ report, lang }: { report: GroundedReport; lang: Lang }) {
  const { sections, disclaimers } = buildSummary(report, lang);
  const en = lang === 'en';
  const [lead, ...rest] = disclaimers;
  return (
    <div className="summary">
      <ul className="rows">
        {sections.map((s) => (
          <Section key={s.key} s={s} lang={lang} />
        ))}
      </ul>
      <section className="disclaimers" aria-label={en ? 'About this summary' : '关于本摘要'}>
        <p className={`disc-lead ${en ? '' : 'zh'}`} lang={en ? 'en' : 'zh'}>
          <FlagIcon severity="info" />
          <span>{lead}</span>
        </p>
        <ul>
          {rest.map((d, i) => (
            <li key={i} className={en ? '' : 'zh'} lang={en ? 'en' : 'zh'}>
              {d}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
