import { describe, it, expect } from 'vitest';
import { confirmBurden, type ConfirmRow } from './confirmBurden';

describe('confirmBurden', () => {
  it('computes confirm rate over emitted rows and a per-rule breakdown', () => {
    const rows: ConfirmRow[] = [
      { emitted: true, needsConfirm: true, ruleIds: ['R6-HIGH-STAKES-MANDATORY-CONFIRM', 'R4-HIGH-STAKES-ANY-ABNORMAL'] },
      { emitted: true, needsConfirm: false, ruleIds: [] },
      { emitted: false, needsConfirm: false, ruleIds: [] }, // abstained → not emitted
      { emitted: true, needsConfirm: true, ruleIds: ['R5-LOW-OCR-CONFIDENCE-NUMERIC'] },
    ];
    const b = confirmBurden(rows);
    expect(b.emitted).toBe(3);
    expect(b.confirmed).toBe(2);
    expect(b.confirmRate).toBeCloseTo(2 / 3, 6);
    expect(b.byRule['R6-HIGH-STAKES-MANDATORY-CONFIRM']).toBe(1);
    expect(b.byRule['R5-LOW-OCR-CONFIDENCE-NUMERIC']).toBe(1);
    expect(b.byRule['R4-HIGH-STAKES-ANY-ABNORMAL']).toBe(1);
  });

  it('confirmRate is NaN when nothing is emitted (never 1.0)', () => {
    const rows: ConfirmRow[] = [{ emitted: false, needsConfirm: false, ruleIds: [] }];
    expect(Number.isNaN(confirmBurden(rows).confirmRate)).toBe(true);
  });

  it('only emitted AND needsConfirm rows contribute to byRule', () => {
    const rows: ConfirmRow[] = [
      { emitted: false, needsConfirm: true, ruleIds: ['R3-CRITICAL-PANIC-RANGE'] }, // not emitted → excluded
      { emitted: true, needsConfirm: false, ruleIds: ['R11-RANGE-DISAGREEMENT'] }, // no confirm → excluded
    ];
    const b = confirmBurden(rows);
    expect(b.confirmed).toBe(0);
    expect(b.byRule).toEqual({});
  });
});
