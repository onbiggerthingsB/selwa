// De-identified real Lhasa tertiary-hospital CBC+CRP, patient consent obtained 2026-07-22.
// This fixture tests transcribed structured-row grounding only, NOT vision/OCR. Verifying OCR
// requires the owner to run the actual report image through the live /api/extract path.

import type { RealReport } from './sample';

export const LHASA_FIELD_SAMPLE: RealReport[] = [
  {
    image: 'field-lhasa-cbc-crp-2026-07-22',
    kind: 'field-lhasa-cbc-crp',
    items: [
      { item_name: '白细胞', item_value: '6.84', item_unit: '10^9/L', item_range: '3.5-9.5', is_abnormal: '0' },
      { item_name: '中性粒细胞绝对值', item_value: '4.89', item_unit: '10^9/L', item_range: '1.8-6.3', is_abnormal: '0' },
      { item_name: '淋巴细胞绝对值', item_value: '1.63', item_unit: '10^9/L', item_range: '1.1-3.2', is_abnormal: '0' },
      { item_name: '单核细胞绝对值', item_value: '0.31', item_unit: '10^9/L', item_range: '0.1-0.6', is_abnormal: '0' },
      { item_name: '嗜酸性粒细胞绝对值', item_value: '0.01', item_unit: '10^9/L', item_range: '0.02-0.52', is_abnormal: '1' },
      { item_name: '嗜碱性粒细胞绝对值', item_value: '0.02', item_unit: '10^9/L', item_range: '0-0.06', is_abnormal: '0' },
      { item_name: '中性粒细胞百分比', item_value: '71.50', item_unit: '%', item_range: '40-75', is_abnormal: '0' },
      { item_name: '淋巴细胞百分比', item_value: '23.80', item_unit: '%', item_range: '20-50', is_abnormal: '0' },
      { item_name: '单核细胞百分比', item_value: '4.60', item_unit: '%', item_range: '3-10', is_abnormal: '0' },
      { item_name: '嗜酸性粒细胞百分比', item_value: '0.10', item_unit: '%', item_range: '0.4-8.0', is_abnormal: '1' },
      { item_name: '嗜碱性粒细胞百分比', item_value: '0.30', item_unit: '%', item_range: '0-1', is_abnormal: '0' },
      { item_name: '红细胞', item_value: '4.34', item_unit: '10^12/L', item_range: '3.8-5.1', is_abnormal: '0' },
      { item_name: '血红蛋白', item_value: '129.00', item_unit: 'g/L', item_range: '115-150', is_abnormal: '0' },
      { item_name: '红细胞压积', item_value: '38.30', item_unit: '%', item_range: '35-45', is_abnormal: '0' },
      { item_name: '平均红细胞体积', item_value: '88.20', item_unit: 'fl', item_range: '82-100', is_abnormal: '0' },
      { item_name: '平均血红蛋白量', item_value: '29.70', item_unit: 'pg', item_range: '27-34', is_abnormal: '0' },
      { item_name: '平均血红蛋白浓度', item_value: '337.00', item_unit: 'g/L', item_range: '316-354', is_abnormal: '0' },
      { item_name: '红细胞分布宽度SD', item_value: '42.90', item_unit: 'fL', item_range: '35.0-56.0', is_abnormal: '0' },
      { item_name: '红细胞分布宽度CV', item_value: '12.60', item_unit: '%', item_range: '11.0-16.0', is_abnormal: '0' },
      { item_name: '血小板计数', item_value: '211.00', item_unit: '10^9/L', item_range: '125-350', is_abnormal: '0' },
      { item_name: '血小板压积', item_value: '0.23', item_unit: '%', item_range: '0.108-0.282', is_abnormal: '0' },
      { item_name: '平均血小板体积', item_value: '11.10', item_unit: 'fl', item_range: '7.7-13.1', is_abnormal: '0' },
      { item_name: '血小板分布宽度', item_value: '16.70', item_unit: 'fl', item_range: '9.0-17.0', is_abnormal: '0' },
      { item_name: '大血小板比率', item_value: '34.30', item_unit: '%', item_range: '11-45.0', is_abnormal: '0' },
      { item_name: '大血小板计数', item_value: '72.00', item_unit: '10^9/L', item_range: '30-90', is_abnormal: '0' },
      { item_name: 'C反应蛋白', item_value: '10.63', item_unit: 'mg/L', item_range: '0-10', is_abnormal: '1' },
      { item_name: '超敏C反应蛋白', item_value: '10.00', item_unit: 'mg/L', item_range: '0-4', is_abnormal: '1' },
    ],
  },
];
