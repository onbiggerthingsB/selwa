// GEOMETRIC ROW BINDING — turning OCR cells into table rows, deterministically.
//
// WHY THIS EXISTS. The 2026-07-25 camera measurement found two reproducible value errors on a real
// Lhasa CBC (validation/camera-path/README.md). Both were ROW-ASSOCIATION failures: BASO% was read
// as 0.10, which is exactly the EO% value printed on the line above it. The value bled upward from
// an adjacent row, identically in all three runs. And the 2026-07-26 full-report read found a page
// whose value/unit/range columns print about one line LOWER than the name column, so a naive
// pairing mis-binds every row on that page.
//
// Neither is detectable downstream. Measured 2026-07-31 (same README): a differential-coherence
// check does not fire on the BASO error — the corrupted deviation is identical to a normal one, and
// the percentage sum moves CLOSER to 100. No arithmetic over the extracted values can see a binding
// error, because every individual cell string is correct. Only the geometry knows.
//
// So binding is done HERE, in our own deterministic code, from cell coordinates — not inside a
// model's attention where it is unattributable and untestable. This is the same split the project
// already runs between OCR and the curated reference table, applied to layout.
//
// WHAT THIS DELIBERATELY DOES NOT DO: guess. When the column geometry is ambiguous, this refuses and
// says why. A wrong binding is invisible to every control downstream; a refusal is merely a page we
// ask the user to retake.

