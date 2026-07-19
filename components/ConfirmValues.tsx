'use client';
import { useState, useEffect } from 'react';
import type { GroundedReport, Sex } from '@/lib/types';
import { groundExtraction } from '@/lib/grounding';
import type { LabExtraction } from '@/lib/extractionSchema';
import { parseScalar } from '@/lib/reference';

export function ConfirmValues({
  report,
  lang,
  onConfirmed,
}: {
  report: GroundedReport;
  lang: 'en' | 'zh';
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

  const t = (en: string, zh: string) => (lang === 'zh' ? zh : en);

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
      <p className="eyebrow" style={{ marginBottom: 6 }}>{t('One quick step', '快速一步')}</p>
      <h2 lang={lang}>{t('Please check these readings', '请核对这些结果')}</h2>
      <p className="confirm-help" lang={lang}>
        {t(
          'Let’s double-check a few results from your photo. Please confirm each result and unit below matches your report exactly.',
          '让我们核对照片中的几项结果。请确认下面每项结果和单位与您的报告完全一致。',
        )}
      </p>

      <ul className="confirm-list">
        {report.rows.map((r, i) =>
          r.needsConfirm ? (
            <li key={i} className="confirm-row">
              <div className="confirm-name">
                {lang === 'zh' ? r.entry?.nameZh ?? r.extracted.name : r.entry?.nameEn ?? r.extracted.name}
                {r.entry && (
                  <span className="zh" lang={lang === 'zh' ? 'en' : 'zh'}>
                    {lang === 'zh' ? r.entry.nameEn : r.entry.nameZh}
                  </span>
                )}
              </div>
              <div className="confirm-inputs">
                <input
                  className="num"
                  inputMode={parseScalar(r.extracted.value) === null ? 'text' : 'decimal'}
                  aria-label={`${t('result', '结果')} ${i}`}
                  value={edits[i].value}
                  onChange={(e) => setEdits({ ...edits, [i]: { ...edits[i], value: e.target.value } })}
                />
                <input
                  aria-label={`${t('unit', '单位')} ${i}`}
                  value={edits[i].unit}
                  onChange={(e) => setEdits({ ...edits, [i]: { ...edits[i], unit: e.target.value } })}
                />
              </div>
              <p className="confirm-hint">
                {parseScalar(r.extracted.value) === null
                  ? t(
                      'Check the result text and symbols exactly as printed.',
                      '请逐字核对报告上打印的结果和符号。',
                    )
                  : t(
                      'Check the decimal point (e.g. 7.0, not 70).',
                      '请核对小数点（例如 7.0，而不是 70）。',
                    )}
              </p>
            </li>
          ) : null,
        )}
      </ul>

      <button className="btn btn-primary btn-block" onClick={submit}>
        {t('Confirm and continue', '确认并继续')}
      </button>
    </div>
  );
}
