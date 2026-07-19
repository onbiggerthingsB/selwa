import type {
  Classification,
  ExtractedRow,
  GuardAction,
  GuardFlag,
  ReferenceEntry,
  Sex,
} from '@/lib/types';
import {
  unitMatches,
  resolveBounds,
  parsePrintedRange,
  parseQualitative,
  statusAgainstPrinted,
  printedRangePlausible,
  type PrintedRange,
} from '@/lib/reference';
import { classifyAgainstBounds } from '@/lib/classify';
import type { LocalizedText } from '@/lib/i18n';
import { defineText, fallback, reviewed } from '@/lib/i18n';

const CONFIRM_CLINICIAN_EN = 'Confirm this with your clinician.';
const CONFIRM_CLINICIAN_ZH = '请与您的医生确认。';

function flag(
  id: string,
  severity: GuardFlag['severity'],
  message: LocalizedText,
): GuardFlag {
  return { id, severity, message };
}

export interface GuardOutcome {
  action: GuardAction;
  needsConfirm: boolean;
  flags: GuardFlag[];
}

// A recognised qualitative result carries its own scale in the value cell; reports
// ordinarily leave the physical-unit column blank. This is deliberately separate
// from unitOptional, whose integrity lock is reserved for dimensionless quantities.
function hasImplicitQualitativeUnit(
  extracted: ExtractedRow,
  entry: ReferenceEntry,
): boolean {
  return (
    entry.unit === 'qualitative' &&
    !extracted.unit?.trim() &&
    parseQualitative(extracted.value) !== null
  );
}

