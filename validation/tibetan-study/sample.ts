// PRE-REGISTERED ZH->BO validation sample. FROZEN — do not edit after the study starts.
// Generated deterministically from data/reference-labs.ts (20 high-stakes names +
// 10 definitions incl. 6 carrying numbers/units + 6 authored doctor-note strings).
// Source language: Chinese (zh). Target: Tibetan (bo). See PROTOCOL.md.

export interface StudyItem {
  readonly id: string;
  readonly kind: 'name' | 'definition' | 'note';
  readonly zh: string;
}

export const STUDY_SAMPLE: readonly StudyItem[] = [
  { id: 'name:amylase', kind: 'name', zh: '淀粉酶' },
  { id: 'name:anion_gap', kind: 'name', zh: '阴离子间隙' },
  { id: 'name:aptt', kind: 'name', zh: '活化部分凝血活酶时间' },
  { id: 'name:base_excess', kind: 'name', zh: '碱剩余' },
  { id: 'name:bicarbonate', kind: 'name', zh: '碳酸氢盐(二氧化碳结合力)' },
  { id: 'name:blood_ph', kind: 'name', zh: '血气pH' },
  { id: 'name:bnp', kind: 'name', zh: 'B型利钠肽' },
  { id: 'name:bun', kind: 'name', zh: '血尿素氮' },
  { id: 'name:calcium_ionized', kind: 'name', zh: '游离钙(离子钙)' },
  { id: 'name:calcium_total', kind: 'name', zh: '血钙(总钙)' },
  { id: 'name:ck_mb', kind: 'name', zh: '肌酸激酶同工酶' },
  { id: 'name:ckmb_mass', kind: 'name', zh: '肌酸激酶同工酶(质量法)' },
  { id: 'name:creatinine', kind: 'name', zh: '肌酐' },
  { id: 'name:d_dimer', kind: 'name', zh: 'D-二聚体' },
  { id: 'name:direct_bilirubin', kind: 'name', zh: '直接胆红素' },
  { id: 'name:egfr', kind: 'name', zh: '估算肾小球滤过率' },
  { id: 'name:fasting_glucose', kind: 'name', zh: '空腹血糖' },
  { id: 'name:ferritin', kind: 'name', zh: '铁蛋白' },
  { id: 'name:fibrinogen', kind: 'name', zh: '纤维蛋白原' },
  { id: 'name:hba1c', kind: 'name', zh: '糖化血红蛋白' },
  { id: 'def:free_t3', kind: 'definition', zh: '测量血中具有活性的游离T3激素。' },
  { id: 'def:hba1c', kind: 'definition', zh: '反映过去2-3个月的平均血糖。' },
  { id: 'def:lipoprotein_a', kind: 'definition', zh: '一种主要由遗传决定、终身较稳定的胆固醇颗粒。注意mg/dL与nmol/L的结果不能直接换算。' },
  { id: 'def:total_t3', kind: 'definition', zh: '测量血中甲状腺激素T3的总量；与TSH和T4一起检查。' },
  { id: 'def:total_t4', kind: 'definition', zh: '测量血中主要甲状腺激素T4的总量；与TSH一起用于评估甲状腺功能。' },
  { id: 'def:vitamin_b12', kind: 'definition', zh: '维生素B12对神经和血细胞生成很重要。' },
  { id: 'def:alkaline_phosphatase', kind: 'definition', zh: '主要存在于肝脏和骨骼中的一种酶。' },
  { id: 'def:amylase', kind: 'definition', zh: '一种主要来自胰腺和唾液腺的酶。' },
  { id: 'def:anion_gap', kind: 'definition', zh: '根据血液样本中所报告的电解质计算得出的指标。' },
  { id: 'def:apolipoprotein_a1', kind: 'definition', zh: '“好”胆固醇HDL中的主要蛋白。' },
  { id: 'note:1', kind: 'note', zh: '建议3个月后复查血常规。' },
  { id: 'note:2', kind: 'note', zh: '结果基本正常，无需特殊处理，请结合临床。' },
  { id: 'note:3', kind: 'note', zh: '血糖偏高，建议控制饮食并到内分泌科就诊。' },
  { id: 'note:4', kind: 'note', zh: '未见异常，暂不需要用药。' },
  { id: 'note:5', kind: 'note', zh: '肝功能轻度异常，请勿自行停药，两周后复查。' },
  { id: 'note:6', kind: 'note', zh: '该指标明显升高，建议尽快就医。' },
];
