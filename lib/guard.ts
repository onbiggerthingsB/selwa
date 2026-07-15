import type {
  Classification,
  ExtractedRow,
  GuardAction,
  GuardFlag,
  ReferenceEntry,
  Sex,
} from '@/lib/types';
import { unitMatches, resolveBounds, parsePrintedRange, type PrintedRange } from '@/lib/reference';
import { classifyAgainstBounds } from '@/lib/classify';

const CONFIRM_CLINICIAN_EN = 'Confirm this with your clinician.';
const CONFIRM_CLINICIAN_ZH = '请与您的医生确认。';

function flag(
  id: string,
  severity: GuardFlag['severity'],
  messageEn: string,
  messageZh: string,
): GuardFlag {
  return { id, severity, messageEn, messageZh };
}

export interface GuardOutcome {
  action: GuardAction;
  needsConfirm: boolean;
  flags: GuardFlag[];
}

// Structural OCR suspicion: missing value, or a value we couldn't parse to a clean number.
function structurallySuspicious(value: string | null, valueNum: number | null): boolean {
  if (value === null) return true;
  if (valueNum === null) return true; // couldn't parse a clean number
  return false;
}

// R13: physiologically implausible magnitude in the analyte's unit — almost
// certainly an OCR misread (decimal shift, inserted digit, wrong-row value). Bounds
// are deliberately wide (source: docs/superpowers/specs/2026-07-08-absolute-bounds-source.md)
// so a real survivable/critical value never lands here.
function outsideAbsoluteBounds(valueNum: number, entry: ReferenceEntry): boolean {
  if (entry.absoluteLow !== null && valueNum < entry.absoluteLow) return true;
  if (entry.absoluteHigh !== null && valueNum > entry.absoluteHigh) return true;
  return false;
}

