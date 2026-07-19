// Curated medical lexicon for the doctor-notes safety guard (M3.1).
//
// SAFETY MODEL: This file is the deterministic source of truth for the immutable
// detectors (lib/notesDetect.ts) and the fidelity guard (lib/notesGuard.ts). The
// LLM never decides what a negation/dose/drug *means*; meaning is read off these
// tables. Edit with the same care as a drug-dosing chart.

import type { SourceLang } from '@/lib/i18n';

export interface NegationMarker {
  marker: string;
  lang: SourceLang;
  polarity: 'absent' | 'uncertain';
  // Hedge ladder rank: higher = more certain/assertive toward the finding.
  // Used by the guard to detect a lost hedge rung (考虑→assertion) or a
  // definite↔uncertain flip.
  strength: number;
}

export interface DoseUnit {
  token: string;
  // Normalized dimension key so equivalent units share a dim (mg ≡ 毫克 → 'mg').
  dim: string;
}

export interface KnownDrug {
  id: string;
  // All lowercased: generic + zh + pinyin(no tones) + brands (EN + ZH).
  forms: string[];
}

export interface HighRiskPair {
  zh: string;
  en: string;
  note: string;
}

// --- Hedge-ladder rank table (applies to both EN and ZH `strength` strings) ---
// Higher = more certain/assertive toward the finding. Negations score high
// because they are a *definite* assertion (of absence).
const STRENGTH_RANK: Record<string, number> = {
  'definite-absent': 5,
  compatible: 4,
  符合: 4,
  probable: 3.5,
  favored: 3.5,
  倾向: 3.5,
  倾向于: 3.5,
  suggestive: 3,
  提示: 3,
  suspected: 3,
  考虑: 3,
  疑: 3,
  疑似: 3,
  可疑: 3,
  possible: 2,
  可能: 2,
  differential: 2,
  vs: 2,
  'to-be-excluded': 1.5,
  待排: 1.5,
  待排除: 1.5,
  'r/o': 1.5,
  'cannot-exclude': 1,
  不能除外: 1,
  不除外: 1,
  pending: 0.5,
  '待查': 0.5,
  'pending-workup': 0.5,
  'follow-up-advised': 0.5,
  随诊: 0.5,
  建议复查: 0.5,
  性质待定: 0.5,
};

function rankStrength(s: string): number {
  return STRENGTH_RANK[s] ?? 2;
}

// Raw marker data, transcribed from the vetted hardening workflow output.
interface RawMarker {
  marker: string;
  kind: 'negation' | 'uncertainty';
  strength: string;
}

const RAW_MARKERS_EN: RawMarker[] = [
  { marker: 'no', kind: 'negation', strength: 'definite-absent' },
  { marker: 'not', kind: 'negation', strength: 'definite-absent' },
  { marker: 'without', kind: 'negation', strength: 'definite-absent' },
  { marker: 'denies', kind: 'negation', strength: 'definite-absent' },
  { marker: 'denied', kind: 'negation', strength: 'definite-absent' },
  { marker: 'negative for', kind: 'negation', strength: 'definite-absent' },
  { marker: 'absence of', kind: 'negation', strength: 'definite-absent' },
  { marker: 'free of', kind: 'negation', strength: 'definite-absent' },
  { marker: 'ruled out', kind: 'negation', strength: 'definite-absent' },
  { marker: 'no evidence of', kind: 'negation', strength: 'definite-absent' },
  { marker: 'unremarkable', kind: 'negation', strength: 'definite-absent' },
  { marker: 'non-', kind: 'negation', strength: 'definite-absent' },
  { marker: 'resolved', kind: 'negation', strength: 'definite-absent' },
  { marker: 'cannot exclude', kind: 'uncertainty', strength: 'cannot-exclude' },
  { marker: 'cannot rule out', kind: 'uncertainty', strength: 'cannot-exclude' },
  { marker: 'suspicious for', kind: 'uncertainty', strength: 'suspected' },
  { marker: 'suggestive of', kind: 'uncertainty', strength: 'suspected' },
  { marker: 'consistent with', kind: 'uncertainty', strength: 'compatible' },
  { marker: 'possible', kind: 'uncertainty', strength: 'possible' },
  { marker: 'probable', kind: 'uncertainty', strength: 'probable' },
  { marker: 'likely', kind: 'uncertainty', strength: 'probable' },
  { marker: 'query', kind: 'uncertainty', strength: 'possible' },
  { marker: 'r/o', kind: 'uncertainty', strength: 'to-be-excluded' },
  { marker: 'vs', kind: 'uncertainty', strength: 'differential' },
  { marker: 'differential', kind: 'uncertainty', strength: 'differential' },
  { marker: 'to be confirmed', kind: 'uncertainty', strength: 'pending' },
  { marker: 'pending', kind: 'uncertainty', strength: 'pending' },
];

