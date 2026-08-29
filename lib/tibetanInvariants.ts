import { createHash } from 'node:crypto';

export type TibetanInvariantCheck = 'B1' | 'B2' | 'B4' | 'B5' | 'B7' | 'B10';

export interface TibetanInvariantFinding {
  check: TibetanInvariantCheck;
  reason: string;
  source: readonly string[];
  target: readonly string[];
}

export interface NamedText {
  id: string;
  text: string;
}

export interface NameCollisionFinding {
  text: string;
  ids: readonly string[];
}

export interface SourceLockedText {
  id: string;
  source: string;
}

export type SourceDriftFinding =
  | Readonly<{ id: string; kind: 'missing-source-lock' }>
  | Readonly<{ id: string; kind: 'source-drift'; expected: string; actual: string }>
  | Readonly<{ id: string; kind: 'orphan-source-lock' }>;

const TIBETAN_DIGIT_RE = /[\u0F20-\u0F29]/gu;
const NUMBER_RE = /(?<![\d.])[+-]?(?:\d+(?:\.\d+)?|\.\d+)/gu;
const INTERVAL_RE =
  /([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(?:-|–|—|~|～|至|到)\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))/gu;
const LATIN_TOKEN_RE = /[A-Za-z][A-Za-z0-9]*(?:[-'][A-Za-z0-9]+)*/gu;

function normalizeTibetanDigits(text: string): string {
  return text
    .replace(TIBETAN_DIGIT_RE, (digit) =>
      String.fromCodePoint(0x30 + digit.codePointAt(0)! - 0x0f20))
    .replaceAll('−', '-');
}

function frequencyMap(values: readonly string[]): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const value of values) {
    frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
  }
  return frequencies;
}

function sameMultiset(left: readonly string[], right: readonly string[]): boolean {
  const leftFrequencies = frequencyMap(left);
  const rightFrequencies = frequencyMap(right);
  if (leftFrequencies.size !== rightFrequencies.size) return false;
  return [...leftFrequencies].every(
    ([value, count]) => rightFrequencies.get(value) === count,
  );
}

function numbers(text: string): string[] {
  return normalizeTibetanDigits(text).match(NUMBER_RE) ?? [];
}

function intervals(text: string): string[] {
  return [...normalizeTibetanDigits(text).matchAll(INTERVAL_RE)]
    .map((match) => `${match[1]}→${match[2]}`);
}

function latinTokens(text: string): string[] {
  return text.match(LATIN_TOKEN_RE) ?? [];
}

function mismatch(
  check: TibetanInvariantCheck,
  reason: string,
  source: readonly string[],
  target: readonly string[],
): TibetanInvariantFinding[] {
  return [{ check, reason, source, target }];
}

export function numberInvariantFindings(
  sourceText: string,
  targetText: string,
): readonly TibetanInvariantFinding[] {
  const source = numbers(sourceText);
  const target = numbers(targetText);
  const findings: TibetanInvariantFinding[] = [];

  if (!sameMultiset(source, target)) {
    findings.push(...mismatch('B1', 'Number multisets differ.', source, target));
  }
  const tibetanDigits = targetText.match(TIBETAN_DIGIT_RE) ?? [];
  if (tibetanDigits.length > 0) {
    findings.push(...mismatch(
      'B1',
      'Tibetan digits are not permitted in immutable numeric values.',
      [],
      tibetanDigits,
    ));
  }
  return findings;
}

export function intervalInvariantFindings(
  sourceText: string,
  targetText: string,
): readonly TibetanInvariantFinding[] {
  const source = intervals(sourceText);
  const target = intervals(targetText);
  return source.length === target.length
    && source.every((value, index) => target[index] === value)
    ? []
    : mismatch('B2', 'Interval endpoints or order differ.', source, target);
}

