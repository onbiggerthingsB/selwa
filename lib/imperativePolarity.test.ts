import { describe, it, expect } from 'vitest';
import { detectImmutables } from './notesDetect';
import { groundNotes } from './notesGrounding';
import type { NotesTranslation } from './notesSchema';
import type { Immutable } from './types';
import type { SourceLang } from './i18n';

const FLIP = 'N-IMPERATIVE-FLIP';
const imps = (text: string, lang: SourceLang): Immutable[] =>
  detectImmutables(text, lang).filter((i) => i.type === 'imperative');

// --- Detector ---------------------------------------------------------------
describe('detectImperatives — polarity + scope', () => {
  it('reads a hold directive (暂停服用) scoped to its drug', () => {
    const [im] = imps('暂停服用二甲双胍', 'zh');
    expect(im.imperative).toBe('hold');
    expect(im.drugId).toBe('metformin');
  });

  it('reads a continue directive (继续服用)', () => {
    expect(imps('继续服用二甲双胍', 'zh')[0].imperative).toBe('continue');
  });

  it('reads dose-direction (减量 → down, 加量 → up)', () => {
    expect(imps('二甲双胍减量', 'zh')[0]).toMatchObject({ imperative: 'dose-change', doseDir: 'down' });
    expect(imps('二甲双胍加量', 'zh')[0]).toMatchObject({ imperative: 'dose-change', doseDir: 'up' });
  });

  it('marks a bare "adjust" (调整剂量 / adjust the dose) as unknown-direction', () => {
    expect(imps('二甲双胍调整剂量', 'zh')[0]).toMatchObject({ imperative: 'dose-change', doseDir: 'unknown' });
    expect(imps('adjust the dose of metformin', 'en')[0]).toMatchObject({ imperative: 'dose-change', doseDir: 'unknown' });
  });

  it('DOUBLE-INVERSION: 不可停药 = do NOT stop = continue polarity', () => {
    expect(imps('二甲双胍不可停药', 'zh')[0].imperative).toBe('continue');
  });

  it('false friends do NOT fire: 停经 (amenorrhea), 继续观察 (keep observing), 恢复良好 (recovering well)', () => {
    expect(imps('停经两个月', 'zh')).toHaveLength(0);
    expect(imps('继续观察血压', 'zh')).toHaveLength(0);
    expect(imps('肝功能恢复良好', 'zh')).toHaveLength(0);
  });

  it('EN word-boundary: "hold" fires as a directive but not inside "household"', () => {
    expect(imps('hold metformin', 'en')[0].imperative).toBe('hold');
    expect(imps('household metformin supply', 'en')).toHaveLength(0);
  });
});

// --- Reconciliation (the Khoong 2019 harm) ----------------------------------
function ground(sourceText: string, translatedText: string, original: string) {
  const t: NotesTranslation = { segments: [{ sourceText, translatedText, kind: 'medication' }] };
  return groundNotes(t, original);
}

