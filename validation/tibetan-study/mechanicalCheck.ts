// Mechanical fidelity check for a candidate ZH->BO translation.
//
// This runs the SAME deterministic W4 verification layer the importer uses, so it
// needs ZERO Tibetan competence: it checks that a candidate Tibetan string preserved
// the source's numbers, units, Latin tokens, and structure, and is well-formed Tibetan.
//
// WHAT THIS DOES NOT DO — and cannot: it says nothing about whether the Tibetan MEANS
// the right thing or reads naturally. A candidate can pass every check here and still be
// a dangerous mistranslation ("fluent-but-wrong"). Semantic quality is the human
// reviewer's job. A clean mechanical pass is necessary, never sufficient. See PROTOCOL.md.

import { auditTibetanWellFormedness } from '@/lib/tibetanWellFormedness';
import {
  numberInvariantFindings,
  intervalInvariantFindings,
  latinTokenInvariantFindings,
  unitInvariantFindings,
} from '@/lib/tibetanInvariants';

// The printed-unit vocabulary the source may carry. Mirrors the importer's set; extend
// with any unit that legitimately appears verbatim in the sample's Chinese source.
export const STUDY_UNIT_VOCABULARY: readonly string[] = [
  'mmol/L', 'mg/dL', 'g/L', 'μmol/L', 'umol/L', 'nmol/L', 'ng/L', 'ng/mL', 'ug/L',
  'U/L', 'mL/min/1.73m2', 'mg/L', 'FEU', '%', 's', 'pg/mL', 'IU/mL',
];

export interface MechanicalFinding {
  readonly check: string;
  readonly detail: string;
}

export interface MechanicalResult {
  readonly id: string;
  readonly pass: boolean;
  readonly findings: readonly MechanicalFinding[];
}

/**
 * Run every structural + well-formedness check on one candidate. Empty findings = pass.
 * A candidate that is still an untranslated placeholder (empty bo) is reported, not passed.
 */
export function checkCandidate(
  id: string,
  zh: string,
  bo: string,
): MechanicalResult {
  const findings: MechanicalFinding[] = [];

  const trimmed = bo.trim();
  if (trimmed.length === 0) {
    return { id, pass: false, findings: [{ check: 'EMPTY', detail: 'No candidate Tibetan supplied.' }] };
  }

  for (const finding of auditTibetanWellFormedness(bo)) {
    findings.push({ check: finding.check, detail: finding.reason });
  }
  for (const finding of numberInvariantFindings(zh, bo)) {
    findings.push({ check: finding.check, detail: 'number multiset differs from source' });
  }
  for (const finding of intervalInvariantFindings(zh, bo)) {
    findings.push({ check: finding.check, detail: 'interval structure differs from source' });
  }
  for (const finding of latinTokenInvariantFindings(zh, bo)) {
    findings.push({ check: finding.check, detail: 'Latin token differs from source' });
  }
  for (const finding of unitInvariantFindings(zh, bo, STUDY_UNIT_VOCABULARY)) {
    findings.push({ check: finding.check, detail: 'unit token differs from source' });
  }

  return { id, pass: findings.length === 0, findings };
}

export interface StudyCandidate {
  readonly id: string;
  readonly zh: string;
  readonly bo: string;
}

export interface MechanicalReport {
  readonly model: string;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly empty: number;
  readonly results: readonly MechanicalResult[];
}

/** Check an entire model's candidate column. */
export function checkModel(
  model: string,
  candidates: readonly StudyCandidate[],
): MechanicalReport {
  const results = candidates.map((c) => checkCandidate(c.id, c.zh, c.bo));
  const empty = results.filter((r) => r.findings.some((f) => f.check === 'EMPTY')).length;
  const passed = results.filter((r) => r.pass).length;
  return {
    model,
    total: results.length,
    passed,
    failed: results.length - passed,
    empty,
    results,
  };
}
