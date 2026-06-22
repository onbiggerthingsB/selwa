import { describe, it, expect } from 'vitest';
import { detectImmutables, splitClauses } from './notesDetect';

describe('detectImmutables', () => {
  it('extracts a ZH prefix negation scoping the finding to its right', () => {
    const im = detectImmutables('未见肝内占位', 'zh');
    const neg = im.find((i) => i.type === 'negation')!;
    expect(neg.polarity).toBe('absent');
    expect(neg.finding).toContain('占位');
  });
  it('extracts a ZH suffix hedge (待排) scoping the finding to its left', () => {
    const im = detectImmutables('占位待排', 'zh');
    const neg = im.find((i) => i.type === 'negation')!;
    expect(neg.polarity).toBe('uncertain');
    expect(neg.finding).toContain('占位');
  });
  it('extracts a dose with amount + unit dimension + frequency', () => {
    const im = detectImmutables('二甲双胍 850mg 每日两次', 'zh');
    const dose = im.find((i) => i.type === 'dosage')!;
    expect(dose.amount).toBe('850');
    expect(dose.unitDim).toBe('mg');
    expect(dose.frequency).toBeTruthy();
  });
  it('normalizes 毫克 to the same unit dimension as mg', () => {
    const a = detectImmutables('500 毫克', 'zh').find((i) => i.type === 'dosage')!;
    const b = detectImmutables('500 mg', 'en').find((i) => i.type === 'dosage')!;
    expect(a.unitDim).toBe(b.unitDim);
  });
  it('extracts a dose range 1-2片', () => {
    const dose = detectImmutables('布洛芬 1-2片 需要时', 'zh').find((i) => i.type === 'dosage')!;
    expect(dose.range).toEqual({ min: '1', max: '2' });
  });
  it('resolves a known drug to its canonical id and detects unknown med tokens', () => {
    const known = detectImmutables('继续服用二甲双胍', 'zh').find((i) => i.type === 'drug')!;
    expect(known.drugId).toBe('metformin');
    const unknown = detectImmutables('服用恩美曲妥珠单抗', 'zh').find((i) => i.type === 'drug')!;
    expect(unknown.drugId).toBeNull();
  });

  // --- EN false-positive regressions (v1 fix) -------------------------------
  it('does not fire a phantom EN negation inside ordinary words (normal/notes)', () => {
    const im = detectImmutables('normal sinus rhythm', 'en');
    expect(im.filter((i) => i.type === 'negation')).toHaveLength(0);
  });
  it('does not fire a phantom EN negation inside "lisinopril" (no inside the word)', () => {
    const im = detectImmutables('continue lisinopril', 'en');
    expect(im.filter((i) => i.type === 'negation')).toHaveLength(0);
    // med-context ("continue") + 'pril' suffix → lisinopril detected as unknown drug.
    const drug = im.find((i) => i.type === 'drug');
    expect(drug).toBeTruthy();
    expect(drug!.drugId).toBeNull();
  });
  it('does not flag "spine" as a drug without medication context', () => {
    const im = detectImmutables('cervical spine MRI', 'en');
    expect(im.filter((i) => i.type === 'drug')).toHaveLength(0);
  });
  it('still detects a genuine EN negation ("no evidence of")', () => {
    const im = detectImmutables('no evidence of malignancy', 'en');
    const neg = im.find((i) => i.type === 'negation');
    expect(neg).toBeTruthy();
    expect(neg!.polarity).toBe('absent');
  });

  // --- Fix 1: EN count units → ZH↔EN dose symmetry --------------------------
  it('extracts "1 tablet" (en) as a DOSAGE with unitDim tablet, not a bare number', () => {
    const im = detectImmutables('1 tablet', 'en');
    const dose = im.find((i) => i.type === 'dosage');
    expect(dose).toBeTruthy();
    expect(dose!.unitDim).toBe('tablet');
    expect(dose!.amount).toBe('1');
    expect(im.filter((i) => i.type === 'number')).toHaveLength(0);
  });
  it('matches EN/ZH count-unit dose dims: 2 tablets ≡ 2片 → tablet', () => {
    const en = detectImmutables('2 tablets', 'en').find((i) => i.type === 'dosage')!;
    const zh = detectImmutables('2片', 'zh').find((i) => i.type === 'dosage')!;
    expect(en.unitDim).toBe('tablet');
    expect(zh.unitDim).toBe('tablet');
    expect(en.unitDim).toBe(zh.unitDim);
  });
  it('matches multi-letter EN count units longest-first ("tablets" beats "tab")', () => {
    const dose = detectImmutables('3 tablets', 'en').find((i) => i.type === 'dosage')!;
    expect(dose.amount).toBe('3');
    expect(dose.unitDim).toBe('tablet');
  });

  // --- Fix 2: comma as thousands separator in dose amounts ------------------
  it('parses a comma-grouped dose amount as one number (1,000 mg → 1000)', () => {
    const im = detectImmutables('warfarin 1,000 mg daily', 'en');
    const doses = im.filter((i) => i.type === 'dosage');
    expect(doses).toHaveLength(1);
    expect(doses[0].amount).toBe('1000');
    expect(doses[0].unitDim).toBe('mg');
    // No stray bare "1" left behind.
    expect(im.filter((i) => i.type === 'number')).toHaveLength(0);
  });
  it('leaves a plain dose amount unchanged (5 mg → 5)', () => {
    const dose = detectImmutables('5 mg', 'en').find((i) => i.type === 'dosage')!;
    expect(dose.amount).toBe('5');
  });
  it('still parses a real decimal dose amount (0.5 mg → 0.5)', () => {
    const dose = detectImmutables('0.5 mg', 'en').find((i) => i.type === 'dosage')!;
    expect(dose.amount).toBe('0.5');
  });

  // --- Fix 3: past-tense EN negation "denied" ------------------------------
  it('detects "denied" as a definite-absent EN negation', () => {
    const im = detectImmutables('denied chest pain', 'en');
    const neg = im.find((i) => i.type === 'negation');
    expect(neg).toBeTruthy();
    expect(neg!.polarity).toBe('absent');
    expect(neg!.finding).toContain('chest pain');
  });
  it('does not fire "denied" inside another word', () => {
    const im = detectImmutables('the deniedness score', 'en');
    expect(im.filter((i) => i.type === 'negation')).toHaveLength(0);
  });
});

describe('splitClauses', () => {
  it('splits on sentence punctuation and conjunctions', () => {
    expect(splitClauses('未见占位，但提示结节').length).toBeGreaterThan(1);
  });
});
