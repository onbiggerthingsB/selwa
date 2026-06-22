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
});

describe('splitClauses', () => {
  it('splits on sentence punctuation and conjunctions', () => {
    expect(splitClauses('未见占位，但提示结节').length).toBeGreaterThan(1);
  });
});
