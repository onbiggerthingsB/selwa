import { describe, it, expect } from 'vitest';
import { evaluateSegment } from './notesGuard';
import type { SegmentKind } from './types';

function seg(source: string, translated: string, kind: SegmentKind = 'finding') {
  return evaluateSegment({ sourceText: source, translatedText: translated, kind });
}
const ids = (o: { flags: { id: string }[] }) => o.flags.map((f) => f.id);

// Each case is transcribed verbatim from /tmp/m3-failure-modes.json testCase
// blocks: { source, translated, expectAction, expectFlagIds }. The guard must
// produce the expected action and surface (at least) the expected flag ids.

describe('notesGuard — R7/R8/R9 (18 red-team failure modes)', () => {
  it('FM-01 negation drop (ruled-out → asserted) → flag', () => {
    const o = seg('胸片未见明显占位性病变。', 'Chest X-ray shows a space-occupying lesion.');
    expect(o.action).toBe('flag');
    expect(ids(o)).toContain('R7-NEGATION-POLARITY-MISMATCH');
    expect(ids(o)).toContain('R9-HIGH-RISK-PAIR');
  });

  it('FM-02 negation reversal (asserted → negated) → abstain', () => {
    const o = seg('活检提示恶性肿瘤细胞。', 'Biopsy shows no malignant tumor cells.');
    expect(o.action).toBe('abstain');
    expect(ids(o)).toContain('R7-NEGATION-POLARITY-MISMATCH');
    expect(ids(o)).toContain('R9-HIGH-RISK-PAIR');
  });

  it('FM-03 double-negation collapse (cannot exclude → excluded) → abstain', () => {
    const o = seg('不能排除转移可能。', 'Metastasis is excluded.');
    expect(o.action).toBe('abstain');
    expect(ids(o)).toContain('R7-HEDGE-STRENGTH-WEAKENED');
    expect(ids(o)).toContain('R7-NEGATION-POLARITY-MISMATCH');
  });

  it('FM-04 hedge weakening (cannot exclude → no evidence) → abstain', () => {
    const o = seg('Cannot exclude early interstitial lung disease.', '无间质性肺病证据。');
    expect(o.action).toBe('abstain');
    expect(ids(o)).toContain('R7-HEDGE-STRENGTH-WEAKENED');
  });

  it('FM-05 dose rounding 850 → 1000 → flag', () => {
    const o = seg('二甲双胍 850mg 每日两次。', 'Metformin 1000 mg twice daily.', 'medication');
    expect(o.action).toBe('flag');
    expect(ids(o)).toContain('R8-DOSE-NOT-PRESERVED');
  });

  it('FM-06 unit swap mcg → 毫克 → abstain', () => {
    const o = seg('Levothyroxine 50 mcg once daily.', '左甲状腺素 50 毫克 每日一次。', 'medication');
    expect(o.action).toBe('abstain');
    expect(ids(o)).toContain('R8-DOSE-UNIT-DIMENSION-MISMATCH');
  });

  it('FM-07 dropped frequency (TID → none) → flag', () => {
    const o = seg('泼尼松 5mg 每日三次。', 'Prednisone 5 mg.', 'medication');
    expect(o.action).toBe('flag');
    expect(ids(o)).toContain('R8-DOSE-FREQUENCY-DROPPED');
  });

  it('FM-08 dose range collapse (1–2 → 2) → flag', () => {
    const o = seg('布洛芬 1-2片 需要时服用。', 'Ibuprofen 2 tablets as needed.', 'medication');
    expect(o.action).toBe('flag');
    expect(ids(o)).toContain('R8-DOSE-RANGE-INCOMPLETE');
  });

  it('FM-09 decimal error 0.125 → 0.25 (≥2×) → abstain', () => {
    const o = seg('地高辛 0.125 mg 每日一次。', 'Digoxin 0.25 mg once daily.', 'medication');
    expect(o.action).toBe('abstain');
    expect(ids(o)).toContain('R8-DOSE-NOT-PRESERVED');
    expect(ids(o)).toContain('R8-DOSE-MAGNITUDE-DIVERGENCE');
  });

  it('FM-10 number transposition 148 → 184 → flag', () => {
    const o = seg('随访血压记录为 148/92 mmHg。', 'Follow-up blood pressure recorded as 184/92 mmHg.', 'followup');
    expect(o.action).toBe('flag');
    expect(ids(o)).toContain('R8-NUMBER-NOT-PRESERVED');
  });

  it('FM-11 drug look-alike substitution (clonazepam → clonidine) → abstain', () => {
    const o = seg('继续服用氯硝西泮。', 'Continue clonidine.', 'medication');
    expect(o.action).toBe('abstain');
    expect(ids(o)).toContain('R9-DRUG-SUBSTITUTED');
  });

  it('FM-12 dropped salt/release qualifier (succinate ER) → flag', () => {
    const o = seg('琥珀酸美托洛尔缓释片 47.5mg 每日一次。', 'Metoprolol 47.5 mg once daily.', 'medication');
    expect(o.action).toBe('flag');
    expect(ids(o)).toContain('R9-DRUG-QUALIFIER-DROPPED');
  });

  it('FM-13 unknown drug guessed (T-DM1 → trastuzumab) → abstain', () => {
    const o = seg('服用 恩美曲妥珠单抗 治疗。', 'Take trastuzumab.', 'medication');
    expect(o.action).toBe('abstain');
    expect(ids(o)).toContain('R9-UNKNOWN-DRUG-ALTERED');
  });

  it('FM-14 segment-split negation (scope broken) → abstain', () => {
    const o = seg('未见肝内占位。', 'Intrahepatic mass.');
    expect(o.action).toBe('abstain');
    expect(ids(o)).toContain('R7-NEGATION-SCOPE-BROKEN');
  });

  it('FM-15 negation retargeted (nodule/calcification swap) → flag', () => {
    const o = seg('见结节，未见钙化。', 'No nodule seen; calcification present.');
    expect(o.action).toBe('flag');
    expect(ids(o)).toContain('R7-NEGATION-RETARGETED');
  });

  it('FM-16 positive/negative flip (HBsAg) → abstain', () => {
    const o = seg('乙肝表面抗原 阳性。', 'Hepatitis B surface antigen negative.');
    expect(o.action).toBe('abstain');
    expect(ids(o)).toContain('R9-RESULT-POLARITY-FLIP');
  });

  it('FM-17 mg ≡ 毫克 true transliteration → render (NO false positive)', () => {
    const o = seg('阿莫西林 500 毫克 每日三次。', 'Amoxicillin 500 mg three times daily.', 'medication');
    expect(o.action).toBe('render');
    expect(o.flags).toHaveLength(0);
  });

  it('FM-18 garbled / OCR-corrupted source → abstain', () => {
    const o = seg('处方：▮▮▮ 0.█ mg ▮▮ 每日', 'Prescription: medication 0.5 mg twice daily.', 'medication');
    expect(o.action).toBe('abstain');
    expect(ids(o)).toContain('R8-DOSE-SOURCE-UNPARSEABLE');
  });
});