const RAW_MARKERS_ZH: RawMarker[] = [
  { marker: '无', kind: 'negation', strength: 'definite-absent' },
  { marker: '未见', kind: 'negation', strength: 'definite-absent' },
  { marker: '未见明显', kind: 'negation', strength: 'definite-absent' },
  { marker: '未发现', kind: 'negation', strength: 'definite-absent' },
  { marker: '未及', kind: 'negation', strength: 'definite-absent' },
  { marker: '不伴', kind: 'negation', strength: 'definite-absent' },
  { marker: '否认', kind: 'negation', strength: 'definite-absent' },
  { marker: '阴性', kind: 'negation', strength: 'definite-absent' },
  { marker: '排除', kind: 'negation', strength: 'definite-absent' },
  { marker: '已排除', kind: 'negation', strength: 'definite-absent' },
  { marker: '正常', kind: 'negation', strength: 'definite-absent' },
  { marker: '未见异常', kind: 'negation', strength: 'definite-absent' },
  { marker: '无异常', kind: 'negation', strength: 'definite-absent' },
  { marker: '不', kind: 'negation', strength: 'definite-absent' },
  { marker: '非', kind: 'negation', strength: 'definite-absent' },
  { marker: '考虑', kind: 'uncertainty', strength: 'suspected' },
  { marker: '考虑为', kind: 'uncertainty', strength: 'suspected' },
  { marker: '提示', kind: 'uncertainty', strength: 'suggestive' },
  { marker: '符合', kind: 'uncertainty', strength: 'compatible' },
  { marker: '倾向', kind: 'uncertainty', strength: 'favored' },
  { marker: '倾向于', kind: 'uncertainty', strength: 'favored' },
  { marker: '可能', kind: 'uncertainty', strength: 'possible' },
  { marker: '疑', kind: 'uncertainty', strength: 'suspected' },
  { marker: '疑似', kind: 'uncertainty', strength: 'suspected' },
  { marker: '可疑', kind: 'uncertainty', strength: 'suspected' },
  { marker: '待排', kind: 'uncertainty', strength: 'to-be-excluded' },
  { marker: '待排除', kind: 'uncertainty', strength: 'to-be-excluded' },
  { marker: '不除外', kind: 'uncertainty', strength: 'cannot-exclude' },
  { marker: '不能除外', kind: 'uncertainty', strength: 'cannot-exclude' },
  { marker: '待查', kind: 'uncertainty', strength: 'pending-workup' },
  { marker: '性质待定', kind: 'uncertainty', strength: 'pending' },
  { marker: '随诊', kind: 'uncertainty', strength: 'follow-up-advised' },
  { marker: '建议复查', kind: 'uncertainty', strength: 'follow-up-advised' },
];

function buildMarkers(raw: RawMarker[], lang: SourceLang): NegationMarker[] {
  return raw.map((m) => ({
    marker: m.marker,
    lang,
    polarity: m.kind === 'negation' ? ('absent' as const) : ('uncertain' as const),
    strength: rankStrength(m.strength),
  }));
}

export const NEGATION_MARKERS: NegationMarker[] = [
  ...buildMarkers(RAW_MARKERS_EN, 'en'),
  ...buildMarkers(RAW_MARKERS_ZH, 'zh'),
];

// --- Dose units: token → normalized dimension ---
// Equivalent units share a dim. Compound tokens use the token itself as dim.
const DOSE_UNIT_DIM: Record<string, string> = {
  mg: 'mg',
  毫克: 'mg',
  g: 'g',
  克: 'g',
  mcg: 'mcg',
  ug: 'mcg',
  'µg': 'mcg',
  微克: 'mcg',
  mL: 'mL',
  ml: 'mL',
  毫升: 'mL',
  L: 'L',
  升: 'L',
  IU: 'IU',
  U: 'IU',
  国际单位: 'IU',
  单位: 'IU',
  mmol: 'mmol',
  毫摩尔: 'mmol',
  片: 'tablet',
  粒: 'capsule',
  丸: 'pill',
  袋: 'sachet',
  支: 'ampoule',
  瓶: 'bottle',
  滴: 'drop',
  喷: 'spray',
  贴: 'patch',
  // English count units, sharing the SAME dim as their ZH counterparts so a
  // faithful 1片→1 tablet translation extracts as the same dose dimension
  // (ZH↔EN dose symmetry for the notes guard).
  tablet: 'tablet',
  tablets: 'tablet',
  tab: 'tablet',
  tabs: 'tablet',
  capsule: 'capsule',
  capsules: 'capsule',
  cap: 'capsule',
  caps: 'capsule',
  pill: 'pill',
  pills: 'pill',
  drop: 'drop',
  drops: 'drop',
  spray: 'spray',
  sprays: 'spray',
  patch: 'patch',
  patches: 'patch',
  // Compound tokens: dim = token itself.
  'mg/dL': 'mg/dL',
  'mmol/L': 'mmol/L',
  'ml/次': 'ml/次',
  'mg/kg': 'mg/kg',
  '毫克/公斤': '毫克/公斤',
};

const DOSE_UNIT_TOKENS: string[] = [
  'mg', '毫克', 'g', '克', 'mcg', 'ug', 'µg', '微克', 'mL', 'ml', '毫升', 'L',
  '升', 'IU', 'U', '国际单位', '单位', 'mmol', '毫摩尔', 'mg/dL', 'mmol/L', '片',
  '粒', '丸', '袋', '支', '瓶', '滴', '喷', '贴', 'ml/次', 'mg/kg', '毫克/公斤',
  // EN count units (share dims with 片/粒/丸/滴/喷/贴 above).
  'tablet', 'tablets', 'tab', 'tabs', 'capsule', 'capsules', 'cap', 'caps',
  'pill', 'pills', 'drop', 'drops', 'spray', 'sprays', 'patch', 'patches',
];

export const DOSE_UNITS: DoseUnit[] = DOSE_UNIT_TOKENS.map((token) => ({
  token,
  dim: DOSE_UNIT_DIM[token] ?? token,
}));

