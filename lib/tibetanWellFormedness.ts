export type TibetanWellFormednessCheck = 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7' | 'A9';

export interface TibetanWellFormednessFinding {
  check: TibetanWellFormednessCheck;
  reason: string;
  offset?: number;
  codePoint?: number;
}

const STANDARD_TSHEG = String.fromCodePoint(0x0f0b);
const NON_BREAKING_TSHEG = String.fromCodePoint(0x0f0c);

// Keep the common-Han detector aligned with the live source-language inference.
const TIBETAN_SCRIPT_RE = /[\u0F00-\u0FFF]/u;

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
  // U+2014 em dash. The Chinese sources use —— as a clause break on 7 of the 109 UI
  // strings, and the reviewer confirmed they intended to reproduce it and substituted SPACES
  // only because they took the mark to be unavailable. Spaces are the worst available answer:
  // canonicalBo (lib/tibetanImport.ts) normalizes NFC + outer trim ONLY, so inner runs of
  // whitespace are compared byte-for-byte, and two reviewers who pad differently produce a
  // spurious dual-agreement disagreement on a row they actually translated identically.
  // Admitting the mark the source already uses is the one instruction two independent
  // translators cannot drift on. Cost, stated plainly: word processors autocorrect "--" to an
  // em dash, so this one mark stops being evidence of a mangled round-trip. The curly quotes
  // U+201C/U+201D stay OUT for exactly that reason and remain the tripwire.
  0x2014, // em dash
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
    // Unassigned code points in the Tibetan block (Unicode 15.1). Enumerated as
    // explicit deterministic ranges rather than \p{Cn} so the set cannot drift
    // with the runtime's ICU Unicode version and silently loosen.
    codePoint === 0x0f48
    || (codePoint >= 0x0f6d && codePoint <= 0x0f70)
    || codePoint === 0x0f98
    || codePoint === 0x0fbd
    || codePoint === 0x0fcd
    || (codePoint >= 0x0fdb && codePoint <= 0x0fff)
    // Deprecated precomposed vowel signs (use the decomposed sequence instead).
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
  } else if (!TIBETAN_SCRIPT_RE.test(text)) {
    // A6 guards the direction every other check leaves open. A1..A5/A7/A9 are deny-lists and the
    // B invariants only compare the target against the source, so NOTHING required the bo cell to
    // contain Tibetan at all. That is not hypothetical: lib/consentCopy.ts registers the English
    // 'Before we read your report' as reviewed Chinese, and for that row the ONLY cell the
    // pipeline accepted was the English typed straight back — which it then wrote into the bo
    // slot as reviewed(). English in, English out, validating clean. Refusing a target with no
    // Tibetan codepoint closes that permanently. Measured collateral across the 109 reviewed UI
    // strings: zero, since every other source carries Han and its faithful rendering is Tibetan.
    // Guarded behind the empty case so a blank cell reports A1 alone rather than both.
    findings.push({ check: 'A6', reason: 'Tibetan copy contains no Tibetan-script codepoint.' });
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
