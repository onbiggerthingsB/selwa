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

export function clauseInvariantFindings(
  sourceText: string,
  targetText: string,
): readonly TibetanInvariantFinding[] {
  const source = sourceText.match(/[。；：;:]/gu) ?? [];
  const target = targetText.match(/[\u0F0D\u0F0E]/gu) ?? [];
  return source.length === target.length
    ? []
    : mismatch('B7', 'Chinese clause separators and Tibetan shad counts differ.', source, target);
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
