import { describe, it, expect } from 'vitest';
import { groundExtraction } from './grounding';
import { applyCrossRowChecks } from './crossRowChecks';
import type { LabExtraction } from '@/lib/extractionSchema';
import { resolveText } from '@/lib/i18n';

const R15 = 'R15-CROSS-ROW-INCONSISTENCY';

// direct (conjugated) bilirubin is a COMPONENT of total, so direct ≤ total always
// holds physiologically. A report where direct materially exceeds total is a
// cross-row inconsistency (mixed units, a swapped row, an OCR misread) that no
// per-row rule can see — both individual values are in-bounds and classifiable.
describe('applyCrossRowChecks — bilirubin direct ≤ total', () => {
  function bili(total: string, direct: string): LabExtraction {
    return {
      rows: [
        { name: '总胆红素', value: total, unit: 'umol/L', printedRange: null, confidence: 'high' },
        { name: '直接胆红素', value: direct, unit: 'umol/L', printedRange: null, confidence: 'high' },
      ],
    };
  }

  it('flags BOTH rows + routes to confirm when direct materially exceeds total', () => {
    // 15 > 10: physiologically impossible, yet each value alone is plausible.
    const { rows } = groundExtraction(bili('10', '15'), 'unknown');
    const total = rows.find((r) => r.entry?.key === 'total_bilirubin')!;
    const direct = rows.find((r) => r.entry?.key === 'direct_bilirubin')!;
    expect(total.flags.map((f) => f.id)).toContain(R15);
    expect(direct.flags.map((f) => f.id)).toContain(R15);
    // total_bilirubin is not high-stakes → would NOT otherwise confirm; the check escalates it.
    expect(total.needsConfirm).toBe(true);
    const message = total.flags.find((f) => f.id === R15)!.message;
    expect(resolveText(message, 'en').text).toBe(
      'Two related values on this report don’t line up (the bilirubin values are inconsistent with each other), so we may have misread a number or a unit. Please check them against your report.',
    );
    expect(resolveText(message, 'zh').text).toBe(
      '这份报告上两个相关数值不一致（胆红素各项彼此矛盾），我们可能读错了某个数字或单位。请与您的报告核对这些项目。',
    );
    expect(resolveText(message, 'bo')).toMatchObject({
      text: resolveText(message, 'zh').text,
      resolvedLang: 'zh',
      review: 'unverified',
    });
  });

  it('does not flag when direct is a normal fraction of total', () => {
    const { rows } = groundExtraction(bili('12', '5'), 'unknown');
    for (const r of rows) expect(r.flags.map((f) => f.id)).not.toContain(R15);
  });

  it('tolerates assay-noise near equality (no flag when within 10%)', () => {
    // total 100, direct 108 → ratio 1.08 < 1.1: pure cholestasis + rounding, not a misread.
    const { rows } = groundExtraction(bili('100', '108'), 'unknown');
    for (const r of rows) expect(r.flags.map((f) => f.id)).not.toContain(R15);
  });

  it('does not fire on a normal low panel where direct overestimates total slightly', () => {
    // total 8, direct 9: ratio 1.125 clears the 1.1 gate, but the absolute excess is
    // only 1 µmol/L — below the 3 µmol/L floor. Direct assays overestimate at low
    // concentrations, so this is a routine normal LFT, not a misread.
    const { rows } = groundExtraction(bili('8', '9'), 'unknown');
    for (const r of rows) expect(r.flags.map((f) => f.id)).not.toContain(R15);
  });

  it('never fires when only one bilirubin row is present', () => {
    const one: LabExtraction = {
      rows: [{ name: '直接胆红素', value: '15', unit: 'umol/L', printedRange: null, confidence: 'high' }],
    };
    const { rows } = groundExtraction(one, 'unknown');
    expect(rows[0].flags.map((f) => f.id)).not.toContain(R15);
  });

  it('skips the check when a bilirubin row abstained (no cross-row comparison on unsafe values)', () => {
    // direct in mg/dL has no curated conversion → abstains (R2); comparing against a
    // µmol/L total would be apples-to-oranges, so the check must not run.
    const mixed: LabExtraction = {
      rows: [
        { name: '总胆红素', value: '10', unit: 'umol/L', printedRange: null, confidence: 'high' },
        { name: '直接胆红素', value: '2', unit: 'mg/dL', printedRange: null, confidence: 'high' },
      ],
    };
    const { rows } = groundExtraction(mixed, 'unknown');
    const direct = rows.find((r) => r.entry?.key === 'direct_bilirubin')!;
    expect(direct.action).toBe('abstain');
    for (const r of rows) expect(r.flags.map((f) => f.id)).not.toContain(R15);
  });

  it('flags all three when total ≠ direct + indirect (sum invariant)', () => {
    // total 20, direct 5, indirect 30: direct ≤ total holds (5 < 22), yet the sum is
    // obviously broken — only the total = direct + indirect check catches this.
    const three: LabExtraction = {
      rows: [
        { name: '总胆红素', value: '20', unit: 'umol/L', printedRange: null, confidence: 'high' },
        { name: '直接胆红素', value: '5', unit: 'umol/L', printedRange: null, confidence: 'high' },
        { name: '间接胆红素', value: '30', unit: 'umol/L', printedRange: null, confidence: 'high' },
      ],
    };
    const { rows } = groundExtraction(three, 'unknown');
    for (const key of ['total_bilirubin', 'direct_bilirubin', 'indirect_bilirubin']) {
      const r = rows.find((x) => x.entry?.key === key)!;
      expect(r.flags.map((f) => f.id), key).toContain(R15);
    }
  });

  it('does not fire when total = direct + indirect within rounding tolerance', () => {
    const three: LabExtraction = {
      rows: [
        { name: '总胆红素', value: '15', unit: 'umol/L', printedRange: null, confidence: 'high' },
        { name: '直接胆红素', value: '5', unit: 'umol/L', printedRange: null, confidence: 'high' },
        { name: '间接胆红素', value: '10', unit: 'umol/L', printedRange: null, confidence: 'high' },
      ],
    };
    const { rows } = groundExtraction(three, 'unknown');
    for (const r of rows) expect(r.flags.map((f) => f.id)).not.toContain(R15);
  });

  it('is a no-op on reports without both bilirubin rows (pure function identity)', () => {
    const report = groundExtraction(
      { rows: [{ name: '空腹血糖', value: '5.0', unit: 'mmol/L', printedRange: null, confidence: 'high' }] },
      'unknown',
    );
    expect(applyCrossRowChecks(report)).toEqual(report);
  });
});