describe('groundNotes — R7b imperative-flip reconciliation', () => {
  it('ABSTAINS on a hold→continue flip (hold the medicine → keep taking it)', () => {
    const g = ground('暂停服用二甲双胍', 'Continue taking metformin.', '暂停服用二甲双胍');
    expect(g.overallAction).toBe('abstain');
    const fb = g.segments.find((s) => s.flags.some((f) => f.id === FLIP));
    expect(fb).toBeDefined();
    expect(fb!.source).toBe('暂停服用二甲双胍');
    expect(fb!.translated).toBe(''); // unsafe translation never surfaced
  });

  it('RENDERS a faithful hold (暂停服用 → Hold metformin)', () => {
    const g = ground('暂停服用二甲双胍', 'Hold metformin.', '暂停服用二甲双胍');
    expect(g.segments.some((s) => s.flags.some((f) => f.id === FLIP))).toBe(false);
    expect(g.overallAction).toBe('render');
  });

  it('RENDERS a faithful continue (继续服用 → Keep taking metformin)', () => {
    const g = ground('继续服用二甲双胍', 'Keep taking metformin.', '继续服用二甲双胍');
    expect(g.segments.some((s) => s.flags.some((f) => f.id === FLIP))).toBe(false);
    expect(g.overallAction).toBe('render');
  });

  it('double-inversion renders faithfully (不可停药 → Keep taking) but ABSTAINS if flipped to Stop', () => {
    const ok = ground('二甲双胍不可停药', 'Keep taking metformin.', '二甲双胍不可停药');
    expect(ok.segments.some((s) => s.flags.some((f) => f.id === FLIP))).toBe(false);
    const bad = ground('二甲双胍不可停药', 'Stop taking metformin.', '二甲双胍不可停药');
    expect(bad.overallAction).toBe('abstain');
    expect(bad.segments.some((s) => s.flags.some((f) => f.id === FLIP))).toBe(true);
  });

  it('ABSTAINS on a dose-direction swap (减量 reduce → increase)', () => {
    const g = ground('二甲双胍减量', 'Increase metformin.', '二甲双胍减量');
    expect(g.overallAction).toBe('abstain');
    expect(g.segments.some((s) => s.flags.some((f) => f.id === FLIP))).toBe(true);
  });

  it('RENDERS a faithful dose-decrease (减量 → reduce)', () => {
    const g = ground('二甲双胍减量', 'Reduce the metformin dose.', '二甲双胍减量');
    expect(g.segments.some((s) => s.flags.some((f) => f.id === FLIP))).toBe(false);
  });

  it('ABSTAINS on an unverifiable "adjust" even when translated faithfully (direction is unknowable)', () => {
    const g = ground('二甲双胍调整剂量', 'Adjust the metformin dose.', '二甲双胍调整剂量');
    expect(g.overallAction).toBe('abstain');
    expect(g.segments.some((s) => s.flags.some((f) => f.id === FLIP))).toBe(true);
  });

  it('does NOT false-abstain on a finding with no directive (停经 amenorrhea)', () => {
    const g = ground('停经两个月', 'Amenorrhea for two months.', '停经两个月');
    expect(g.segments.some((s) => s.flags.some((f) => f.id === FLIP))).toBe(false);
    expect(g.overallAction).toBe('render');
  });

  it('ABSTAINS when the directive is dropped entirely from the translation', () => {
    // Original holds metformin; translation omits the instruction → directive lost.
    const g = ground('暂停服用二甲双胍', 'Metformin.', '暂停服用二甲双胍');
    expect(g.overallAction).toBe('abstain');
    expect(g.segments.some((s) => s.flags.some((f) => f.id === FLIP))).toBe(true);
  });

  it('a detected flip REPLACES the whole note — the wrong translation is never surfaced', () => {
    const g = ground('暂停服用二甲双胍', 'Continue taking metformin.', '暂停服用二甲双胍');
    // Only the verbatim-original fallback remains; no segment renders the flipped text.
    expect(g.segments).toHaveLength(1);
    expect(g.segments.every((s) => !s.translated.toLowerCase().includes('continue'))).toBe(true);
    expect(g.segments[0].source).toBe('暂停服用二甲双胍');
  });
});

