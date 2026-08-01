import { describe, expect, it } from 'vitest';
import {
  extractLocalizedTextCorpus,
  staticTextTemplates,
} from '@/lib/localizedTextCorpus';
import {
  auditTibetanWellFormedness,
  type TibetanWellFormednessCheck,
} from '@/lib/tibetanWellFormedness';

const TIBETAN_KA = String.fromCodePoint(0x0f40);
const TIBETAN_KHA = String.fromCodePoint(0x0f41);
const STANDARD_TSHEG = String.fromCodePoint(0x0f0b);

function hasFinding(text: string, check: TibetanWellFormednessCheck): boolean {
  return auditTibetanWellFormedness(text).some((finding) => finding.check === check);
}

describe('Tibetan Class A well-formedness', () => {
  it('reports a visible empty curated corpus and the separately excluded OCR echo', () => {
    const corpus = extractLocalizedTextCorpus();
    const findings = corpus.curatedBo.flatMap((entry) => {
      const variant = entry.variants.bo;
      if (variant.kind !== 'direct') return [];
      const templates = staticTextTemplates(variant.expression);
      expect(
        templates.length,
        `${entry.id} has direct bo copy that the static verifier cannot inspect`,
      ).toBeGreaterThan(0);
      return templates.flatMap((template) =>
        auditTibetanWellFormedness(template.literalText)
          .map((finding) => ({ id: entry.id, ...finding })),
      );
    });

    // Rebaselined 2026-07-28 for 16 bone densitometry entries (report-only, bandless,
    // 'measurement' frame) plus two OCR-spelling aliases: entries add 32 calls; aliases add none.
    expect(corpus.calls).toHaveLength(619); // curatedBo===0 below remains the safety check
    expect(corpus.curatedBo).toHaveLength(0);
    expect(corpus.excludedDirectBo).toHaveLength(1);
    expect(corpus.excludedDirectBo[0].reason).toBe('verbatim-ocr-echo');
    expect(findings).toEqual([]);
  });

  it('accepts Tibetan text with preserved Latin, numeric, unit, and comparison tokens', () => {
    const text = `${TIBETAN_KA}${STANDARD_TSHEG}${TIBETAN_KHA} 11.1 µmol/L ≥ 1`;
    expect(auditTibetanWellFormedness(text)).toEqual([]);
  });

  it.each([
    { check: 'A1' as const, label: 'empty copy', text: '   ' },
    { check: 'A2' as const, label: 'common Han tail', text: `${TIBETAN_KA}中` },
    {
      check: 'A2' as const,
      label: 'CJK Extension A tail',
      text: `${TIBETAN_KA}${String.fromCodePoint(0x3400)}`,
    },
    {
      check: 'A3' as const,
      label: 'outside-script emoji',
      text: `${TIBETAN_KA}${String.fromCodePoint(0x1f9ea)}`,
    },
    {
      check: 'A4' as const,
      label: 'Devanagari bleed',
      text: `${TIBETAN_KA}${String.fromCodePoint(0x0915)}`,
    },
    {
      check: 'A5' as const,
      label: 'unassigned U+0F48',
      text: `${TIBETAN_KA}${String.fromCodePoint(0x0f48)}`,
    },
    {
      check: 'A5' as const,
      label: 'unassigned range start U+0F6D',
      text: `${TIBETAN_KA}${String.fromCodePoint(0x0f6d)}`,
    },
    {
      check: 'A5' as const,
      label: 'unassigned range end U+0F70',
      text: `${TIBETAN_KA}${String.fromCodePoint(0x0f70)}`,
    },
    {
      check: 'A5' as const,
      label: 'unassigned U+0F98',
      text: `${TIBETAN_KA}${String.fromCodePoint(0x0f98)}`,
    },
    {
      check: 'A5' as const,
      label: 'unassigned U+0FBD',
      text: `${TIBETAN_KA}${String.fromCodePoint(0x0fbd)}`,
    },
    {
      check: 'A5' as const,
      label: 'unassigned U+0FCD',
      text: `${TIBETAN_KA}${String.fromCodePoint(0x0fcd)}`,
    },
    {
      check: 'A5' as const,
      label: 'unassigned block tail U+0FDB',
      text: `${TIBETAN_KA}${String.fromCodePoint(0x0fdb)}`,
    },
    {
      check: 'A5' as const,
      label: 'unassigned block end U+0FFF',
      text: `${TIBETAN_KA}${String.fromCodePoint(0x0fff)}`,
    },
    {
      check: 'A5' as const,
      label: 'precomposed U+0F77',
      text: `${TIBETAN_KA}${String.fromCodePoint(0x0f77)}`,
    },
    {
      check: 'A5' as const,
      label: 'precomposed U+0F79',
      text: `${TIBETAN_KA}${String.fromCodePoint(0x0f79)}`,
    },
    {
      check: 'A5' as const,
      label: 'NFC-unstable U+0F73',
      text: `${TIBETAN_KA}${String.fromCodePoint(0x0f73)}`,
    },
    {
      check: 'A7' as const,
      label: 'missing tsheg between separated Tibetan runs',
      text: `${TIBETAN_KA} ${TIBETAN_KHA}`,
    },
    {
      check: 'A7' as const,
      label: 'leading tsheg',
      text: `${STANDARD_TSHEG}${TIBETAN_KA}`,
    },
    {
      check: 'A7' as const,
      label: 'doubled tsheg',
      text: `${TIBETAN_KA}${STANDARD_TSHEG}${STANDARD_TSHEG}${TIBETAN_KHA}`,
    },
    {
      check: 'A9' as const,
      label: 'right-to-left mark',
      text: `${TIBETAN_KA}${String.fromCodePoint(0x200f)}`,
    },
  ])('positive control rejects $label via $check', ({ check, text }) => {
    expect(hasFinding(text, check)).toBe(true);
  });
});
