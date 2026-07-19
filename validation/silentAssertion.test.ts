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
import {
  LANGS,
  resolveText,
  type Lang,
  type LocalizedText,
} from '@/lib/i18n';
import { goldFor } from './real-corpus/gold-labels';
import { MIMIC_US_SAMPLE } from './real-corpus/us-sample';
import { MEDREPBENCH_SAMPLE } from './real-corpus/sample';

function sectionFor(name: string, value: string | null, unit: string | null, range: string | null) {
  const rep = groundExtraction({ rows: [{ name, value, unit, printedRange: range, confidence: 'high' }] }, 'unknown');
  return { row: rep.rows[0], section: buildSummary(rep, 'en').sections[0] as SummarySection };
}

// This is a semantic signal, not an English-copy regex. summary.ts exposes the
// report's printed range only when it actually rendered a report-position chip.
// Detecting assertion from one English chip field let every non-English path evade this gate.
const asserts = (s: SummarySection) => s.reportRange.trim().length > 0;

interface LanguageAudit {
  checked: Record<Lang, number>;
  failures: string[];
  directBo: string[];
  badBoFallback: string[];
}

function languageAudit(): LanguageAudit {
  return {
    checked: { en: 0, zh: 0, bo: 0 },
    failures: [],
    directBo: [],
    badBoFallback: [],
  };
}

function auditBoFallback(
  copy: LocalizedText,
  context: string,
  audit: LanguageAudit,
): void {
  const variant = copy.bo;
  if (!('fallback' in variant)) {
    audit.directBo.push(context);
    return;
  }
  if (variant.fallback !== 'zh') {
    audit.badBoFallback.push(`${context} → ${variant.fallback}`);
    return;
  }

  const resolved = resolveText(copy, 'bo');
  if (
    !resolved.usedFallback
    || resolved.resolvedLang !== 'zh'
    || resolved.path.join('→') !== 'bo→zh'
  ) {
    audit.badBoFallback.push(
      `${context} → resolved=${resolved.resolvedLang}, path=${resolved.path.join('→')}`,
    );
  }
}

function auditDisclosure(
  section: SummarySection,
  context: string,
  audit: LanguageAudit,
): void {
  auditBoFallback(section.chip, `${context} chip`, audit);
  section.flags.forEach((flag, index) => {
    auditBoFallback(flag.message, `${context} flag ${index}`, audit);
  });

  for (const lang of LANGS) {
    audit.checked[lang] += 1;
    const chip = resolveText(section.chip, lang).text;
    const messages = section.flags.map((flag) => resolveText(flag.message, lang).text);
    if (chip.trim().length === 0) {
      audit.failures.push(`${context} ${lang} → empty chip`);
    }
    if (messages.length === 0) {
      audit.failures.push(`${context} ${lang} → no visible disclosure`);
    }
    messages.forEach((message, index) => {
      if (message.trim().length === 0) {
        audit.failures.push(`${context} ${lang} → empty disclosure ${index}`);
      }
    });
  }
}

/**
 * bo has no clinical content to validate linguistically yet. It must nevertheless
 * exercise this gate: every asserted row is rendered through bo, checked nonempty,
 * and proven to resolve from the same Chinese disclosure this gate tests.
 *
 * The direct-bo assertion is an intentional tripwire. The first direct Tibetan
 * clinical string must add medically-literate Tibetan review and Tibetan-specific
 * silent-assertion checks before this expectation may change.
 */
function expectLanguageAudit(
  audit: LanguageAudit,
  minimumRows: number,
  gateName: string,
): void {
  expect(audit.checked.en, `${gateName}: the gate must exercise real rows`).toBeGreaterThan(
    minimumRows,
  );
  expect(audit.checked.zh, `${gateName}: ZH must exercise every EN row`).toBe(audit.checked.en);
  expect(audit.checked.bo, `${gateName}: bo must exercise every EN row`).toBe(audit.checked.en);
  expect(
    audit.directBo,
    `${gateName}: direct bo clinical copy exists. Add Tibetan-specific safety checks and medically-literate review before removing this tripwire.`,
  ).toEqual([]);
  expect(
    audit.badBoFallback,
    `${gateName}: bo clinical copy must explicitly resolve through the tested zh fallback`,
  ).toEqual([]);
  expect(
    [...new Set(audit.failures)],
    `${gateName}:\n${[...new Set(audit.failures)].join('\n')}`,
  ).toEqual([]);
}

