// FROZEN RECORD — first real camera-path OCR measurement, 2026-07-25.
//
// De-identified: analyte rows only. The source photo is NOT committed (it carries the patient's
// name, medical-record number and barcode); see README.md for what was run.
//
// Three independent runs of the PRODUCTION path against the same photo of page 1 of a real
// Lhasa CBC report: claude-opus-4-8 + the EXTRACTION_PROMPT from lib/extractionSchema.ts + the
// same forced-tool output shape as app/api/extract/route.ts. Ground truth is the hand
// transcription frozen in validation/real-corpus/field-lhasa.ts.
//
// Kept verbatim so the two value errors — and the fact that they are INVISIBLE to chipWrong —
// stay reviewable. Do not "fix" these rows: being wrong is the finding.

export interface CameraPathRow {
  name: string;
  value: string | null;
  unit: string | null;
  printedRange: string | null;
  printedFlagRaw?: string | null;
  confidence: 'low' | 'medium' | 'high';
}

export const CAMERA_PATH_RUNS_2026_07_25: readonly (readonly CameraPathRow[])[] = [
  // ---- run 1 ----
  [
    { name: '白细胞 WBC', value: '6.84', unit: '*10^9/L', printedRange: '3.5-9.5', printedFlagRaw: null, confidence: 'high' },
    { name: '中性粒细胞绝对值 NEUT#', value: '4.89', unit: '*10^9/L', printedRange: '1.8-6.3', printedFlagRaw: null, confidence: 'high' },
    { name: '淋巴细胞绝对值 LYMPH#', value: '1.63', unit: '*10^9/L', printedRange: '1.1-3.2', printedFlagRaw: null, confidence: 'high' },
    { name: '单核细胞绝对值 MONO#', value: '0.31', unit: '*10^9/L', printedRange: '0.1-0.6', printedFlagRaw: null, confidence: 'high' },
    { name: '嗜酸性粒细胞绝对值 EO', value: '0.01', unit: '*10^9/L', printedRange: '0.02-0.52', printedFlagRaw: '* ↓', confidence: 'high' },
    { name: '嗜碱性粒细胞绝对值 BASO', value: '0.01', unit: '*10^9/L', printedRange: '0-0.06', printedFlagRaw: null, confidence: 'high' },
    { name: '中性粒细胞百分比 NEUT%', value: '71.50', unit: '%', printedRange: '40-75', printedFlagRaw: null, confidence: 'high' },
    { name: '淋巴细胞百分比 LYMPH%', value: '23.80', unit: '%', printedRange: '20-50', printedFlagRaw: null, confidence: 'high' },
    { name: '单核细胞百分比 MONO%', value: '4.60', unit: '%', printedRange: '3-10', printedFlagRaw: null, confidence: 'high' },
    { name: '嗜酸性粒细胞百分比 EO%', value: '0.10', unit: '%', printedRange: '0.4-8.0', printedFlagRaw: '* ↓', confidence: 'high' },
    { name: '嗜碱性粒细胞百分比 BASO%', value: '0.10', unit: '%', printedRange: '0-1', printedFlagRaw: null, confidence: 'high' },
    { name: '红细胞 RBC', value: '4.34', unit: '*10^12/L', printedRange: '3.8-5.1', printedFlagRaw: null, confidence: 'high' },
    { name: '血红蛋白 HGB', value: '129.00', unit: 'g/L', printedRange: '115-150', printedFlagRaw: null, confidence: 'high' },
    { name: '红细胞压积 HCT', value: '38.30', unit: '%', printedRange: '35-45', printedFlagRaw: null, confidence: 'high' },
    { name: '平均红细胞体积 MCV', value: '88.20', unit: 'fl', printedRange: '82-100', printedFlagRaw: null, confidence: 'high' },
    { name: '平均血红蛋白含量 MCH', value: '29.70', unit: 'pg', printedRange: '27-34', printedFlagRaw: null, confidence: 'high' },
    { name: '平均血红蛋白浓度 MCHC', value: '337.00', unit: 'g/L', printedRange: '316-354', printedFlagRaw: null, confidence: 'high' },
    { name: '红细胞分布宽度标准差 RDW-SD', value: '42.90', unit: 'fL', printedRange: '35.0-56.0', printedFlagRaw: null, confidence: 'high' },
    { name: '红细胞分布宽度变异系数 RDW-CV', value: '12.60', unit: '%', printedRange: '11.0-16.0', printedFlagRaw: null, confidence: 'high' },
    { name: '血小板 PLT', value: '211.00', unit: '*10^9/L', printedRange: '125-350', printedFlagRaw: null, confidence: 'high' },
    { name: '血小板压积 PCT', value: '0.23', unit: '%', printedRange: '0.108-0.282', printedFlagRaw: null, confidence: 'high' },
    { name: '平均血小板体积 MPV', value: '11.10', unit: 'fl', printedRange: '7.7-13.1', printedFlagRaw: null, confidence: 'high' },
    { name: '血小板分布宽度 PDW', value: '16.70', unit: 'fl', printedRange: '9.0-17.0', printedFlagRaw: null, confidence: 'high' },
    { name: '大血小板比率 P-LCR', value: '34.30', unit: '%', printedRange: '11-45.0', printedFlagRaw: null, confidence: 'high' },
    { name: '大血小板数目 P_LCC', value: '72.00', unit: '*10^9/L', printedRange: '30-90', printedFlagRaw: null, confidence: 'high' },
  ],
  // ---- run 2 ----
  [
    { name: '白细胞 WBC', value: '6.84', unit: '*10^9/L', printedRange: '3.5-9.5', printedFlagRaw: null, confidence: 'high' },
    { name: '中性粒细胞绝对值 NEUT#', value: '4.89', unit: '*10^9/L', printedRange: '1.8-6.3', printedFlagRaw: null, confidence: 'high' },
    { name: '淋巴细胞绝对值 LYMPH#', value: '1.63', unit: '*10^9/L', printedRange: '1.1-3.2', printedFlagRaw: null, confidence: 'high' },
    { name: '单核细胞绝对值 MONO#', value: '0.31', unit: '*10^9/L', printedRange: '0.1-0.6', printedFlagRaw: null, confidence: 'high' },
    { name: '嗜酸性粒细胞绝对值 EO', value: '0.01', unit: '*10^9/L', printedRange: '0.02-0.52', printedFlagRaw: '* ↓', confidence: 'high' },
    { name: '嗜碱性粒细胞绝对值 BASO', value: '0.01', unit: '*10^9/L', printedRange: '0-0.06', printedFlagRaw: null, confidence: 'high' },
    { name: '中性粒细胞百分比 NEUT%', value: '71.50', unit: '%', printedRange: '40-75', printedFlagRaw: null, confidence: 'high' },
    { name: '淋巴细胞百分比 LYMPH%', value: '23.80', unit: '%', printedRange: '20-50', printedFlagRaw: null, confidence: 'high' },
    { name: '单核细胞百分比 MONO%', value: '4.60', unit: '%', printedRange: '3-10', printedFlagRaw: null, confidence: 'high' },
    { name: '嗜酸性粒细胞百分比 EO%', value: '0.10', unit: '%', printedRange: '0.4-8.0', printedFlagRaw: '* ↓', confidence: 'high' },
    { name: '嗜碱性粒细胞百分比 BASO%', value: '0.10', unit: '%', printedRange: '0-1', printedFlagRaw: null, confidence: 'high' },
    { name: '红细胞 RBC', value: '4.34', unit: '*10^12/L', printedRange: '3.8-5.1', printedFlagRaw: null, confidence: 'high' },
    { name: '血红蛋白 HGB', value: '129.00', unit: 'g/L', printedRange: '115-150', printedFlagRaw: null, confidence: 'high' },
    { name: '红细胞压积 HCT', value: '38.30', unit: '%', printedRange: '35-45', printedFlagRaw: null, confidence: 'high' },
    { name: '平均红细胞体积 MCV', value: '88.20', unit: 'fl', printedRange: '82-100', printedFlagRaw: null, confidence: 'high' },
    { name: '平均血红蛋白含量 MCH', value: '29.70', unit: 'pg', printedRange: '27-34', printedFlagRaw: null, confidence: 'high' },
    { name: '平均血红蛋白浓度 MCHC', value: '337.00', unit: 'g/L', printedRange: '316-354', printedFlagRaw: null, confidence: 'high' },
    { name: '红细胞分布宽度标准差 RDW-SD', value: '42.90', unit: 'fL', printedRange: '35.0-56.0', printedFlagRaw: null, confidence: 'high' },
    { name: '红细胞分布宽度变异系数 RDW-CV', value: '12.60', unit: '%', printedRange: '11.0-16.0', printedFlagRaw: null, confidence: 'high' },
    { name: '血小板 PLT', value: '211.00', unit: '*10^9/L', printedRange: '125-350', printedFlagRaw: null, confidence: 'high' },
    { name: '血小板压积 PCT', value: '0.23', unit: '%', printedRange: '0.108-0.282', printedFlagRaw: null, confidence: 'high' },
    { name: '平均血小板体积 MPV', value: '11.10', unit: 'fl', printedRange: '7.7-13.1', printedFlagRaw: null, confidence: 'high' },
    { name: '血小板分布宽度 PDW', value: '16.70', unit: 'fl', printedRange: '9.0-17.0', printedFlagRaw: null, confidence: 'high' },
    { name: '大血小板比率 P-LCR', value: '34.30', unit: '%', printedRange: '11-45.0', printedFlagRaw: null, confidence: 'high' },
    { name: '大血小板数目 P-LCC', value: '72.00', unit: '*10^9/L', printedRange: '30-90', printedFlagRaw: null, confidence: 'high' },
  ],
  // ---- run 3 ----
  [
    { name: '白细胞 WBC', value: '6.84', unit: '*10^9/L', printedRange: '3.5-9.5', printedFlagRaw: null, confidence: 'high' },
    { name: '中性粒细胞绝对值 NEUT#', value: '4.89', unit: '*10^9/L', printedRange: '1.8-6.3', printedFlagRaw: null, confidence: 'high' },
    { name: '淋巴细胞绝对值 LYMPH#', value: '1.63', unit: '*10^9/L', printedRange: '1.1-3.2', printedFlagRaw: null, confidence: 'high' },
    { name: '单核细胞绝对值 MONO#', value: '0.31', unit: '*10^9/L', printedRange: '0.1-0.6', printedFlagRaw: null, confidence: 'high' },
    { name: '嗜酸性粒细胞绝对值 EO', value: '0.01', unit: '*10^9/L', printedRange: '0.02-0.52', printedFlagRaw: '* ↓', confidence: 'high' },
    { name: '嗜碱性粒细胞绝对值 BASO', value: '0.00', unit: '*10^9/L', printedRange: '0-0.06', printedFlagRaw: null, confidence: 'high' },
    { name: '中性粒细胞百分比 NEUT%', value: '71.50', unit: '%', printedRange: '40-75', printedFlagRaw: null, confidence: 'high' },
    { name: '淋巴细胞百分比 LYMPH%', value: '23.80', unit: '%', printedRange: '20-50', printedFlagRaw: null, confidence: 'high' },
    { name: '单核细胞百分比 MONO%', value: '4.60', unit: '%', printedRange: '3-10', printedFlagRaw: null, confidence: 'high' },
    { name: '嗜酸性粒细胞百分比 EO%', value: '0.10', unit: '%', printedRange: '0.4-8.0', printedFlagRaw: '* ↓', confidence: 'high' },
    { name: '嗜碱性粒细胞百分比 BASO%', value: '0.10', unit: '%', printedRange: '0-1', printedFlagRaw: null, confidence: 'high' },
    { name: '红细胞 RBC', value: '4.34', unit: '*10^12/L', printedRange: '3.8-5.1', printedFlagRaw: null, confidence: 'high' },
    { name: '血红蛋白 HGB', value: '129.00', unit: 'g/L', printedRange: '115-150', printedFlagRaw: null, confidence: 'high' },
    { name: '红细胞压积 HCT', value: '38.30', unit: '%', printedRange: '35-45', printedFlagRaw: null, confidence: 'high' },
    { name: '平均红细胞体积 MCV', value: '88.20', unit: 'fl', printedRange: '82-100', printedFlagRaw: null, confidence: 'high' },
    { name: '平均血红蛋白含量 MCH', value: '29.70', unit: 'pg', printedRange: '27-34', printedFlagRaw: null, confidence: 'high' },
    { name: '平均血红蛋白浓度 MCHC', value: '337.00', unit: 'g/L', printedRange: '316-354', printedFlagRaw: null, confidence: 'high' },
    { name: '红细胞分布宽度标准差 RDW-SD', value: '42.90', unit: 'fL', printedRange: '35.0-56.0', printedFlagRaw: null, confidence: 'high' },
    { name: '红细胞分布宽度变异系数 RDW-CV', value: '12.60', unit: '%', printedRange: '11.0-16.0', printedFlagRaw: null, confidence: 'high' },
    { name: '血小板 PLT', value: '211.00', unit: '*10^9/L', printedRange: '125-350', printedFlagRaw: null, confidence: 'high' },
    { name: '血小板压积 PCT', value: '0.23', unit: '%', printedRange: '0.108-0.282', printedFlagRaw: null, confidence: 'high' },
    { name: '平均血小板体积 MPV', value: '11.10', unit: 'fl', printedRange: '7.7-13.1', printedFlagRaw: null, confidence: 'high' },
    { name: '血小板分布宽度 PDW', value: '16.70', unit: 'fl', printedRange: '9.0-17.0', printedFlagRaw: null, confidence: 'high' },
    { name: '大血小板比率 P-LCR', value: '34.30', unit: '%', printedRange: '11-45.0', printedFlagRaw: null, confidence: 'high' },
    { name: '大血小板数目 P-LCC', value: '72.00', unit: '*10^9/L', printedRange: '30-90', printedFlagRaw: null, confidence: 'high' },
  ],
];
