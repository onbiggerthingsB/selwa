import type { ReferenceEntry } from '@/lib/types';
import { UNIT_CONVERSIONS } from '@/data/unit-conversions';
import { normalizeUnit, unitMatches } from '@/lib/reference';

export function convertValue(
  value: number,
  fromUnit: string,
  entry: ReferenceEntry,
): { value: number; unit: string } | null {
  if (unitMatches(fromUnit, entry)) return null; // already canonical/allowed — nothing to do
  const from = normalizeUnit(fromUnit);
  // An analyte may have MORE THAN ONE curated conventional source unit (e.g. d-dimer
  // ng/mL FEU and µg/L FEU both → mg/L FEU). Match the first whose conventionalUnit
  // equals the report's unit. Absence (incl. deliberate abstain-traps) → null → abstain.
  for (const conv of UNIT_CONVERSIONS) {
    if (conv.analyteKey !== entry.key) continue;
    if (from === normalizeUnit(conv.conventionalUnit)) {
      return { value: value * conv.factorConvToSI, unit: entry.unit };
    }
  }
  return null; // no matching source unit for this analyte → abstain
}
