// REAL lab-report rows — a hand-pulled sample of the public MedRepBench dataset
// (https://huggingface.co/datasets/MedRepBench/MedRepBench, CC BY-NC 4.0; de-identified
// real-world Chinese medical report IMAGES with author-provided gold field annotations).
//
// WHY THIS EXISTS: every green signal we have (316 tests, CheckList 13/13, gate recall
// 1.0, confirm-burden 2/2) is graded against a corpus WE authored and tuned the guard
// against — self-referential. These rows are externally authored, so they measure the
// deterministic pipeline on report content that does NOT encode our assumptions. This is
// the "grounding on real content" half of Prove-the-Number — image-free (gold rows fed
// straight to groundExtraction), so it needs no vision model / API.
//
// PROVENANCE + CAVEATS (be honest about them):
//  - Pulled via WebFetch over the public `datasets-meta-zhCN.csv` (sandbox blocks curl).
//    Values are transcribed VERBATIM incl. the source's OWN OCR noise (e.g. 红蛋白 for
//    血红蛋白, 均血红蛋白里 for 平均血红蛋白量) — that noise is real and part of the test.
//  - A convenience sample of the first ~24 dataset rows, NOT random. Large homogeneous
//    panels that would be ~100% abstain anyway are noted but excluded for size:
//    an IgE allergy microarray (~30 unknown allergens) and two long urinalysis panels.
//    → the TRUE real-world abstain-rate is therefore HIGHER than this sample shows.
//  - The CBC report is capped at the 20 items the fetch returned (it had more).
//  - is_abnormal is the report's OWN flag (relative to the report's printed range), so
//    disagreement with our classification can mean our reference band differs from the
//    lab's — not necessarily a bug. Interpreted accordingly in the runner.

export interface RealItem {
  item_name: string;
  item_value: string;
  item_unit: string;
  item_range: string;
  is_abnormal: string; // '0' normal, '1' abnormal, '' unscored
}
export interface RealReport {
  image: string;
  kind: string; // human label of the panel type (ours, for reading the breakdown)
  items: RealItem[];
}

