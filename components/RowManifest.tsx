'use client';
import type { GroundedReport } from '@/lib/types';
import type { Lang } from '@/lib/i18n';
import { UI_COPY } from '@/lib/uiCopy';
import { LocalizedText } from '@/components/LocalizedText';

// COMPLETENESS GATE. The extract route fails closed when the model returns ZERO rows, but a
// PARTIAL read — 8 of 11 printed rows — still produces a perfectly confident screen, and a
// silently dropped abnormal row reads to the user as reassurance. Nothing in the pipeline can
// detect this: grounding and summary are 1:1 maps over whatever arrived, and the photo is not
// carried to /result, so the app has no copy of the page to corroborate against.
//
// So we do not try to guess what was dropped. We hand verification to the only party who can see
// the page — the person holding it (or, per the Lhasa field finding, a family member nearby who
// reads Chinese). This is deliberately failure-distribution-independent: it needs only a count and
// a verbatim echo, so it does not depend on knowing how OCR fails, which we have not yet measured.
//
// The list is a VERBATIM echo of what was read off the page: the report's own printed name, value
// and unit, with no curated-table name, no interpretation and no status chip. Anything else would
// invite the user to check our reading against our own translation of it rather than against the
// paper. It renders BEFORE any interpretation for the same reason.
export function RowManifest({
  report,
  lang,
  onAcknowledged,
  onRetake,
}: {
  report: GroundedReport;
  lang: Lang;
  onAcknowledged: () => void;
  onRetake: () => void;
}) {
  return (
    <section className="manifest" aria-labelledby="manifest-heading">
      <p className="eyebrow">
        <LocalizedText value={UI_COPY.manifestEyebrow} lang={lang} />
      </p>
      <h2 id="manifest-heading">
        {report.rows.length}{' '}
        <LocalizedText value={UI_COPY.manifestCountLabel} lang={lang} />
      </h2>
      <p className="manifest-help">
        <LocalizedText value={UI_COPY.manifestHelp} lang={lang} />
      </p>

      <ul className="manifest-list" data-testid="manifest-list">
        {report.rows.map((row, i) => (
          <li key={i} className="manifest-row">
            {/* Verbatim OCR text in the report's own language — deliberately NOT localized and
                NOT run through defineText: it is the page's own words, not a translation. */}
            <span className="manifest-name">{row.extracted.name}</span>
            <span className="manifest-value">
              {row.extracted.value ?? ''}
              {row.extracted.unit ? ` ${row.extracted.unit}` : ''}
            </span>
          </li>
        ))}
      </ul>

      <div className="manifest-actions">
        <button className="btn btn-primary btn-block" onClick={onAcknowledged}>
          <LocalizedText value={UI_COPY.manifestConfirmCta} lang={lang} />
        </button>
        <button className="btn btn-ghost btn-block" onClick={onRetake}>
          <LocalizedText value={UI_COPY.manifestMissingCta} lang={lang} />
        </button>
      </div>
    </section>
  );
}
