import { describe, expect, it } from 'vitest';
import {
  findEntry,
  parsePrintedRange,
  parseScalar,
  printedSpecimenFor,
  statusAgainstPrinted,
} from '@/lib/reference';
import { REFERENCE_LABS } from '@/data/reference-labs';
import {
  BONE_DENSITOMETRY_NAMES_2026_07_28,
  RESPELLED_NAMES_2026_07_28,
  DECLINED_NAMES_2026_07_28,
} from './unresolved-names-2026-07-28';

describe('recognition on the 2026-07-28 Lhasa health check', () => {
  it.each(BONE_DENSITOMETRY_NAMES_2026_07_28)(
    'resolves the bone densitometry row %s to %s, and only from an unknown printed specimen',
    (printed, key) => {
      expect(findEntry(printed, 'unknown')?.key).toBe(key);
      expect(findEntry(printed, null)?.key).toBe(key);
      // A bone densitometry row is never on a blood or urine panel. The measurement frame makes
      // that structural, not a matter of alias hygiene (lib/reference.ts specimenSafeMatch).
      expect(findEntry(printed, 'blood')).toBeNull();
      expect(findEntry(printed, 'urine')).toBeNull();
    },
  );

  it.each(RESPELLED_NAMES_2026_07_28)('resolves the printed spelling %s to %s', (printed, key) => {
    expect(findEntry(printed, 'blood')?.key).toBe(key);
  });

  it.each(DECLINED_NAMES_2026_07_28)('keeps %s unresolved on purpose (%s)', (printed) => {
    for (const specimen of ['unknown', 'blood', 'urine', null] as const) {
      expect(findEntry(printed, specimen)).toBeNull();
    }
  });

  // The whole point of the measurement frame for this modality.
  it('reaches every bone entry only from an unknown printed specimen', () => {
    const bone = REFERENCE_LABS.filter((entry) => entry.key.startsWith('bone_'));
    expect(bone).toHaveLength(16);
    for (const entry of bone) {
      expect(entry.specimen, entry.key).toBe('measurement');
      expect(printedSpecimenFor(entry), entry.key).toBe('unknown');
      expect(entry.interpretation, entry.key).toBe('report-only');
      expect(entry.source, entry.key).toBe('');
      expect(
        [entry.refLow, entry.refHigh, entry.criticalLow, entry.criticalHigh, entry.absoluteLow, entry.absoluteHigh],
        entry.key,
      ).toEqual([null, null, null, null, null, null]);
    }
  });

  it('pins safe parsing and positioning for negative bone-density scores and ranges', () => {
    expect(parseScalar('-3.0')).toBe(-3);

    const signedRange = parsePrintedRange('-2.5~-1.0');
    expect(signedRange).toEqual({
      low: -2.5,
      high: -1,
      lowInclusive: true,
      highInclusive: true,
    });
    expect(statusAgainstPrinted(-3, signedRange)).toBe('below');
    expect(statusAgainstPrinted(-0.5, signedRange)).toBe('above');

    expect(parsePrintedRange('-2.5--1.0')).toBeNull();
    expect(parsePrintedRange('>-1')).toEqual({
      low: -1,
      high: null,
      lowInclusive: false,
      highInclusive: true,
    });
    expect(parsePrintedRange('−2.5~−1.0')).toBeNull();
  });
});

describe('collision proof for the bone densitometry curation', () => {
  // 1. NO BARE QUANTITY TOKEN MAY RESOLVE. T值/Z值 are statistical score names, not analytes;
  //    BMD/BMC/均值 are generic; T11/T12/L1/SD are site and unit labels. A bare one names nothing.
  it.each(['BMD', 'BMC', 'T值', 'Z值', '均值', 'T11', 'T12', 'L1', 'SD', '骨密度', '骨矿含量'])(
    'never resolves the bare token %s in any specimen context',
    (bare) => {
      for (const specimen of ['unknown', 'blood', 'urine', null] as const) {
        expect(findEntry(bare, specimen), `${bare} @ ${specimen}`).toBeNull();
      }
    },
  );

  // 2. EVERY new alias AND every new key routes to exactly its own entry, and to nothing from a
  //    blood or urine panel.
  it('routes every bone alias and key to its own entry only', () => {
    const bone = REFERENCE_LABS.filter((entry) => entry.key.startsWith('bone_'));
    for (const entry of bone) {
      for (const token of [entry.key, ...entry.aliases]) {
        expect(findEntry(token, 'unknown')?.key, token).toBe(entry.key);
        expect(findEntry(token, 'blood'), token).toBeNull();
        expect(findEntry(token, 'urine'), token).toBeNull();
      }
    }
  });

  // 3. The two new SPELLING aliases add exactly one reachable name each and change nothing else.
  it('adds the two respelled names without widening anything', () => {
    expect(findEntry('碳酸氢盐（HC03）')?.key).toBe('bicarbonate');
    expect(findEntry('碳酸氢盐(HC03)')?.key).toBe('bicarbonate');
    expect(findEntry('HC03')).toBeNull();
    expect(findEntry('血清碳酸氢盐（HCO3）测定', 'blood')?.key).toBe('bicarbonate');
    expect(findEntry('血清碳酸氢盐（HC03）测定', 'urine')).toBeNull();

    expect(findEntry('三碘甲状原氨酸(T3)')?.key).toBe('total_t3');
    expect(findEntry('血清三碘甲状腺原氨酸(T3)', 'blood')?.key).toBe('total_t3');
    expect(findEntry('血清三碘甲状原氨酸(T3)', 'urine')).toBeNull();
    expect(findEntry('三碘甲状原氨酸')).toBeNull();
    expect(findEntry('三碘甲状腺原氨酸')).toBeNull();
    expect(findEntry('游离三碘甲状原氨酸')).toBeNull();
    expect(findEntry('血清游离三碘甲状腺原氨酸')?.key).toBe('free_t3');
  });
});
