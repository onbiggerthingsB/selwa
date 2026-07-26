import type { ReferenceEntry } from '@/lib/types';
import { UNIT_CONVERSIONS } from '@/data/unit-conversions';
import { unitComparisonKey, unitMatches } from '@/lib/reference';

export interface CanonicalToDisplayConversion {
  factor: number;
  converted: boolean;
}

export function convertValue(
  value: number,
  fromUnit: string,
  entry: ReferenceEntry,
): { value: number; unit: string } | null {
  if (unitMatches(fromUnit, entry)) return null; // already canonical/allowed — nothing to do
  // Same comparison key as unitMatches: a unit whose I/l was misread must resolve identically here,
  // or a confusable source unit would fail to match AND fail to convert.
  const from = unitComparisonKey(fromUnit);
  // An analyte may have MORE THAN ONE curated conventional source unit (e.g. d-dimer
  // ng/mL FEU and µg/L FEU both → mg/L FEU). Match the first whose conventionalUnit
  // equals the report's unit. Absence (incl. deliberate abstain-traps) → null → abstain.
  for (const conv of UNIT_CONVERSIONS) {
    if (conv.analyteKey !== entry.key) continue;
    if (from === unitComparisonKey(conv.conventionalUnit)) {
      return { value: value * conv.factorConvToSI, unit: entry.unit };
    }
  }
  return null; // no matching source unit for this analyte → abstain
}

/**
 * Finds the reviewed factor for presenting a canonical reference bound in the
 * report's displayed unit. Allowed units are numerically 1:1 by table invariant;
 * all other units require an analyte-specific reverse conversion.
 */
export function canonicalToDisplayConversion(
  displayUnit: string | null,
  entry: ReferenceEntry,
): CanonicalToDisplayConversion | null {
  if (unitMatches(displayUnit, entry)) return { factor: 1, converted: false };
  if (!displayUnit) return null;

  const display = unitComparisonKey(displayUnit);
  const canonical = unitComparisonKey(entry.unit);
  for (const conversion of UNIT_CONVERSIONS) {
    if (conversion.analyteKey !== entry.key) continue;
    if (unitComparisonKey(conversion.siUnit) !== canonical) continue;
    if (unitComparisonKey(conversion.conventionalUnit) === display) {
      return { factor: conversion.factorSIToConv, converted: true };
    }
  }

  return null;
}