// --- Adversarial-review hardening (Opus multi-agent review of R7b) -----------
describe('groundNotes — R7b hardening from adversarial review', () => {
  it('CROSS-DRUG SWAP: hold(A)+continue(B) rendered as continue(A)+hold(B) → abstain (drug-scoped keys)', () => {
    // 停用华法林 (hold warfarin) + 继续服用二甲双胍 (continue metformin), rendered swapped.
    const orig = '停用华法林，继续服用二甲双胍';
    const flipped = ground(orig, 'Continue taking warfarin and stop taking metformin.', orig);
    expect(flipped.overallAction).toBe('abstain');
    expect(flipped.segments.some((s) => s.flags.some((f) => f.id === FLIP))).toBe(true);
    // A faithful (non-swapped) rendering still renders — no new over-abstain.
    const faithful = ground(orig, 'Stop taking warfarin and continue taking metformin.', orig);
    expect(faithful.segments.some((s) => s.flags.some((f) => f.id === FLIP))).toBe(false);
  });

  it('BARE 停 + drug (停二甲双胍): stop→continue flip is caught', () => {
    const g = ground('停二甲双胍', 'Keep taking metformin.', '停二甲双胍');
    expect(g.overallAction).toBe('abstain');
    // faithful stop renders
    expect(ground('停二甲双胍', 'Stop taking metformin.', '停二甲双胍').segments.some((s) => s.flags.some((f) => f.id === FLIP))).toBe(false);
  });

  it('停 + drug-CLASS (停他汀类药物): flip caught even when the class is not a known drug', () => {
    const g = ground('停他汀类药物', 'Keep taking your statin.', '停他汀类药物');
    expect(g.overallAction).toBe('abstain');
  });

  it('inferLang misroute: English note with a CJK drug name still catches the flip', () => {
    // Pre-fix inferLang→zh disabled EN imperative detection; union-of-both-lexicons fixes it.
    const g = ground('Hold warfarin 华法林 for now.', '继续服用华法林。', 'Hold warfarin 华法林 for now.');
    expect(g.overallAction).toBe('abstain');
    expect(g.segments.some((s) => s.flags.some((f) => f.id === FLIP))).toBe(true);
  });

  it('MED ANAPHOR: a bare continue on "这个药"/"this medication" is still protected', () => {
    const g = ground('继续这个药', 'Do not take this medication.', '继续这个药');
    expect(g.overallAction).toBe('abstain');
    // faithful continue on the anaphor renders
    expect(ground('继续这个药', 'Keep taking this medication.', '继续这个药').segments.some((s) => s.flags.some((f) => f.id === FLIP))).toBe(false);
  });
});

// --- Double-inversion adjacency (detector) ----------------------------------
describe('detectImperatives — inversion requires immediate adjacency', () => {
  it('别的 ("other") does NOT invert an adjacent hold; 别 alone DOES', () => {
    expect(imps('别的药停用二甲双胍', 'zh')[0].imperative).toBe('hold'); // 别的 ≠ inversion
    expect(imps('别停用二甲双胍', 'zh')[0].imperative).toBe('continue'); // 别 = do-not → continue
  });

  it('不得不 ("had to") does NOT invert a hold; 不要/不得 DO', () => {
    expect(imps('患者不得不停用二甲双胍', 'zh')[0].imperative).toBe('hold'); // 不得不 = had-to → real hold
    expect(imps('不要停用二甲双胍', 'zh')[0].imperative).toBe('continue'); // do-not-stop → continue
    expect(imps('不得停用二甲双胍', 'zh')[0].imperative).toBe('continue'); // must-not-stop → continue
  });
});

// --- Completeness pass (Fable hunt → Opus verified) --------------------------
describe('detectImperatives — completeness additions', () => {
  it('EN bare "stop X" is a hold; "do not stop X" inverts to continue', () => {
    expect(imps('stop the metformin', 'en')[0].imperative).toBe('hold');
    expect(imps('do not stop the metformin', 'en')[0].imperative).toBe('continue');
    expect(imps('stop the bleeding', 'en')).toHaveLength(0); // no drug → not a med hold
  });

  it('EN skip / wean off / d/c are detected', () => {
    expect(imps('skip your metformin today', 'en')[0].imperative).toBe('hold');
    expect(imps('wean off the prednisone', 'en')[0]).toMatchObject({ imperative: 'dose-change', doseDir: 'down' });
    expect(imps('d/c the aspirin', 'en')[0].imperative).toBe('hold');
  });

  it('ZH colloquial 别吃 / 先别吃 fire on a med referent', () => {
    expect(imps('先别吃这个药', 'zh')[0].imperative).toBe('hold'); // anaphor 这个药
    expect(imps('别吃辣', 'zh')).toHaveLength(0); // no drug/anaphor → not a med hold
  });

  it('ZH drug-CLASS noun is a med anchor: 降压药不要停 → continue, 降糖药先停 → hold', () => {
    expect(imps('降压药不要停', 'zh')[0].imperative).toBe('continue'); // 不要 inverts hold
    expect(imps('降糖药先停', 'zh')[0].imperative).toBe('hold');
  });

  it('ZH regimen-continue 维持原方案 / 减到 target dose', () => {
    expect(imps('出院后维持原方案', 'zh')[0].imperative).toBe('continue');
    expect(imps('二甲双胍减到半片', 'zh')[0]).toMatchObject({ imperative: 'dose-change', doseDir: 'down' });
  });
});

