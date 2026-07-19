// PRINTED-RANGE PARSER SEMANTICS (Codex blocker #1).
//
// Every expectation here is HAND-LABELLED from the report text alone. Nothing in this file
// imports a production parser to compute what it then asserts — that mistake is exactly why
// these bugs survived: validation/chipFidelity.test.ts built its "independent oracle" out of the
// production `parsePrintedRange` + the same permissive `parseFloat`, so the oracle and the code
// agreed while both were wrong.
//
// The four failures Codex reproduced at HEAD:
//   `<5.2` with value 5.2  -> "Within"  (strict < collapsed to <=)
//   `2--40`                -> unparsed  (OCR double-dash — and `0--1.75` is in our own corpus)
//   `-2-2` with value 0    -> "Below"   (unsigned regex grabs the substring `2-2`)
//   value "3-15"           -> 3         (parseFloat accepts a non-scalar)

import { describe, it, expect } from 'vitest';
import {
  parsePrintedRange,
  parseQualitative,
  parseScalar,
  parseValueRange,
  statusAgainstPrinted,
  statusQualitativeAgainstPrinted,
  statusRangeAgainstPrinted,
} from './reference';

describe('parsePrintedRange — bounds carry INCLUSIVITY', () => {
  it('a two-sided range is inclusive at both ends', () => {
    expect(parsePrintedRange('3.9-6.1')).toEqual({ low: 3.9, high: 6.1, lowInclusive: true, highInclusive: true });
  });

  it('strict "<" is NOT inclusive; "≤" is', () => {
    expect(parsePrintedRange('<5.2')).toEqual({ low: null, high: 5.2, lowInclusive: true, highInclusive: false });
    expect(parsePrintedRange('≤5.2')).toEqual({ low: null, high: 5.2, lowInclusive: true, highInclusive: true });
    expect(parsePrintedRange('<=5.2')).toEqual({ low: null, high: 5.2, lowInclusive: true, highInclusive: true });
  });

  it('strict ">" is NOT inclusive; "≥" is', () => {
    expect(parsePrintedRange('>90')).toEqual({ low: 90, high: null, lowInclusive: false, highInclusive: true });
    expect(parsePrintedRange('≥90')).toEqual({ low: 90, high: null, lowInclusive: true, highInclusive: true });
  });
});

describe('parsePrintedRange — real report formats', () => {
  it('OCR double-dash separators parse (0--1.75 is verbatim in our corpus)', () => {
    expect(parsePrintedRange('0--1.75')).toEqual({ low: 0, high: 1.75, lowInclusive: true, highInclusive: true });
    expect(parsePrintedRange('2--40')).toEqual({ low: 2, high: 40, lowInclusive: true, highInclusive: true });
  });

  it('tilde and en/em dashes parse', () => {
    expect(parsePrintedRange('40~55')?.low).toBe(40);
    expect(parsePrintedRange('3.1–6.8')?.high).toBe(6.8);
  });

  it('NEGATIVE bounds parse as signed numbers, not substrings', () => {
    expect(parsePrintedRange('-2-2')).toEqual({ low: -2, high: 2, lowInclusive: true, highInclusive: true });
    // AMBIGUOUS by construction: "-3.0--1.0" reads as (-3.0 .. 1.0) with a "--" separator OR
    // (-3.0 .. -1.0) with a "-" separator and a negative high. Both are coherent, so we cannot
    // know what the lab meant → defer rather than guess. (My first expectation here was itself a
    // guess; the data has no way to settle it.)
    expect(parsePrintedRange('-3.0--1.0')).toBeNull();
  });

  it('scientific notation parses (HBV DNA "<2.000E+01" is verbatim in our corpus)', () => {
    expect(parsePrintedRange('<2.000E+01')).toEqual({ low: null, high: 20, lowInclusive: true, highInclusive: false });
  });

  it('non-numeric / junk ranges do NOT parse (they must defer, not guess)', () => {
    expect(parsePrintedRange('Negative(-)')).toBeNull();
    expect(parsePrintedRange('一年信日')).toBeNull(); // real OCR garbage from our corpus
    expect(parsePrintedRange('')).toBeNull();
    expect(parsePrintedRange(null)).toBeNull();
  });
});

describe('parseScalar — a value must be a NUMBER, not "whatever starts like one"', () => {
  it('accepts clean numbers incl. scientific notation and a trailing flag', () => {
    expect(parseScalar('5.2')).toBe(5.2);
    expect(parseScalar('1.050E+08')).toBe(1.05e8);
    expect(parseScalar('569.412↑')).toBe(569.412); // real corpus row
    expect(parseScalar('-2.5')).toBe(-2.5);
  });

  it('REJECTS non-scalars that parseFloat would silently truncate', () => {
    expect(parseScalar('3-15')).toBeNull(); // parseFloat gave 3
    expect(parseScalar('<0.01')).toBeNull(); // a censored value is not a scalar
    expect(parseScalar('Negative(-)')).toBeNull();
    expect(parseScalar('')).toBeNull();
    expect(parseScalar(null)).toBeNull();
  });
});

