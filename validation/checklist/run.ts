// CheckList runner (validation-rigor cycle). Executes a BehavioralCase against
// the REAL guard entry points and normalizes the verdict. Pure & deterministic.

import { groundExtraction } from '@/lib/grounding';
import { groundNotes } from '@/lib/notesGrounding';
import type { SegmentAction, Sex, Classification, GroundedRow } from '@/lib/types';
import type { BehavioralCase, LabsInput, NotesInput, Verdict } from './types';

// Normalize the two guard vocabularies to the unified Verdict. A high-stakes /
// critical labs row keeps action='classify' but sets needsConfirm=true and carries
// a "confirm with clinician" flag — so those states are 'flag', not clean 'render'.
// (Verified against the real guard: 空腹血糖 5.5 mmol/L → classify + needsConfirm.)
function fromLabs(row: GroundedRow): Verdict {
  if (row.action === 'abstain') return 'abstain';
  if (row.needsConfirm || row.flags.length > 0) return 'flag';
  return 'render';
}
function fromNotes(a: SegmentAction): Verdict {
  return a; // already render|flag|abstain
}

interface Evaluated {
  verdict: Verdict;
  classification: Classification | null; // labs only
}

function evaluate(kind: 'labs' | 'notes', input: LabsInput | NotesInput): Evaluated {
  if (kind === 'labs') {
    const i = input as LabsInput;
    const report = groundExtraction({ rows: [i.row] }, (i.sex ?? 'unknown') as Sex, i.age);
    const row = report.rows[0];
    return { verdict: fromLabs(row), classification: row.classification };
  }
  const i = input as NotesInput;
  const grounded = groundNotes(
    { segments: [{ sourceText: i.sourceText, translatedText: i.translatedText, kind: i.kind }] },
    i.originalText,
  );
  return { verdict: fromNotes(grounded.overallAction), classification: null };
}

// Apply a shallow perturbation patch to a labs row or notes segment.
function applyPatch(input: LabsInput | NotesInput, patch: Record<string, unknown>, kind: 'labs' | 'notes'): LabsInput | NotesInput {
  if (kind === 'labs') {
    const i = input as LabsInput;
    return { ...i, row: { ...i.row, ...(patch as object) } };
  }
  return { ...(input as NotesInput), ...(patch as object) };
}

export interface CaseResult {
  id: string;
  capability: string;
  testType: BehavioralCase['testType'];
  kind: BehavioralCase['kind'];
  expected: Verdict | 'invariant';
  actual: Verdict;
  pass: boolean;
  detail?: string; // e.g. which perturbation broke invariance
}

export function runBehavioralCase(c: BehavioralCase): CaseResult {
  const base = evaluate(c.kind, c.input);

  if (c.testType === 'INV') {
    for (const p of c.perturbations ?? []) {
      const perturbed = evaluate(c.kind, applyPatch(c.input, p.patch, c.kind));
      if (perturbed.verdict !== base.verdict || perturbed.classification !== base.classification) {
        return {
          id: c.id, capability: c.capability, testType: c.testType, kind: c.kind,
          expected: 'invariant', actual: perturbed.verdict, pass: false,
          detail: `perturbation "${p.name}" changed verdict ${base.verdict}→${perturbed.verdict} / class ${base.classification}→${perturbed.classification}`,
        };
      }
    }
    return {
      id: c.id, capability: c.capability, testType: c.testType, kind: c.kind,
      expected: 'invariant', actual: base.verdict, pass: true,
    };
  }

  // MFT / DIR: a single required verdict.
  const expected = c.expect.verdict!;
  return {
    id: c.id, capability: c.capability, testType: c.testType, kind: c.kind,
    expected, actual: base.verdict, pass: base.verdict === expected,
  };
}