describe('detectImperatives — over-abstain guards (no phantom holds)', () => {
  it('停经 does not bridge to a later 药 (停经后可服用降压药 has no directive)', () => {
    expect(imps('停经后可服用降压药', 'zh')).toHaveLength(0);
  });

  it('暂停期间 does not fire a spurious hold', () => {
    // Only the genuine 继续服用 directive remains; 暂停 (governing 期间) is suppressed.
    const list = imps('暂停期间继续服用二甲双胍', 'zh');
    expect(list.every((im) => im.imperative !== 'hold')).toBe(true);
    expect(list.some((im) => im.imperative === 'continue')).toBe(true);
  });
});

describe('groundNotes — completeness + swap/reorder handling', () => {
  it('catches an EN bare-stop flip (Stop the metformin → 继续服用)', () => {
    const g = ground('停用二甲双胍', '继续服用二甲双胍', 'Stop the metformin.');
    expect(g.overallAction).toBe('abstain');
  });

  it('catches a drug-class hold flip (降压药先停 → keep taking)', () => {
    const g = ground('降压药先停', 'Keep taking your blood pressure medication.', '降压药先停');
    expect(g.overallAction).toBe('abstain');
  });

  it('does NOT over-abstain when a shared same-polarity directive reorders drugs across "and/和"', () => {
    // "continue metformin and aspirin" faithfully rendered with the drugs reordered.
    const g = ground(
      '继续服用二甲双胍和阿司匹林',
      'Keep taking aspirin and metformin.',
      '继续服用二甲双胍和阿司匹林',
    );
    expect(g.segments.some((s) => s.flags.some((f) => f.id === FLIP))).toBe(false);
  });

  it('STILL catches a real cross-drug swap (mixed polarity)', () => {
    const orig = '停用华法林，继续服用二甲双胍';
    const g = ground(orig, 'Continue taking warfarin and stop taking metformin.', orig);
    expect(g.overallAction).toBe('abstain');
  });
});

// --- Second completeness pass (Opus hunt → verified) -------------------------
describe('detectImperatives — second completeness pass', () => {
  it('ZH 照常/一直吃 continue', () => {
    expect(imps('二甲双胍照常吃', 'zh')[0].imperative).toBe('continue');
    expect(imps('降压药照常服用', 'zh')[0].imperative).toBe('continue');
  });

  it('EN drug-CLASS anchor lets a bare continue/hold fire (keep on your statin / keep off the blood thinner)', () => {
    expect(imps('keep on your statin', 'en')[0].imperative).toBe('continue');
    expect(imps('keep off the blood thinner', 'en')[0].imperative).toBe('hold');
  });

  it('EN keep off / get off holds; 翻倍 doubles; cut … in half halves; up the dose raises', () => {
    expect(imps('keep off the aspirin', 'en')[0].imperative).toBe('hold');
    expect(imps('华法林剂量翻倍', 'zh')[0]).toMatchObject({ imperative: 'dose-change', doseDir: 'up' });
    expect(imps('cut the metformin dose in half', 'en')[0]).toMatchObject({ imperative: 'dose-change', doseDir: 'down' });
    expect(imps('up the dose of metformin', 'en')[0]).toMatchObject({ imperative: 'dose-change', doseDir: 'up' });
  });

  it('over-abstain guards: d/c home, cut back on salt, 血压维持不变 do NOT fire', () => {
    expect(imps('d/c home in the morning', 'en')).toHaveLength(0); // discharge, not a drug hold
    expect(imps('cut back on salt', 'en')).toHaveLength(0); // lifestyle, no drug
    expect(imps('血压维持不变', 'zh')).toHaveLength(0); // stable vital, not a med continue
  });
});

describe('groundNotes — second completeness pass (flips caught)', () => {
  it('照常服用 → "stop" flip abstains', () => {
    const g = ground('降压药照常服用', 'Stop taking your blood pressure medication.', '降压药照常服用');
    expect(g.overallAction).toBe('abstain');
  });
  it('EN class-anchor continue → "stop" flip abstains (keep on your statin → stop)', () => {
    const g = ground('keep on your statin', 'Stop your statin.', 'keep on your statin');
    expect(g.overallAction).toBe('abstain');
  });
});