/** One text cell from an OCR/layout stage. Origin top-left, y increasing downward. */
export interface Cell {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

export interface BoundRow {
  /** One entry per detected column, in left-to-right order. null where that column had no cell. */
  cells: (Cell | null)[];
}

export interface BindingResult {
  rows: BoundRow[];
  /** Column count detected by x-clustering. */
  columnCount: number;
  /**
   * Per-column systematic vertical offset relative to the leftmost column, in pixels. A non-zero
   * value here is the offset-column layout: the column is printed consistently lower or higher than
   * the name column, and rows are bound AFTER correcting for it.
   */
  columnOffsets: number[];
  /** Cells that could not be assigned to any row. Never silently dropped. */
  unbound: Cell[];
  /** True when the geometry is ambiguous. When set, `rows` is empty — we do not emit a guess. */
  refused: boolean;
  reason: string;
}

const midY = (c: Cell): number => c.y + c.height / 2;
const midX = (c: Cell): number => c.x + c.width / 2;

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Cluster cells into columns by horizontal overlap. Uses the cell's own x-extent rather than a fixed
 * grid, because printed tables are not pixel-aligned and a photograph is never square to the page.
 */
export function clusterColumns(cells: readonly Cell[]): Cell[][] {
  const byX = [...cells].sort((a, b) => a.x - b.x);
  const columns: Cell[][] = [];
  for (const cell of byX) {
    const target = columns.find((column) => {
      // Overlap against the column's current horizontal span, not just its first member: a wide
      // header cell should not fork a column that its own body cells belong to.
      const left = Math.min(...column.map((c) => c.x));
      const right = Math.max(...column.map((c) => c.x + c.width));
      const overlap = Math.min(right, cell.x + cell.width) - Math.max(left, cell.x);
      return overlap > 0.5 * Math.min(right - left, cell.width);
    });
    if (target) target.push(cell);
    else columns.push([cell]);
  }
  return columns.sort((a, b) => median(a.map(midX)) - median(b.map(midX)));
}

/**
 * Score one candidate offset: shift the column by `offset`, then greedily pair its cells with
 * reference cells one-to-one, nearest first. Returns how many paired and how tightly.
 */
function scoreOffset(
  column: readonly Cell[],
  reference: readonly Cell[],
  offset: number,
  tolerance: number,
): { matched: number; spread: number } {
  const pairs: { distance: number; cell: number; ref: number }[] = [];
  column.forEach((cell, ci) => {
    reference.forEach((ref, ri) => {
      const distance = Math.abs(midY(cell) - offset - midY(ref));
      if (distance <= tolerance) pairs.push({ distance, cell: ci, ref: ri });
    });
  });
  pairs.sort((a, b) => a.distance - b.distance);
  const usedCells = new Set<number>();
  const usedRefs = new Set<number>();
  const residuals: number[] = [];
  for (const pair of pairs) {
    if (usedCells.has(pair.cell) || usedRefs.has(pair.ref)) continue;
    usedCells.add(pair.cell);
    usedRefs.add(pair.ref);
    residuals.push(pair.distance);
  }
  return { matched: residuals.length, spread: residuals.length ? median(residuals) : Infinity };
}

/**
 * Estimate one column's systematic vertical offset against the reference column.
 *
 * WHY THIS IS A SEARCH AND NOT A NEAREST-NEIGHBOUR AVERAGE. The first version of this function took
 * each cell's nearest reference neighbour and took the median delta. Tested against the real
 * offset-column page it REPRODUCED THE BUG: when a column is shifted by exactly one row pitch, every
 * cell's nearest neighbour is the row below its true owner, so all the deltas are zero and the
 * function confidently reports "no offset" while every row is mis-bound. A one-row shift is
 * genuinely ambiguous by proximity alone — proximity is the wrong evidence.
 *
 * The right evidence is COMPLETENESS. A whole-column shift orphans a cell at each end: the first
 * name has no value and the last value has no name. So we score candidate offsets by how many cells
 * pair off one-to-one, and prefer the offset that leaves nothing stranded. Ties near zero go to
 * zero, because an unshifted table is the ordinary case and should not need to win a coin toss.
 */
function estimateOffset(
  column: readonly Cell[],
  reference: readonly Cell[],
  rowHeight: number,
): { offset: number; consistent: boolean; spread: number } {
  if (column.length === 0 || reference.length === 0) {
    return { offset: 0, consistent: true, spread: 0 };
  }
  const tolerance = 0.25 * rowHeight;
  // Every observed cell-to-reference delta is a candidate, plus zero. Deriving candidates from the
  // data rather than assuming a row pitch means this works on irregular tables too.
  const candidates = new Set<number>([0]);
  for (const cell of column) for (const ref of reference) candidates.add(midY(cell) - midY(ref));

  let best = { offset: 0, matched: -1, spread: Infinity };
  for (const offset of candidates) {
    const { matched, spread } = scoreOffset(column, reference, offset, tolerance);
    const better =
      matched > best.matched
      || (matched === best.matched
        && (spread < best.spread
          || (spread === best.spread && Math.abs(offset) < Math.abs(best.offset))));
    if (better) best = { offset, matched, spread };
  }

  // Consistency is judged on the winning alignment. A page whose column genuinely does not line up
  // will have no offset that pairs its cells tightly, and we would rather say so than pick the least
  // bad of several wrong answers. Threshold is a fraction of a row, not a pixel count, so the same
  // page photographed closer does not change the decision.
  const consistent = best.matched >= Math.min(column.length, reference.length) && best.spread <= tolerance;
  return { offset: best.offset, consistent, spread: best.spread === Infinity ? rowHeight : best.spread };
}

export interface BindOptions {
  /**
   * Fraction of a row height within which two offset-corrected cells count as the same row.
   * Deliberately below 0.5 so that adjacent rows cannot merge — the BASO/EO failure was a value
   * migrating one row, and a generous tolerance is exactly how that becomes invisible.
   */
  rowTolerance?: number;
}

export function bindCells(cells: readonly Cell[], options: BindOptions = {}): BindingResult {
  const rowTolerance = options.rowTolerance ?? 0.4;
  const empty = { rows: [], columnCount: 0, columnOffsets: [], unbound: [...cells] };

  if (cells.length === 0) {
    return { ...empty, refused: false, reason: 'no cells' };
  }

  const columns = clusterColumns(cells);
  const rowHeight = median(cells.map((c) => c.height));
  if (rowHeight <= 0) {
    return { ...empty, columnCount: columns.length, refused: true, reason: 'cell heights are zero or negative; cannot scale row tolerance' };
  }

  // The leftmost column is the reference. In a lab table that is the analyte name, and it is the
  // column a reader anchors on, so binding everything else to it matches how the page is read.
  const [reference, ...rest] = columns;
  const offsets = [0];
  for (const column of rest) {
    const { offset, consistent, spread } = estimateOffset(column, reference, rowHeight);
    if (!consistent) {
      return {
        ...empty,
        columnCount: columns.length,
        columnOffsets: offsets,
        refused: true,
        reason:
          `column ${offsets.length} does not align consistently with the name column `
          + `(offset spread ${spread.toFixed(1)}px against a ${rowHeight.toFixed(1)}px row). `
          + 'Refusing rather than binding values to names we cannot pair.',
      };
    }
    offsets.push(offset);
  }

  // Bind by offset-corrected vertical position against the reference column.
  const rows: BoundRow[] = reference
    .slice()
    .sort((a, b) => midY(a) - midY(b))
    .map((anchor) => ({ cells: [anchor, ...rest.map(() => null)] }));

  const unbound: Cell[] = [];
  rest.forEach((column, index) => {
    for (const cell of column) {
      const corrected = midY(cell) - offsets[index + 1];
      let bestRow: BoundRow | null = null;
      let bestDistance = Infinity;
      for (const row of rows) {
        const distance = Math.abs(midY(row.cells[0]!) - corrected);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestRow = row;
        }
      }
      if (!bestRow || bestDistance > rowTolerance * rowHeight) {
        unbound.push(cell);
        continue;
      }
      // Two cells from one column competing for one row means the page is not the grid we think it
      // is. Keep the nearer, surface the other. Never overwrite silently.
      const slot = index + 1;
      const existing = bestRow.cells[slot];
      if (existing) {
        const existingDistance = Math.abs(midY(bestRow.cells[0]!) - (midY(existing) - offsets[slot]));
        if (existingDistance <= bestDistance) unbound.push(cell);
        else {
          unbound.push(existing);
          bestRow.cells[slot] = cell;
        }
        continue;
      }
      bestRow.cells[slot] = cell;
    }
  });

  return {
    rows,
    columnCount: columns.length,
    columnOffsets: offsets,
    unbound,
    refused: false,
    reason: '',
  };
}
