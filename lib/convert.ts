import type { ReferenceEntry } from '@/lib/types';
import { UNIT_CONVERSIONS } from '@/data/unit-conversions';
import { normalizeUnit, unitMatches } from '@/lib/reference';

export function convertValue(
  value: number,
  fromUnit: string,
  entry: ReferenceEntry,
): { value: number; unit: string } | null {
  if (unitMatches(fromUnit, entry)) return null; // already canonical/allowed — nothing to do
  const conv = UNIT_CONVERSIONS.find((c) => c.analyteKey === entry.key);
  if (!conv) return null; // no curated conversion (incl. deliberate abstain-traps) → caller abstains
  const from = normalizeUnit(fromUnit);
  if (from === normalizeUnit(conv.conventionalUnit)) {
    return { value: value * conv.factorConvToSI, unit: entry.unit };
  }
  return null; // unrecognized source unit for this analyte → abstain
}
