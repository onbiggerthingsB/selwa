import { describe, it, expect } from 'vitest';
import { REFERENCE_LABS } from './reference-labs';
import { normalizeUnit } from '@/lib/reference';

// H1.5 audit guard. The safety design lets an analyte carry multiple `allowedUnits`
// ONLY when they are numerically 1:1 (no conversion needed) — otherwise a report in
// the second unit is silently classified against the first unit's bounds. A
// magnitude-confusable unit must instead live in unit-conversions.ts (converted) or
// be absent (abstained via R2). This test freezes that invariant: every multi-unit
// whitelist must fall entirely within ONE reviewed equivalence class, so any future
// edit that adds a non-equivalent unit fails here and forces human review.
//
// Each group is a set of NORMALIZED (µ→u, ×→x, spaces stripped, lowercased) unit
// strings that are exactly numerically equal.
const EQUIVALENCE_GROUPS: Record<string, string[]> = {
  // 10^9/L: giga/L, per-nL, 10^3/µL, K/µL all equal 10^9/L exactly.
  count_1e9: ['10^9/l', '10*9/l', 'x10^9/l', 'g/l', '/nl', '10^3/ul', 'k/ul'],
  // 10^12/L: tera/L.
  count_1e12: ['10^12/l', '10*12/l', 'x10^12/l', 't/l'],
  // Enzyme activity: IU/L === U/L.
  enzyme_activity: ['u/l', 'iu/l'],
  // Antibody titer: 1 IU/mL = 1 kIU/L; U/mL is per-mL scale-equal (assay-arbitrary
  // 'U' vs standardized 'IU' — cutoffs are assay-specific, so the printed cutoff
  // governs; no magnitude trap because all are "per mL").
  antibody_titer: ['iu/ml', 'kiu/l', 'u/ml'],
  // Micro-mass concentration: 1 µg/L = 1 ng/mL = 1 mcg/L.
  micro_mass_conc: ['ug/l', 'ng/ml', 'mcg/l'],
  // 1 ng/L = 1 pg/mL.
  ngl_pgml: ['ng/l', 'pg/ml'],
  // 1 mIU/L = 1 µIU/mL (10^-3 IU / 10^3 mL = 10^-6 IU/mL).
  milli_iu: ['miu/l', 'uiu/ml'],
  // Monovalent ions ONLY: 1 mmol/L = 1 mEq/L (valence 1). Divalent analytes must
  // NEVER whitelist mEq/L (2 mEq/L = 1 mmol/L) — enforced separately below.
  monovalent_ion: ['mmol/l', 'meq/l'],
  seconds: ['s', 'sec', '秒'],
  // BMI notation: the same quantity written three ways, no magnitude difference.
  bmi_notation: ['kg/m2', 'kg/m²', 'kg/m^2'],
  // Areal bone mineral density notation: the same quantity written three ways, no magnitude
  // difference. Exactly parallel to bmi_notation. normalizeUnit does not fold the superscript,
  // so all three spellings must be listed.
  bmd_areal_notation: ['g/cm2', 'g/cm²', 'g/cm^2'],
  // Per-minute rate (pulse): every form denotes beats per one minute.
  per_minute: ['次/分', 'bpm', '/min', '次/分钟', 'beats/min'],
  // Percent: halfwidth % and fullwidth ％ are the same unit; Chinese reports print both.
  percent: ['%', '％'],
  esr_rate: ['mm/h', 'mm/hr', 'mm/1h'],
  egfr: ['ml/min/1.73m2', 'ml/min/1.73m²'],
  // D-dimer FEU basis: µg/mL FEU = mg/L FEU exactly (both FEU-qualified).
  ddimer_feu: ['mg/lfeu', 'ug/mlfeu'],
  // Dimensionless pH is variously printed with a placeholder, "pH", or an
  // empty unit cell. These labels all preserve the same numeric value.
  dimensionless_ph: ['units', 'ph', ''],
  urine_qual: ['qualitative', 'negative/+/++/+++', 'negative/positive'],
  // Microscopy count notations: a bare field abbreviation and the common
  // slash/hash/cells spellings all mean count per the same field size.
  microscopy_hpf: ['hpf', '/hpf', '#/hpf', 'cells/hpf'],
  microscopy_lpf: ['lpf', '/lpf', '#/lpf'],
};

function groupFor(unit: string): string | null {
  for (const [name, members] of Object.entries(EQUIVALENCE_GROUPS)) {
    if (members.includes(unit)) return name;
  }
  return null;
}

describe('unit whitelist audit — every multi-unit analyte is within one 1:1 equivalence class', () => {
  it('has no analyte whitelisting two non-equivalent units', () => {
    const violations: string[] = [];
    for (const e of REFERENCE_LABS) {
      const norm = [...new Set(e.allowedUnits.map(normalizeUnit))];
      if (norm.length <= 1) continue; // single unit (after normalization) is always safe
      const groups = new Set(norm.map(groupFor));
      if (groups.has(null)) {
        violations.push(`${e.key}: unit(s) not in any reviewed equivalence group → ${JSON.stringify(norm)}`);
      } else if (groups.size !== 1) {
        violations.push(`${e.key}: units span multiple equivalence groups ${JSON.stringify([...groups])} → ${JSON.stringify(norm)}`);
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('divalent analytes never whitelist mEq/L (2 mEq/L = 1 mmol/L — a silent 2× error)', () => {
    for (const key of ['calcium_total', 'magnesium', 'phosphate']) {
      const e = REFERENCE_LABS.find((x) => x.key === key)!;
      const norm = e.allowedUnits.map(normalizeUnit);
      expect(norm, `${key} must not accept mEq/L`).not.toContain('meq/l');
    }
  });

  it('d-dimer accepts only FEU-qualified units (bare mg/L is FEU/DDU-ambiguous → abstain)', () => {
    const dd = REFERENCE_LABS.find((x) => x.key === 'd_dimer')!;
    const norm = dd.allowedUnits.map(normalizeUnit);
    // Every accepted unit must be explicitly FEU-qualified.
    for (const u of norm) expect(u, `d_dimer unit ${u}`).toContain('feu');
    // The specific ambiguous/removed forms must not be present.
    for (const bad of ['mg/l', 'ug/ml', 'ng/ml']) expect(norm).not.toContain(bad);
  });
});
