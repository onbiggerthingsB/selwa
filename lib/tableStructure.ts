// STRUCTURAL REFUSAL — deciding, from geometry alone, whether a page is a lab table at all.
//
// WHY THIS EXISTS. The 31-page read of a real health check (validation/camera-path/
// full-report-2026-07-26.md) contained 14 narrative pages — ultrasound and MRI reports, an ECG
// waveform, CT slices — plus a 健康警示灯 infographic: a drawing of a body with 32 labelled organs
// and no numbers anywhere. The frontier model correctly returned ZERO rows on every one of them, and
// on the infographic it extracted the 32 organ labels while setting every value, unit and range to
// null. That is the OCR-only invariant holding under an unusual input.
//
// But it held by the model's JUDGEMENT, and judgement drifts between versions, prompts and
// temperatures. Nothing structural prevented it from inventing a row. This module removes the
// judgement: if the geometry is not a table, there are no rows to emit, by construction. There is no
// generative head involved and therefore nothing that can hallucinate.
//
// WHAT THIS DOES NOT DECIDE. Whether the table is a LAB table, what the analytes are, or whether any
// value is plausible. It answers one question — "is this a grid of results?" — and everything about
// meaning stays where it already lives, in the curated reference table.

import { clusterColumns, type Cell } from './cellBinding';

export interface StructureVerdict {
  isTable: boolean;
  /** Columns found by x-clustering. */
  columns: number;
  /** Vertical bands containing cells from two or more columns — i.e. plausible table rows. */
  alignedRows: number;
  /** Whether some non-leading column is mostly short result-like tokens rather than prose. */
  hasResultColumn: boolean;
  reason: string;
}

/** Minimum aligned rows before a page can be a table. Two rows is a heading and a line, not a grid. */
const MIN_ROWS = 3;
/** Fraction of a column's cells that must look like results for it to count as a result column. */
const RESULT_DENSITY = 0.6;
/** Fraction of all cells that must participate in an aligned row before a page counts as a grid. */
const MIN_PARTICIPATION = 0.7;

const midY = (c: Cell): number => c.y + c.height / 2;

const isNumericResult = (text: string): boolean =>
  /[0-9]/u.test(text.trim()) && text.trim().length <= 24;

/**
 * Does this column carry RESULTS rather than more labels?
 *
 * THE FIRST VERSION OF THIS WAS WRONG, and the test that should have caught it passed for the wrong
 * reason. It accepted any token of six characters or fewer, on the reasoning that results are short
 * and that a length rule needs no vocabulary. But organ names are short too — 心脏, 肺, 肝脏 — so the
 * 健康警示灯 body diagram scored `hasResultColumn: true`, and it was rejected only because that
 * particular synthetic scatter produced two aligned rows instead of three. With 32 labels on a real
 * diagram, three would have aligned and a page of organ names would have been accepted as a table of
 * results.
 *
 * The discriminating signal is not length, it is DIVERSITY. A qualitative results column repeats
 * itself — 阴性, 阴性, 阴性, 阴性 — because most results on a normal panel are the same. A column of
 * labels does not repeat: every organ, and every analyte name, is different. So: numeric, or short
 * and low-diversity. Still no vocabulary, so it cannot stop working on a marker we have not seen.
 */
function isResultColumn(column: readonly Cell[]): boolean {
  if (column.length === 0) return false;
  const numeric = column.filter((c) => isNumericResult(c.text)).length;
  if (numeric >= RESULT_DENSITY * column.length) return true;

  const short = column.filter((c) => [...c.text.trim()].length <= 6 && c.text.trim().length > 0);
  if (short.length < RESULT_DENSITY * column.length) return false;
  const distinct = new Set(short.map((c) => c.text.trim())).size;
  return distinct / short.length <= 0.5;
}

export function detectTableStructure(cells: readonly Cell[]): StructureVerdict {
  const none = (reason: string, extra: Partial<StructureVerdict> = {}): StructureVerdict => ({
    isTable: false,
    columns: 0,
    alignedRows: 0,
    hasResultColumn: false,
    reason,
    ...extra,
  });

  if (cells.length === 0) return none('no cells on the page');

  const columns = clusterColumns(cells);
  if (columns.length < 2) {
    // An ultrasound or MRI report is one wide column of prose. There is no second column for a value
    // to live in, so there is no row to build.
    return none('only one column of text; this is prose, not a table', { columns: columns.length });
  }

  // Count vertical bands that contain cells from at least two different columns. A body diagram's
  // organ labels are scattered around an illustration, so they rarely share a horizontal band with
  // a second column's cell; a table's rows always do.
  const rowHeight = cells.reduce((sum, c) => sum + c.height, 0) / cells.length;
  const bands: { y: number; columns: Set<number> }[] = [];
  columns.forEach((column, index) => {
    for (const cell of column) {
      const y = midY(cell);
      const band = bands.find((b) => Math.abs(b.y - y) <= 0.5 * rowHeight);
      if (band) band.columns.add(index);
      else bands.push({ y, columns: new Set([index]) });
    }
  });
  const alignedBands = bands.filter((b) => b.columns.size >= 2);
  const alignedRows = alignedBands.length;

  // How much of the page actually participates in rows. In a table nearly every cell sits in a band
  // shared with another column. On an illustration, labels are scattered around the picture and most
  // of them share a band with nothing — which is the signal that separates a diagram from a grid far
  // more reliably than counting how many rows happen to line up.
  const inRows = bands
    .filter((b) => b.columns.size >= 2)
    .reduce((n, b) => n + b.columns.size, 0);
  const participation = inRows / cells.length;

  const hasResultColumn = columns.slice(1).some(isResultColumn);
  const base = { columns: columns.length, alignedRows, hasResultColumn };

  if (alignedRows < MIN_ROWS) {
    return { ...base, isTable: false, reason: `only ${alignedRows} aligned row(s); a grid needs at least ${MIN_ROWS}` };
  }
  if (participation < MIN_PARTICIPATION) {
    return {
      ...base,
      isTable: false,
      reason:
        `only ${Math.round(participation * 100)}% of cells sit in an aligned row; `
        + 'scattered labels around an illustration, not a grid',
    };
  }
  if (!hasResultColumn) {
    // The 健康警示灯 infographic: 32 organ labels, no numbers. Names without results are not a table
    // of results, and emitting rows for them would put labels in front of a user as if they were
    // findings.
    return { ...base, isTable: false, reason: 'no column of result-like values; labels without results are not a results table' };
  }

  return { ...base, isTable: true, reason: '' };
}
