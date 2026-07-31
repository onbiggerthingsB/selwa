// RENDER-THEN-VERIFY — checking a claimed row structure against where the text physically sits.
//
// WHAT PROBLEM THIS SOLVES. Today the extraction model returns rows with no coordinates: it asserts
// "this value belongs to this analyte" and nothing can check the assertion. The two real errors ever
// measured on the camera path were both violations of exactly that assertion (BASO% read as 0.10,
// which is the EO% value printed on the line above), and both were invisible downstream — measured
// 2026-07-31, a differential-coherence check does not fire on either, because every individual cell
// string is correct.
//
// If we have the TEXT POSITIONS from an OCR pass, the claim becomes checkable without ever knowing
// the right answer. We do not need ground truth to notice that a claim is geometrically impossible.
//
// TWO INDEPENDENT SIGNALS, and the second is the sharper one:
//
//   PROVENANCE — every claimed string must exist on the page, and a printed cell can only be used
//   once. This is what catches the real BASO failure directly: the model claimed 0.10 for BOTH EO%
//   and BASO%, but the page prints 0.10 once and 0.30 once. A value claimed twice and printed once
//   was copied from somewhere, and that is decidable with no geometry at all.
//
//   COHERENCE — a claimed row's cells must occupy one horizontal band, after allowing for a
//   systematic per-column offset (the offset-column page prints value/unit/range about a line below
//   the name, legitimately). A row whose members are outliers against that offset is a row whose
//   parts do not sit together on the paper.
//
// WHAT THIS IS NOT. It does not decide what the right value is, and it never repairs anything. It
// says "this claim cannot be true of this page", which routes the row to a human. Meaning stays
// deterministic and in the curated table, as everywhere else in this project.

import type { Cell } from './cellBinding';

export interface ClaimedRow {
  name: string;
  value: string | null;
  unit: string | null;
  printedRange: string | null;
}

export type FindingKind = 'not-on-page' | 'reused-cell' | 'incoherent-band';

export interface VerificationFinding {
  rowIndex: number;
  field: 'name' | 'value' | 'unit' | 'printedRange';
  kind: FindingKind;
  detail: string;
}

export interface VerificationResult {
  /** False when the cells cannot support a check at all; findings are then empty and mean nothing. */
  verifiable: boolean;
  reason: string;
  findings: VerificationFinding[];
}

const FIELDS = ['name', 'value', 'unit', 'printedRange'] as const;
type Field = (typeof FIELDS)[number];

/** Compare printed text tolerantly of whitespace only. Never of characters — 172 is not 173. */
const norm = (text: string): string => text.replace(/\s+/gu, '');

const midY = (c: Cell): number => c.y + c.height / 2;

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function verifyRowClaim(
  claimed: readonly ClaimedRow[],
  cells: readonly Cell[],
): VerificationResult {
  if (cells.length === 0) {
    return { verifiable: false, reason: 'no positioned cells to check against', findings: [] };
  }
  if (claimed.length === 0) {
    return { verifiable: true, reason: '', findings: [] };
  }

  // Index the page by normalized text. A page legitimately prints the same string more than once
  // (two analytes both 阴性), so this is a pool of occurrences, not a lookup.
  const pool = new Map<string, Cell[]>();
  for (const cell of cells) {
    const key = norm(cell.text);
    if (key.length === 0) continue;
    const bucket = pool.get(key);
    if (bucket) bucket.push(cell);
    else pool.set(key, [cell]);
  }

  const findings: VerificationFinding[] = [];
  // Which cell each claimed field was matched to; null where unmatched.
  const located: Partial<Record<Field, Cell | null>>[] = [];

  claimed.forEach((row, rowIndex) => {
    const perRow: Partial<Record<Field, Cell | null>> = {};
    for (const field of FIELDS) {
      const text = row[field];
      if (text === null || norm(text).length === 0) {
        perRow[field] = null;
        continue;
      }
      const key = norm(text);
      const bucket = pool.get(key);
      if (!bucket) {
        // Either the page never printed this, or an earlier row already consumed every occurrence.
        findings.push({
          rowIndex,
          field,
          kind: 'not-on-page',
          detail: `"${text}" does not appear on the page`,
        });
        perRow[field] = null;
        continue;
      }
      if (bucket.length === 0) {
        findings.push({
          rowIndex,
          field,
          kind: 'reused-cell',
          detail:
            `"${text}" is claimed here but every printed occurrence was already used by an earlier `
            + 'row. A value claimed more often than it is printed was copied from somewhere.',
        });
        perRow[field] = null;
        continue;
      }
      // Consume the occurrence nearest this row's name, so that a page printing the same string
      // twice pairs each occurrence with its own row rather than arbitrarily.
      const anchor = perRow.name ?? null;
      let chosen = 0;
      if (anchor) {
        let best = Infinity;
        bucket.forEach((cell, i) => {
          const distance = Math.abs(midY(cell) - midY(anchor));
          if (distance < best) {
            best = distance;
            chosen = i;
          }
        });
      }
      perRow[field] = bucket.splice(chosen, 1)[0];
    }
    located.push(perRow);
  });

  // COHERENCE. Compute each column's systematic offset from the rows we fully located, then flag
  // rows whose members are outliers against it. Done per field rather than per x-cluster because the
  // claim itself tells us which field a cell is supposed to be.
  const rowHeight = median(cells.map((c) => c.height));
  const offsets: Partial<Record<Field, number>> = {};
  for (const field of FIELDS) {
    if (field === 'name') continue;
    const deltas = located
      .map((row) => (row.name && row[field] ? midY(row[field]!) - midY(row.name!) : null))
      .filter((d): d is number => d !== null);
    if (deltas.length > 0) offsets[field] = median(deltas);
  }

  located.forEach((row, rowIndex) => {
    if (!row.name) return;
    for (const field of FIELDS) {
      if (field === 'name') continue;
      const cell = row[field];
      if (!cell) continue;
      const expected = offsets[field] ?? 0;
      const residual = Math.abs(midY(cell) - midY(row.name!) - expected);
      if (residual > 0.5 * rowHeight) {
        findings.push({
          rowIndex,
          field,
          kind: 'incoherent-band',
          detail:
            `"${cell.text}" sits ${residual.toFixed(0)}px away from where this row's other cells sit `
            + `(row height ${rowHeight.toFixed(0)}px). It is printed on a different line from its `
            + 'claimed analyte.',
        });
      }
    }
  });

  return { verifiable: true, reason: '', findings };
}
