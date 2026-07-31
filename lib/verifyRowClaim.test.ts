import { describe, expect, it } from 'vitest';
import { verifyRowClaim, type ClaimedRow } from './verifyRowClaim';
import type { Cell } from './cellBinding';

const cell = (x: number, y: number, text: string, width = 80): Cell =>
  ({ x, y, width, height: 20, text });

/**
 * The real CBC page from validation/camera-path/. Names in column 0, values in column 1.
 * EO% is printed 0.10 and BASO% is printed 0.30 — the two rows the model confused.
 */
function pageCells(): Cell[] {
  const rows: [string, string][] = [
    ['白细胞', '6.84'],
    ['中性粒细胞百分比', '71.50'],
    ['嗜酸性粒细胞百分比', '0.10'],
    ['嗜碱性粒细胞百分比', '0.30'],
  ];
  return rows.flatMap(([name, value], r) => [
    cell(0, 100 + r * 30, name, 130),
    cell(160, 100 + r * 30, value, 60),
  ]);
}

const claim = (name: string, value: string): ClaimedRow => ({
  name,
  value,
  unit: null,
  printedRange: null,
});

const truthfulClaim = (): ClaimedRow[] => [
  claim('白细胞', '6.84'),
  claim('中性粒细胞百分比', '71.50'),
  claim('嗜酸性粒细胞百分比', '0.10'),
  claim('嗜碱性粒细胞百分比', '0.30'),
];

describe('verifying a claimed row structure against text positions', () => {
  it('passes a claim that matches the page', () => {
    const result = verifyRowClaim(truthfulClaim(), pageCells());
    expect(result.verifiable).toBe(true);
    expect(result.findings).toEqual([]);
  });

  // THE REAL FAILURE, 2026-07-25. All three runs read BASO% as 0.10 — exactly the EO% value printed
  // on the line above. Both misread values fall inside their printed ranges, so the status chip is
  // identical to the correct one and chipWrong stays 0. Nothing downstream sees it.
  //
  // Provenance sees it immediately, and without any geometry: the page prints 0.10 once, and the
  // claim uses it twice.
  it('catches the measured BASO/EO failure — a value claimed twice but printed once', () => {
    const corrupted = truthfulClaim();
    corrupted[3] = claim('嗜碱性粒细胞百分比', '0.10'); // truth is 0.30

    const result = verifyRowClaim(corrupted, pageCells());

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ rowIndex: 3, field: 'value', kind: 'reused-cell' });
    expect(result.findings[0].detail).toMatch(/copied from somewhere/u);
  });

  it('catches a value physically printed on a different line from its claimed analyte', () => {
    // Distinct values, so provenance cannot fire and only the geometry can object: the claim binds
    // 白细胞 to a number that sits three rows lower on the paper.
    const cells = pageCells();
    const swapped: ClaimedRow[] = [
      claim('白细胞', '0.30'),
      claim('中性粒细胞百分比', '71.50'),
      claim('嗜酸性粒细胞百分比', '0.10'),
      claim('嗜碱性粒细胞百分比', '6.84'),
    ];

    const result = verifyRowClaim(swapped, cells);

    const bands = result.findings.filter((f) => f.kind === 'incoherent-band');
    expect(bands.length).toBeGreaterThan(0);
    expect(bands[0].detail).toMatch(/printed on a different line/u);
  });

  it('does NOT flag the offset-column page, where every value legitimately sits a line lower', () => {
    // The page from full-report-2026-07-26.md. A systematic offset is a printing convention, not an
    // error, and a check that cried wolf here would be turned off within a week.
    const shifted = pageCells().map((c) => (c.x === 0 ? c : { ...c, y: c.y + 30 }));

    const result = verifyRowClaim(truthfulClaim(), shifted);

    expect(result.findings).toEqual([]);
  });

  it('does NOT flag a page that legitimately prints the same result many times', () => {
    // A urinalysis panel where every result is 阴性. Provenance must count occurrences, not assume
    // uniqueness, or it would reject an entire real panel.
    const cells = ['尿蛋白', '尿糖', '酮体', '亚硝酸盐'].flatMap((name, r) => [
      cell(0, 100 + r * 30, name, 130),
      cell(160, 100 + r * 30, '阴性', 60),
    ]);
    const claims = ['尿蛋白', '尿糖', '酮体', '亚硝酸盐'].map((n) => claim(n, '阴性'));

    const result = verifyRowClaim(claims, cells);

    expect(result.findings).toEqual([]);
  });

  it('flags a value that appears nowhere on the page', () => {
    const invented = truthfulClaim();
    invented[1] = claim('中性粒细胞百分比', '99.99');

    const result = verifyRowClaim(invented, pageCells());

    expect(result.findings).toContainEqual(
      expect.objectContaining({ rowIndex: 1, field: 'value', kind: 'not-on-page' }),
    );
  });

  it('reports that it cannot verify when there are no positioned cells', () => {
    const result = verifyRowClaim(truthfulClaim(), []);
    expect(result.verifiable).toBe(false);
    expect(result.findings).toEqual([]);
    // An empty finding list must never read as "checked and clean".
    expect(result.reason).toMatch(/no positioned cells/u);
  });

  it('treats an empty claim as trivially verifiable', () => {
    expect(verifyRowClaim([], pageCells())).toMatchObject({ verifiable: true, findings: [] });
  });
});