export const MEDREPBENCH_SAMPLE: RealReport[] = [
  {
    image: 'b1661081666053267500.png',
    kind: 'coagulation',
    items: [
      { item_name: 'PT', item_value: '12.80', item_unit: '', item_range: '9-14', is_abnormal: '0' },
      { item_name: 'PT%', item_value: '86.40', item_unit: '%', item_range: '70-140', is_abnormal: '0' },
      { item_name: 'INR', item_value: '1.14', item_unit: '', item_range: '0.8-1.2', is_abnormal: '0' },
      { item_name: 'APTT', item_value: '26.30', item_unit: 's', item_range: '22.2-32.5', is_abnormal: '0' },
      { item_name: 'Fib', item_value: '1.51', item_unit: 'g/L', item_range: '2-4', is_abnormal: '1' },
      { item_name: 'TT', item_value: '19.00', item_unit: 's', item_range: '14-21', is_abnormal: '0' },
      { item_name: 'D-Dimer', item_value: '0.41', item_unit: 'mg/L(FEU)', item_range: '0-0.55', is_abnormal: '0' },
    ],
  },
  {
    image: 'b1654234121564732458.png',
    kind: 'cardiac markers',
    items: [
      { item_name: '肌钙蛋白I', item_value: '0.00', item_unit: 'ng/ml', item_range: '0-0.04', is_abnormal: '0' },
      { item_name: '肌红蛋白', item_value: '12.1', item_unit: 'ng/ml', item_range: '0-70', is_abnormal: '0' },
      { item_name: '肌酸激酶同工酶质量', item_value: '0.93', item_unit: 'ng/ml', item_range: '0-4.0', is_abnormal: '0' },
    ],
  },
  {
    image: '1000_b_image_1672751880704286725.jpg',
    kind: 'infectious serology',
    items: [
      { item_name: '乙肝病毒表面 抗原', item_value: '0.010', item_unit: 'IU/ml', item_range: '~<0.05', is_abnormal: '0' },
      { item_name: '人类免疫缺陷 病毒抗体/抗原 (P24)', item_value: '0.022', item_unit: 'S/CO', item_range: '~<1', is_abnormal: '0' },
      { item_name: '梅毒螺旋体特 异性抗体', item_value: '0.030', item_unit: 'S/CO', item_range: '~<1', is_abnormal: '0' },
      { item_name: '丙型肝炎病毒 lgG抗体', item_value: '0.227', item_unit: 'S/CO', item_range: '~<1', is_abnormal: '0' },
    ],
  },
  {
    image: 'b1637806968172887230.png',
    kind: 'HBV DNA (E-notation)',
    items: [
      { item_name: 'A磁珠法高灵敏乙肝病毒(HBV)DNA定量检测', item_value: '1.050E+08', item_unit: 'IU/ml', item_range: '<2.000E+01', is_abnormal: '1' },
    ],
  },
  {
    image: 'b1659757548246256875.png',
    kind: 'CBC (capped at 20 items)',
    items: [
      { item_name: '反应蛋白', item_value: '3.03', item_unit: 'mg/L', item_range: '0-8', is_abnormal: '0' },
      { item_name: 'WBC', item_value: '12.9', item_unit: '10^9/L', item_range: '4.9-12.7', is_abnormal: '1' },
      { item_name: 'RBC', item_value: '4.53', item_unit: '10^12/L', item_range: '4.1-5.5', is_abnormal: '0' },
      { item_name: '血小板压积', item_value: '0.3', item_unit: '%', item_range: '0.1-0.3', is_abnormal: '0' },
      { item_name: '红蛋白', item_value: '130', item_unit: 'g/L', item_range: '115-150', is_abnormal: '0' },
      { item_name: 'HCT', item_value: '39', item_unit: '%', item_range: '35-48', is_abnormal: '0' },
      { item_name: '中性粒细胞百分比', item_value: '53.7', item_unit: '%', item_range: '23-64', is_abnormal: '0' },
      { item_name: '淋巴细胞百分比', item_value: '35.6', item_unit: '%', item_range: '26-67', is_abnormal: '0' },
      { item_name: '单核细胞百分比', item_value: '8.0', item_unit: '%', item_range: '2-11', is_abnormal: '0' },
      { item_name: '[细胞平均体积', item_value: '85', item_unit: 'fL', item_range: '76-88', is_abnormal: '0' },
      { item_name: '嗜酸性粒细胞百分比', item_value: '2.6', item_unit: '%', item_range: '0.5-9', is_abnormal: '0' },
      { item_name: '均血红蛋白里', item_value: '29', item_unit: 'pg', item_range: '24-37', is_abnormal: '0' },
      { item_name: '嗜碱性粒细胞百分比', item_value: '0.1', item_unit: '%', item_range: '0-1', is_abnormal: '0' },
      { item_name: '均血红蛋白浓度', item_value: '338', item_unit: 'g/L', item_range: '305-361', is_abnormal: '0' },
      { item_name: '中性粒细胞数', item_value: '6.94', item_unit: '10^9/L', item_range: '1.3-6.7', is_abnormal: '1' },
      { item_name: '淋巴细胞数', item_value: '4.60', item_unit: '10^9/L', item_range: '2.0-6.5', is_abnormal: '0' },
      { item_name: '[细胞分布宽度SD', item_value: '38', item_unit: 'fL', item_range: '37-54', is_abnormal: '0' },
      { item_name: '单核细胞数', item_value: '1.04', item_unit: '10^9/L', item_range: '0.16-0.92', is_abnormal: '1' },
      { item_name: '[细胞分布宽度CV', item_value: '13', item_unit: '%', item_range: '7-14', is_abnormal: '0' },
      { item_name: '嗜酸性粒细胞数', item_value: '0.33', item_unit: '10^9/L', item_range: '0.04-0.74', is_abnormal: '0' },
    ],
  },
  {
    image: 'b1663315950356101563.png',
    kind: 'heavy metals / trace elements',
    items: [
      { item_name: '镉(Cd)', item_value: '64.2000', item_unit: 'μg/L', item_range: '0-200', is_abnormal: '0' },
      { item_name: '铅(Pb)', item_value: '39.7000', item_unit: 'μg/L', item_range: '0-100', is_abnormal: '0' },
      { item_name: '铜(Cu)', item_value: '1.0704', item_unit: 'μg/ml', item_range: '0.65-2.5', is_abnormal: '0' },
      { item_name: '铁(Fe)', item_value: '359.4367', item_unit: 'μg/ml', item_range: '300-530', is_abnormal: '0' },
      { item_name: '锌(Zn)', item_value: '7.0196', item_unit: 'μg/ml', item_range: '4.8-15.6', is_abnormal: '0' },
      { item_name: '钙(Ca)', item_value: '40.6759', item_unit: 'μg/ml', item_range: '50-100', is_abnormal: '1' },
      { item_name: '镁(Mg)', item_value: '35.0286', item_unit: 'ug/ml', item_range: '20-80', is_abnormal: '0' },
    ],
  },
  {
    image: 'b1659182646286163093.png',
    kind: 'urine dipstick (mostly qualitative)',
    items: [
      { item_name: '颜色', item_value: '', item_unit: '', item_range: '', is_abnormal: '' },
      { item_name: '外观', item_value: '微混', item_unit: '', item_range: '', is_abnormal: '' },
      { item_name: '白细胞', item_value: '-', item_unit: '', item_range: '', is_abnormal: '0' },
      { item_name: '亚硝酸盐', item_value: '-', item_unit: '', item_range: '', is_abnormal: '0' },
      { item_name: '尿胆原', item_value: '-', item_unit: 'mg/dl', item_range: '', is_abnormal: '0' },
      { item_name: '蛋白质', item_value: '+-', item_unit: 'mg/dl', item_range: '', is_abnormal: '1' },
      { item_name: '酸碱度', item_value: '5.50', item_unit: '', item_range: '', is_abnormal: '' },
      { item_name: '隐血', item_value: '-', item_unit: '个/ul', item_range: '', is_abnormal: '0' },
      { item_name: '比重', item_value: '1.02', item_unit: '', item_range: '', is_abnormal: '' },
      { item_name: '酮体', item_value: '-', item_unit: '', item_range: '', is_abnormal: '0' },
      { item_name: '胆红素', item_value: '-', item_unit: 'mmol/L', item_range: '', is_abnormal: '0' },
      { item_name: '葡萄糖', item_value: '-', item_unit: 'mg/dl', item_range: '', is_abnormal: '0' },
      { item_name: '抗坏血酸', item_value: '-', item_unit: 'mg/dl', item_range: '', is_abnormal: '0' },
      { item_name: '镜检红细胞', item_value: '', item_unit: '/HP', item_range: '', is_abnormal: '' },
      { item_name: '镜检白细胞', item_value: '-', item_unit: '/HP', item_range: '', is_abnormal: '0' },
      { item_name: '上皮细胞', item_value: '-', item_unit: '/LP', item_range: '', is_abnormal: '0' },
      { item_name: '管型', item_value: '-', item_unit: '/LP', item_range: '', is_abnormal: '0' },
      { item_name: '结晶', item_value: '-', item_unit: '', item_range: '', is_abnormal: '0' },
    ],
  },
  {
    image: '1000_b_image_1683712095887462401.jpg',
    kind: 'thyroid function',
    items: [
      { item_name: ' 促甲状腺激 素受体抗体', item_value: '1.33', item_unit: 'IU/L', item_range: '0--1.75', is_abnormal: '0' },
      { item_name: ' 游离三碘甲 状原氨酸', item_value: '5.01', item_unit: 'pmol/L', item_range: '3.1--6.8', is_abnormal: '0' },
      { item_name: ' 游离甲状腺 素', item_value: '15.89', item_unit: 'pmol/L', item_range: '12--22', is_abnormal: '0' },
      { item_name: ' 促甲状腺激 素', item_value: '2.37', item_unit: 'mlU/L', item_range: '0.27--4.2', is_abnormal: '0' },
    ],
  },
  {
    image: 'b1656326152412474784.png',
    kind: 'cytology (free text)',
    items: [
      { item_name: '细胞量', item_value: '>40%', item_unit: '%', item_range: '', is_abnormal: '0' },
      { item_name: '标本满意度', item_value: '满意', item_unit: '', item_range: '', is_abnormal: '0' },
      { item_name: '诊断意见', item_value: '未见上皮内病变和恶性细胞(NILM),建议定期复查。', item_unit: '', item_range: '', is_abnormal: '0' },
    ],
  },
  {
    image: 'b1637570186606592319.png',
    kind: 'single chemistry (albumin)',
    items: [
      { item_name: '白蛋白', item_value: '42', item_unit: 'g/L', item_range: '40~55', is_abnormal: '0' },
    ],
  },
  {
    image: '1000_b_image_1665624107811405824.jpeg',
    kind: 'HBV serology (quantitative)',
    items: [
      { item_name: ' 乙型肝炎表 面抗原定量', item_value: '0.010', item_unit: 'IU/ml', item_range: '0-0.05', is_abnormal: '0' },
      { item_name: ' 乙型肝炎表 面抗体定量', item_value: '569.412↑', item_unit: 'mlU/ml', item_range: '0-10', is_abnormal: '1' },
      { item_name: ' 乙型肝炎e抗 原定量', item_value: '0.010', item_unit: 'IU/ml', item_range: '0-0.1', is_abnormal: '0' },
      { item_name: ' 乙型肝炎e抗 体定量', item_value: '0.041', item_unit: 'PEIU/ml', item_range: '0-0.15', is_abnormal: '0' },
      { item_name: ' 乙型肝炎核 心抗体定量', item_value: '0.200', item_unit: 'PEIU/ml', item_range: '0-0.7', is_abnormal: '0' },
    ],
  },
];