describe('notesGuard — invariants', () => {
  it('abstain blanks the translation (caller shows source verbatim)', () => {
    const o = seg('乙肝表面抗原 阳性。', 'Hepatitis B surface antigen negative.');
    expect(o.action).toBe('abstain');
    // Returned `original` is the verbatim source; the caller renders it.
    expect(o.original).toBe('乙肝表面抗原 阳性。');
  });

  it('render preserves all immutables and returns them as preserved chips', () => {
    const o = seg('阿莫西林 500 毫克 每日三次。', 'Amoxicillin 500 mg three times daily.', 'medication');
    expect(o.action).toBe('render');
    expect(o.preserved.length).toBeGreaterThan(0);
  });

  it('a clean faithful translation with no immutables renders', () => {
    const o = seg('请多喝水，注意休息。', 'Please drink more water and rest.', 'instruction');
    expect(o.action).toBe('render');
    expect(o.flags).toHaveLength(0);
  });
});

// GAP 1 — unmapped-finding negations must fail SAFE. The detector emits a
// correct negation immutable for these findings, but they sit outside
// FINDING_SYNONYMS, so the per-finding logic alone discarded them. The
// polarity-bucket-count balance must now catch dropped/added negations.
describe('notesGuard — GAP 1: unmapped-finding negations fail safe', () => {
  it('UNSAFE dropped negation (未见积液 → Effusion present) → flag', () => {
    // src: 1 absent negation; out: 0 negations → output dropped a negation
    // (false-alarm direction) → flag, not render.
    const o = seg('未见积液', 'Effusion present.');
    expect(o.action).not.toBe('render');
    expect(ids(o)).toContain('R7-NEGATION-POLARITY-MISMATCH');
  });

  it('UNSAFE added negation (可见气胸 → No pneumothorax) → abstain', () => {
    // src: 0 negations; out: 1 absent negation → output ADDED a negation
    // (false reassurance — the dangerous direction) → abstain.
    const o = seg('可见气胸', 'No pneumothorax.');
    expect(o.action).toBe('abstain');
    expect(ids(o)).toContain('R7-NEGATION-POLARITY-MISMATCH');
  });

  it('UNSAFE dropped negation (未见出血 → Hemorrhage present) → flag', () => {
    const o = seg('未见出血', 'Hemorrhage present.');
    expect(o.action).not.toBe('render');
    expect(ids(o)).toContain('R7-NEGATION-POLARITY-MISMATCH');
  });

  it('FAITHFUL preserved negation (未见积液 → No effusion) → render', () => {
    // src: 1 absent; out: 1 absent → equal buckets → preserved → render.
    const o = seg('未见积液', 'No effusion.');
    expect(o.action).toBe('render');
    expect(o.flags).toHaveLength(0);
  });
});

