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
  it('A6 refuses a target with no Tibetan script, and A1 alone owns the empty cell', () => {
    // The English-in/English-out hole: lib/consentCopy.ts registers English as reviewed Chinese,
    // and before A6 the only cell the pipeline accepted for that row was the English typed back,
    // which it then wrote into the bo slot. No other check looked at the target's script.
    const findings = auditTibetanWellFormedness('Before we read your report');
    expect(findings.map(({ check }) => check)).toContain('A6');

    // A blank cell reports A1 and NOT A6 — one defect, one diagnostic.
    const empty = auditTibetanWellFormedness('   ').map(({ check }) => check);
    expect(empty).toContain('A1');
    expect(empty).not.toContain('A6');

    expect(auditTibetanWellFormedness('བཀྲ་ཤིས།')).toEqual([]);
  });

  it('A3 admits the em dash the sources use, and still rejects curly quotes', () => {
    // 7 of the 109 UI strings carry ——. The reviewer meant to reproduce it and padded with
    // SPACES instead, which is worse: canonicalBo compares inner whitespace byte-for-byte, so
    // two reviewers padding differently disagree on a row they translated identically.
    expect(auditTibetanWellFormedness('བཀྲ་ཤིས།——དགེ་ལེགས།')).toEqual([]);

    // Curly quotes stay banned: they are the signature of an autocorrecting editor, and the
    // reviewer confirmed the Tibetan gug rtags is the mark they would use anyway.
    expect(
      auditTibetanWellFormedness('བཀྲ་ཤིས། \u201Cདགེ་ལེགས།\u201D').map(({ check }) => check),
    ).toEqual(['A3', 'A3']);
    expect(auditTibetanWellFormedness('བཀྲ་ཤིས། ༼དགེ་ལེགས།༽')).toEqual([]);
  });

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
