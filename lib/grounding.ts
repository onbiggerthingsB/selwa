import type { GroundedReport, GroundedRow, Sex } from '@/lib/types';
import type { LabExtraction } from '@/lib/extractionSchema';
import { findEntryMatch, unitMatches, parsePrintedRange } from '@/lib/reference';
import { parseValue, classify } from '@/lib/classify';
import { evaluateRow } from '@/lib/guard';
import { convertValue } from '@/lib/convert';
import { applyCrossRowChecks } from '@/lib/crossRowChecks';

export function groundExtraction(extraction: LabExtraction, sex: Sex, age?: number): GroundedReport {
  const rows: GroundedRow[] = extraction.rows.map((extracted) => {
    // Only explicitly printed urine/blood context may unlock (or refine) a
    // scoped alias. Missing/null context retains the legacy exact lookup.
    const { entry, matchedVia } = findEntryMatch(
      extracted.name,
      extracted.specimen ?? 'unknown',
    );
    let valueNum = parseValue(extracted.value);

    // R2b — safe unit auto-conversion. When the reported unit doesn't match our
    // reference unit but a curated, unambiguous conversion exists, convert to the
    // canonical SI value and record an info flag. Unconvertible mismatches fall
    // through unchanged so the guard's R2 abstain still fires.
    let converted: { from: string; to: string } | null = null;
    if (
      entry?.interpretation === 'ours' &&
      valueNum !== null &&
      extracted.unit &&
      !unitMatches(extracted.unit, entry)
    ) {
      const c = convertValue(valueNum, extracted.unit, entry);
      if (c) {
        converted = { from: `${extracted.value} ${extracted.unit}`, to: `${c.value.toFixed(2)} ${c.unit}` };
        valueNum = c.value;
      }
    }
    const effectiveUnit = converted ? entry!.unit : extracted.unit;

    // Normalize the report's printed reference range to our canonical unit so R11
    // compares like-with-like (a mg/dL printed range vs our mmol/L band, etc.).
    // When the value was unit-converted, apply the SAME conversion to the range.
    let normalizedPrintedRange = parsePrintedRange(extracted.printedRange);
    if (normalizedPrintedRange && converted && entry && extracted.unit) {
      const cl =
        normalizedPrintedRange.low !== null ? convertValue(normalizedPrintedRange.low, extracted.unit, entry) : null;
      const ch =
        normalizedPrintedRange.high !== null ? convertValue(normalizedPrintedRange.high, extracted.unit, entry) : null;
      // Unit conversion rescales the BOUNDS; it must not silently change their STRICTNESS.
      // "<5.2 mg/dL" is still a strict upper bound after conversion — dropping the flags here
      // would let R11 treat it as inclusive and miss the flip.
      normalizedPrintedRange = {
        low: cl ? cl.value : null,
        high: ch ? ch.value : null,
        lowInclusive: normalizedPrintedRange.lowInclusive,
        highInclusive: normalizedPrintedRange.highInclusive,
      };
    }

    // classify only when grounded against a matched entry; the guard owns abstention.
    const classification =
      entry?.interpretation === 'ours'
        ? classify(valueNum, entry, sex, age)
        : 'unclassified';
    const outcome = evaluateRow(
      { ...extracted, unit: effectiveUnit },
      entry,
      valueNum,
      classification,
      sex,
      age,
      normalizedPrintedRange,
      matchedVia,
    );

    // Surface the conversion as a non-blocking info flag (EN + ZH).
    if (converted) {
      outcome.flags.unshift({
        id: 'R2b-UNIT-CONVERTED',
        severity: 'info',
        messageEn: `We converted ${converted.from} to ${converted.to} to compare with our reference range.`,
        messageZh: `我们已将 ${converted.from} 换算为 ${converted.to} 以便与参考范围比较。`,
      });
    }

    return {
      extracted,
      entry,
      matchedVia,
      valueNum,
      classification: outcome.action === 'abstain' ? 'unclassified' : classification,
      action: outcome.action,
      needsConfirm: outcome.needsConfirm,
      flags: outcome.flags,
    };
  });

  // generatedAt stamped by the caller (Date is non-deterministic in tests).
  // H1.5: report-level cross-row integrity (e.g. direct ≤ total bilirubin) runs
  // after every row is grounded, escalating inconsistent rows to the confirm gate.
  return applyCrossRowChecks({ rows, sex, age, generatedAt: 0 });
}