export function evaluateRow(
  extracted: ExtractedRow,
  entry: ReferenceEntry | null,
  valueNum: number | null,
  classification: Classification,
  sex: Sex,
  age?: number,
  // R11 (harden-H1): the printed range already parsed + unit-normalized to our
  // canonical unit by grounding.ts. Optional for back-compat with direct callers
  // (whose printed range is in canonical units); falls back to parsing the raw string.
  normalizedPrintedRange?: PrintedRange | null,
): GuardOutcome {
  const flags: GuardFlag[] = [];

  // R1 — unknown analyte: abstain, never classify.
  if (!entry) {
    flags.push(
      flag(
        'R1-UNKNOWN-ANALYTE',
        'caution',
        'This test is not in our reference set, so we are not interpreting it. ' + CONFIRM_CLINICIAN_EN,
        '该项目不在我们的参考范围内，因此我们不作解读。' + CONFIRM_CLINICIAN_ZH,
      ),
    );
    return { action: 'abstain', needsConfirm: false, flags };
  }

  // R2 — unit mismatch: abstain (no auto-conversion in v0).
  if (!unitMatches(extracted.unit, entry)) {
    flags.push(
      flag(
        'R2-UNIT-MISMATCH',
        'caution',
        `The unit on your report differs from our reference (we expect ${entry.unit}). ` + CONFIRM_CLINICIAN_EN,
        `报告上的单位与我们的参考单位不同（我们使用 ${entry.unit}）。` + CONFIRM_CLINICIAN_ZH,
      ),
    );
    return { action: 'abstain', needsConfirm: false, flags };
  }

  // R13 — implausible magnitude → suppress interpretation (likely misread). Abstain
  // (no classification, raw value shown) AND needsConfirm (the confirm gate offers a
  // correction). Bounds are wide so a real critical value is never suppressed here.
  if (valueNum !== null && outsideAbsoluteBounds(valueNum, entry)) {
    flags.push(
      flag(
        'R13-IMPLAUSIBLE-VALUE',
        'caution',
        'This value looks unusually far outside the physically possible range, so we may have misread it. Please check the number against your report.',
        '该数值远超生理可能范围，我们可能读错了，请与您的报告核对该数字。',
      ),
    );
    return { action: 'abstain', needsConfirm: true, flags };
  }

  let needsConfirm = false;

  // R3 — critical/panic band.
  if (classification === 'critical') {
    needsConfirm = true;
    flags.push(
      flag(
        'R3-CRITICAL-PANIC-RANGE',
        'urgent',
        'This value is in a critical range that can be serious. Please seek medical advice promptly. ' + CONFIRM_CLINICIAN_EN,
        '该数值处于可能严重的危急范围，请尽快就医并' + CONFIRM_CLINICIAN_ZH,
      ),
    );
  }

  // R4 — high-stakes analyte, any abnormal (even mild).
  if (entry.highStakes && (classification === 'low' || classification === 'high')) {
    flags.push(
      flag(
        'R4-HIGH-STAKES-ANY-ABNORMAL',
        'caution',
        'This is an important test and your value is outside the usual range. ' + CONFIRM_CLINICIAN_EN,
        '这是一项重要指标，您的数值超出常规范围。' + CONFIRM_CLINICIAN_ZH,
      ),
    );
  }

  // R5 — low OCR confidence or structurally suspicious numeric → confirm.
  if (extracted.confidence === 'low' || structurallySuspicious(extracted.value, valueNum)) {
    needsConfirm = true;
    flags.push(
      flag(
        'R5-LOW-OCR-CONFIDENCE-NUMERIC',
        'caution',
        'We may have misread this number. Please check it against your report.',
        '我们可能读错了这个数字，请与您的报告核对。',
      ),
    );
  }

  // R6 — high-stakes OR critical: ALWAYS confirm, regardless of reported confidence.
  if (entry.highStakes || classification === 'critical') {
    needsConfirm = true;
    flags.push(
      flag(
        'R6-HIGH-STAKES-MANDATORY-CONFIRM',
        'info',
        'Because this test matters, please confirm the value we read.',
        '由于该指标很重要，请确认我们读取的数值。',
      ),
    );
  }

  // R11 — the report's own printed range vs ours (unit-normalized). Fire on a VALUE-LEVEL
  // FLIP (our band and the printed range give a different low/normal/high call for THIS
  // value) REGARDLESS of overall band closeness — a value sitting in the narrow gap between
  // the two bands is a real disagreement that must confirm, even when the bands are within
  // the materiality tolerance. Band differences that don't flip this value are informational
  // only (assay/lab reference ranges legitimately vary). Surfaced by the real-content
  // measurement: HCT 49.9% (our sex-unknown union band vs a narrower printed range).
  const printed = normalizedPrintedRange ?? parsePrintedRange(extracted.printedRange);
  if (printed) {
    const { low, high } = resolveBounds(entry, sex, age);
    const valueFlips =
      valueNum !== null &&
      classifyAgainstBounds(valueNum, low, high) !== classifyAgainstBounds(valueNum, printed.low, printed.high);
    const bandsDiffer = printedRangeDisagrees(printed, entry, sex, age);
    if (valueFlips || bandsDiffer) {
      if (valueFlips) needsConfirm = true;
      flags.push(
        flag(
          'R11-RANGE-DISAGREEMENT',
          valueFlips ? 'caution' : 'info',
          valueFlips
            ? 'Your report’s reference range differs from ours in a way that could change whether this value is in range. ' +
              CONFIRM_CLINICIAN_EN
            : 'Your report’s own reference range differs slightly from ours; ranges vary between labs.',
          valueFlips
            ? '您报告上的参考范围与我们的不同，这可能影响该数值是否属于正常范围。' + CONFIRM_CLINICIAN_ZH
            : '您报告上的参考范围与我们的略有不同；不同实验室的范围会有差异。',
        ),
      );
    }
  }

  // R12 — population-sensitive analyte with unknown sex or missing age (we widened the band).
  if (entry.populationSensitive && (sex === 'unknown' || (entry.ageBands && age === undefined))) {
    flags.push(
      flag(
        'R12-POPULATION-SENSITIVE',
        'info',
        'The normal range for this test depends on sex/age, which we don’t have, so we used a wider range. ' + CONFIRM_CLINICIAN_EN,
        '该指标的正常范围与性别/年龄有关，我们缺少这些信息，因此使用了较宽的范围。' + CONFIRM_CLINICIAN_ZH,
      ),
    );
  }

  return { action: 'classify', needsConfirm, flags };
}

function printedRangeDisagrees(printed: PrintedRange, entry: ReferenceEntry, sex: Sex, age?: number): boolean {
  const { low, high } = resolveBounds(entry, sex, age);
  const tol = 0.15; // 15% materiality threshold
  const off = (ours: number | null, theirs: number | null) =>
    ours !== null && theirs !== null && Math.abs(ours - theirs) > Math.abs(ours) * tol;
  return off(low, printed.low) || off(high, printed.high);
}
