import { describe, expect, it } from 'vitest';
import { detectTableStructure } from './tableStructure';
import type { Cell } from './cellBinding';

// Page shapes reconstructed from the real 31-page health check recorded in
// validation/camera-path/full-report-2026-07-26.md: 14 narrative pages (ultrasound, MRI, ECG, CT),
// 7 genuine lab tables, and one 健康警示灯 infographic — a body drawing with 32 labelled organs and
// no numbers. The frontier model returned zero rows on all 14 narrative pages and, on the
// infographic, extracted the 32 labels with every value/unit/range null.
//
// It did that by judgement. These tests pin the same outcomes STRUCTURALLY, so the behaviour cannot
// drift with a model version, a prompt edit, or a temperature change.

const cell = (x: number, y: number, text: string, width = 80, height = 20): Cell =>
  ({ x, y, width, height, text });

/** A lab table: name | value | unit | range. */
const labTable = (): Cell[] =>
  [
    ['血红蛋白', '172', 'g/L', '130-175'],
    ['白细胞', '6.84', '10^9/L', '3.5-9.5'],
    ['血小板', '210', '10^9/L', '125-350'],
    ['红细胞压积', '49.7', '%', '40-50'],
  ].flatMap((cols, r) => cols.map((t, c) => cell(c * 110, 100 + r * 30, t, c === 0 ? 100 : 70)));

/** A urinalysis table, where every result is qualitative rather than numeric. */
const qualitativeTable = (): Cell[] =>
  [
    ['尿蛋白', '阴性', '阴性'],
    ['尿糖', '阴性', '阴性'],
    ['酮体', '阴性', '阴性'],
    ['亚硝酸盐', '阴性', '阴性'],
  ].flatMap((cols, r) => cols.map((t, c) => cell(c * 110, 100 + r * 30, t, c === 0 ? 100 : 70)));

/** An ultrasound report: one wide column of prose lines. */
const narrativePage = (): Cell[] =>
  [
    '超声所见：肝脏大小形态正常，实质回声均匀，未见明显占位性病变。',
    '胆囊大小形态正常，壁不厚，腔内未见明显异常回声。',
    '胰腺形态大小正常，实质回声均匀，主胰管未见扩张。',
    '双肾大小形态正常，皮髓质分界清晰，集合系统未见分离。',
    '超声提示：肝胆胰脾双肾未见明显异常。',
  ].map((t, r) => cell(60, 120 + r * 34, t, 620, 24));

/** The 健康警示灯 infographic: organ labels scattered around a body drawing, no numbers. */
const bodyDiagram = (): Cell[] => {
  const labels = ['心脏', '肺', '肝脏', '胆囊', '胰腺', '脾', '左肾', '右肾', '胃', '甲状腺', '前列腺', '膀胱'];
  // Scattered around an illustration rather than laid out in a grid.
  const spots = [
    [180, 140], [300, 150], [150, 230], [280, 245], [200, 300], [330, 310],
    [140, 380], [340, 385], [230, 200], [240, 90], [220, 470], [300, 470],
  ];
  return labels.map((t, i) => cell(spots[i][0], spots[i][1], t, 60, 18));
};

describe('structural table detection', () => {
  it('accepts a numeric lab table', () => {
    const verdict = detectTableStructure(labTable());
    expect(verdict.isTable).toBe(true);
    expect(verdict.columns).toBe(4);
    expect(verdict.alignedRows).toBeGreaterThanOrEqual(4);
    expect(verdict.hasResultColumn).toBe(true);
  });

  it('accepts a urinalysis table whose results are all qualitative', () => {
    // 阴性 is a result. A detector that required digits would reject an entire real panel, so this
    // is pinned separately from the numeric case.
    const verdict = detectTableStructure(qualitativeTable());
    expect(verdict.isTable).toBe(true);
    expect(verdict.hasResultColumn).toBe(true);
  });

  it('refuses an ultrasound narrative — one column of prose is not a table', () => {
    const verdict = detectTableStructure(narrativePage());
    expect(verdict.isTable).toBe(false);
    expect(verdict.columns).toBe(1);
    expect(verdict.reason).toMatch(/prose, not a table/u);
  });

  it('refuses the body-diagram infographic, and refuses it as scattered labels', () => {
    // The sharpest case in the corpus: 32 organ names, no numbers. The failure to avoid is rendering
    // organ labels to a user as if they were findings.
    //
    // ASSERT THE REASON, not just the verdict. The first version of this test accepted any refusal,
    // and it passed while `hasResultColumn` was TRUE — the detector had classified 心脏 and 肺 as
    // results, and the page was rejected only because this particular scatter produced two aligned
    // rows. With 32 labels three would have aligned and the page would have been accepted. A test
    // that cannot tell a correct refusal from a lucky one is not a test.
    const verdict = detectTableStructure(bodyDiagram());
    expect(verdict.isTable).toBe(false);
    expect(verdict.hasResultColumn).toBe(false);
  });

  it('refuses a body diagram even when enough labels happen to line up', () => {
    // The case the original scatter got wrong by luck: labels that DO form aligned bands. Only the
    // diversity of the text distinguishes this from a table, so this is where that rule earns its
    // place.
    const organs = ['心脏', '肺', '肝脏', '胆囊', '胰腺', '脾', '左肾', '右肾', '胃', '甲状腺', '前列腺', '膀胱'];
    const aligned = organs.map((t, i) =>
      cell((i % 3) * 150, 100 + Math.floor(i / 3) * 40, t, 60, 18),
    );
    const verdict = detectTableStructure(aligned);
    expect(verdict.alignedRows).toBeGreaterThanOrEqual(3);
    expect(verdict.hasResultColumn).toBe(false);
    expect(verdict.isTable).toBe(false);
  });

  it('refuses a two-row fragment — a heading plus one line is not a grid', () => {
    const fragment = labTable().filter((c) => c.y < 140);
    const verdict = detectTableStructure(fragment);
    expect(verdict.isTable).toBe(false);
    expect(verdict.reason).toMatch(/aligned row/u);
  });

  it('refuses an empty page', () => {
    expect(detectTableStructure([])).toMatchObject({ isTable: false, columns: 0 });
  });

  it('refuses a two-column list of names with no results beside them', () => {
    // Names in both columns, nothing result-like anywhere: a checklist or an index, not results.
    const checklist = ['血常规检查', '尿常规检查', '肝功能检查', '肾功能检查'].flatMap((t, r) => [
      cell(0, 100 + r * 30, t, 140),
      cell(200, 100 + r * 30, '已检查完成项目', 160),
    ]);
    const verdict = detectTableStructure(checklist);
    expect(verdict.isTable).toBe(false);
    expect(verdict.hasResultColumn).toBe(false);
  });
});
