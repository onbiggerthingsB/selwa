// PRINTED-FLAG CAPTURE MUST STAY DARK AND COPY-ONLY.
//
// A report may print a marker beside a result, but our external corpora expose
// only structured abnormality labels, not page-level evidence that a glyph was
// actually printed. Rendering a captured marker now would therefore ship an
// unmeasurable clinical assertion: a model-induced flag could be presented as
// the lab's own determination. This tranche records the verbatim field and gives
// it deterministic meaning, but deliberately exposes neither one to the user.
//
// These locks defend four boundaries:
// - purity: direction depends on the copied token alone, never value or range;
// - fail-closed parsing: unknown or decorated text never becomes a known flag;
// - darkness: adding the field cannot change any user-visible summary output;
// - measurement honesty: neither corpus is backfilled from its gold label.

import { describe, expect, it } from 'vitest';
import { groundExtraction } from '@/lib/grounding';
import {
  parsePrintedRange,
  parseScalar,
  printedFlagDirection,
  statusAgainstPrinted,
  type PrintedFlagDirection,
} from '@/lib/reference';
import { buildSummary } from '@/lib/summary';
import { MEDREPBENCH_SAMPLE } from './real-corpus/sample';
import { MIMIC_US_SAMPLE } from './real-corpus/us-sample';

const FLAG_TOKENS: ReadonlyArray<
  readonly [raw: string, expected: PrintedFlagDirection]
> = [
  ['↑', 'high'],
  ['H', 'high'],
  ['HI', 'high'],
  ['HIGH', 'high'],
  ['偏高', 'high'],
  ['增高', 'high'],
  ['升高', 'high'],
  ['高', 'high'],
  ['↓', 'low'],
  ['L', 'low'],
  ['LO', 'low'],
  ['LOW', 'low'],
  ['偏低', 'low'],
  ['降低', 'low'],
  ['减低', 'low'],
  ['低', 'low'],
  ['*', 'abnormal'],
  ['!', 'abnormal'],
  ['A', 'abnormal'],
  ['异常', 'abnormal'],
  ['H/L', 'abnormal'],
  ['↑↓', 'abnormal'],
  ['HIGH-LOW', 'abnormal'],
  ['偏高/偏低', 'abnormal'],
];

const DERIVED_STATUS_FRAMES = [
  { value: '1', printedRange: '2-3', expected: 'below' },
  { value: '2.5', printedRange: '2-3', expected: 'within' },
  { value: '4', printedRange: '2-3', expected: 'above' },
] as const;

// Compile-time arity lock: a value or range cannot be supplied without a type
// error, so future callers cannot quietly turn this OCR parser into a comparator.
type PrintedFlagArguments = Parameters<typeof printedFlagDirection>;
const acceptedArguments: PrintedFlagArguments = [null];
// @ts-expect-error A second, value-like argument must remain forbidden.
const forbiddenArguments: PrintedFlagArguments = ['H', '5'];
void acceptedArguments;
void forbiddenArguments;

describe('printed flag reproduction boundary', () => {
  it('derives each closed token independently of every value/range status', () => {
    for (const frame of DERIVED_STATUS_FRAMES) {
      expect(
        statusAgainstPrinted(
          parseScalar(frame.value),
          parsePrintedRange(frame.printedRange),
        ),
      ).toBe(frame.expected);

      for (const [raw, expected] of FLAG_TOKENS) {
        expect(
          printedFlagDirection(raw),
          `${raw} must remain ${expected} when arithmetic is ${frame.expected}`,
        ).toBe(expected);
      }
    }
  });

  it.each([
    ['L/H', 'abnormal'],
    ['↓↑', 'abnormal'],
    ['LOW|HIGH', 'abnormal'],
    ['偏低偏高', 'abnormal'],
    [' ( H ) ', 'high'],
    ['【偏低】', 'low'],
  ] as const)('recognises only a complete known marker %s', (raw, expected) => {
    expect(printedFlagDirection(raw)).toBe(expected);
  });

  it('fails closed for unknown, empty, or decorated values', () => {
    const violations: string[] = [];
    for (const raw of [
      '?',
      '⚑',
      '见备注',
      '',
      '  ',
      'H?',
      'LOW?',
      'H:L',
      'H.L',
      'H,L',
      'H(L)',
      '569.412↑',
    ]) {
      if (printedFlagDirection(raw) !== null) violations.push(raw);
    }
    expect(violations).toEqual([]);
  });

  it('keeps the raw field out of every user-visible summary value', () => {
    const baseRow = {
      name: '空腹血糖',
      value: '7.8',
      unit: 'mmol/L',
      printedRange: '3.9-6.1',
      confidence: 'high' as const,
      specimen: 'blood' as const,
    };
    const withoutFlag = buildSummary(
      groundExtraction({ rows: [baseRow] }, 'unknown'),
      'en',
    );
    const sentinel = 'FLAG_SENTINEL_DO_NOT_RENDER';
    for (const raw of [...FLAG_TOKENS.map(([token]) => token), sentinel]) {
      const withFlag = buildSummary(
        groundExtraction(
          { rows: [{ ...baseRow, printedFlagRaw: raw }] },
          'unknown',
        ),
        'en',
      );

      expect(withFlag, `${raw} must remain dark`).toEqual(withoutFlag);
      if (raw === sentinel) {
        expect(JSON.stringify(withFlag)).not.toContain(sentinel);
      }
    }
  });

  it('does not backfill the field from either corpus abnormality oracle', () => {
    const violations: string[] = [];
    for (const [corpusName, corpus] of [
      ['MedRepBench', MEDREPBENCH_SAMPLE],
      ['MIMIC', MIMIC_US_SAMPLE],
    ] as const) {
      for (const report of corpus) {
        for (const item of report.items) {
          if ('printedFlagRaw' in item) {
            violations.push(`${corpusName}: ${report.image}: ${item.item_name}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