export const FREQUENCY_TOKENS: string[] = [
  'QD', 'BID', 'TID', 'QID', 'QHS', 'QAM', 'QPM', 'QOD', 'Q4H', 'Q6H', 'Q8H',
  'Q12H', 'PRN', 'STAT', 'AC', 'PC', 'PO', 'IV', 'IM', 'SC', 'SL', 'PR', 'PV',
  'SUBQ', '每日', '每日一次', '每日两次', '每日三次', '每日四次', '一日一次',
  '一日两次', '一日三次', '一日四次', '每天', '每次', '每周', '每周一次', '每晚',
  '睡前', '晨起', '空腹', '饭前', '饭后', '餐前', '餐后', '饭中', '必要时',
  '需要时', '顿服', '隔日', '隔日一次', '每隔', '口服', '外用', '肌注', '静滴',
  '静注', '皮下注射', '舌下含服', '雾化', 'qd', 'bid', 'tid', 'prn',
];

// --- Known drugs: generic/zh/pinyin/brands → one canonical id ---
interface RawDrug {
  generic: string;
  zh: string;
  pinyin: string;
  brandsEn: string[];
}

const RAW_DRUGS: RawDrug[] = [
  { generic: 'metformin', zh: '二甲双胍', pinyin: 'èr jiǎ shuāng guā', brandsEn: ['Glucophage', '格华止'] },
  { generic: 'amlodipine', zh: '氨氯地平', pinyin: 'ān lǜ dì píng', brandsEn: ['Norvasc', '络活喜'] },
  { generic: 'atorvastatin', zh: '阿托伐他汀', pinyin: 'ā tuō fá tā tīng', brandsEn: ['Lipitor', '立普妥'] },
  { generic: 'aspirin', zh: '阿司匹林', pinyin: 'ā sī pǐ lín', brandsEn: ['Bayer', '拜阿司匹灵', '拜阿司匹林'] },
  { generic: 'clopidogrel', zh: '氯吡格雷', pinyin: 'lǜ bǐ gé léi', brandsEn: ['Plavix', '波立维'] },
  { generic: 'metoprolol', zh: '美托洛尔', pinyin: 'měi tuō luò ěr', brandsEn: ['Betaloc', 'Lopressor', '倍他乐克'] },
  { generic: 'losartan', zh: '氯沙坦', pinyin: 'lǜ shā tǎn', brandsEn: ['Cozaar', '科素亚'] },
  { generic: 'enalapril', zh: '依那普利', pinyin: 'yī nà pǔ lì', brandsEn: ['Vasotec', '悦宁定'] },
  { generic: 'nifedipine', zh: '硝苯地平', pinyin: 'xiāo běn dì píng', brandsEn: ['Adalat', '拜新同', '心痛定'] },
  { generic: 'glimepiride', zh: '格列美脲', pinyin: 'gé liè měi niào', brandsEn: ['Amaryl', '亚莫利'] },
  { generic: 'acarbose', zh: '阿卡波糖', pinyin: 'ā kǎ bō táng', brandsEn: ['Glucobay', '拜唐苹'] },
  { generic: 'insulin', zh: '胰岛素', pinyin: 'yí dǎo sù', brandsEn: ['Lantus', 'Novolin', '诺和灵', '来得时'] },
  { generic: 'omeprazole', zh: '奥美拉唑', pinyin: 'ào měi lā zuò', brandsEn: ['Prilosec', 'Losec', '洛赛克'] },
  { generic: 'amoxicillin', zh: '阿莫西林', pinyin: 'ā mò xī lín', brandsEn: ['Amoxil', '阿莫仙'] },
  { generic: 'cephalexin', zh: '头孢氨苄', pinyin: 'tóu bāo ān biàn', brandsEn: ['Keflex'] },
  { generic: 'azithromycin', zh: '阿奇霉素', pinyin: 'ā qí méi sù', brandsEn: ['Zithromax', '希舒美'] },
  { generic: 'levothyroxine', zh: '左甲状腺素', pinyin: 'zuǒ jiǎ zhuàng xiàn sù', brandsEn: ['Euthyrox', '优甲乐'] },
  { generic: 'ibuprofen', zh: '布洛芬', pinyin: 'bù luò fēn', brandsEn: ['Advil', 'Motrin', '芬必得'] },
  { generic: 'acetaminophen', zh: '对乙酰氨基酚', pinyin: 'duì yǐ xiān ān jī fēn', brandsEn: ['Tylenol', '泰诺', '扑热息痛'] },
  { generic: 'warfarin', zh: '华法林', pinyin: 'huá fǎ lín', brandsEn: ['Coumadin', '可密定'] },
  { generic: 'prednisone', zh: '泼尼松', pinyin: 'pō ní sōng', brandsEn: ['强的松'] },
];

// Strip pinyin tone diacritics (è→e, ǎ→a, …) while keeping spaces.
function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
}

export const KNOWN_DRUGS: KnownDrug[] = RAW_DRUGS.map((d) => {
  const forms = [
    d.generic,
    d.zh,
    stripDiacritics(d.pinyin),
    ...d.brandsEn,
  ].map((f) => f.toLowerCase());
  return { id: d.generic.toLowerCase(), forms: Array.from(new Set(forms)) };
});

// --- R7b (harden-H2): medication imperative-polarity markers ---
// A hold↔continue flip or a dose-direction swap is the highest-harm notes failure
// (Khoong 2019). Markers are DELIBERATELY multi-character and med-scoped (停药 not bare
// 停, 继续服用 not bare 继续) so disease/finding false-friends (停经 amenorrhea, 继续观察
// continue-observation, 恢复良好 recovering-well) never fire. `requiresDrugScope` markers
// only emit when a drug is in the same clause; the rest carry a med morpheme (药/服/用/量)
// and are medication directives on their own.
export interface ImperativeMarker {
  marker: string;
  lang: SourceLang;
  polarity: 'hold' | 'continue' | 'dose-change';
  doseDir?: 'up' | 'down' | 'unknown';
  requiresDrugScope?: boolean;
}

