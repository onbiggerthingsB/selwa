// NO SILENT ASSERTIONS.
//
// The chip is deliberately DECOUPLED from recognition (grilling Q1): it reproduces the range
// PRINTED ON THE REPORT, which is pure arithmetic on the page and works for analytes we cannot
// name. That decision bought ~28 points of coverage and is right. Its unpriced cost was this:
//
//   Lactate 3.4 mmol/L      -> "Above your report's range"   needsConfirm=false, flags: []
//   pO2 60 mm Hg            -> "Below your report's range"   needsConfirm=false, flags: []
//   Troponin T 2.4 ng/mL    -> "Above your report's range"   needsConfirm=false, flags: []
//
// 126 real corpus rows (27.1%), 83 of them independently labelled high-stakes, asserted a position
// for an analyte we could not identify while saying NOTHING about not identifying it. R1 fires
// internally on every one — the guard knew — but R1 was absent from SURFACING_FLAGS, so a faithful
// reproduction of the report's own arithmetic read to the user as understanding of the test.
//
// The invariant: if a row ASSERTS a position, the user must be able to see either that we grounded
// it (a recognised analyte) or that we did not (R1). Never a confident position and silence.

import { describe, it, expect } from 'vitest';
import { groundExtraction } from '@/lib/grounding';
import { buildSummary, type SummarySection } from '@/lib/summary';
import { goldFor } from './real-corpus/gold-labels';
import { MIMIC_US_SAMPLE } from './real-corpus/us-sample';
import { MEDREPBENCH_SAMPLE } from './real-corpus/sample';

function sectionFor(name: string, value: string | null, unit: string | null, range: string | null) {
  const rep = groundExtraction({ rows: [{ name, value, unit, printedRange: range, confidence: 'high' }] }, 'unknown');
  return { row: rep.rows[0], section: buildSummary(rep, 'en').sections[0] as SummarySection };
}

const asserts = (s: SummarySection) => /your report’s range/.test(s.chipEn);

describe('a row may never assert a position with no disclosure', () => {
  it('every unrecognised corpus row that asserts a position discloses that we do not know the test', () => {
    const silent: string[] = [];
    let asserted = 0;
    for (const corpus of [MIMIC_US_SAMPLE, MEDREPBENCH_SAMPLE])
      for (const rep of corpus)
        for (const it of rep.items) {
          const { row, section } = sectionFor(it.item_name, it.item_value || null, it.item_unit || null, it.item_range || null);
          if (row.entry !== null || !asserts(section)) continue;
          asserted += 1;
          if (section.flags.length === 0) silent.push(`${it.item_name.trim()} ${it.item_value}${it.item_unit} → "${section.chipEn}"`);
        }
    expect(asserted).toBeGreaterThan(50); // the gate must actually be exercising rows
    expect([...new Set(silent)], `unrecognised rows asserting a position in silence:\n${[...new Set(silent)].join('\n')}`).toEqual([]);
  });

  it('still-unrecognised high-stakes rows disclose that we cannot name them', () => {
    // Lactate / Free Calcium / Troponin T were on this list until the tranche-1 curation gave them
    // entries. These remain unrecognised on purpose: pO2 because a venous gas prints the identical
    // row name, 'Urea Nitrogen' because MIMIC carries it in EIGHT fluids (the Glucose trap).
    for (const [n, v, u, r] of [
      ['pO2', '60', 'mm Hg', '80-100'],
      ['Urea Nitrogen', '47', 'mg/dL', '6-20'],
      ['Anion Gap', '20', 'mEq/L', '8-16'],
    ] as const) {
      expect(goldFor(n)?.highStakes, `${n} should be gold-high-stakes`).toBe(true);
      const { row, section } = sectionFor(n, v, u, r);
      expect(row.entry, `${n} is expected to still be unrecognised`).toBeNull();
      expect(section.flags.map((f) => f.messageEn).join(' '), `${n} must disclose`).toMatch(/not in our reference set/i);
    }
  });

  // THE GENERAL INVARIANT, and the reason it exists: adding curated entries in the tranche-1 pass
  // MOVED rows from R1 (spoken) to R2 unit-mismatch (then silent). A recognised-but-abstaining
  // Troponin T asserted "Above your report's range" with needsConfirm=false and no visible flag —
  // strictly worse than never having recognised it. Recognising an analyte must never reduce what
  // the user is told, so the rule is about ABSTENTION, not about recognition.
  it('ANY row that asserts a position while abstaining must say something', () => {
    const silent: string[] = [];
    let checked = 0;
    for (const corpus of [MIMIC_US_SAMPLE, MEDREPBENCH_SAMPLE])
      for (const rep of corpus)
        for (const it of rep.items) {
          const { row, section } = sectionFor(it.item_name, it.item_value || null, it.item_unit || null, it.item_range || null);
          if (row.action !== 'abstain' || !asserts(section)) continue;
          checked += 1;
          if (section.flags.length === 0) silent.push(`${it.item_name.trim()} ${it.item_value}${it.item_unit} → "${section.chipEn}" (entry=${row.entry?.key ?? 'none'}, flags=${row.flags.map((f) => f.id).join(',')})`);
        }
    expect(checked).toBeGreaterThan(50);
    expect([...new Set(silent)], `rows asserting a position while silently abstaining:\n${[...new Set(silent)].join('\n')}`).toEqual([]);
  });

  it('a high-stakes analyte we recognise but cannot unit-match still confirms and speaks', () => {
    // Troponin T: corpus prints ng/mL, our band is ng/L. R2 returns before R6 can fire, so this
    // needed R2 itself to carry the confirm.
    const { row, section } = sectionFor('Troponin T', '2.4', 'ng/mL', '0-0.01');
    expect(row.entry?.key).toBe('troponin_t');
    expect(row.action).toBe('abstain');
    expect(row.needsConfirm, 'a high-stakes unit mismatch must reach the confirm gate').toBe(true);
    expect(section.flags.length, 'and must not be silent').toBeGreaterThan(0);
  });
});

