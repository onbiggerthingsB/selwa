'use client';
import { useState, useEffect } from 'react';
import type { GroundedReport, Sex } from '@/lib/types';
import { groundExtraction } from '@/lib/grounding';
import type { LabExtraction } from '@/lib/extractionSchema';
import { parseScalar } from '@/lib/reference';
import {
  LANGUAGE_CONFIG,
  resolvePrimarySecondary,
  resolveText,
  type Lang,
} from '@/lib/i18n';
import { UI_COPY } from '@/lib/uiCopy';
import { LocalizedText } from '@/components/LocalizedText';

export function ConfirmValues({
  report,
  lang,
  onConfirmed,
}: {
  report: GroundedReport;
  lang: Lang;
  onConfirmed: (confirmed: GroundedReport) => void;
}) {
  const toConfirm = report.rows.filter((r) => r.needsConfirm);

  const [edits, setEdits] = useState<Record<number, { value: string; unit: string }>>(() => {
    const init: Record<number, { value: string; unit: string }> = {};
    report.rows.forEach((r, i) => {
      if (r.needsConfirm) init[i] = { value: r.extracted.value ?? '', unit: r.extracted.unit ?? '' };
    });
    return init;
  });

  // Nothing to confirm → pass through unchanged (effect avoids setState-in-render).
  useEffect(() => {
    if (toConfirm.length === 0) onConfirmed(report);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit() {
    const rows = report.rows.map((r, i) =>
      edits[i] ? { ...r.extracted, value: edits[i].value, unit: edits[i].unit } : r.extracted,
    );
    const extraction: LabExtraction = { rows };
    const regrounded: GroundedReport = {
      ...groundExtraction(extraction, report.sex as Sex, report.age),
      generatedAt: report.generatedAt,
    };
    onConfirmed(regrounded);
  }

  if (toConfirm.length === 0) return null;

  return (
    <div className="confirm">
      <p className="eyebrow" style={{ marginBottom: 6 }}>
        <LocalizedText value={UI_COPY.confirmEyebrow} lang={lang} />
      </p>
      <h2>
        <LocalizedText value={UI_COPY.confirmHeading} lang={lang} />
      </h2>
      <p className="confirm-help">
        <LocalizedText value={UI_COPY.confirmHelp} lang={lang} />
      </p>

      <ul className="confirm-list">
        {report.rows.map((r, i) =>
          r.needsConfirm ? (
            <li key={i} className="confirm-row">
              <div className="confirm-name">
                {r.entry ? (
                  (() => {
                    const names = resolvePrimarySecondary(r.entry.name, lang);
                    return (
                      <>
                        <LocalizedText value={r.entry.name} lang={lang} />
                        {names.secondary.text !== names.primary.text && (
                          <LocalizedText
                            className={
                              names.secondary.resolvedLang === 'zh' ? 'zh' : undefined
                            }
                            value={r.entry.name}
                            lang={LANGUAGE_CONFIG[lang].secondary}
                          />
                        )}
                      </>
                    );
                  })()
                ) : (
                  r.extracted.name
                )}
              </div>
              <div className="confirm-inputs">
                <input
                  className="num"
                  inputMode={parseScalar(r.extracted.value) === null ? 'text' : 'decimal'}
                  aria-label={`${resolveText(UI_COPY.result, lang).text} ${i}`}
                  value={edits[i].value}
                  onChange={(e) => setEdits({ ...edits, [i]: { ...edits[i], value: e.target.value } })}
                />
                <input
                  aria-label={`${resolveText(UI_COPY.unit, lang).text} ${i}`}
                  value={edits[i].unit}
                  onChange={(e) => setEdits({ ...edits, [i]: { ...edits[i], unit: e.target.value } })}
                />
              </div>
              <p className="confirm-hint">
                <LocalizedText
                  value={
                    parseScalar(r.extracted.value) === null
                      ? UI_COPY.qualitativeHint
                      : UI_COPY.decimalHint
                  }
                  lang={lang}
                />
              </p>
            </li>
          ) : null,
        )}
      </ul>

      <button className="btn btn-primary btn-block" onClick={submit}>
        <LocalizedText value={UI_COPY.confirmContinue} lang={lang} />
      </button>
    </div>
  );
}
