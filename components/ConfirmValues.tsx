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

  // Nothing to confirm → pass through unchanged (run as an effect to avoid setState-in-render).
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
      ...groundExtraction(extraction, report.sex as Sex),
      generatedAt: report.generatedAt,
    };
    onConfirmed(regrounded);
  }

  if (toConfirm.length === 0) return null;

  return (
    <div className="confirm">
      <h2>{t('Please check these readings', '请核对以下读数')}</h2>
      <p className="confirm-help">
        {t(
          'Check the decimal point and units against your report (e.g. 7.0, not 70).',
          '请对照报告核对小数点和单位（例如 7.0，而不是 70）。',
        )}
      </p>
      <ul>
        {report.rows.map((r, i) =>
          r.needsConfirm ? (
            <li key={i} className="confirm-row">
              <span className="confirm-name">
                {lang === 'zh' ? r.entry?.nameZh ?? r.extracted.name : r.entry?.nameEn ?? r.extracted.name}
              </span>
              <input
                aria-label={`value ${i}`}
                value={edits[i].value}
                onChange={(e) => setEdits({ ...edits, [i]: { ...edits[i], value: e.target.value } })}
              />
              <input
                aria-label={`unit ${i}`}
                value={edits[i].unit}
                onChange={(e) => setEdits({ ...edits, [i]: { ...edits[i], unit: e.target.value } })}
              />
            </li>
          ) : null,
        )}
      </ul>
      <button onClick={submit}>{t('Confirm and continue', '确认并继续')}</button>
    </div>
  );
}
