// H1.5: report-level cross-row integrity checks. The per-row guard (evaluateRow)
// sees one analyte at a time, so it cannot catch an inconsistency BETWEEN two rows
// whose values are each individually plausible. These checks encode invariants that
// hold across rows and, when violated, ESCALATE only — flag the involved rows and
// route them to the confirm gate. They NEVER reclassify or convert a value (the
// LLM-is-OCR-only / meaning-is-deterministic invariant is preserved).

import type { GroundedReport, GroundedRow, GuardFlag } from '@/lib/types';

// direct/conjugated bilirubin is a fraction of total, so direct ≤ total. Fire only
// when direct exceeds total by BOTH a relative margin AND an absolute floor: direct
// assays are known to overestimate at low concentrations, so a healthy panel like
// total 8 / direct 9 is assay noise, not a misread. A real swap / unit error is large.
const BILIRUBIN_RATIO = 1.1;
const BILIRUBIN_ABS_FLOOR = 3; // µmol/L

// total = direct + indirect (indirect is the computed remainder), so all three must
// sum. Absorb one-decimal rounding with a combined absolute + relative tolerance.
const SUM_ABS_TOL = 2; // µmol/L
const SUM_REL_TOL = 0.1;

function crossRowFlag(): GuardFlag {
  return {
    id: 'R15-CROSS-ROW-INCONSISTENCY',
    severity: 'caution',
    messageEn:
      'Two related values on this report don’t line up (the bilirubin values are inconsistent with each other), so we may have misread a number or a unit. Please check them against your report.',
    messageZh:
      '这份报告上两个相关数值不一致（胆红素各项彼此矛盾），我们可能读错了某个数字或单位。请与您的报告核对这些项目。',
  };
}

function withFlag(row: GroundedRow, flag: GuardFlag): GroundedRow {
  if (row.flags.some((f) => f.id === flag.id)) return row;
  return { ...row, needsConfirm: true, flags: [...row.flags, flag] };
}

// Only compare rows the guard actually classified (action 'classify'): an abstained
// row's value is unsafe/unit-mismatched, so a cross-row comparison would be invalid.
// All bilirubin analytes share the same canonical unit (µmol/L) and none but total
// auto-converts, so any two CLASSIFIED bilirubin rows are guaranteed same-unit.
function classifiedRow(report: GroundedReport, key: string): GroundedRow | undefined {
  return report.rows.find(
    (r) => r.entry?.key === key && r.action === 'classify' && r.valueNum !== null,
  );
}

export function applyCrossRowChecks(report: GroundedReport): GroundedReport {
  const total = classifiedRow(report, 'total_bilirubin');
  const direct = classifiedRow(report, 'direct_bilirubin');
  const indirect = classifiedRow(report, 'indirect_bilirubin');

  const toFlag = new Set<GroundedRow>();

  // Invariant 1: direct ≤ total.
  if (total && direct) {
    const excess = direct.valueNum! - total.valueNum!;
    if (direct.valueNum! > total.valueNum! * BILIRUBIN_RATIO && excess > BILIRUBIN_ABS_FLOOR) {
      toFlag.add(total);
      toFlag.add(direct);
    }
  }

  // Invariant 2: total = direct + indirect (only when all three are present).
  if (total && direct && indirect) {
    const sum = direct.valueNum! + indirect.valueNum!;
    const tol = Math.max(SUM_ABS_TOL, total.valueNum! * SUM_REL_TOL);
    if (Math.abs(total.valueNum! - sum) > tol) {
      toFlag.add(total);
      toFlag.add(direct);
      toFlag.add(indirect);
    }
  }

  if (toFlag.size === 0) return report;
  const flag = crossRowFlag();
  return {
    ...report,
    rows: report.rows.map((r) => (toFlag.has(r) ? withFlag(r, flag) : r)),
  };
}
