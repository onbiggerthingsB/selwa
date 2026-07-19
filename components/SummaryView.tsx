'use client';
import type { GroundedReport } from '@/lib/types';
import { buildSummary, type Lang, type SummaryFlag, type SummarySection } from '@/lib/summary';
import {
  LANGUAGE_CONFIG,
  resolvePrimarySecondary,
  resolveText,
} from '@/lib/i18n';
import { LocalizedText } from '@/components/LocalizedText';
import { DISCLAIMER_TEXTS } from '@/lib/disclaimers';
import { UI_COPY } from '@/lib/uiCopy';

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
  const name = resolvePrimarySecondary(s.name, lang);
  const chip = resolvePrimarySecondary(s.chip, lang);
  const plain = resolvePrimarySecondary(s.plain, lang);
  const secondaryLang = LANGUAGE_CONFIG[lang].secondary;

  return (
    <li className={`row status-${s.tone}`}>
      <div className="row-head">
        <div className="row-name">
          <div className={`name-primary ${name.primary.resolvedLang === 'zh' ? 'zh' : ''}`}>
            <LocalizedText value={s.name} lang={lang} />
          </div>
          {name.secondary.text !== name.primary.text && (
            <div
              className={`name-secondary ${name.secondary.resolvedLang === 'zh' ? 'zh' : ''}`}
            >
              <LocalizedText value={s.name} lang={secondaryLang} />
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
        <LocalizedText value={s.chip} lang={lang} />
        {chip.secondary.text !== chip.primary.text && (
          <span className={chip.secondary.resolvedLang === 'zh' ? 'zh' : undefined} aria-hidden>
            {'· '}
            <LocalizedText value={s.chip} lang={secondaryLang} />
          </span>
        )}
      </span>

      {plain.primary.text && (
        <p className="row-plain">
          <LocalizedText value={s.plain} lang={lang} />
          {plain.secondary.text && plain.secondary.text !== plain.primary.text && (
            <span
              className={`plain-secondary ${plain.secondary.resolvedLang === 'zh' ? 'zh' : ''}`}
            >
              <LocalizedText value={s.plain} lang={secondaryLang} />
            </span>
          )}
        </p>
      )}

      {s.flags.length > 0 && (
        <div className="flags">
          {s.flags.map((f: SummaryFlag, i) => (
            <div key={i} className={`flag flag-${f.severity}`}>
              <FlagIcon severity={f.severity} />
              <LocalizedText value={f.message} lang={lang} />
            </div>
          ))}
        </div>
      )}

      {(s.reportRange || s.typicalRange || s.source) && (
        <div className="row-foot">
          {s.reportRange && (
            <span className="ref num">
              <LocalizedText value={UI_COPY.reportRange} lang={lang} />
              {s.reportRange}
            </span>
          )}
          {s.typicalRange && (
            <span className="ref num">
              <LocalizedText value={UI_COPY.typicalRange} lang={lang} />
              {s.typicalRange}
            </span>
          )}
          {s.source && (
            <span className="src">
              <LocalizedText value={UI_COPY.source} lang={lang} />
              {s.source}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

export function SummaryView({ report, lang }: { report: GroundedReport; lang: Lang }) {
  const { sections } = buildSummary(report, lang);
  const [lead, ...rest] = DISCLAIMER_TEXTS;
  return (
    <div className="summary">
      <ul className="rows">
        {sections.map((s) => (
          <Section key={s.key} s={s} lang={lang} />
        ))}
      </ul>
      <section
        className="disclaimers"
        aria-label={resolveText(UI_COPY.aboutSummary, lang).text}
      >
        <p
          className={`disc-lead ${resolveText(lead, lang).resolvedLang === 'zh' ? 'zh' : ''}`}
        >
          <FlagIcon severity="info" />
          <LocalizedText value={lead} lang={lang} />
        </p>
        <ul>
          {rest.map((d, i) => (
            <li
              key={i}
              className={resolveText(d, lang).resolvedLang === 'zh' ? 'zh' : undefined}
            >
              <LocalizedText value={d} lang={lang} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