// GAP 2 — a known source drug that vanishes or is replaced by an unrecognized
// token must fail SAFE. The old rule only fired when the OUTPUT named another
// recognized drug, silently rendering the cases below.
describe('notesGuard — GAP 2: vanished/replaced known drug fails safe', () => {
  it('UNSAFE drug swap to unseeded drug (warfarin → heparin) → abstain', () => {
    const o = seg('Continue warfarin.', 'Continue heparin.', 'medication');
    expect(o.action).toBe('abstain');
    expect(ids(o)).toContain('R9-DRUG-SUBSTITUTED');
  });

  it('UNSAFE drug dropped (继续服用二甲双胍 → Continue your medication) → abstain', () => {
    const o = seg('继续服用二甲双胍。', 'Continue your medication.', 'medication');
    expect(o.action).toBe('abstain');
    expect(ids(o)).toContain('R9-DRUG-SUBSTITUTED');
  });

  it('UNSAFE drug swap to unseeded drug (atorvastatin → simvastatin) → abstain', () => {
    const o = seg('Continue atorvastatin.', 'Continue simvastatin.', 'medication');
    expect(o.action).toBe('abstain');
    expect(ids(o)).toContain('R9-DRUG-SUBSTITUTED');
  });

  it('FAITHFUL drug preserved (继续服用二甲双胍 → Continue metformin) → render', () => {
    const o = seg('继续服用二甲双胍。', 'Continue metformin.', 'medication');
    expect(o.action).toBe('render');
    expect(o.flags).toHaveLength(0);
  });

  it('FAITHFUL transliteration still renders (FM-17 stays green)', () => {
    const o = seg('阿莫西林 500 毫克 每日三次。', 'Amoxicillin 500 mg three times daily.', 'medication');
    expect(o.action).toBe('render');
    expect(o.flags).toHaveLength(0);
  });
});