// ZH monitoring/finding objects that turn a bare CONTINUE marker into a NON-medication
// instruction (继续观察 = keep observing). Suppress emission when a marker is followed
// by one of these.
export const IMPERATIVE_MONITORING_OBJECTS: string[] = ['观察', '随访', '监测', '复查', '复诊', '门诊'];

// Medication anaphors: when a bare requiresDrugScope directive (继续/维持/hold/…) has no
// named drug in its clause but refers to one of these, it is still a medication order —
// emit it (so a flip on "继续这个药" / "keep taking this medication" is caught) rather
// than silently skip. Multi-char only (no bare "it"/"them") to avoid substring noise.
export const IMPERATIVE_MED_ANAPHORS: { lang: SourceLang; token: string }[] = [
  { lang: 'zh', token: '这个药' }, { lang: 'zh', token: '该药' }, { lang: 'zh', token: '此药' },
  { lang: 'zh', token: '这药' }, { lang: 'zh', token: '这些药' }, { lang: 'zh', token: '这种药' },
  { lang: 'zh', token: '该药物' }, { lang: 'zh', token: '原药' },
  { lang: 'en', token: 'this one' }, { lang: 'en', token: 'that one' },
  { lang: 'en', token: 'this medication' }, { lang: 'en', token: 'the medication' },
  { lang: 'en', token: 'your medication' }, { lang: 'en', token: 'this medicine' },
  { lang: 'en', token: 'the medicine' }, { lang: 'en', token: 'this pill' }, { lang: 'en', token: 'the pill' },
];

// Chinese drug-CLASS nouns (降压药 = "blood-pressure medicine"). These are NOT specific
// drugs (detectDrugs won't recognize them) but ARE a medication referent, so a scoped
// directive (停/继续/别吃/…) or a 不要/别 inversion must fire on "降压药别停" / "先停降糖药".
// Treated as anaphors (bind drugId=null) via clauseHasMedAnaphor.
export const MED_CLASS_ANCHORS: string[] = [
  '降压药', '降糖药', '降脂药', '调脂药', '抗凝药', '抗凝剂', '抗血小板药', '抗生素', '消炎药',
  '止痛药', '镇痛药', '安眠药', '助眠药', '激素', '糖皮质激素', '利尿药', '利尿剂', '平喘药',
  '化疗药', '止血药', '抗病毒药', '免疫抑制剂', '他汀类', '他汀', '胰岛素类', '中药', '西药',
];

// English drug-class referents — same role as MED_CLASS_ANCHORS: a bare requiresDrugScope
// directive ("keep on your statin", "stop the blood thinner") must fire even though the
// class noun isn't a specific known drug. Lowercased; matched as a substring.
export const EN_MED_CLASS_ANCHORS: string[] = [
  'statin', 'statins', 'beta blocker', 'beta blockers', 'beta-blocker', 'ace inhibitor',
  'ace inhibitors', 'arb', 'blood thinner', 'blood thinners', 'blood pressure pill',
  'blood pressure pills', 'blood pressure medication', 'blood pressure medicine',
  'blood pressure med', 'water pill', 'water pills', 'steroid', 'steroids', 'antibiotic',
  'antibiotics', 'painkiller', 'painkillers', 'pain medication', 'diuretic', 'diuretics', 'inhaler',
];

// Negation tokens that INVERT an adjacent imperative (不要停药 = do NOT stop = CONTINUE;
// 不要继续 = do NOT continue = HOLD). Reused for EN too.
// Matched by IMMEDIATE adjacency (endsWith over each token independently). These are the
// explicit directive negators ("不要停药" = do not stop). Bare 不 is deliberately EXCLUDED:
// it would make 不得不停用 ("had to stop" = a real HOLD) wrongly invert to continue (the
// 不 tail of 不得不) — the dangerous direction. Real "don't stop" orders use 不要/不可/不能/别.
export const IMPERATIVE_INVERSION_MARKERS: { lang: SourceLang; marker: string }[] = [
  { lang: 'zh', marker: '不要' }, { lang: 'zh', marker: '不可' }, { lang: 'zh', marker: '不能' },
  { lang: 'zh', marker: '勿' }, { lang: 'zh', marker: '切勿' }, { lang: 'zh', marker: '别' },
  { lang: 'zh', marker: '无需' }, { lang: 'zh', marker: '不用' }, { lang: 'zh', marker: '不得' },
  { lang: 'en', marker: 'do not' }, { lang: 'en', marker: "don't" }, { lang: 'en', marker: 'never' },
  { lang: 'en', marker: 'no need to' }, { lang: 'en', marker: 'avoid' },
];