describe('parseQualitative — exact curated tokens only', () => {
  it.each([
    'Absent',
    'Negative',
    'Not Detected',
    'Nil',
    '-',
    '阴性',
    '未检出',
  ])('maps the negative token %s', (raw) => {
    expect(parseQualitative(raw)).toBe('negative');
  });

  it.each(['Present', 'Positive', '+', '++', '+++', '阳性', '检出'])(
    'maps the positive token %s',
    (raw) => {
      expect(parseQualitative(raw)).toBe('positive');
    },
  );

  it.each(['Trace', '±', '+/-', '微量'])('maps the trace token %s', (raw) => {
    expect(parseQualitative(raw)).toBe('trace');
  });

  it('rejects partial or unrelated text without changing parseScalar', () => {
    expect(parseQualitative('Absent-ish')).toBeNull();
    expect(parseQualitative('Negative (-)')).toBeNull();
    expect(parseQualitative('3-15')).toBeNull();
    expect(parseScalar('3-15')).toBeNull();
  });
});

describe('parseValueRange — a range result stays a range', () => {
  it('parses whole-field numeric ranges with report spacing', () => {
    expect(parseValueRange('0-2')).toEqual({ low: 0, high: 2 });
    expect(parseValueRange('0 - 1')).toEqual({ low: 0, high: 1 });
    expect(parseValueRange('3.1–6.8')).toEqual({ low: 3.1, high: 6.8 });
  });

  it('rejects scalars, comparators, qualitative tokens, junk, and ambiguous ranges', () => {
    expect(parseValueRange('2')).toBeNull();
    expect(parseValueRange('<2')).toBeNull();
    expect(parseValueRange('Absent')).toBeNull();
    expect(parseValueRange('-3.0--1.0')).toBeNull();
    expect(parseValueRange(null)).toBeNull();
  });

  it('does not weaken the scalar parser', () => {
    expect(parseScalar('0-2')).toBeNull();
    expect(parseScalar('0 - 1')).toBeNull();
    expect(parseScalar('3-15')).toBeNull();
  });
});

describe('qualitative and range-valued report comparisons', () => {
  it('compares qualitative results only with the report’s qualitative reference', () => {
    expect(statusQualitativeAgainstPrinted(parseQualitative('Absent'), parseQualitative('Negative'))).toBe('within');
    expect(statusQualitativeAgainstPrinted(parseQualitative('Positive'), parseQualitative('Absent'))).toBe('outside');
    expect(statusQualitativeAgainstPrinted(parseQualitative('Trace'), null)).toBe('none');
  });

  it('handles contained and wholly outside result ranges, but defers partial overlap', () => {
    const reference = parsePrintedRange('0-5');
    expect(statusRangeAgainstPrinted(parseValueRange('0-2'), reference)).toBe('within');
    expect(statusRangeAgainstPrinted(parseValueRange('0-5'), reference)).toBe('within');
    expect(statusRangeAgainstPrinted(parseValueRange('6-8'), reference)).toBe('above');
    expect(statusRangeAgainstPrinted(parseValueRange('-2~-1'), reference)).toBe('below');
    expect(statusRangeAgainstPrinted(parseValueRange('4-7'), reference)).toBe('none');
    expect(statusRangeAgainstPrinted(parseValueRange('-1-2'), reference)).toBe('none');
  });
});

describe('statusAgainstPrinted — hand-labelled truth', () => {
  // [value, range, expected] — each judged by reading the range as a human would.
  const CASES: [string, string, 'below' | 'within' | 'above' | 'none'][] = [
    ['5.2', '<5.2', 'above'], // 5.2 is NOT below 5.2 → outside, on the high side
    ['5.1', '<5.2', 'within'],
    ['5.2', '≤5.2', 'within'], // inclusive
    ['90', '>90', 'below'], // 90 is NOT above 90 → outside, on the low side
    ['91', '>90', 'within'],
    ['90', '≥90', 'within'],
    ['0', '-2-2', 'within'], // negative low bound
    ['-3', '-2-2', 'below'],
    ['11', '2--40', 'within'], // OCR double-dash
    ['3-15', '0-10', 'none'], // not a scalar → assert nothing
    ['5.4', 'Negative(-)', 'none'], // unparseable range → assert nothing
  ];
  for (const [v, r, want] of CASES) {
    it(`value ${v} against "${r}" → ${want}`, () => {
      expect(statusAgainstPrinted(parseScalar(v), parsePrintedRange(r))).toBe(want);
    });
  }
});