// Structural OCR suspicion: missing value, or a value we couldn't parse in the
// shape curated for this entry.
function structurallySuspicious(
  value: string | null,
  valueNum: number | null,
  entry: ReferenceEntry,
): boolean {
  if (value === null) return true;
  if (entry.unit === 'qualitative' && parseQualitative(value) !== null) return false;
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

function specimenMatchCorroborated(
  extracted: ExtractedRow,
  entry: ReferenceEntry,
  printed: PrintedRange | null,
  sex: Sex,
  age?: number,
): boolean {
  // A contradictory numeric range is a hard veto. A matching printed unit must
  // never overrule the evidence that closed the mislabelled-blood-gas hole.
  if (printed !== null && entry.interpretation === 'ours') {
    return !printedRangeDisagrees(printed, entry, sex, age);
  }

  // Dipstick reports use a qualitative reference token instead of a numeric
  // band. These exact negative tokens are real printed corroboration.
  if (entry.unit === 'qualitative' && parseQualitative(extracted.printedRange) === 'negative') {
    return true;
  }

  // Only an ACTUALLY PRINTED unit is evidence. unitOptional makes a blank unit
  // acceptable later in R2; it must not turn absence into R18 corroboration.
  const printedUnit = extracted.unit?.trim();
  return printedUnit !== undefined && printedUnit.length > 0 && unitMatches(printedUnit, entry);
}

function reportOnlySpecimenContradicted(
  extracted: ExtractedRow,
  entry: ReferenceEntry,
): boolean {
  // "as reported" is an explicit wildcard: this report-only entry has no
  // curated unit family, so a printed unit is not contradictory evidence.
  if (entry.unit === 'as reported') return false;
  const printedUnit = extracted.unit?.trim();
  return (
    printedUnit !== undefined &&
    printedUnit.length > 0 &&
    !unitMatches(printedUnit, entry)
  );
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
  matchedVia: 'unmatched' | 'exact' | 'specimen-scoped' = 'exact',
): GuardOutcome {
  const flags: GuardFlag[] = [];

  // R1 — unknown analyte: abstain, never classify.
  if (!entry) {
    flags.push(
      flag(
        'R1-UNKNOWN-ANALYTE',
        'caution',
        // SURFACED (see SURFACING_FLAGS in lib/summary.ts). Measured on the real corpora: 126 rows
        // (27.1%) — 83 of them independently labelled high-stakes — asserted "Above/Below your
        // report's range" while we did NOT recognise the analyte, with ZERO disclosure. A Lactate
        // of 3.4 or a pO2 of 60 rendered exactly as confidently as a known, grounded row. The chip
        // is decoupled from recognition on purpose (it reproduces the report's own range), but
        // staying silent about not knowing the test let that reproduction read as understanding.
        //
        // Wording is B1-constrained: it describes OUR SCOPE and attributes the visible position to
        // the report, never applying a range to the patient's number. "reference set"/"参考资料"
        // deliberately avoid "our reference range"/"我们的参考范围", which the leakage gate bans
        // because that phrasing implies we judged this value against our band.
        defineText({
          en: reviewed(
            'This test is not in our reference set, so we are not interpreting it — anything shown here comes from your report itself. ' +
              CONFIRM_CLINICIAN_EN,
          ),
          zh: reviewed(
            '该项目不在我们的参考资料中，因此我们不作解读——此处显示的内容均来自您的报告本身。' +
              CONFIRM_CLINICIAN_ZH,
          ),
          bo: fallback('zh'),
        }),
      ),
    );
    return { action: 'abstain', needsConfirm: false, flags };
  }

  const printed = normalizedPrintedRange ?? parsePrintedRange(extracted.printedRange);

  // R18 — an owned-band (`ours`) specimen-scoped alias is trusted ONLY while the report supplies
  // independent corroboration: a compatible numeric range, an exact qualitative reference token
  // for a qualitative entry, or an explicitly printed matching unit. A contradictory numeric
  // range always wins. A wrong specimen label hands classification the wrong clinical frame, so
  // this fails closed before unit handling or classification can present the entry as understood.
  //
  // A report-only entry has no owned band or clinical classification to misapply. Its generic
  // names exist only in the scoped index, so unknown/other-fluid rows cannot reach it; when urine
  // context is printed, absence of row-level corroboration may still unlock translation and the
  // report's own comparison. Positive contradictory evidence remains fail-closed: an explicitly
  // printed unit outside that entry's curated unit family still triggers R18.
  //
  // ABSENCE OF A PRINTED RANGE IS NOT CORROBORATION. An earlier version required
  // `printed !== null`, which treated "no evidence" as "no problem" and left the exact hole
  // this rule exists to close: a mislabelled blood gas — pH 7.1, no printed range, no unit —
  // resolved to urine_ph and classified as NORMAL against the urine band, with needsConfirm
  // false, no flag, and "Typical range 5–8 pH" plus "Urine pH measures how acidic or alkaline
  // the urine is" rendered beside a life-threatening acidosis. Nothing else catches it: the
  // scoped name is the ONLY evidence of specimen, and R16/R17 cannot fire without a printed
  // range to compare against. A scoped match with nothing to check is uncorroborated by
  // definition, so it aborts too — the flag text already says exactly that.
  //
  // Cost of failing closed here is small and bounded: with no printed range there is no chip
  // either, so the row loses only typicalRange and the definition, and it still discloses.
  if (
    matchedVia === 'specimen-scoped' &&
    (entry.interpretation === 'report-only'
      ? reportOnlySpecimenContradicted(extracted, entry)
      : !specimenMatchCorroborated(extracted, entry, printed, sex, age))
  ) {
    flags.push(
      flag(
        'R18-SPECIMEN-MATCH-UNCORROBORATED',
        'caution',
        defineText({
          en: reviewed(
            'We could not corroborate the specimen label we read with the reference details printed on your report, so we are not interpreting this test. Please check the specimen, range, and unit on your report.',
          ),
          zh: reviewed(
            '我们无法用报告上打印的参考信息确认所读取的样本类型，因此不解读此项目。请核对报告上的样本类型、范围和单位。',
          ),
          bo: fallback('zh'),
        }),
      ),
    );
    // The existing confirmation screen can edit only value and unit. Sending an
    // R18 row there cannot resolve a specimen/range mismatch, so disclose and
    // abstain without adding an irrelevant confirmation step.
    return { action: 'abstain', needsConfirm: false, flags };
  }

  // Report-only entries are intentionally handled without an owned band. Their
  // name and definition may render, and the summary may reproduce the report's
  // own comparison, but no unit/value/clinical classification runs here. Low
  // OCR confidence still enters the confirmation flow; the result can be a word
  // or a range, so do not mislabel it as a suspicious numeric shape.
  if (entry.interpretation === 'report-only') {
    if (extracted.confidence === 'low') {
      flags.push(
        flag(
          'R5-LOW-OCR-CONFIDENCE-NUMERIC',
          'caution',
          defineText({
            en: reviewed('We may have misread this result. Please check it against your report.'),
            zh: reviewed('我们可能读错了这项结果，请与您的报告核对。'),
            bo: fallback('zh'),
          }),
        ),
      );
      return { action: 'classify', needsConfirm: true, flags };
    }
    return { action: 'classify', needsConfirm: false, flags };
  }

  // R2 — unit mismatch: abstain (no auto-conversion in v0).
  if (!unitMatches(extracted.unit, entry) && !hasImplicitQualitativeUnit(extracted, entry)) {
    flags.push(
      flag(
        'R2-UNIT-MISMATCH',
        'caution',
        defineText({
          en: reviewed(
            `The unit on your report differs from our reference (we expect ${entry.unit}). ` +
              CONFIRM_CLINICIAN_EN,
          ),
          zh: reviewed(
            `报告上的单位与我们的参考单位不同（我们使用 ${entry.unit}）。` +
              CONFIRM_CLINICIAN_ZH,
          ),
          bo: fallback('zh'),
        }),
      ),
    );
    // needsConfirm for a HIGH-STAKES analyte: R2 returns before R6 can fire, so without this a
    // recognised-but-unit-mismatched troponin abstained with needsConfirm=false AND (before R2 was
    // surfaced) no visible flag at all — strictly worse than not recognising it, because R1 at
    // least spoke. Recognising an analyte must never reduce what the user is told.
    return { action: 'abstain', needsConfirm: entry.highStakes, flags };
  }

  // R13 — implausible magnitude → suppress interpretation (likely misread). Abstain
  // (no classification, raw value shown) AND needsConfirm (the confirm gate offers a
  // correction). Bounds are wide so a real critical value is never suppressed here.
  if (valueNum !== null && outsideAbsoluteBounds(valueNum, entry)) {
    flags.push(
      flag(
        'R13-IMPLAUSIBLE-VALUE',
        'caution',
        defineText({
          en: reviewed(
            'This value looks unusually far outside the physically possible range, so we may have misread it. Please check the number against your report.',
          ),
          zh: reviewed('该数值远超生理可能范围，我们可能读错了，请与您的报告核对该数字。'),
          bo: fallback('zh'),
        }),
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
        defineText({
          en: reviewed(
            'This value is in a critical range that can be serious. Please seek medical advice promptly. ' +
              CONFIRM_CLINICIAN_EN,
          ),
          zh: reviewed('该数值处于可能严重的危急范围，请尽快就医并' + CONFIRM_CLINICIAN_ZH),
          bo: fallback('zh'),
        }),
      ),
    );
  }

  // R4 — high-stakes analyte, any abnormal (even mild).
  if (entry.highStakes && (classification === 'low' || classification === 'high')) {
    flags.push(
      flag(
        'R4-HIGH-STAKES-ANY-ABNORMAL',
        'caution',
        defineText({
          en: reviewed(
            'This is an important test and your value is outside the usual range. ' +
              CONFIRM_CLINICIAN_EN,
          ),
          zh: reviewed('这是一项重要指标，您的数值超出常规范围。' + CONFIRM_CLINICIAN_ZH),
          bo: fallback('zh'),
        }),
      ),
    );
  }

  // R5 — low OCR confidence or structurally suspicious numeric → confirm.
  if (
    extracted.confidence === 'low' ||
    structurallySuspicious(extracted.value, valueNum, entry)
  ) {
    needsConfirm = true;
    flags.push(
      flag(
        'R5-LOW-OCR-CONFIDENCE-NUMERIC',
        'caution',
        defineText({
          en: reviewed('We may have misread this number. Please check it against your report.'),
          zh: reviewed('我们可能读错了这个数字，请与您的报告核对。'),
          bo: fallback('zh'),
        }),
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
        defineText({
          en: reviewed('Because this test matters, please confirm the value we read.'),
          zh: reviewed('由于该指标很重要，请确认我们读取的数值。'),
          bo: fallback('zh'),
        }),
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
  // R16 — the printed range cannot be this analyte's range in the unit we assumed (grounding
  // assumes the range shares the VALUE's unit; real reports mix them). The assumption is
  // DISPROVED, so every downstream use of this range is void: R11 must not draw a conclusion
  // from it, and the summary must not build a chip from it (it suppresses on this flag, as it
  // does for R13). Confirm, because the user should check what their report actually prints.
  const printedUsable = printed !== null && printedRangePlausible(printed, entry, sex, age);
  if (printed && !printedUsable) {
    needsConfirm = true;
    flags.push(
      flag(
        'R16-PRINTED-RANGE-UNIT-SUSPECT',
        'caution',
        defineText({
          en: reviewed(
            'The reference range on your report doesn’t appear to use the same units as the value, so we can’t compare them. Please check the range against your report. ' +
              CONFIRM_CLINICIAN_EN,
          ),
          zh: reviewed(
            '您报告上的参考范围似乎与数值使用的单位不同，因此我们无法进行比较。请核对报告上的范围。' +
              CONFIRM_CLINICIAN_ZH,
          ),
          bo: fallback('zh'),
        }),
      ),
    );
  }

  // R11 is SKIPPED when R16 disproved the range: comparing our band against a range whose unit we
  // got wrong produces a meaningless agree/disagree verdict (it was the double-conversion that
  // made TC 250 mg/dL vs a printed SI range look consistent, leaving needsConfirm=false).
  // R12 below still applies — it is about OUR band, not the report's.
  if (printed && printedUsable) {
    const { low, high } = resolveBounds(entry, sex, age);
    // The PRINTED side must honour bound strictness ("<5.2" excludes 5.2), so it goes through the
    // same shared helper the chip uses. classifyAgainstBounds() takes bare numbers and would
    // silently treat "<5.2" as "<=5.2" — the flip would be missed and no confirm raised.
    const oursSays = valueNum === null ? null : classifyAgainstBounds(valueNum, low, high);
    const printedSays = statusAgainstPrinted(valueNum, printed);
    const asOurs = printedSays === 'below' ? 'low' : printedSays === 'above' ? 'high' : printedSays === 'within' ? 'normal' : null;
    const valueFlips = oursSays !== null && asOurs !== null && oursSays !== asOurs;
    const bandsDiffer = printedRangeDisagrees(printed, entry, sex, age);

    // R17 — our band and the report's printed range DO NOT OVERLAP AT ALL. Not lab-to-lab
    // variation (that is bandsDiffer, a 15% tolerance): disjoint bands mean our entry is measuring
    // something else — most often a different SPECIMEN under the same name.
    //
    // Found by an adversarial review of the β2-microglobulin alias: a urine β2M of 1.03 mg/L
    // against a printed 0-0.3 rendered a correct chip ("Above your report's range") sitting beside
    // "Typical range 0.8-2.4 mg/L" — our SERUM band — with nothing warning the user. R11 fires and
    // confirms, but is not surfaced; R16 misses it (2.4 vs 0.3 is 8x, under SCALE_TOLERANCE 10);
    // R13 catches only the HEALTHY urine value (0.15 < absoluteLow) and misses the injured patient.
    //
    // We cannot tell which specimen the row is, so we do not guess: we stop presenting our band as
    // "typical" for it (lib/summary.ts suppresses typicalRange + source) and confirm. The chip is
    // untouched — it is the report's own arithmetic and stays correct regardless of specimen.
    const ourLow = low ?? -Infinity;
    const ourHigh = high ?? Infinity;
    const theirLow = printed.low ?? -Infinity;
    const theirHigh = printed.high ?? Infinity;
    if (!(ourLow <= theirHigh && theirLow <= ourHigh)) {
      needsConfirm = true;
      flags.push(
        flag(
          'R17-BAND-NOT-COMPARABLE',
          'caution',
          // INTERNAL (not in SURFACING_FLAGS): it drives suppression + the confirm gate. Its
          // user-visible effect is the ABSENCE of a misleading "Typical range", which needs no
          // new sentence. Surfacing a message here is a deliberate follow-up, not an oversight.
          defineText({
            en: reviewed(
              'Our reference band for this test does not overlap the range printed on your report, so we are not showing a typical range for it.',
            ),
            zh: reviewed(
              '我们对该项目的参考区间与您报告上打印的范围完全不重叠，因此不显示一般范围。',
            ),
            bo: fallback('zh'),
          }),
        ),
      );
    }
    if (valueFlips || bandsDiffer) {
      if (valueFlips) needsConfirm = true;
      flags.push(
        flag(
          'R11-RANGE-DISAGREEMENT',
          valueFlips ? 'caution' : 'info',
          defineText({
            en: reviewed(
              valueFlips
                ? 'Your report’s reference range differs from ours in a way that could change whether this value is in range. ' +
                    CONFIRM_CLINICIAN_EN
                : 'Your report’s own reference range differs slightly from ours; ranges vary between labs.',
            ),
            zh: reviewed(
              valueFlips
                ? '您报告上的参考范围与我们的不同，这可能影响该数值是否属于正常范围。' +
                    CONFIRM_CLINICIAN_ZH
                : '您报告上的参考范围与我们的略有不同；不同实验室的范围会有差异。',
            ),
            bo: fallback('zh'),
          }),
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
        defineText({
          en: reviewed(
            'The normal range for this test depends on sex/age, which we don’t have, so we used a wider range. ' +
              CONFIRM_CLINICIAN_EN,
          ),
          zh: reviewed(
            '该指标的正常范围与性别/年龄有关，我们缺少这些信息，因此使用了较宽的范围。' +
              CONFIRM_CLINICIAN_ZH,
          ),
          bo: fallback('zh'),
        }),
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