export const IMPERATIVE_MARKERS: ImperativeMarker[] = [
  // --- HOLD (stop/pause the medication) ---
  { lang: 'zh', marker: '停药', polarity: 'hold' },
  { lang: 'zh', marker: '停用', polarity: 'hold' },
  { lang: 'zh', marker: '停服', polarity: 'hold' },
  { lang: 'zh', marker: '停止服用', polarity: 'hold' },
  { lang: 'zh', marker: '停止使用', polarity: 'hold' },
  { lang: 'zh', marker: '停止服药', polarity: 'hold' },
  { lang: 'zh', marker: '暂停服用', polarity: 'hold' },
  { lang: 'zh', marker: '暂停用药', polarity: 'hold' },
  { lang: 'zh', marker: '暂时停用', polarity: 'hold' },
  { lang: 'zh', marker: '暂时停药', polarity: 'hold' },
  { lang: 'zh', marker: '暂停', polarity: 'hold', requiresDrugScope: true },
  { lang: 'zh', marker: '停药观察', polarity: 'hold' },
  { lang: 'zh', marker: '逐渐停药', polarity: 'hold' },
  { lang: 'zh', marker: '逐步停药', polarity: 'hold' },
  { lang: 'zh', marker: '减停', polarity: 'hold' },
  { lang: 'zh', marker: '撤药', polarity: 'hold' },
  { lang: 'zh', marker: '撤停', polarity: 'hold' },
  { lang: 'zh', marker: '禁用', polarity: 'hold' },
  { lang: 'zh', marker: '禁服', polarity: 'hold' },
  { lang: 'zh', marker: '忌服', polarity: 'hold' },
  { lang: 'zh', marker: '中断用药', polarity: 'hold' },
  { lang: 'zh', marker: '中断治疗', polarity: 'hold' },
  { lang: 'zh', marker: '不要再吃', polarity: 'hold' },
  { lang: 'zh', marker: '不要再服', polarity: 'hold' },
  { lang: 'zh', marker: '不要再用', polarity: 'hold' },
  { lang: 'zh', marker: '别吃了', polarity: 'hold' },
  { lang: 'zh', marker: '别再吃', polarity: 'hold' },
  { lang: 'zh', marker: '别用了', polarity: 'hold' },
  { lang: 'zh', marker: '别服了', polarity: 'hold' },
  // Bare transitive 停/停掉/停了/先停: only when a drug is in the clause (停经/停诊 don't
  // fire). "停" + …药 (停他汀类药物, 停降压药) is handled by a regex in detectImperatives.
  { lang: 'zh', marker: '停掉', polarity: 'hold', requiresDrugScope: true },
  { lang: 'zh', marker: '停了', polarity: 'hold', requiresDrugScope: true },
  { lang: 'zh', marker: '先停', polarity: 'hold', requiresDrugScope: true },
  { lang: 'zh', marker: '停', polarity: 'hold', requiresDrugScope: true },
  { lang: 'en', marker: 'hold off on', polarity: 'hold' },
  { lang: 'en', marker: 'hold off', polarity: 'hold' },
  { lang: 'en', marker: 'stop taking', polarity: 'hold' },
  { lang: 'en', marker: 'stop using', polarity: 'hold' },
  { lang: 'en', marker: 'do not take', polarity: 'hold' },
  { lang: 'en', marker: "don't take", polarity: 'hold' },
  { lang: 'en', marker: 'do not use', polarity: 'hold' },
  { lang: 'en', marker: 'discontinue', polarity: 'hold' },
  { lang: 'en', marker: 'discontinued', polarity: 'hold' },
  { lang: 'en', marker: 'withhold', polarity: 'hold' },
  { lang: 'en', marker: 'cease taking', polarity: 'hold' },
  { lang: 'en', marker: 'no longer take', polarity: 'hold' },
  { lang: 'en', marker: 'hold', polarity: 'hold', requiresDrugScope: true },
  { lang: 'en', marker: 'suspend', polarity: 'hold', requiresDrugScope: true },
  // --- CONTINUE (keep/resume the medication) ---
  { lang: 'zh', marker: '继续服用', polarity: 'continue' },
  { lang: 'zh', marker: '继续用药', polarity: 'continue' },
  { lang: 'zh', marker: '继续使用', polarity: 'continue' },
  { lang: 'zh', marker: '继续吃', polarity: 'continue' },
  { lang: 'zh', marker: '接着吃', polarity: 'continue' },
  { lang: 'zh', marker: '续用', polarity: 'continue' },
  { lang: 'zh', marker: '续服', polarity: 'continue' },
  { lang: 'zh', marker: '维持治疗', polarity: 'continue' },
  { lang: 'zh', marker: '维持原量', polarity: 'continue' },
  { lang: 'zh', marker: '维持原剂量', polarity: 'continue' },
  { lang: 'zh', marker: '按原剂量', polarity: 'continue' },
  { lang: 'zh', marker: '恢复用药', polarity: 'continue' },
  { lang: 'zh', marker: '恢复服用', polarity: 'continue' },
  { lang: 'zh', marker: '恢复使用', polarity: 'continue' },
  { lang: 'zh', marker: '恢复吃药', polarity: 'continue' },
  { lang: 'zh', marker: '重新服用', polarity: 'continue' },
  { lang: 'zh', marker: '坚持服用', polarity: 'continue' },
  { lang: 'zh', marker: '坚持用药', polarity: 'continue' },
  { lang: 'zh', marker: '规律服用', polarity: 'continue' },
  { lang: 'zh', marker: '按时服用', polarity: 'continue' },
  { lang: 'zh', marker: '长期服用', polarity: 'continue' },
  { lang: 'zh', marker: '长期用药', polarity: 'continue' },
  { lang: 'zh', marker: '继续', polarity: 'continue', requiresDrugScope: true },
  { lang: 'zh', marker: '维持', polarity: 'continue', requiresDrugScope: true },
  { lang: 'en', marker: 'continue taking', polarity: 'continue' },
  { lang: 'en', marker: 'continue to take', polarity: 'continue' },
  { lang: 'en', marker: 'keep taking', polarity: 'continue' },
  { lang: 'en', marker: 'keep on taking', polarity: 'continue' },
  { lang: 'en', marker: 'resume taking', polarity: 'continue' },
  { lang: 'en', marker: 'remain on', polarity: 'continue' },
  { lang: 'en', marker: 'stay on', polarity: 'continue' },
  { lang: 'en', marker: 'continue', polarity: 'continue', requiresDrugScope: true },
  { lang: 'en', marker: 'resume', polarity: 'continue', requiresDrugScope: true },
  { lang: 'en', marker: 'keep using', polarity: 'continue', requiresDrugScope: true },
  { lang: 'en', marker: 'maintain', polarity: 'continue', requiresDrugScope: true },
  // --- DOSE-CHANGE down ---
  { lang: 'zh', marker: '减量', polarity: 'dose-change', doseDir: 'down' },
  { lang: 'zh', marker: '减药', polarity: 'dose-change', doseDir: 'down' },
  { lang: 'zh', marker: '减少剂量', polarity: 'dose-change', doseDir: 'down' },
  { lang: 'zh', marker: '减半', polarity: 'dose-change', doseDir: 'down' },
  { lang: 'zh', marker: '半量', polarity: 'dose-change', doseDir: 'down' },
  { lang: 'zh', marker: '逐渐减量', polarity: 'dose-change', doseDir: 'down' },
  { lang: 'zh', marker: '缓慢减量', polarity: 'dose-change', doseDir: 'down' },
  { lang: 'en', marker: 'decrease', polarity: 'dose-change', doseDir: 'down' },
  { lang: 'en', marker: 'reduce', polarity: 'dose-change', doseDir: 'down' },
  { lang: 'en', marker: 'lower the dose', polarity: 'dose-change', doseDir: 'down' },
  { lang: 'en', marker: 'taper', polarity: 'dose-change', doseDir: 'down' },
  { lang: 'en', marker: 'halve', polarity: 'dose-change', doseDir: 'down' },
  // --- DOSE-CHANGE up ---
  { lang: 'zh', marker: '加量', polarity: 'dose-change', doseDir: 'up' },
  { lang: 'zh', marker: '增量', polarity: 'dose-change', doseDir: 'up' },
  { lang: 'zh', marker: '增加剂量', polarity: 'dose-change', doseDir: 'up' },
  { lang: 'zh', marker: '加倍', polarity: 'dose-change', doseDir: 'up' },
  { lang: 'zh', marker: '逐渐加量', polarity: 'dose-change', doseDir: 'up' },
  { lang: 'en', marker: 'increase', polarity: 'dose-change', doseDir: 'up' },
  { lang: 'en', marker: 'double the dose', polarity: 'dose-change', doseDir: 'up' },
  { lang: 'en', marker: 'up-titrate', polarity: 'dose-change', doseDir: 'up' },
  // --- DOSE-CHANGE unknown direction → unverifiable (abstain) ---
  { lang: 'zh', marker: '调整剂量', polarity: 'dose-change', doseDir: 'unknown' },
  { lang: 'zh', marker: '剂量调整', polarity: 'dose-change', doseDir: 'unknown' },
  { lang: 'zh', marker: '调整用量', polarity: 'dose-change', doseDir: 'unknown' },
  // (改为/改成 intentionally NOT markers: they also cover route/frequency/regimen changes
  //  — 改为口服 — so treating them as dose-change over-abstains. A dose VALUE change via
  //  改为 is still caught by the dose immutable. See harden-H2 review.)
  { lang: 'en', marker: 'adjust the dose', polarity: 'dose-change', doseDir: 'unknown' },
  { lang: 'en', marker: 'adjust your dose', polarity: 'dose-change', doseDir: 'unknown' },
  { lang: 'en', marker: 'titrate', polarity: 'dose-change', doseDir: 'unknown' },
  // --- R7b hardening (adversarial-review completeness passes): common real phrasings the
  //     first lexicon missed — each an UNSAFE gap (a flip would render). Bare/ambiguous
  //     markers carry requiresDrugScope (need a drug OR a med anaphor/class-anchor in the
  //     clause) so lifestyle/NPO/navigation/vitals sentences don't spuriously abstain. ---
  // EN HOLD — bare 'stop' (drug-scoped) is the most common English hold + enables 'do not
  // stop X' inversion; perioperative/outpatient/chart-shorthand verbs.
  { lang: 'en', marker: 'stop', polarity: 'hold', requiresDrugScope: true },
  { lang: 'en', marker: 'skip', polarity: 'hold', requiresDrugScope: true },
  { lang: 'en', marker: 'omit', polarity: 'hold', requiresDrugScope: true },
  { lang: 'en', marker: 'pause', polarity: 'hold', requiresDrugScope: true },
  { lang: 'en', marker: 'stay off', polarity: 'hold', requiresDrugScope: true }, // not "stay off your feet"
  { lang: 'en', marker: 'come off', polarity: 'hold', requiresDrugScope: true },
  { lang: 'en', marker: 'leave off', polarity: 'hold', requiresDrugScope: true },
  { lang: 'en', marker: 'lay off', polarity: 'hold', requiresDrugScope: true },
  { lang: 'en', marker: 'keep off', polarity: 'hold', requiresDrugScope: true },
  { lang: 'en', marker: 'get off', polarity: 'hold', requiresDrugScope: true }, // not "get off your feet"
  { lang: 'en', marker: 'quit taking', polarity: 'hold' },
  { lang: 'en', marker: 'quit', polarity: 'hold', requiresDrugScope: true },
  { lang: 'en', marker: 'take a break from', polarity: 'hold', requiresDrugScope: true },
  { lang: 'en', marker: 'cut out', polarity: 'hold', requiresDrugScope: true },
  { lang: 'en', marker: 'd/c', polarity: 'hold', requiresDrugScope: true }, // not "d/c home" (discharge)
  { lang: 'en', marker: 'dc', polarity: 'hold', requiresDrugScope: true },
  // EN CONTINUE
  { lang: 'en', marker: 'keep on', polarity: 'continue', requiresDrugScope: true },
  { lang: 'en', marker: 'stick with', polarity: 'continue', requiresDrugScope: true },
  { lang: 'en', marker: 'stick to', polarity: 'continue', requiresDrugScope: true },
  { lang: 'en', marker: 'carry on with', polarity: 'continue' },
  { lang: 'en', marker: 'carry on', polarity: 'continue', requiresDrugScope: true },
  { lang: 'en', marker: 'stay the course', polarity: 'continue', requiresDrugScope: true },
  // EN DOSE — taper/titration family with no numeric anchor (all drug-scoped: oxygen/
  // ventilator weaning, "cut back on salt", "go up to the 3rd floor" must not fire).
  { lang: 'en', marker: 'wean off', polarity: 'dose-change', doseDir: 'down', requiresDrugScope: true },
  { lang: 'en', marker: 'wean', polarity: 'dose-change', doseDir: 'down', requiresDrugScope: true },
  { lang: 'en', marker: 'cut back', polarity: 'dose-change', doseDir: 'down', requiresDrugScope: true },
  { lang: 'en', marker: 'back off', polarity: 'dose-change', doseDir: 'down', requiresDrugScope: true },
  { lang: 'en', marker: 'step down', polarity: 'dose-change', doseDir: 'down', requiresDrugScope: true },
  { lang: 'en', marker: 'step up', polarity: 'dose-change', doseDir: 'up', requiresDrugScope: true },
  { lang: 'en', marker: 'bump up', polarity: 'dose-change', doseDir: 'up', requiresDrugScope: true },
  { lang: 'en', marker: 'drop the dose', polarity: 'dose-change', doseDir: 'down' },
  { lang: 'en', marker: 'increase the dose', polarity: 'dose-change', doseDir: 'up' },
  { lang: 'en', marker: 'up the dose', polarity: 'dose-change', doseDir: 'up' },
  { lang: 'en', marker: 'raise the dose', polarity: 'dose-change', doseDir: 'up' },
  { lang: 'en', marker: 'bump the dose', polarity: 'dose-change', doseDir: 'up' },
  { lang: 'en', marker: 'cut the dose', polarity: 'dose-change', doseDir: 'down' },
  { lang: 'en', marker: 'double the', polarity: 'dose-change', doseDir: 'up', requiresDrugScope: true },
  { lang: 'en', marker: 'double up on', polarity: 'dose-change', doseDir: 'up' },
  { lang: 'en', marker: 'go up to', polarity: 'dose-change', doseDir: 'up', requiresDrugScope: true },
  { lang: 'en', marker: 'go down to', polarity: 'dose-change', doseDir: 'down', requiresDrugScope: true },
  { lang: 'en', marker: 'drop down to', polarity: 'dose-change', doseDir: 'down', requiresDrugScope: true },
  { lang: 'en', marker: 'drop to', polarity: 'dose-change', doseDir: 'down', requiresDrugScope: true },
  // ZH HOLD — colloquial 别/不要 + verb (drug-scoped so 别吃辣/不要用力/暂时别吃(食物) don't fire)
  { lang: 'zh', marker: '别吃', polarity: 'hold', requiresDrugScope: true },
  { lang: 'zh', marker: '别服', polarity: 'hold', requiresDrugScope: true },
  { lang: 'zh', marker: '别用', polarity: 'hold', requiresDrugScope: true },
  { lang: 'zh', marker: '别再吃了', polarity: 'hold', requiresDrugScope: true },
  { lang: 'zh', marker: '别再服了', polarity: 'hold' },
  { lang: 'zh', marker: '别再用了', polarity: 'hold', requiresDrugScope: true },
  { lang: 'zh', marker: '不要吃', polarity: 'hold', requiresDrugScope: true },
  { lang: 'zh', marker: '不要服', polarity: 'hold', requiresDrugScope: true },
  { lang: 'zh', marker: '不要用', polarity: 'hold', requiresDrugScope: true },
  { lang: 'zh', marker: '暂时不吃', polarity: 'hold', requiresDrugScope: true },
  { lang: 'zh', marker: '暂时别吃', polarity: 'hold', requiresDrugScope: true },
  { lang: 'zh', marker: '先别吃', polarity: 'hold', requiresDrugScope: true },
  { lang: 'zh', marker: '先别用', polarity: 'hold', requiresDrugScope: true },
  { lang: 'zh', marker: '先别服', polarity: 'hold' }, // 服 implies medication
  { lang: 'zh', marker: '停一停', polarity: 'hold', requiresDrugScope: true },
  // ZH CONTINUE — keep-the-current-regimen phrasings
  { lang: 'zh', marker: '维持原方案', polarity: 'continue' },
  { lang: 'zh', marker: '继续原方案', polarity: 'continue' },
  { lang: 'zh', marker: '照原方案', polarity: 'continue' },
  { lang: 'zh', marker: '按原方案', polarity: 'continue' },
  { lang: 'zh', marker: '按原样吃', polarity: 'continue' },
  { lang: 'zh', marker: '按原样用', polarity: 'continue' },
  { lang: 'zh', marker: '继续原剂量', polarity: 'continue' },
  { lang: 'zh', marker: '照常服用', polarity: 'continue' },
  { lang: 'zh', marker: '照常吃', polarity: 'continue', requiresDrugScope: true },
  { lang: 'zh', marker: '照常用', polarity: 'continue', requiresDrugScope: true },
  { lang: 'zh', marker: '照常', polarity: 'continue', requiresDrugScope: true },
  { lang: 'zh', marker: '一直吃', polarity: 'continue', requiresDrugScope: true },
  { lang: 'zh', marker: '一直服', polarity: 'continue' },
  { lang: 'zh', marker: '接着用', polarity: 'continue', requiresDrugScope: true },
  { lang: 'zh', marker: '用药不变', polarity: 'continue' },
  { lang: 'zh', marker: '方案不变', polarity: 'continue' },
  { lang: 'zh', marker: '维持不变', polarity: 'continue', requiresDrugScope: true }, // not a stable vital
  { lang: 'zh', marker: '照旧', polarity: 'continue', requiresDrugScope: true },
  // ZH DOSE — …到/…至 target forms (drug-scoped: a bare lab/weight/BP target isn't a dose)
  // + magnitude-only 加大/减小剂量 + doubling synonyms 翻倍/翻一倍.
  { lang: 'zh', marker: '减到', polarity: 'dose-change', doseDir: 'down', requiresDrugScope: true },
  { lang: 'zh', marker: '减至', polarity: 'dose-change', doseDir: 'down', requiresDrugScope: true },
  { lang: 'zh', marker: '加到', polarity: 'dose-change', doseDir: 'up', requiresDrugScope: true },
  { lang: 'zh', marker: '加至', polarity: 'dose-change', doseDir: 'up', requiresDrugScope: true },
  { lang: 'zh', marker: '增至', polarity: 'dose-change', doseDir: 'up', requiresDrugScope: true },
  { lang: 'zh', marker: '增到', polarity: 'dose-change', doseDir: 'up', requiresDrugScope: true },
  { lang: 'zh', marker: '加大剂量', polarity: 'dose-change', doseDir: 'up' },
  { lang: 'zh', marker: '减小剂量', polarity: 'dose-change', doseDir: 'down' },
  { lang: 'zh', marker: '翻倍', polarity: 'dose-change', doseDir: 'up', requiresDrugScope: true },
  { lang: 'zh', marker: '翻一倍', polarity: 'dose-change', doseDir: 'up', requiresDrugScope: true },
  { lang: 'zh', marker: '调到', polarity: 'dose-change', doseDir: 'unknown', requiresDrugScope: true },
];

