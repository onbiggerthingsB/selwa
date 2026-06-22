'use client';
import { useState, useEffect } from 'react';
import type { GroundedReport, Sex } from '@/lib/types';
import { groundExtraction } from '@/lib/grounding';
import type { LabExtraction } from '@/lib/extractionSchema';

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
      <h2 lang={lang}>{t('Please check these readings', '请核对这些数值')}</h2>
      <p className="confirm-help" lang={lang}>
        {t(
          'Let’s double-check a few numbers from your photo. A tiny difference in a decimal point matters — please confirm each value below matches your report.',
          '让我们核对照片中的几个数值。小数点的微小差异也很重要——请确认下面每个数值与您的报告一致。',
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
                  inputMode="decimal"
                  aria-label={`${t('value', '数值')} ${i}`}
                  value={edits[i].value}
                  onChange={(e) => setEdits({ ...edits, [i]: { ...edits[i], value: e.target.value } })}
                />
                <input
                  aria-label={`${t('unit', '单位')} ${i}`}
                  value={edits[i].unit}
                  onChange={(e) => setEdits({ ...edits, [i]: { ...edits[i], unit: e.target.value } })}
                />
              </div>
              <p className="confirm-hint">{t('Check the decimal point (e.g. 7.0, not 70).', '请核对小数点（例如 7.0，而不是 70）。')}</p>
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
