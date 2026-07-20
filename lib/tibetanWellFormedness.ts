export type TibetanWellFormednessCheck = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A7' | 'A9';

export interface TibetanWellFormednessFinding {
  check: TibetanWellFormednessCheck;
  reason: string;
  offset?: number;
  codePoint?: number;
}

const STANDARD_TSHEG = String.fromCodePoint(0x0f0b);
const NON_BREAKING_TSHEG = String.fromCodePoint(0x0f0c);

// Keep the common-Han detector aligned with the live source-language inference.
const COMMON_CJK_RE = /[一-鿿]/u;
const CJK_EXTENSION_A_RE = /[㐀-䶿]/u;

const ASCII_PUNCTUATION = new Set(
  [...`!"#%'()*+,-./:;<=>?[]^_{}`].map((character) => character.codePointAt(0)!),
);

// Unit and numeric symbols that B4/B5 require a translation to preserve verbatim.
const NON_ASCII_ALLOW_SET = new Set([
  0x00b2, // ²
  0x00b5, // µ
  0x00d7, // ×
  0x03bc, // μ
  0x2013, // en dash
  0x2212, // minus
  0x2264, // ≤
  0x2265, // ≥
]);

function isAllowedCodePoint(codePoint: number): boolean {
  if (codePoint >= 0x0f00 && codePoint <= 0x0fff) return true;
  if (
    (codePoint >= 0x41 && codePoint <= 0x5a)
    || (codePoint >= 0x61 && codePoint <= 0x7a)
    || (codePoint >= 0x30 && codePoint <= 0x39)
  ) {
    return true;
  }
  return (
    codePoint === 0x20
    || ASCII_PUNCTUATION.has(codePoint)
    || NON_ASCII_ALLOW_SET.has(codePoint)
  );
}

function isForbiddenTibetanCodePoint(codePoint: number): boolean {
  return (
    codePoint === 0x0f48
    || (codePoint >= 0x0f6d && codePoint <= 0x0f70)
    || codePoint === 0x0f98
    || codePoint === 0x0f77
    || codePoint === 0x0f79
  );
}

function hasMultipleSeparatedTibetanRuns(text: string): boolean {
  return text
    .split(' ')
    .filter((part) => /[\u0F40-\u0FBC]/u.test(part))
    .length >= 2;
}

export function auditTibetanWellFormedness(
  text: string,
): readonly TibetanWellFormednessFinding[] {
  const findings: TibetanWellFormednessFinding[] = [];

  if (text.trim().length === 0) {
    findings.push({ check: 'A1', reason: 'Tibetan copy is empty after trimming.' });
  }

  if (COMMON_CJK_RE.test(text) || CJK_EXTENSION_A_RE.test(text)) {
    findings.push({ check: 'A2', reason: 'Tibetan copy contains a CJK codepoint.' });
  }

  let offset = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    if (!isAllowedCodePoint(codePoint)) {
      findings.push({
        check: 'A3',
        reason: `Codepoint U+${codePoint.toString(16).toUpperCase().padStart(4, '0')} is outside the allow-set.`,
        offset,
        codePoint,
      });
    }
    if (codePoint >= 0x0900 && codePoint <= 0x097f) {
      findings.push({
        check: 'A4',
        reason: 'Tibetan copy contains a Devanagari codepoint.',
        offset,
        codePoint,
      });
    }
    if (isForbiddenTibetanCodePoint(codePoint)) {
      findings.push({
        check: 'A5',
        reason: 'Tibetan copy contains an unassigned, deprecated, or precomposed codepoint.',
        offset,
        codePoint,
      });
    }
    if (
      (codePoint >= 0x200b && codePoint <= 0x200f)
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || codePoint === 0x2060
      || (codePoint >= 0x2066 && codePoint <= 0x2069)
      || codePoint === 0xfeff
    ) {
      findings.push({
        check: 'A9',
        reason: 'Tibetan copy contains a zero-width or bidi control.',
        offset,
        codePoint,
      });
    }
    offset += character.length;
  }

  if (text.normalize('NFC') !== text) {
    findings.push({ check: 'A5', reason: 'Tibetan copy is not NFC-stable.' });
  }

  const trimmed = text.trim();
  if (trimmed.startsWith(STANDARD_TSHEG) || trimmed.startsWith(NON_BREAKING_TSHEG)) {
    findings.push({ check: 'A7', reason: 'Tibetan copy starts with a tsheg.' });
  }
  if (text.includes(`${STANDARD_TSHEG}${STANDARD_TSHEG}`)) {
    findings.push({ check: 'A7', reason: 'Tibetan copy contains a doubled standard tsheg.' });
  }
  if (
    hasMultipleSeparatedTibetanRuns(text)
    && !text.includes(STANDARD_TSHEG)
    && !text.includes(NON_BREAKING_TSHEG)
  ) {
    findings.push({
      check: 'A7',
      reason: 'Separated Tibetan orthographic runs have no tsheg.',
    });
  }

  return findings;
}
