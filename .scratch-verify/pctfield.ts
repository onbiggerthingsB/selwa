import { groundExtraction } from '@/lib/grounding';
import { buildSummary } from '@/lib/summary';
import { resolveText } from '@/lib/i18n';

// The five differential % rows AS PRINTED on the de-identified Lhasa field CBC
// (validation/real-corpus/field-lhasa.ts:18-22), each with a ONE-PLACE decimal shift —
// the classic OCR error this table's absolute bounds exist to catch.
const ROWS: [string, string, string, string][] = [
  ['中性粒细胞百分比', '715.0', '%', '40-75'],   // printed 71.50
  ['淋巴细胞百分比', '238.0', '%', '20-50'],     // printed 23.80
  ['单核细胞百分比', '46.0', '%', '3-10'],       // printed 4.60
  ['嗜酸性粒细胞百分比', '1.0', '%', '0.4-8.0'], // printed 0.10
  ['嗜碱性粒细胞百分比', '3.0', '%', '0-1'],     // printed 0.30
];

const report = groundExtraction(
  {
    rows: ROWS.map(([name, value, unit, printedRange]) => ({
      name,
      value,
      unit,
      printedRange,
      confidence: 'high' as const,
      specimen: 'blood' as const,
    })),
  } as never,
  'female',
  52,
);
const { sections } = buildSummary(report, 'en');

report.rows.forEach((row, i) => {
  const s = sections[i];
  console.log(
    `${row.extracted.name.padEnd(12)} ${String(row.extracted.value).padStart(6)} %  ` +
      `action=${row.action.padEnd(8)} needsConfirm=${String(row.needsConfirm).padEnd(5)} ` +
      `flags=[${row.flags.map((f) => f.id).join(',') || ''}]  ` +
      `chip="${resolveText(s.chip, 'en').text}"  typical="${s.typicalRange}"`,
  );
});
