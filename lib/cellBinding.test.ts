import { describe, expect, it } from 'vitest';
import { bindCells, type Cell } from './cellBinding';

// Geometry is reconstructed from the two REAL failures recorded in
// validation/camera-path/README.md. Both were row-association errors, and both were invisible to
// every downstream control — a differential-coherence check was measured on 2026-07-31 and does not
// fire on either. If binding is going to be the answer, it has to survive these two shapes.

const ROW_H = 20;
const cell = (x: number, y: number, text: string, width = 90): Cell => ({
  x,
  y,
  width,
  height: ROW_H,
  text,
});

/** A clean four-column lab table: name | value | unit | range. */
function alignedTable(): Cell[] {
  const rows = [
    ['白细胞', '6.84', '10^9/L', '3.5-9.5'],
    ['嗜酸性粒细胞百分比', '0.10', '%', '0.4-8.0'],
    ['嗜碱性粒细胞百分比', '0.30', '%', '0-1'],
  ];
  return rows.flatMap((cols, r) =>
    cols.map((text, c) => cell(c * 100, 100 + r * 30, text, c === 0 ? 95 : 60)),
  );
}

describe('geometric row binding', () => {
  it('binds a clean table and reports no column offset', () => {
    const result = bindCells(alignedTable());

    expect(result.refused).toBe(false);
    expect(result.columnCount).toBe(4);
    expect(result.columnOffsets).toEqual([0, 0, 0, 0]);
    expect(result.unbound).toEqual([]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r) => r.cells.map((c) => c?.text))).toEqual([
      ['白细胞', '6.84', '10^9/L', '3.5-9.5'],
      ['嗜酸性粒细胞百分比', '0.10', '%', '0.4-8.0'],
      ['嗜碱性粒细胞百分比', '0.30', '%', '0-1'],
    ]);
  });

  // THE OFFSET-COLUMN PAGE (full-report-2026-07-26.md). The value/unit/range columns print about one
  // line lower than the name column. Pairing by raw nearest-y binds every value to the name above
  // it — wrong on every row, reproducibly, and undetectable downstream because each cell string is
  // individually correct. The offset is systematic, so it is recoverable.
  it('recovers the correct pairing when value columns print one line lower than the names', () => {
    const shifted = alignedTable().map((c) =>
      c.x === 0 ? c : { ...c, y: c.y + 30 },
    );

    const result = bindCells(shifted);

    expect(result.refused).toBe(false);
    expect(result.columnOffsets[0]).toBe(0);
    // Detected as a whole-row shift rather than treated as row membership.
    expect(result.columnOffsets.slice(1).every((o) => Math.abs(o - 30) < 1)).toBe(true);
    expect(result.rows.map((r) => r.cells.map((c) => c?.text))).toEqual([
      ['白细胞', '6.84', '10^9/L', '3.5-9.5'],
      ['嗜酸性粒细胞百分比', '0.10', '%', '0.4-8.0'],
      ['嗜碱性粒细胞百分比', '0.30', '%', '0-1'],
    ]);
  });

  // THE BASO/EO FAILURE (README, 2026-07-25). BASO% was read as 0.10 — exactly the EO% value on the
  // line above. Under geometric binding, 0.30 sits at BASO's y and 0.10 at EO's, so each is bound to
  // its own name. The value cannot migrate, because its position is the evidence.
  it('keeps adjacent rows apart, so a value cannot migrate to the row above', () => {
    const result = bindCells(alignedTable());
    const eo = result.rows.find((r) => r.cells[0]?.text === '嗜酸性粒细胞百分比');
    const baso = result.rows.find((r) => r.cells[0]?.text === '嗜碱性粒细胞百分比');

    expect(eo!.cells[1]?.text).toBe('0.10');
    expect(baso!.cells[1]?.text).toBe('0.30');
    // The exact confusion that occurred: BASO taking EO's printed value.
    expect(baso!.cells[1]?.text).not.toBe('0.10');
  });

  it('refuses rather than guessing when a column does not align consistently', () => {
    // Values displaced by DIFFERENT amounts: not a shifted column, not a clean grid. No single
    // offset explains them, so there is no honest pairing and there must be no pairing.
    //
    // (An earlier version of this test used `i % 2` over the row-major cell array. All three value
    // cells landed on the same parity and received an identical -24 shift, which is a perfectly
    // consistent offset — the code correctly detected it and the test was wrong, not the code.)
    const displacement = new Map([
      [100, 26],
      [130, -24],
      [160, 31],
    ]);
    const jittered = alignedTable().map((c) =>
      c.x === 100 ? { ...c, y: c.y + (displacement.get(c.y) ?? 0) } : c,
    );

    const result = bindCells(jittered);

    expect(result.refused).toBe(true);
    expect(result.rows).toEqual([]);
    expect(result.reason).toMatch(/does not align consistently/u);
  });

  it('surfaces a cell it cannot place instead of dropping it', () => {
    const orphan = [...alignedTable(), cell(100, 900, '99.9', 60)];

    const result = bindCells(orphan);

    expect(result.refused).toBe(false);
    expect(result.unbound.map((c) => c.text)).toEqual(['99.9']);
    // And it did not get forced onto the nearest row just because that row had an empty slot.
    expect(result.rows.every((r) => r.cells[1]?.text !== '99.9')).toBe(true);
  });

  it('surfaces the loser when two cells in one column compete for one row', () => {
    const doubled = [...alignedTable(), cell(100, 103, '7.77', 60)];

    const result = bindCells(doubled);

    expect(result.refused).toBe(false);
    // One of the two is kept, the other is reported. Neither is silently overwritten.
    const wbc = result.rows.find((r) => r.cells[0]?.text === '白细胞');
    expect(['6.84', '7.77']).toContain(wbc!.cells[1]?.text);
    expect(result.unbound).toHaveLength(1);
    expect(['6.84', '7.77']).toContain(result.unbound[0].text);
  });

  it('scales its tolerance with row height, so distance from the page does not change behaviour', () => {
    const zoomed = alignedTable().map((c) => ({
      x: c.x * 3,
      y: c.y * 3,
      width: c.width * 3,
      height: c.height * 3,
      text: c.text,
    }));

    const near = bindCells(alignedTable());
    const far = bindCells(zoomed);

    expect(far.refused).toBe(false);
    expect(far.rows.map((r) => r.cells.map((c) => c?.text))).toEqual(
      near.rows.map((r) => r.cells.map((c) => c?.text)),
    );
  });

  it('returns no rows and does not refuse when there are no cells', () => {
    const result = bindCells([]);
    expect(result).toMatchObject({ refused: false, rows: [], unbound: [] });
  });
});