export function latinTokenInvariantFindings(
  sourceText: string,
  targetText: string,
): readonly TibetanInvariantFinding[] {
  const source = latinTokens(sourceText);
  const target = latinTokens(targetText);
  return sameMultiset(source, target)
    ? []
    : mismatch('B4', 'Latin token multisets differ.', source, target);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function unitTokens(
  text: string,
  vocabulary: readonly string[],
): readonly string[] {
  const alternatives = [...new Set(vocabulary)]
    .filter((unit) => unit.length > 0)
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .map(escapeRegExp);
  if (alternatives.length === 0) return [];

  const unitPattern = new RegExp(
    `(?<![A-Za-z0-9])(?:${alternatives.join('|')})(?![A-Za-z0-9])`,
    'gu',
  );
  return text.match(unitPattern) ?? [];
}

export function unitInvariantFindings(
  sourceText: string,
  targetText: string,
  vocabulary: readonly string[],
): readonly TibetanInvariantFinding[] {
  const source = unitTokens(sourceText, vocabulary);
  const target = unitTokens(targetText, vocabulary);
  return sameMultiset(source, target)
    ? []
    : mismatch('B5', 'Unit token multisets differ.', source, target);
}

/**
 * B7 is ONE-SIDED (target >= source), not equality. It catches a DROPPED clause; a surplus
 * shad is not a defect.
 *
 * Equality was wrong in both directions, and it refused 15 of the first 19 rows a real Tibetan
 * translator returned. A shad is not a translation of a Chinese period — it is where Tibetan
 * grammar closes a clause, and the two do not correspond:
 *   • 44 of the 109 UI strings are labels/headings whose Chinese carries no 。；：at all
 *     (重试, 返回, 结果, 单位). Equality demanded ZERO shad — i.e. unpunctuated Tibetan. The
 *     reviewer translating them stated the rule unprompted and without being asked about
 *     register: the shad is required on buttons and prose alike, by Tibetan grammar.
 *   • Chinese ，、（）—— also close clauses that Tibetan ends with a shad, and this predicate
 *     does not count them, so a faithful translation systematically overshoots.
 *
 * Equality also produced a live FALSE ACCEPT, which one-sidedness removes: for a source with one
 * 。whose faithful Tibetan takes two shad, the correct string was refused (2 !== 1) while the
 * string with a clause DELETED was accepted (1 === 1). The gate was inverted on that row.
 *
 * Measured on the 19 reviewed rows: equality refuses 15, one-sided refuses 0, and shad count is
 * >= separator count in 19 of 19 — no faithful translation ever under-produced a shad.
 *
 * KNOWN LIMIT, deliberately not papered over. Restricting to the deficit direction narrows what
 * this catches: of 11 clause-deletion mutants built from those rows, one-sided catches 4. Equality
 * "caught" 10, but 6 of those were rows where it also refused the correct text — a rule that
 * refuses everything detects nothing. Measured only on rows whose faithful text PASSES, equality
 * scored 4 of 4 and one-sided scores 4 of 11, over 19 importable rows instead of 4. The residual
 * gap is covered by planDualAgreement: two reviewers must produce byte-identical strings
 * independently, which is a far stronger omission detector than counting punctuation.
 */
export function clauseInvariantFindings(
  sourceText: string,
  targetText: string,
): readonly TibetanInvariantFinding[] {
  // Terminators only. A colon INTRODUCES a clause, it does not close one, so counting it
  // demanded a shad Tibetan has no reason to write. Five of the 109 UI strings carry the
  // parenthetical （原文：{original}）, where the colon labels a quoted value mid-sentence;
  // counting it refused rows 58 and 61 of a reviewed packet outright. Verified against the
  // full 108-row reviewed corpus: dropping the colon fixes exactly those rows and refuses
  // nothing new.
  const source = sourceText.match(/[。；;]/gu) ?? [];
  // Tibetan boundaries are not only shad. Syllables inside a phrase are joined by a TSHEG, so a
  // SPACE between two Tibetan runs is itself a phrase boundary — and the reviewer uses exactly
  // that where orthography drops the shad ("有一些藏文字…后面不用 །，因为它本来就是很长的竖":
  // some letters already end in a long vertical stroke that serves as the shad). Counting the
  // shad alone therefore under-reports real boundaries and refuses correct Tibetan.
  //
  // DELIBERATELY NOT a letter allow-list. The reviewer named ག as an EXAMPLE, not an enumeration,
  // and encoding a guessed set is how this check went wrong three times already: it kept inferring
  // Tibetan structure from Chinese punctuation. Space-as-boundary needs no such guess. The
  // residual gap — an omitted shad with no space either, e.g. a clause running straight into a
  // parenthetical — is left REFUSING on purpose, so a human looks rather than the code guessing.
  const target = targetText.match(/[\u0F0D\u0F0E]|(?<![\u0F0D\u0F0E])\s+(?=[\u0F40-\u0FBC])/gu) ?? [];
  return target.length >= source.length
    ? []
    : mismatch(
        'B7',
        'Tibetan shad count is below the Chinese clause-separator count, so a clause looks dropped.',
        source,
        target,
      );
}

export function placeholderInvariantFindings(
  sourcePlaceholders: readonly string[],
  targetPlaceholders: readonly string[],
): readonly TibetanInvariantFinding[] {
  return (
    sourcePlaceholders.length === targetPlaceholders.length
    && sourcePlaceholders.every((value, index) => targetPlaceholders[index] === value)
  )
    ? []
    : mismatch(
        'B10',
        'Placeholder count or order differs.',
        sourcePlaceholders,
        targetPlaceholders,
      );
}

export function nameCollisionFindings(
  values: readonly NamedText[],
): readonly NameCollisionFinding[] {
  const idsByText = new Map<string, string[]>();
  for (const { id, text } of values) {
    const ids = idsByText.get(text) ?? [];
    ids.push(id);
    idsByText.set(text, ids);
  }
  return [...idsByText]
    .filter(([, ids]) => ids.length > 1)
    .map(([text, ids]) => ({ text, ids: ids.sort() }))
    .sort((left, right) => left.text.localeCompare(right.text));
}

export function hashTibetanSource(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

export function sourceDriftFindings(
  values: readonly SourceLockedText[],
  expectedHashes: Readonly<Record<string, string>>,
): readonly SourceDriftFinding[] {
  const findings: SourceDriftFinding[] = [];
  const presentIds = new Set(values.map(({ id }) => id));

  for (const { id, source } of values) {
    const expected = expectedHashes[id];
    if (!expected) {
      findings.push({ id, kind: 'missing-source-lock' });
      continue;
    }
    const actual = hashTibetanSource(source);
    if (actual !== expected) {
      findings.push({ id, kind: 'source-drift', expected, actual });
    }
  }
  for (const id of Object.keys(expectedHashes)) {
    if (!presentIds.has(id)) findings.push({ id, kind: 'orphan-source-lock' });
  }

  return findings.sort(
    (left, right) => left.id.localeCompare(right.id) || left.kind.localeCompare(right.kind),
  );
}