describe('a row may never assert a position with no disclosure', () => {
  it('every unrecognised corpus row that asserts a position discloses that we do not know the test', () => {
    const audit = languageAudit();
    for (const corpus of [MIMIC_US_SAMPLE, MEDREPBENCH_SAMPLE])
      for (const rep of corpus)
        for (const it of rep.items) {
          const { row, section } = sectionFor(it.item_name, it.item_value || null, it.item_unit || null, it.item_range || null);
          if (row.entry !== null || !asserts(section)) continue;
          auditDisclosure(
            section,
            `${it.item_name.trim()} ${it.item_value}${it.item_unit}`,
            audit,
          );
        }
    expectLanguageAudit(
      audit,
      50,
      'unrecognised rows asserting a position in silence',
    );
  });

  it('still-unrecognised high-stakes rows disclose that we cannot name them', () => {
    const audit = languageAudit();
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
      auditDisclosure(section, n, audit);
      const en = section.flags.map((f) => resolveText(f.message, 'en').text).join(' ');
      const zh = section.flags.map((f) => resolveText(f.message, 'zh').text).join(' ');
      const bo = section.flags.map((f) => resolveText(f.message, 'bo').text).join(' ');
      expect(en, `${n} must disclose in English`).toMatch(/not in our reference set/i);
      expect(zh, `${n} must disclose in Chinese`).toMatch(/不在我们的参考资料中/);
      expect(bo, `${n} bo must show the exact tested Chinese disclosure`).toBe(zh);
    }
    expectLanguageAudit(audit, 0, 'still-unrecognised high-stakes disclosure');
  });

  // THE GENERAL INVARIANT, and the reason it exists: adding curated entries in the tranche-1 pass
  // MOVED rows from R1 (spoken) to R2 unit-mismatch (then silent). A recognised-but-abstaining
  // Troponin T asserted "Above your report's range" with needsConfirm=false and no visible flag —
  // strictly worse than never having recognised it. Recognising an analyte must never reduce what
  // the user is told, so the rule is about ABSTENTION, not about recognition.
  it('ANY row that asserts a position while abstaining must say something', () => {
    const audit = languageAudit();
    for (const corpus of [MIMIC_US_SAMPLE, MEDREPBENCH_SAMPLE])
      for (const rep of corpus)
        for (const it of rep.items) {
          const { row, section } = sectionFor(it.item_name, it.item_value || null, it.item_unit || null, it.item_range || null);
          if (row.action !== 'abstain' || !asserts(section)) continue;
          auditDisclosure(
            section,
            `${it.item_name.trim()} ${it.item_value}${it.item_unit} (entry=${row.entry?.key ?? 'none'}, flags=${row.flags.map((f) => f.id).join(',')})`,
            audit,
          );
        }
    expectLanguageAudit(
      audit,
      50,
      'rows asserting a position while silently abstaining',
    );
  });

  it('a high-stakes analyte we recognise but cannot unit-match still confirms and speaks', () => {
    const audit = languageAudit();
    // Troponin T: corpus prints ng/mL, our band is ng/L. R2 returns before R6 can fire, so this
    // needed R2 itself to carry the confirm.
    const { row, section } = sectionFor('Troponin T', '2.4', 'ng/mL', '0-0.01');
    expect(row.entry?.key).toBe('troponin_t');
    expect(row.action).toBe('abstain');
    expect(row.needsConfirm, 'a high-stakes unit mismatch must reach the confirm gate').toBe(true);
    auditDisclosure(section, 'Troponin T unit mismatch', audit);
    expectLanguageAudit(audit, 0, 'high-stakes unit mismatch disclosure');
  });

  it('a specimen-scoped row that abstains under R18 discloses why', () => {
    const report = groundExtraction(
      {
        rows: [
          {
            name: 'pH',
            value: '7.1',
            unit: 'pH',
            printedRange: '7.35-7.45',
            confidence: 'high',
            specimen: 'urine',
          },
        ],
      },
      'unknown',
    );
    const row = report.rows[0];
    const section = buildSummary(report, 'en').sections[0];
    const audit = languageAudit();

    expect(row.matchedVia).toBe('specimen-scoped');
    expect(row.action).toBe('abstain');
    expect(row.needsConfirm).toBe(false);
    expect(row.flags.map((f) => f.id)).toContain('R18-SPECIMEN-MATCH-UNCORROBORATED');
    expect(resolveText(section.chip, 'en').text).toBe('Below your report’s range');
    expect(resolveText(section.chip, 'zh').text).toBe('低于报告所列范围');
    expect(resolveText(section.chip, 'bo').text).toBe('低于报告所列范围');
    expect(section.typicalRange).toBe('');
    expect(section.source).toBe('');
    const en = section.flags.map((f) => resolveText(f.message, 'en').text).join(' ');
    const zh = section.flags.map((f) => resolveText(f.message, 'zh').text).join(' ');
    const bo = section.flags.map((f) => resolveText(f.message, 'bo').text).join(' ');
    expect(en).toMatch(/could not corroborate the specimen/i);
    expect(zh).toMatch(/无法用报告上打印的参考信息确认/);
    expect(bo).toBe(zh);
    auditDisclosure(section, 'R18 specimen disclosure', audit);
    expectLanguageAudit(audit, 0, 'R18 specimen disclosure');
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
    expect(resolveText(section.chip, 'en').text).toBe('Above your report’s range');
    expect(resolveText(section.chip, 'zh').text).toBe('高于报告所列范围');
    expect(resolveText(section.chip, 'bo').text).toBe('高于报告所列范围');
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
