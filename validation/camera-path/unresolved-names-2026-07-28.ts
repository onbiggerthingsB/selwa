// FROZEN RECOGNITION EVIDENCE — 2026-07-28.
//
// A 31-page Lhasa comprehensive health check (体检报告), photographed with the patient's consent
// and replayed through findEntry(). Recognition at the time: 107 of 129 rows = 82.9%. These are
// the 22 distinct printed row names that did NOT resolve.
//
// NO IMAGES AND NO PATIENT DATA ARE COMMITTED. Only the printed row LABELS are recorded here;
// they carry no identifying information.
//
// This list is a frozen record, not a target. The three groups below encode a DECISION each:
// what we curated, what we curated under a different spelling, and what we deliberately declined.

/** GOAL A — bone densitometry. An entire modality the table did not cover. */
export const BONE_DENSITOMETRY_NAMES_2026_07_28 = [
  ['T11 BMD', 'bone_bmd_t11'],
  ['T11 BMC', 'bone_bmc_t11'],
  ['T11 T值', 'bone_t_score_t11'],
  ['T11 Z值', 'bone_z_score_t11'],
  ['T12 BMD', 'bone_bmd_t12'],
  ['T12 BMC', 'bone_bmc_t12'],
  ['T12 T值', 'bone_t_score_t12'],
  ['T12 Z值', 'bone_z_score_t12'],
  ['L1 BMD', 'bone_bmd_l1'],
  ['L1 BMC', 'bone_bmc_l1'],
  ['L1 T值', 'bone_t_score_l1'],
  ['L1 Z值', 'bone_z_score_l1'],
  ['均值 BMD', 'bone_bmd_mean'],
  ['均值 BMC', 'bone_bmc_mean'],
  ['均值 T值', 'bone_t_score_mean'],
  ['均值 Z值', 'bone_z_score_mean'],
] as const;

/** GOAL B — spellings the table already covered under a different spelling. */
export const RESPELLED_NAMES_2026_07_28 = [
  // 'HC03' is printed with a DIGIT ZERO where the chemical symbol HCO3 has a letter O.
  ['血清碳酸氢盐（HC03）测定', 'bicarbonate'],
  // A dropped 腺 vs the curated 血清三碘甲状腺原氨酸(T3). Already recorded as OCR instability in
  // validation/camera-path/full-report-2026-07-26.md.
  ['血清三碘甲状原氨酸(T3)', 'total_t3'],
] as const;

/**
 * Names we read and DELIBERATELY do not resolve. Each carries its reason. These are decisions
 * with owners, not a backlog: a future pass that makes one of them resolve must delete its line
 * here and say why.
 */
export const DECLINED_NAMES_2026_07_28 = [
  [
    '血清胱抑素',
    'Cystatins A, B and C are distinct proteins and the page did not print the subtype. '
      + 'lib/reference.test.ts already locks a bare 胱抑素 as unknown; naming it Cystatin C would '
      + 'assert a subtype the page does not show.',
  ],
  [
    '检测结果:DOB',
    'The 13C urea breath test. Removed from the table on 2026-07-28 because it was falsely '
      + "specimen: 'blood' (it is a breath assay) and its DOB abbreviation collides with date of "
      + 'birth. It needs a breath specimen frame first.',
  ],
  ['基础代谢率', 'Basal metabolic rate. Out of scope for this pass; no frame decided.'],
  ['其他', 'A literal "other" row. Not an analyte.'],
] as const;