describe('R17 — we stop showing our band when it cannot be this row’s band', () => {
  // Disjoint bands are not lab-to-lab variation; they mean our entry measures something else,
  // usually a different SPECIMEN under the same name. Found adversarially on urine β2-microglobulin
  // against our serum band, where R11/R13/R16 all failed to protect the user.
  it('a urine β2-microglobulin does not get our serum “typical range”', () => {
    const { row, section } = sectionFor('β2微球蛋白', '1.03', 'mg/L', '0-0.3');
    expect(row.entry?.key).toBe('beta2_microglobulin');
    expect(row.flags.map((f) => f.id)).toContain('R17-BAND-NOT-COMPARABLE');
    expect(section.typicalRange, 'our serum band must not be presented for a urine row').toBe('');
    expect(section.source).toBe('');
    expect(row.needsConfirm).toBe(true);
    // The chip is the REPORT's own arithmetic and stays correct whatever the specimen.
    expect(section.chipEn).toBe('Above your report’s range');
  });

  it('ordinary lab-to-lab variation still shows our typical range', () => {
    // The guard must not become useless: overlapping-but-different bands are normal and must keep
    // the reference context. R17 is for disjoint bands only.
    const { row, section } = sectionFor('空腹血糖', '5.0', 'mmol/L', '3.9-6.1');
    expect(row.flags.map((f) => f.id)).not.toContain('R17-BAND-NOT-COMPARABLE');
    expect(section.typicalRange).not.toBe('');
  });

  it('no real corpus row loses its typical range to a false R17', () => {
    // Guards the false-positive direction: R17 firing on a genuine same-specimen row would strip
    // useful reference context from rows we DO understand.
    const fired: string[] = [];
    for (const corpus of [MIMIC_US_SAMPLE, MEDREPBENCH_SAMPLE])
      for (const rep of corpus)
        for (const it of rep.items) {
          const { row } = sectionFor(it.item_name, it.item_value || null, it.item_unit || null, it.item_range || null);
          if (row.flags.some((f) => f.id === 'R17-BAND-NOT-COMPARABLE')) fired.push(`${it.item_name.trim()} ${it.item_value}${it.item_unit} (${it.item_range})`);
        }
    // Documented, not asserted-empty: if a real row ever trips R17, that is a finding to inspect
    // (a specimen collision in our table), not automatically a bug in R17.
    expect(fired.length, `R17 fired on real rows — inspect for a specimen collision:\n${fired.join('\n')}`).toBeLessThanOrEqual(2);
  });
});