export const HIGH_RISK_PAIRS: HighRiskPair[] = [
  { zh: '良性', en: 'benign', note: 'Antonym pair with 恶性/malignant. A swap inverts the entire prognosis — the single highest-stakes false friend. notesGuard must verify the polarity token in source maps to the same-polarity token in output; any 良性↔malignant or 恶性↔benign cross is an abstain-level mismatch.' },
  { zh: '恶性', en: 'malignant', note: 'See 良性/benign. Also guard 恶性 vs 阳性 (malignant vs positive) — visually/semantically distinct but both ominous; do not let LLM collapse them.' },
  { zh: '阳性', en: 'positive', note: 'Test-result polarity. 阳 looks/sounds adjacent to 阴 (yin) but means opposite. Never render as \'sunny/yang\'. Swap with 阴性/negative inverts a diagnosis (e.g. HBsAg, tumor markers, pregnancy). Treat as immutable polarity token.' },
  { zh: '阴性', en: 'negative', note: 'See 阳性/positive. Note overlap with negation lexicon: 阴性 also functions as a definite-absent negation marker. Match as both a polarity token AND a negation cue.' },
  { zh: '高血压', en: 'hypertension', note: 'Antonym with 低血压/hypotension; differ by one character (高 vs 低). A swap reverses the clinical problem and any implied medication direction. Same 高/低 risk applies to 高血糖/低血糖 (hyper/hypoglycemia) and 高钾/低钾.' },
  { zh: '低血压', en: 'hypotension', note: 'See 高血压/hypertension. Generalize the 高(high)/低(low) prefix check across all analyte-direction terms; mismatched prefix is a fidelity failure.' },
  { zh: '占位', en: 'space-occupying lesion / mass', note: 'Radiology term implying a mass (often tumor workup). Must NOT be softened to \'shadow\', \'spot\', or dropped. Frequently co-occurs with 待排/占位性病变; preserve the full phrase and any attached hedge.' },
  { zh: '待排', en: 'to be excluded / rule out', note: 'Hedge meaning the finding is suspected and must be excluded — NOT confirmed and not negated. Mistranslating as \'excluded\'/\'ruled out\' (definite-absent) flips meaning catastrophically. Tie to the finding it follows (e.g. 占位待排 = mass, to be ruled out).' },
  { zh: '考虑', en: 'consider / favor', note: 'Hedge ladder rung 1 (weakest commitment): radiologist favors this dx but is not asserting it. Must render as hedged (\'consider\', \'favor\'), never as a definite finding. Distinct strength from 符合/提示.' },
  { zh: '符合', en: 'consistent with / compatible with', note: 'Hedge ladder rung 3 (strongest of the three): findings match the named dx but it is still not a definite assertion. Must not be rendered as \'is/diagnosed as\'. Stronger than 考虑/提示 but still hedged.' },
  { zh: '提示', en: 'suggestive of / indicates', note: 'Hedge ladder rung 2 (middle): findings point toward a dx. Render as \'suggestive of\'. Guard the relative ordering 考虑 < 提示 < 符合; collapsing any rung to a bare assertion is a hedge-strength fidelity failure.' },
  { zh: '复查', en: 'recheck / follow-up', note: 'Recommendation to re-test/follow up. Dropping it removes a safety-net instruction. Often paired with 建议 (advise) and 随诊; preserve as an actionable instruction, not optional flavor.' },
];
