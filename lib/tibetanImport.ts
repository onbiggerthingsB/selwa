import { createHash, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';
import { HIGH_RISK_PAIRS } from '@/data/medical-lexicon';
import { REFERENCE_LABS } from '@/data/reference-labs';
import type { ReferenceEntry } from '@/lib/types';
import { UNIT_CONVERSIONS } from '@/data/unit-conversions';
import { DISCLAIMER_TEXTS } from '@/lib/disclaimers';
import { resolveText } from '@/lib/i18n';
import {
  extractLocalizedTextCorpus,
  extractLocalizedTextFromSource,
  staticTextTemplates,
  type LocalizedTextCall,
  type LocalizedTextCorpus,
  type StaticTextTemplate,
  type TextExpression,
} from '@/lib/localizedTextCorpus';
import { normalizeUnit } from '@/lib/reference';
import {
  clauseInvariantFindings,
  hashTibetanSource,
  intervalInvariantFindings,
  latinTokenInvariantFindings,
  nameCollisionFindings,
  numberInvariantFindings,
  placeholderInvariantFindings,
  sourceDriftFindings,
  unitInvariantFindings,
  type TibetanInvariantFinding,
} from '@/lib/tibetanInvariants';
import { auditTibetanWellFormedness } from '@/lib/tibetanWellFormedness';

export const REVIEW_PACKET_FILES = {
  names: 'glossary-names.csv',
  terms: 'glossary-terms.csv',
  floor: 'floor-strings.csv',
  decisions: 'decisions.csv',
} as const;

// THE TWO-PERSON RULE. Tibetan copy cannot be machine-verified — no COMET metric exists for
// Tibetan, health-domain d-BLEU is ~9.4, and TLUE (EMNLP 2025) found Tibetan experts approved only
// 28.74% of Claude's Tibetan at BLEU 34.8: fluent but wrong. So the only gate on meaning is human,
// and a single human reviewing their own translation is not a gate at all. Two independent
// reviewers must agree before anything enters the app.
//
// WHAT THIS ENFORCES, HONESTLY. This is an honest-participant control, NOT an anti-collusion or
// identity system. A solo operator can export two packets, paste the same bo column into both, type
// a second name, and pass every check here. No local tool can prevent that. What it does buy:
//   • the one-packet import path no longer exists, so importing before a second review is a
//     deliberate act of fabrication rather than the default;
//   • a recorded claim of two named reviewers that lands in git history and PR review;
//   • mechanical guarantees independent of the two-person story — a row-set completeness gate that
//     catches silent row deletion, and cross-packet source equality that catches a reviewer
//     approving Tibetan against a falsified zh/context column;
//   • fail-closed disagreement: the importer NEVER picks a winner between two translations.
// The rule itself remains process, enforced by review; this code makes violating it deliberate and
// visible. Do not add cryptography or signatures — they would imply a guarantee we cannot make.
export const MANIFEST_FILE = 'manifest.csv';
export const INSTRUCTIONS_FILE = 'INSTRUCTIONS.md';

export interface PacketManifest {
  packetId: string;
  reviewerName: string;
  reviewerContact: string;
  reviewDate: string;
}

/** Reviewers' spreadsheet tools prepend a BOM; without this a trivial U+FEFF breaks the header. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** NFC → trim → casefold → collapse whitespace. Used only to compare reviewer identities. */
function normalizeIdentity(value: string): string {
  return value.normalize('NFC').trim().toLowerCase().replace(/\s+/gu, ' ');
}

export const SECONDS_POLICY_DECISION_ID = 'printed-unit-miao-policy';

const COMPARATOR_TERMS = [
  { term: '低于', note: 'below / less than' },
  { term: '高于', note: 'above / greater than' },
  { term: '超过', note: 'exceeds' },
  { term: '达到', note: 'reaches' },
  { term: '以上', note: 'at or above' },
  { term: '以下', note: 'at or below' },
] as const;

// RAW_MARKERS_ZH is intentionally private to medical-lexicon.ts. Keep this
// authoring list explicit so uncertainty markers cannot silently enter the
// reviewer packet alongside the 15 definite-negation terms.
const CORE_NEGATORS_ZH = [
  '无',
  '未见',
  '未见明显',
  '未发现',
  '未及',
  '不伴',
  '否认',
  '阴性',
  '排除',
  '已排除',
  '正常',
  '未见异常',
  '无异常',
  '不',
  '非',
] as const;

const BOILERPLATE_TERMS = [
  {
    term: '请与您的医生确认。',
    note: 'Please confirm this with your clinician. Shared by guard and notesGuard; review once.',
  },
  {
    term: '按原文显示；这一部分我们无法安全地简化。',
    note: 'Shown as written; we could not safely simplify this part.',
  },
] as const;

export const GLOSSARY_TERM_COMPONENT_COUNTS = {
  comparators: COMPARATOR_TERMS.length,
  coreNegators: CORE_NEGATORS_ZH.length,
  polarityPairs: HIGH_RISK_PAIRS.length,
  boilerplate: BOILERPLATE_TERMS.length,
} as const;

const PLACEHOLDER_NAME_BY_EXPRESSION = {
  'converted.from': 'fromUnit',
  'converted.to': 'toUnit',
  'entry.unit': 'unit',
  'sd.raw': 'original',
  raw: 'original',
  'ratio.toFixed(1)': 'ratio',
  'srcFreq.toUpperCase()': 'frequency',
  n: 'number',
} as const satisfies Readonly<Record<string, string>>;

const DISCLAIMER_KEYS = [
  'lead',
  'scope',
  'photo-recognition',
  'clinician-confirm',
  'regulatory-status',
] as const;

export const TIBETAN_UNIT_VOCABULARY = [
  ...new Set(
    REFERENCE_LABS
      .flatMap((entry) => [entry.unit, ...entry.allowedUnits])
      .concat(
        UNIT_CONVERSIONS.flatMap(({ conventionalUnit, siUnit }) => [
          conventionalUnit,
          siUnit,
        ]),
      )
      .flatMap((unit) => [unit, normalizeUnit(unit)])
      .filter((unit) => unit.length > 0),
  ),
].sort((left, right) => right.length - left.length || left.localeCompare(right));

export interface GlossaryNameRow {
  key: string;
  zh: string;
  en: string;
  unit: string;
  context: string;
  specimen: string;
  aliases: string;
  id: string;
  sourceHash: string;
  bo: string;
}

export interface GlossaryTermRow {
  term: string;
  categories: string;
  englishOrNote: string;
  bo: string;
}

export interface FloorStringRow {
  id: string;
  zh: string;
  en: string;
  screen: string;
  leakageNote: string;
  sourceHash: string;
  alternatives: string;
  placeholders: string;
  bo: string;
}

export interface DecisionRow {
  id: string;
  question: string;
  status: string;
  decision: string;
  notes: string;
}

export interface TibetanReviewPacket {
  names: readonly GlossaryNameRow[];
  terms: readonly GlossaryTermRow[];
  floor: readonly FloorStringRow[];
  decisions: readonly DecisionRow[];
  termComposition: typeof GLOSSARY_TERM_COMPONENT_COUNTS;
}

export type ReviewPacketKind = 'glossary-names' | 'floor-strings';

export interface ReviewedImportRow {
  packet: ReviewPacketKind;
  id: string;
  sourceHash: string;
  zh: string;
  en: string;
  bo: string;
  key?: string;
  unit?: string;
  context?: string;
  specimen?: string;
  aliases?: string;
  screen?: string;
  leakageNote?: string;
  alternatives?: string;
  placeholders?: string;
}

export interface ImportDiagnostic {
  check: string;
  message: string;
}

export type ImportRowStatus = 'written' | 'refused' | 'skipped';

export interface ImportRowResult {
  id: string;
  packet: ReviewPacketKind;
  status: ImportRowStatus;
  diagnostics: readonly ImportDiagnostic[];
}

interface PlannedReplacement {
  id: string;
  packet: ReviewPacketKind;
  sourceFile: string;
  start: number;
  end: number;
  expected: string;
  replacement: string;
  // The reviewer's approved Tibetan, parsed. Carried so validateUpdatedSources can
  // independently re-read the WRITTEN value after the edit and confirm it round-trips
  // to exactly this — an escaping bug that silently altered the string is otherwise
  // invisible to the structure-only after-write checks.
  targetTemplates: readonly ParsedTargetTemplate[];
}

export interface TibetanImportPlan {
  rows: readonly ImportRowResult[];
  replacements: readonly PlannedReplacement[];
}

export interface RebaselineChecklist {
  referenceBaselineBo?: string;
  disclaimerBaselineBo?: string;
  directContexts: readonly string[];
  expectedHashes: Readonly<Record<string, string>>;
}

export interface TibetanImportResult {
  rows: readonly ImportRowResult[];
  written: number;
  refused: number;
  skipped: number;
  filesWritten: readonly string[];
  checklist?: RebaselineChecklist;
}

interface CsvRecord {
  readonly [column: string]: string;
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

export function csvEscape(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function serializeCsv(
  columns: readonly string[],
  rows: readonly Readonly<Record<string, string>>[],
): string {
  return [
    columns.map(csvEscape).join(','),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column] ?? '')).join(',')),
  ].join('\n') + '\n';
}

export function parseCsv(csv: string): { columns: string[]; rows: CsvRecord[] } {
  const values: string[][] = [[]];
  let field = '';
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (field.length > 0) throw new Error('CSV quote must begin at the start of a field.');
      quoted = true;
    } else if (character === ',') {
      values.at(-1)!.push(field);
      field = '';
    } else if (character === '\n') {
      values.at(-1)!.push(field.endsWith('\r') ? field.slice(0, -1) : field);
      values.push([]);
      field = '';
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error('CSV ends inside a quoted field.');
  if (field.length > 0 || values.at(-1)!.length > 0) values.at(-1)!.push(field);
  if (values.at(-1)?.length === 0) values.pop();
  const columns = values.shift() ?? [];
  if (columns.length === 0) throw new Error('CSV is missing a header row.');
  if (new Set(columns).size !== columns.length) throw new Error('CSV has duplicate columns.');

  const rows = values.map((row, rowIndex) => {
    if (row.length !== columns.length) {
      throw new Error(
        `CSV row ${rowIndex + 2} has ${row.length} fields; expected ${columns.length}.`,
      );
    }
    return Object.fromEntries(columns.map((column, index) => [column, row[index]]));
  });
  return { columns, rows };
}

function stablePlaceholder(raw: string): string {
  const value = PLACEHOLDER_NAME_BY_EXPRESSION[
    raw as keyof typeof PLACEHOLDER_NAME_BY_EXPRESSION
  ];
  if (!value) throw new Error(`No stable reviewer placeholder is defined for expression ${raw}.`);
  return value;
}

function stablePlaceholders(template: StaticTextTemplate): string[] {
  return template.placeholders.map(stablePlaceholder);
}

function renderPacketTemplate(template: StaticTextTemplate): string {
  let rendered = template.segments[0] ?? '';
  stablePlaceholders(template).forEach((placeholder, index) => {
    rendered += `{${placeholder}}${template.segments[index + 1] ?? ''}`;
  });
  return rendered;
}

function packetForms(entry: LocalizedTextCall, lang: 'en' | 'zh'): {
  display: string;
  templates: readonly StaticTextTemplate[];
} {
  const variant = entry.variants[lang];
  if (variant.kind !== 'direct') {
    throw new Error(`${entry.id}.${lang} must be direct for reviewer export.`);
  }
  const templates = staticTextTemplates(variant.expression);
  if (templates.length === 0) {
    throw new Error(`${entry.id}.${lang} has no statically reviewable text.`);
  }
  const forms = templates.map(renderPacketTemplate);
  return {
    display: forms.length === 1 ? forms[0] : JSON.stringify(forms),
    templates,
  };
}

function leakageNote(entry: LocalizedTextCall, zhForms: string): string {
  if (zhForms.includes('该项目不在我们的参考资料中')) {
    return '保留“参考资料”，不得改成“我们的参考范围”；后者会暗示应用用自己的区间判断了患者数值，会触发 B1 leakage gate。';
  }
  if (
    entry.sourceFile === 'lib/summary.ts'
    && entry.ownerProperty === 'EMPTY_LOCALIZED_TEXT'
  ) {
    return 'Structural empty-text sentinel. Leave bo empty; the importer refuses any non-empty value.';
  }
  return '';
}

export function buildFloorStringRows(
  corpus: LocalizedTextCorpus,
): readonly FloorStringRow[] {
  const excluded = new Set(corpus.excludedDirectBo.map(({ entry }) => entry.id));
  return corpus.calls
    .filter((entry) => !entry.reference && !excluded.has(entry.id))
    .map((entry) => {
      const zh = packetForms(entry, 'zh');
      const en = packetForms(entry, 'en');
      if (zh.templates.length !== en.templates.length) {
        throw new Error(`${entry.id} has different EN/ZH alternative counts.`);
      }
      return {
        id: entry.id,
        zh: zh.display,
        en: en.display,
        screen: `${entry.sourceFile} · ${entry.ownerProperty ?? entry.context}`,
        leakageNote: leakageNote(entry, zh.display),
        sourceHash: entry.sourceHash,
        alternatives: String(zh.templates.length),
        placeholders: JSON.stringify(zh.templates.map(stablePlaceholders)),
        bo: '',
      };
    });
}

function buildGlossaryNameRows(corpus: LocalizedTextCorpus): GlossaryNameRow[] {
  const calls = new Map(
    corpus.calls
      .filter((entry) => entry.reference?.field === 'name')
      .map((entry) => [entry.reference!.key, entry]),
  );
  return REFERENCE_LABS.map((entry) => {
    const call = calls.get(entry.key);
    if (!call) throw new Error(`Missing extracted name call for ${entry.key}.`);
    return {
      key: entry.key,
      zh: resolveText(entry.name, 'zh').text,
      en: resolveText(entry.name, 'en').text,
      unit: entry.unit,
      context: `${resolveText(entry.definition, 'en').text} Specimen: ${entry.specimen}.`,
      specimen: entry.specimen,
      aliases: JSON.stringify({
        unscoped: entry.aliases,
        ...(entry.specimenAliases ?? {}),
      }),
      id: call.id,
      sourceHash: call.sourceHash,
      bo: '',
    };
  });
}

function buildGlossaryTermRows(): GlossaryTermRow[] {
  const byTerm = new Map<string, { categories: Set<string>; notes: string[] }>();
  const add = (term: string, category: string, note: string): void => {
    const row = byTerm.get(term) ?? { categories: new Set<string>(), notes: [] };
    row.categories.add(category);
    if (note && !row.notes.includes(note)) row.notes.push(note);
    byTerm.set(term, row);
  };

  COMPARATOR_TERMS.forEach(({ term, note }) => add(term, 'comparator', note));
  CORE_NEGATORS_ZH.forEach((term) => add(term, 'core-negator', 'Definite-negation marker.'));
  HIGH_RISK_PAIRS.forEach(({ zh, en, note }) => add(zh, 'polarity', `${en} — ${note}`));
  BOILERPLATE_TERMS.forEach(({ term, note }) => add(term, 'boilerplate', note));

  return [...byTerm]
    .map(([term, value]) => ({
      term,
      categories: [...value.categories].sort().join(' | '),
      englishOrNote: value.notes.join(' | '),
      bo: '',
    }))
    .sort((left, right) => left.term.localeCompare(right.term, 'zh'));
}

function buildDecisionRows(): DecisionRow[] {
  return [{
    id: SECONDS_POLICY_DECISION_ID,
    question:
      'Does Tibetan copy preserve the printed unit 秒 verbatim — matching the report in the patient\'s hand, violating no-CJK — or substitute a Tibetan/Latin token — satisfying no-CJK, diverging from the printed report?',
    status: 'unresolved',
    decision: '',
    notes: 'Engineering must not choose. A2 rejects the first option; B5 rejects the second.',
  }];
}

export function buildTibetanReviewPacket(
  repoRoot = process.cwd(),
): TibetanReviewPacket {
  const corpus = extractLocalizedTextCorpus({ repoRoot });
  const referenceCalls = corpus.calls.filter((entry) => entry.reference);
  // Assert only the STABLE, meaningful invariant: the reference-derived corpus (names +
  // definitions) must be intact, since that is what a broken extraction would drop. Do NOT
  // hard-assert the total call / source-file / floor counts — those grow legitimately with
  // every UI feature (Feature 2 added 34), and a production tool must not crash when the app
  // gains a string. The duplicate-id and excludedDirectBo checks below still catch a corrupt
  // or unsafe corpus; curatedBo === 0 is asserted corpus-wide in the Tibetan test layer.
  if (referenceCalls.length !== 337) {
    throw new Error(`Expected 337 reference calls; got ${referenceCalls.length}.`);
  }
  if (new Set(corpus.calls.map(({ id }) => id)).size !== corpus.calls.length) {
    throw new Error('Localized corpus contains duplicate semantic ids; refusing to export ambiguity.');
  }
  if (
    corpus.excludedDirectBo.length !== 1
    || corpus.excludedDirectBo[0].reason !== 'verbatim-ocr-echo'
  ) {
    throw new Error('Expected the sole explicit verbatim OCR echo exclusion.');
  }
  const names = buildGlossaryNameRows(corpus);
  const terms = buildGlossaryTermRows();
  const floor = buildFloorStringRows(corpus);
  const decisions = buildDecisionRows();

  if (names.length !== 117) throw new Error(`Expected 117 glossary names; got ${names.length}.`);
  if (terms.length !== 34) throw new Error(`Expected 34 distinct glossary terms; got ${terms.length}.`);
  // floor.length is NOT hard-asserted: the packet legitimately exports however many UI floor
  // strings exist, and that count grows with every feature. The reviewer simply receives all
  // of them. names (117) and terms (34) stay exact — they are reference/authored, not UI.
  return {
    names,
    terms,
    floor,
    decisions,
    termComposition: GLOSSARY_TERM_COMPONENT_COUNTS,
  };
}

function nameCsv(packet: TibetanReviewPacket): string {
  return serializeCsv(
    ['key', 'zh', 'en', 'unit', 'context', 'specimen', 'aliases', 'id', 'sourceHash', 'bo'],
    packet.names.map((row) => ({ ...row })),
  );
}

function termCsv(packet: TibetanReviewPacket): string {
  return serializeCsv(
    ['term', 'categories', 'english-or-note', 'bo'],
    packet.terms.map((row) => ({
      term: row.term,
      categories: row.categories,
      'english-or-note': row.englishOrNote,
      bo: row.bo,
    })),
  );
}

function floorCsv(packet: TibetanReviewPacket): string {
  return serializeCsv(
    [
      'id',
      'zh',
      'en',
      'screen',
      'leakage-note',
      'sourceHash',
      'alternatives',
      'placeholders',
      'bo',
    ],
    packet.floor.map((row) => ({
      id: row.id,
      zh: row.zh,
      en: row.en,
      screen: row.screen,
      'leakage-note': row.leakageNote,
      sourceHash: row.sourceHash,
      alternatives: row.alternatives,
      placeholders: row.placeholders,
      bo: row.bo,
    })),
  );
}

function decisionCsv(packet: TibetanReviewPacket): string {
  return serializeCsv(
    ['id', 'question', 'status', 'decision', 'notes'],
    packet.decisions.map((row) => ({ ...row })),
  );
}

const REVIEWER_INSTRUCTIONS = `# 藏语审核说明 / Tibetan review instructions

## 中文

您收到的是**两份独立审核**中的一份。另一位审核员收到内容相同的另一份。
**在两份都提交之前，请不要与对方讨论答案**——两份独立的答案是我们唯一的质量保证。

1. 只填写 \`bo\` 这一列，以及 \`${MANIFEST_FILE}\` 里的姓名、联系方式、日期。
2. **不要动 \`${REVIEW_PACKET_FILES.terms}\`**——那是给您参考的术语表。在里面填任何内容都会导致整批导入被拒绝。
3. **不要增加、删除或重新排序任何一行**，也不要修改除 \`bo\` 以外的任何一列。
4. 如果 \`alternatives\` 列要求 N 个变体，请填写一个包含 N 个字符串的 JSON 数组，例如 \`["第一种","第二种"]\`。
5. 请用 Google Sheets 或 LibreOffice 编辑，并导出为 **UTF-8 CSV**（Excel 的 CSV 导出常常损坏藏文）。
6. 完成后请把**整个文件夹**返回。

如果某一条您不确定，请**留空**。留空只是暂不收录；填错则可能被病人看到。

## English

You have one of **two independent review packets**. Another reviewer has the other.
**Do not discuss answers with the other reviewer until both are submitted** — two independent
answers are the only quality guarantee we have.

1. Fill in only the \`bo\` column, plus name/contact/date in \`${MANIFEST_FILE}\`.
2. **Do not touch \`${REVIEW_PACKET_FILES.terms}\`** — it is reference material. Any entry there
   aborts the entire import.
3. **Do not add, delete, or reorder rows**, and do not edit any column other than \`bo\`.
4. Where the \`alternatives\` column asks for N variants, give a JSON array of exactly N strings,
   e.g. \`["first","second"]\`.
5. Edit in Google Sheets or LibreOffice and export as **UTF-8 CSV** (Excel's CSV export corrupts
   Tibetan).
6. Return the whole folder.

If you are unsure about an entry, **leave it empty**. Empty means "not yet published"; wrong means
a patient may read it.
`;

function manifestCsv(packetId: string): string {
  return serializeCsv(
    ['packet-id', 'reviewer-name', 'reviewer-contact', 'review-date'],
    [{ 'packet-id': packetId, 'reviewer-name': '', 'reviewer-contact': '', 'review-date': '' }],
  );
}

export function readPacketManifest(packetDirectory: string): PacketManifest {
  const manifestPath = path.join(packetDirectory, MANIFEST_FILE);
  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch {
    throw new Error(
      `${MANIFEST_FILE} is missing from ${packetDirectory}. Every packet must carry the manifest `
      + 'identifying who reviewed it. Nothing was imported.',
    );
  }
  const parsed = parseCsv(stripBom(raw));
  requiredColumns(parsed, MANIFEST_FILE, [
    'packet-id',
    'reviewer-name',
    'reviewer-contact',
    'review-date',
  ]);
  if (parsed.rows.length !== 1) {
    throw new Error(
      `${MANIFEST_FILE} must hold exactly one row, found ${parsed.rows.length}. Nothing was imported.`,
    );
  }
  const [row] = parsed.rows;
  const manifest: PacketManifest = {
    packetId: row['packet-id'].trim(),
    reviewerName: row['reviewer-name'].trim(),
    reviewerContact: row['reviewer-contact'].trim(),
    reviewDate: row['review-date'].trim(),
  };
  if (manifest.packetId.length === 0) {
    throw new Error(`${MANIFEST_FILE} has an empty packet-id. Nothing was imported.`);
  }
  // A freshly exported, unfilled manifest fails here on purpose: an unnamed review is not a review.
  if (manifest.reviewerName.length === 0 || manifest.reviewerContact.length === 0) {
    throw new Error(
      `${MANIFEST_FILE} in ${packetDirectory} is missing reviewer-name or reviewer-contact. `
      + 'An anonymous packet cannot evidence a second opinion. Nothing was imported.',
    );
  }
  return manifest;
}

export function writeTibetanReviewPacket(
  repoRoot: string,
  packetDirectory: string,
): TibetanReviewPacket {
  const packet = buildTibetanReviewPacket(repoRoot);
  mkdirSync(packetDirectory, { recursive: true });
  writeFileSync(path.join(packetDirectory, REVIEW_PACKET_FILES.names), nameCsv(packet), 'utf8');
  writeFileSync(path.join(packetDirectory, REVIEW_PACKET_FILES.terms), termCsv(packet), 'utf8');
  writeFileSync(path.join(packetDirectory, REVIEW_PACKET_FILES.floor), floorCsv(packet), 'utf8');
  writeFileSync(
    path.join(packetDirectory, REVIEW_PACKET_FILES.decisions),
    decisionCsv(packet),
    'utf8',
  );
  // Re-exporting over a filled directory deliberately mints a NEW packet-id: the answers in it were
  // reviewed against the old source, so they must not silently carry over as a fresh review.
  writeFileSync(path.join(packetDirectory, MANIFEST_FILE), manifestCsv(randomUUID()), 'utf8');
  writeFileSync(path.join(packetDirectory, INSTRUCTIONS_FILE), REVIEWER_INSTRUCTIONS, 'utf8');
  return packet;
}

function requiredColumns(
  parsed: { columns: readonly string[]; rows: readonly CsvRecord[] },
  fileName: string,
  columns: readonly string[],
): void {
  const missing = columns.filter((column) => !parsed.columns.includes(column));
  if (missing.length > 0) {
    throw new Error(`${fileName} is missing required columns: ${missing.join(', ')}.`);
  }
}

export function readReviewedPacket(packetDirectory: string): ReviewedImportRow[] {
  const namesPath = path.join(packetDirectory, REVIEW_PACKET_FILES.names);
  const termsPath = path.join(packetDirectory, REVIEW_PACKET_FILES.terms);
  const floorPath = path.join(packetDirectory, REVIEW_PACKET_FILES.floor);
  const decisionsPath = path.join(packetDirectory, REVIEW_PACKET_FILES.decisions);
  // stripBom: reviewers work in Google Sheets / LibreOffice, which prepend U+FEFF on CSV export.
  // Without this the BOM concatenates into the first header name and requiredColumns throws.
  const names = parseCsv(stripBom(readFileSync(namesPath, 'utf8')));
  const terms = parseCsv(stripBom(readFileSync(termsPath, 'utf8')));
  const floor = parseCsv(stripBom(readFileSync(floorPath, 'utf8')));
  const decisions = parseCsv(stripBom(readFileSync(decisionsPath, 'utf8')));
  requiredColumns(
    names,
    REVIEW_PACKET_FILES.names,
    ['key', 'zh', 'en', 'unit', 'context', 'specimen', 'aliases', 'id', 'sourceHash', 'bo'],
  );
  requiredColumns(
    floor,
    REVIEW_PACKET_FILES.floor,
    [
      'id',
      'zh',
      'en',
      'screen',
      'leakage-note',
      'sourceHash',
      'alternatives',
      'placeholders',
      'bo',
    ],
  );
  requiredColumns(
    terms,
    REVIEW_PACKET_FILES.terms,
    ['term', 'categories', 'english-or-note', 'bo'],
  );
  requiredColumns(
    decisions,
    REVIEW_PACKET_FILES.decisions,
    ['id', 'question', 'status', 'decision', 'notes'],
  );
  const filledTerms = terms.rows.filter((row) => row.bo.trim().length > 0);
  if (filledTerms.length > 0) {
    throw new Error(
      `${REVIEW_PACKET_FILES.terms} contains ${filledTerms.length} filled bo cell(s), `
      + 'but glossary terms are authoring support with no defineText destination. Nothing was imported.',
    );
  }
  if (!decisions.rows.some((row) => row.id === SECONDS_POLICY_DECISION_ID)) {
    throw new Error(
      `${REVIEW_PACKET_FILES.decisions} is missing ${SECONDS_POLICY_DECISION_ID}.`,
    );
  }
  return [
    ...names.rows.map((row): ReviewedImportRow => ({
      packet: 'glossary-names',
      id: row.id,
      sourceHash: row.sourceHash,
      zh: row.zh,
      en: row.en,
      bo: row.bo,
      key: row.key,
      unit: row.unit,
      context: row.context,
      specimen: row.specimen,
      aliases: row.aliases,
    })),
    ...floor.rows.map((row): ReviewedImportRow => ({
      packet: 'floor-strings',
      id: row.id,
      sourceHash: row.sourceHash,
      zh: row.zh,
      en: row.en,
      bo: row.bo,
      screen: row.screen,
      leakageNote: row['leakage-note'],
      alternatives: row.alternatives,
      placeholders: row.placeholders,
    })),
  ];
}

interface ParsedTargetTemplate extends StaticTextTemplate {
  stablePlaceholders: readonly string[];
}

function parseTargetTemplate(text: string): ParsedTargetTemplate {
  const segments: string[] = [];
  const placeholders: string[] = [];
  const tokenPattern = /\{([^{}\r\n]+)\}/gu;
  let cursor = 0;
  for (const match of text.matchAll(tokenPattern)) {
    segments.push(text.slice(cursor, match.index));
    placeholders.push(match[1]);
    cursor = match.index! + match[0].length;
  }
  segments.push(text.slice(cursor));
  return {
    segments,
    placeholders,
    stablePlaceholders: placeholders,
    literalText: segments.join(''),
  };
}

function parseReviewedForms(rawBo: string, expectedCount: number): string[] {
  if (expectedCount === 1) {
    // A single-form source takes one plain-text Tibetan string. A JSON string
    // array here is a reviewer applying the multi-alternative format to the wrong
    // row; committing it verbatim would write literal brackets and quotes into
    // patient-facing copy. Refuse rather than write it. (Real Tibetan copy never
    // parses as a JSON array, so this cannot false-refuse a legitimate string.)
    const trimmed = rawBo.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = undefined;
      }
      if (Array.isArray(parsed)) {
        throw new Error(
          'This source takes a single plain-text Tibetan string, not a JSON array.',
        );
      }
    }
    return [rawBo];
  }
  let value: unknown;
  try {
    value = JSON.parse(rawBo);
  } catch {
    throw new Error(
      `This source has ${expectedCount} runtime alternatives; bo must be a JSON string array.`,
    );
  }
  if (
    !Array.isArray(value)
    || value.length !== expectedCount
    || value.some((entry) => typeof entry !== 'string')
  ) {
    throw new Error(
      `Expected a JSON array containing exactly ${expectedCount} Tibetan strings.`,
    );
  }
  return value;
}

function singleQuoted(value: string): string {
  return `'${value
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')}'`;
}

function templateSegment(value: string): string {
  // Kept symmetric with singleQuoted(): a raw CR/LF inside a template literal is
  // normalized by the TS parser (CR/CRLF -> LF), and U+2028/U+2029 are line
  // terminators, so any of them would silently alter the stored value. Escaping
  // is defense-in-depth — Class A (A3) already refuses these upstream — but the
  // writer must not depend on a guard in another module for correctness.
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('`', '\\`')
    .replaceAll('${', '\\${')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function renderedLeaf(
  source: Exclude<TextExpression, { kind: 'conditional' | 'dynamic' }>,
  target: ParsedTargetTemplate,
): string {
  if (source.kind === 'static') return singleQuoted(target.segments.join(''));

  let rendered = `\`${templateSegment(target.segments[0] ?? '')}`;
  source.placeholders.forEach((placeholder, index) => {
    rendered += `\${${placeholder}}${templateSegment(target.segments[index + 1] ?? '')}`;
  });
  return `${rendered}\``;
}

function reviewedInitializer(
  expression: TextExpression,
  targets: readonly ParsedTargetTemplate[],
  reviewedHelper: string,
): string {
  let targetIndex = 0;
  const render = (value: TextExpression): string => {
    if (value.kind === 'dynamic') {
      throw new Error('Dynamic source text cannot receive a reviewer-authored translation.');
    }
    if (value.kind === 'conditional') {
      return `(${value.condition} ? ${render(value.whenTrue)} : ${render(value.whenFalse)})`;
    }
    const target = targets[targetIndex];
    if (!target) throw new Error('Reviewer alternatives do not match the source expression.');
    targetIndex += 1;
    return renderedLeaf(value, target);
  };
  const inner = render(expression);
  if (targetIndex !== targets.length) {
    throw new Error('Reviewer alternatives do not match the source expression.');
  }
  return `${reviewedHelper}(${inner})`;
}

function reviewedBinding(sourceFileName: string, source: string): string | null {
  const parsed = ts.createSourceFile(
    sourceFileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    sourceFileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const bindings: string[] = [];
  for (const statement of parsed.statements) {
    if (
      !ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || !(
        statement.moduleSpecifier.text === '@/lib/i18n'
        || statement.moduleSpecifier.text === './i18n'
        || statement.moduleSpecifier.text.endsWith('/i18n')
      )
    ) {
      continue;
    }
    const named = statement.importClause?.namedBindings;
    if (!named) continue;
    if (ts.isNamespaceImport(named)) {
      bindings.push(`${named.name.text}.reviewed`);
      continue;
    }
    for (const element of named.elements) {
      if ((element.propertyName?.text ?? element.name.text) === 'reviewed') {
        bindings.push(element.name.text);
      }
    }
  }
  return bindings.length === 1 ? bindings[0] : null;
}

interface LocatedInitializer {
  start: number;
  end: number;
  text: string;
}

function initializerFromExtractedNode(
  entry: LocalizedTextCall,
  source: string,
): LocatedInitializer {
  const callSource = source.slice(entry.start, entry.end);
  const prefix = 'const __tibetanReviewTarget = ';
  const wrapped = `${prefix}${callSource};`;
  const sourceFile = ts.createSourceFile(
    entry.sourceFile,
    wrapped,
    ts.ScriptTarget.Latest,
    true,
    entry.sourceFile.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const diagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.DiagnosticWithLocation[] }
  ).parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    throw new Error('The extracted defineText node no longer parses independently.');
  }

  const statement = sourceFile.statements[0];
  const declaration = statement && ts.isVariableStatement(statement)
    ? statement.declarationList.declarations[0]
    : undefined;
  const call = declaration?.initializer;
  if (!call || !ts.isCallExpression(call) || call.arguments.length !== 1) {
    throw new Error('The extracted target is not one defineText call.');
  }
  const object = call.arguments[0];
  if (!ts.isObjectLiteralExpression(object)) {
    throw new Error('The extracted defineText call no longer has an object literal.');
  }
  const boProperties = object.properties.filter((property): property is ts.PropertyAssignment => {
    if (!ts.isPropertyAssignment(property)) return false;
    return (
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      && property.name.text === 'bo'
    );
  });
  if (boProperties.length !== 1) throw new Error('The extracted defineText call has no unique bo field.');
  const initializer = boProperties[0].initializer;
  if (!ts.isCallExpression(initializer) || initializer.arguments.length !== 1) {
    throw new Error("The bo initializer is not exactly fallback('zh').");
  }
  const argument = initializer.arguments[0];
  if (!ts.isStringLiteral(argument) || argument.text !== 'zh') {
    throw new Error("The bo initializer is not exactly fallback('zh').");
  }
  const start = initializer.getStart(sourceFile) - prefix.length;
  const end = initializer.end - prefix.length;
  if (start < 0 || end > callSource.length || start >= end) {
    throw new Error('The bo initializer lies outside the extracted defineText node.');
  }
  return {
    start: entry.start + start,
    end: entry.start + end,
    text: source.slice(entry.start + start, entry.start + end),
  };
}

function diagnosticFromInvariant(finding: TibetanInvariantFinding): ImportDiagnostic {
  return {
    check: finding.check,
    message:
      `${finding.reason} source=${JSON.stringify(finding.source)} `
      + `target=${JSON.stringify(finding.target)}`,
  };
}

function cjkCodePoint(text: string): string | null {
  for (const character of text) {
    const codePoint = character.codePointAt(0)!;
    if (auditTibetanWellFormedness(character).some(({ check }) => check === 'A2')) {
      return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
    }
  }
  return null;
}

function templateDiagnostics(
  source: StaticTextTemplate,
  target: ParsedTargetTemplate,
  unitVocabulary: readonly string[],
): ImportDiagnostic[] {
  const diagnostics: ImportDiagnostic[] = [];
  for (const finding of auditTibetanWellFormedness(target.literalText)) {
    const codePoint = finding.check === 'A2' ? cjkCodePoint(target.literalText) : null;
    diagnostics.push({
      check: finding.check,
      message: `${finding.reason}${codePoint ? ` First CJK codepoint: ${codePoint}.` : ''}`,
    });
  }
  diagnostics.push(
    ...numberInvariantFindings(source.literalText, target.literalText).map(diagnosticFromInvariant),
    ...intervalInvariantFindings(source.literalText, target.literalText).map(diagnosticFromInvariant),
    ...latinTokenInvariantFindings(source.literalText, target.literalText).map(diagnosticFromInvariant),
    ...unitInvariantFindings(
      source.literalText,
      target.literalText,
      unitVocabulary,
    ).map(diagnosticFromInvariant),
    ...clauseInvariantFindings(source.literalText, target.literalText).map(diagnosticFromInvariant),
    ...placeholderInvariantFindings(
      stablePlaceholders(source),
      target.stablePlaceholders,
    ).map(diagnosticFromInvariant),
  );
  return diagnostics;
}

function canonicalTemplates(templates: readonly StaticTextTemplate[]): string {
  return JSON.stringify(
    templates.map(({ segments, placeholders }) => ({ segments, placeholders })),
  );
}

function sourceTemplates(entry: LocalizedTextCall): readonly StaticTextTemplate[] {
  const zh = entry.variants.zh;
  if (zh.kind !== 'direct') return [];
  return staticTextTemplates(zh.expression);
}

interface Candidate {
  rowIndex: number;
  row: ReviewedImportRow;
  entry: LocalizedTextCall;
  replacement: PlannedReplacement;
  targetTemplates: readonly ParsedTargetTemplate[];
}

function secondsDecisionDiagnostic(): ImportDiagnostic {
  return {
    check: 'DECISION',
    message: `Resolve ${SECONDS_POLICY_DECISION_ID} in decisions.csv before importing this row.`,
  };
}

export function planTibetanImport(input: {
  corpus: LocalizedTextCorpus;
  sourceFiles: Readonly<Record<string, string>>;
  rows: readonly ReviewedImportRow[];
  unitVocabulary?: readonly string[];
  labTable?: readonly ReferenceEntry[];
}): TibetanImportPlan {
  const { corpus, sourceFiles, rows } = input;
  const unitVocabulary = input.unitVocabulary ?? TIBETAN_UNIT_VOCABULARY;
  const labTable = input.labTable ?? REFERENCE_LABS;
  const calls = new Map<string, LocalizedTextCall[]>();
  for (const entry of corpus.calls) {
    const matches = calls.get(entry.id) ?? [];
    matches.push(entry);
    calls.set(entry.id, matches);
  }
  const excludedIds = new Set(corpus.excludedDirectBo.map(({ entry }) => entry.id));
  const freshFloorRows = new Map(
    buildFloorStringRows(corpus).map((row) => [row.id, row]),
  );
  const results: ImportRowResult[] = rows.map((row) => ({
    id: row.id,
    packet: row.packet,
    status: 'refused',
    diagnostics: [],
  }));
  const candidates: Candidate[] = [];
  const nonEmptyById = new Map<string, number[]>();

  rows.forEach((row, index) => {
    if (row.bo.trim().length === 0) return;
    const indices = nonEmptyById.get(row.id) ?? [];
    indices.push(index);
    nonEmptyById.set(row.id, indices);
  });

  rows.forEach((row, rowIndex) => {
    if (row.bo.trim().length === 0) {
      results[rowIndex] = {
        id: row.id,
        packet: row.packet,
        status: 'skipped',
        diagnostics: [],
      };
      return;
    }

    if (row.packet !== 'glossary-names' && row.packet !== 'floor-strings') {
      results[rowIndex] = {
        id: row.id,
        packet: row.packet,
        status: 'refused',
        diagnostics: [{ check: 'IDENTITY', message: 'Unknown reviewer packet kind.' }],
      };
      return;
    }

    if ((nonEmptyById.get(row.id)?.length ?? 0) > 1) {
      results[rowIndex] = {
        id: row.id,
        packet: row.packet,
        status: 'refused',
        diagnostics: [{ check: 'IDENTITY', message: 'The packet contains this non-empty id more than once.' }],
      };
      return;
    }

    const entries = calls.get(row.id) ?? [];
    if (entries.length === 0) {
      results[rowIndex] = {
        id: row.id,
        packet: row.packet,
        status: 'refused',
        diagnostics: [{ check: 'IDENTITY', message: 'Target id is absent; it moved or was deleted.' }],
      };
      return;
    }
    if (entries.length !== 1) {
      results[rowIndex] = {
        id: row.id,
        packet: row.packet,
        status: 'refused',
        diagnostics: [{
          check: 'IDENTITY',
          message: `Target id is ambiguous in the current tree (${entries.length} matches).`,
        }],
      };
      return;
    }
    const entry = entries[0];
    if (
      row.packet === 'glossary-names'
      && (
        entry.reference?.field !== 'name'
        || (row.key !== undefined && row.key !== entry.reference.key)
      )
    ) {
      results[rowIndex] = {
        id: row.id,
        packet: row.packet,
        status: 'refused',
        diagnostics: [{
          check: 'IDENTITY',
          message: 'Glossary-name row no longer identifies the same reference name and key.',
        }],
      };
      return;
    }
    if (
      row.packet === 'floor-strings'
      && (entry.reference !== undefined || excludedIds.has(entry.id))
    ) {
      results[rowIndex] = {
        id: row.id,
        packet: row.packet,
        status: 'refused',
        diagnostics: [{
          check: 'IDENTITY',
          message: 'Floor row now points to reference content or an explicitly excluded direct-bo call.',
        }],
      };
      return;
    }
    const source = sourceFiles[entry.sourceFile];
    if (source === undefined) {
      results[rowIndex] = {
        id: row.id,
        packet: row.packet,
        status: 'refused',
        diagnostics: [{ check: 'IDENTITY', message: `Current source file ${entry.sourceFile} is unavailable.` }],
      };
      return;
    }

    // Check current ownership before the whole-node drift hash. A successful
    // first import necessarily changes that hash; surfacing refuse-overwrite on
    // a second run is the more specific fail-closed result, while no write is
    // possible in either case.
    const currentBo = entry.variants.bo;
    if (currentBo.kind !== 'fallback' || currentBo.target !== 'zh') {
      results[rowIndex] = {
        id: row.id,
        packet: row.packet,
        status: 'refused',
        diagnostics: [{
          check: 'OVERWRITE',
          message: "The current bo value is not fallback('zh'); refusing to overwrite direct or redirected copy.",
        }],
      };
      return;
    }

    const nodeSource = source.slice(entry.start, entry.end);
    const drift = sourceDriftFindings(
      [{ id: entry.id, source: nodeSource }],
      { [entry.id]: row.sourceHash },
    );
    if (entry.sourceHash !== row.sourceHash || drift.length > 0) {
      results[rowIndex] = {
        id: row.id,
        packet: row.packet,
        status: 'refused',
        diagnostics: [{
          check: 'B13',
          message:
            `Source drift: expected ${row.sourceHash.slice(0, 8)}, got `
            + `${entry.sourceHash.slice(0, 8)}. Re-export and re-review.`,
        }],
      };
      return;
    }

    const currentZh = packetForms(entry, 'zh').display;
    const currentEn = packetForms(entry, 'en').display;
    const snapshotDifferences: string[] = [];
    if (row.zh !== currentZh) snapshotDifferences.push('zh');
    if (row.en !== currentEn) snapshotDifferences.push('en');
    if (row.packet === 'floor-strings') {
      const expected = freshFloorRows.get(entry.id);
      if (!expected) {
        snapshotDifferences.push('floor-membership');
      } else {
        if (row.screen !== expected.screen) snapshotDifferences.push('screen');
        if (row.leakageNote !== expected.leakageNote) snapshotDifferences.push('leakage-note');
        if (row.alternatives !== expected.alternatives) snapshotDifferences.push('alternatives');
        if (row.placeholders !== expected.placeholders) snapshotDifferences.push('placeholders');
      }
    } else {
      const reference = labTable.find(({ key }) => key === entry.reference?.key);
      if (reference) {
        const expected = {
          unit: reference.unit,
          context: `${resolveText(reference.definition, 'en').text} Specimen: ${reference.specimen}.`,
          specimen: reference.specimen,
          aliases: JSON.stringify({
            unscoped: reference.aliases,
            ...(reference.specimenAliases ?? {}),
          }),
        };
        if (row.unit !== expected.unit) snapshotDifferences.push('unit');
        if (row.context !== expected.context) snapshotDifferences.push('context');
        if (row.specimen !== expected.specimen) snapshotDifferences.push('specimen');
        if (row.aliases !== expected.aliases) snapshotDifferences.push('aliases');
      } else {
        // A glossary name row must correspond to a real reference entry; without
        // one, its reviewer-visible context columns cannot be verified at all.
        // Refuse rather than silently skip the snapshot check.
        snapshotDifferences.push('unknown-reference-key');
      }
    }
    if (snapshotDifferences.length > 0) {
      results[rowIndex] = {
        id: row.id,
        packet: row.packet,
        status: 'refused',
        diagnostics: [{
          check: 'PACKET',
          message:
            `Reviewer-visible fields differ from the fresh export (${snapshotDifferences.join(', ')}). `
            + 'Re-export and re-review.',
        }],
      };
      return;
    }

    let located: LocatedInitializer;
    try {
      located = initializerFromExtractedNode(entry, source);
    } catch (error) {
      results[rowIndex] = {
        id: row.id,
        packet: row.packet,
        status: 'refused',
        diagnostics: [{ check: 'AST', message: error instanceof Error ? error.message : 'AST check failed.' }],
      };
      return;
    }
    if (located.text !== currentBo.raw) {
      results[rowIndex] = {
        id: row.id,
        packet: row.packet,
        status: 'refused',
        diagnostics: [{ check: 'AST', message: 'Re-parsed bo initializer disagrees with the fresh extractor.' }],
      };
      return;
    }

    const sourceVariant = entry.variants.zh;
    const templates = sourceTemplates(entry);
    if (sourceVariant.kind !== 'direct' || templates.length === 0) {
      results[rowIndex] = {
        id: row.id,
        packet: row.packet,
        status: 'refused',
        diagnostics: [{ check: 'SOURCE', message: 'ZH source is not statically reviewable.' }],
      };
      return;
    }
    if (templates.every((template) => template.literalText.length === 0)) {
      results[rowIndex] = {
        id: row.id,
        packet: row.packet,
        status: 'refused',
        diagnostics: [{
          check: 'EMPTY-SOURCE',
          message: 'This is a structural empty-text sentinel; non-empty bo would create visible copy.',
        }],
      };
      return;
    }

    let forms: string[];
    try {
      forms = parseReviewedForms(row.bo, templates.length);
    } catch (error) {
      results[rowIndex] = {
        id: row.id,
        packet: row.packet,
        status: 'refused',
        diagnostics: [{ check: 'FORMAT', message: error instanceof Error ? error.message : 'Invalid bo cell.' }],
      };
      return;
    }
    const targets = forms.map(parseTargetTemplate);
    const diagnostics = templates.flatMap((template, index) =>
      templateDiagnostics(template, targets[index], unitVocabulary));
    if (diagnostics.length > 0) {
      if (templates.some((template) => template.literalText.includes('秒'))) {
        diagnostics.push(secondsDecisionDiagnostic());
      }
      results[rowIndex] = {
        id: row.id,
        packet: row.packet,
        status: 'refused',
        diagnostics,
      };
      return;
    }

    let replacement: string;
    try {
      const helper = reviewedBinding(entry.sourceFile, source);
      if (!helper) throw new Error('Current source has no unique imported reviewed() binding.');
      replacement = reviewedInitializer(sourceVariant.expression, targets, helper);
    } catch (error) {
      results[rowIndex] = {
        id: row.id,
        packet: row.packet,
        status: 'refused',
        diagnostics: [{ check: 'AST', message: error instanceof Error ? error.message : 'Replacement failed.' }],
      };
      return;
    }
    candidates.push({
      rowIndex,
      row,
      entry,
      targetTemplates: targets,
      replacement: {
        id: row.id,
        packet: row.packet,
        sourceFile: entry.sourceFile,
        start: located.start,
        end: located.end,
        expected: located.text,
        replacement,
        targetTemplates: targets,
      },
    });
  });

  const existingNames = corpus.curatedBo
    .filter((entry) => entry.reference?.field === 'name')
    .flatMap((entry) => {
      const variant = entry.variants.bo;
      if (variant.kind !== 'direct') return [];
      const templates = staticTextTemplates(variant.expression);
      return templates.length === 1
        ? [{ id: entry.id, text: templates[0].literalText }]
        : [];
    });
  const candidateNames = candidates
    .filter(({ entry }) => entry.reference?.field === 'name')
    .map(({ entry, targetTemplates }) => ({
      id: entry.id,
      text: targetTemplates[0]?.literalText ?? '',
    }));
  const collisions = nameCollisionFindings([...existingNames, ...candidateNames]);
  const collisionById = new Map<string, string[]>();
  for (const collision of collisions) {
    for (const id of collision.ids) {
      const messages = collisionById.get(id) ?? [];
      messages.push(
        `Tibetan reference name collides with ${collision.ids.filter((other) => other !== id).join(', ')}.`,
      );
      collisionById.set(id, messages);
    }
  }

  const replacements: PlannedReplacement[] = [];
  for (const candidate of candidates) {
    const collisionMessages = collisionById.get(candidate.entry.id) ?? [];
    if (collisionMessages.length > 0) {
      results[candidate.rowIndex] = {
        id: candidate.row.id,
        packet: candidate.row.packet,
        status: 'refused',
        diagnostics: collisionMessages.map((message) => ({ check: 'B12', message })),
      };
      continue;
    }
    results[candidate.rowIndex] = {
      id: candidate.row.id,
      packet: candidate.row.packet,
      // A plan is not exposed as a completed import. executeTibetanImport turns
      // this into written after applying every accepted edit back-to-front.
      status: 'written',
      diagnostics: [],
    };
    replacements.push(candidate.replacement);
  }

  return { rows: results, replacements };
}

export function applyTibetanImportPlan(
  sourceFiles: Readonly<Record<string, string>>,
  plan: TibetanImportPlan,
): Readonly<Record<string, string>> {
  const replacementsByFile = new Map<string, PlannedReplacement[]>();
  for (const replacement of plan.replacements) {
    const values = replacementsByFile.get(replacement.sourceFile) ?? [];
    values.push(replacement);
    replacementsByFile.set(replacement.sourceFile, values);
  }

  const updated: Record<string, string> = {};
  for (const [sourceFile, replacements] of replacementsByFile) {
    let source = sourceFiles[sourceFile];
    if (source === undefined) throw new Error(`Missing source file ${sourceFile}.`);
    const descending = [...replacements].sort((left, right) => right.start - left.start);
    for (let index = 0; index < descending.length; index += 1) {
      const replacement = descending[index];
      const previous = descending[index - 1];
      if (previous && replacement.end > previous.start) {
        throw new Error(`Overlapping replacements in ${sourceFile}.`);
      }
      if (source.slice(replacement.start, replacement.end) !== replacement.expected) {
        throw new Error(`${replacement.id} changed between validation and application.`);
      }
      source =
        source.slice(0, replacement.start)
        + replacement.replacement
        + source.slice(replacement.end);
    }
    updated[sourceFile] = source;
  }
  return updated;
}

function validateUpdatedSources(
  corpus: LocalizedTextCorpus,
  updated: Readonly<Record<string, string>>,
  plan: TibetanImportPlan,
): void {
  const replacementIds = new Set(plan.replacements.map(({ id }) => id));
  const approvedById = new Map(
    plan.replacements.map(({ id, targetTemplates }) => [id, targetTemplates]),
  );
  for (const [sourceFile, source] of Object.entries(updated)) {
    const before = corpus.calls.filter((entry) => entry.sourceFile === sourceFile);
    const after = extractLocalizedTextFromSource(sourceFile, source);
    const beforeById = new Map(before.map((entry) => [entry.id, entry]));
    const afterById = new Map(after.map((entry) => [entry.id, entry]));
    if (
      before.length !== after.length
      || before.some((entry) => !afterById.has(entry.id))
      || after.some((entry) => !beforeById.has(entry.id))
    ) {
      throw new Error(`${sourceFile} localization identities changed in the staged output.`);
    }
    for (const entry of after) {
      const previous = beforeById.get(entry.id)!;
      if (!replacementIds.has(entry.id)) {
        if (entry.sourceHash !== previous.sourceHash) {
          throw new Error(`${entry.id} changed outside its planned bo initializer.`);
        }
        continue;
      }
      const bo = entry.variants.bo;
      if (bo.kind !== 'direct' || bo.review !== 'reviewed') {
        throw new Error(`${entry.id} did not stage as reviewed direct bo copy.`);
      }
      // Independent after-write value check: re-read the WRITTEN bo and confirm it
      // round-trips to exactly the reviewer's approved Tibetan. The parser un-escapes
      // on re-extraction, so a faithful write reproduces the approved segments and
      // placeholders; any escaping bug that altered the string trips this. A mismatch
      // (or a missing approval) throws, so this can only ever fail closed.
      const approved = approvedById.get(entry.id);
      const written = staticTextTemplates(bo.expression);
      if (!approved || !staticTemplatesEqual(written, approved)) {
        throw new Error(`${entry.id} staged bo does not match the approved Tibetan.`);
      }
    }
  }
}

function staticTemplatesEqual(
  a: readonly StaticTextTemplate[],
  b: readonly StaticTextTemplate[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((template, index) => {
    const other = b[index];
    // Compare the literal segments byte-for-byte — this is the reviewer's Tibetan and
    // the value an escaping bug would corrupt. Compare placeholder COUNT only: the
    // written expression restores the fresh ZH placeholder expressions, which
    // legitimately differ from the reviewer's tokens, so their text is not compared.
    return (
      template.segments.length === other.segments.length
      && template.segments.every((segment, i) => segment === other.segments[i])
      && template.placeholders.length === other.placeholders.length
    );
  });
}

function directStaticText(entry: LocalizedTextCall, lang: 'bo' | 'zh'): string | null {
  const variant = entry.variants[lang];
  if (variant.kind !== 'direct') return null;
  const templates = staticTextTemplates(variant.expression);
  return templates.length === 1 && templates[0].placeholders.length === 0
    ? templates[0].literalText
    : null;
}

export function buildRebaselineChecklist(
  corpus: LocalizedTextCorpus,
): RebaselineChecklist {
  const byId = new Map(corpus.calls.map((entry) => [entry.id, entry]));
  const referenceComplete = REFERENCE_LABS.every((entry) =>
    byId.has(`REFERENCE_LABS.${entry.key}.name`)
    && byId.has(`REFERENCE_LABS.${entry.key}.definition`));
  let referenceBaselineBo: string | undefined;
  if (referenceComplete) {
    const payload = REFERENCE_LABS.map((entry) => {
      const textFor = (field: 'name' | 'definition' | 'plain'): string => {
        const call = byId.get(`REFERENCE_LABS.${entry.key}.${field}`)
          ?? (
            field === 'plain' && entry.plain === entry.definition
              ? byId.get(`REFERENCE_LABS.${entry.key}.definition`)
              : undefined
          );
        return (call && directStaticText(call, 'bo')) ?? resolveText(entry[field], 'bo').text;
      };
      return {
        key: entry.key,
        name: textFor('name'),
        definition: textFor('definition'),
        plain: textFor('plain'),
      };
    });
    referenceBaselineBo = sha256Json(payload);
  }

  const disclaimerCalls = corpus.calls
    .filter((entry) => entry.sourceFile === 'lib/disclaimers.ts')
    .sort((left, right) => left.start - right.start);
  let disclaimerBaselineBo: string | undefined;
  if (disclaimerCalls.length === DISCLAIMER_KEYS.length) {
    disclaimerBaselineBo = sha256Json(
      disclaimerCalls.map((entry, index) => ({
        key: DISCLAIMER_KEYS[index],
        text: directStaticText(entry, 'bo') ?? resolveText(DISCLAIMER_TEXTS[index], 'bo').text,
      })),
    );
  }

  const expectedHashes = Object.fromEntries(
    corpus.curatedBo.map((entry) => {
      const templates = sourceTemplates(entry);
      return [entry.id, hashTibetanSource(canonicalTemplates(templates))];
    }),
  );
  const disclaimerIndex = new Map(
    corpus.calls
      .filter((entry) => entry.sourceFile === 'lib/disclaimers.ts')
      .sort((left, right) => left.start - right.start)
      .map((entry, index) => [entry.id, index]),
  );
  const auditContext = (entry: LocalizedTextCall): string => {
    if (entry.reference) return entry.context;
    if (entry.sourceFile === 'lib/uiCopy.ts' && entry.ownerProperty) {
      return `UI_COPY.${entry.ownerProperty}`;
    }
    if (entry.sourceFile === 'lib/consentCopy.ts' && entry.ownerProperty) {
      return `CONSENT_COPY.${entry.ownerProperty}`;
    }
    const disclaimer = disclaimerIndex.get(entry.id);
    if (disclaimer !== undefined) return `DISCLAIMER_TEXTS[${disclaimer}]`;
    return entry.id;
  };
  return {
    referenceBaselineBo,
    disclaimerBaselineBo,
    directContexts: [...new Set(corpus.curatedBo.map(auditContext))].sort(),
    expectedHashes,
  };
}

export function formatRebaselineChecklist(checklist: RebaselineChecklist): string {
  const lines = [
    'Re-baseline checklist (review and apply manually; this importer edits no test file):',
    `REFERENCE_BASELINE.bo = ${checklist.referenceBaselineBo ?? 'unavailable for this fixture'}`,
    `DISCLAIMER_BASELINE.bo = ${checklist.disclaimerBaselineBo ?? 'unavailable for this fixture'}`,
    'DIRECT bo contexts (add each to DIRECT_BO_ALLOWLIST with a named reason):',
    ...(
      checklist.directContexts.length > 0
        ? checklist.directContexts.map((context) => `- ${context}`)
        : ['- (none)']
    ),
    'B13 expectedHashes (hashTibetanSource of canonical fresh ZH templates):',
    ...(
      Object.keys(checklist.expectedHashes).length > 0
        ? Object.entries(checklist.expectedHashes)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([id, hash]) => `- ${JSON.stringify(id)}: ${JSON.stringify(hash)}`)
        : ['- (none)']
    ),
  ];
  return lines.join('\n');
}

function commitUpdatedFiles(
  repoRoot: string,
  originals: Readonly<Record<string, string>>,
  updated: Readonly<Record<string, string>>,
): void {
  const sourceFiles = Object.keys(updated).sort();
  for (const sourceFile of sourceFiles) {
    const absoluteFile = path.join(repoRoot, sourceFile);
    if (readFileSync(absoluteFile, 'utf8') !== originals[sourceFile]) {
      throw new Error(`${sourceFile} changed after validation; refusing to overwrite it.`);
    }
  }

  const staged = new Map<string, string>();
  try {
    for (const sourceFile of sourceFiles) {
      const absoluteFile = path.join(repoRoot, sourceFile);
      const temporary = path.join(
        path.dirname(absoluteFile),
        `.${path.basename(absoluteFile)}.tibetan-import-${randomUUID()}.tmp`,
      );
      writeFileSync(temporary, updated[sourceFile], {
        encoding: 'utf8',
        flag: 'wx',
        mode: statSync(absoluteFile).mode,
      });
      staged.set(sourceFile, temporary);
    }

    // Re-check every original after all output has been staged. Each rename is
    // atomic within its source directory, so a crash cannot truncate a TS file.
    for (const sourceFile of sourceFiles) {
      const absoluteFile = path.join(repoRoot, sourceFile);
      if (readFileSync(absoluteFile, 'utf8') !== originals[sourceFile]) {
        throw new Error(`${sourceFile} changed while edits were staged; refusing to overwrite it.`);
      }
    }
    for (const sourceFile of sourceFiles) {
      renameSync(staged.get(sourceFile)!, path.join(repoRoot, sourceFile));
      staged.delete(sourceFile);
    }
  } finally {
    for (const temporary of staged.values()) {
      try {
        unlinkSync(temporary);
      } catch {
        // A successful atomic rename removes the temporary path. Cleanup errors
        // for a still-staged file must not conceal the original refusal/error.
      }
    }
  }
}

export function executeTibetanImport(input: {
  repoRoot: string;
  rows: readonly ReviewedImportRow[];
  labTable?: readonly ReferenceEntry[];
}): TibetanImportResult {
  const repoRoot = path.resolve(input.repoRoot);
  const corpus = extractLocalizedTextCorpus({ repoRoot });
  const sourceFiles = Object.fromEntries(
    corpus.sourceFiles.map((sourceFile) => [
      sourceFile,
      readFileSync(path.join(repoRoot, sourceFile), 'utf8'),
    ]),
  );
  const plan = planTibetanImport({
    corpus,
    sourceFiles,
    rows: input.rows,
    labTable: input.labTable,
  });
  const updated = applyTibetanImportPlan(sourceFiles, plan);
  validateUpdatedSources(corpus, updated, plan);
  const filesWritten = Object.keys(updated).sort();
  if (filesWritten.length > 0) commitUpdatedFiles(repoRoot, sourceFiles, updated);

  const postCorpus = filesWritten.length > 0
    ? extractLocalizedTextCorpus({ repoRoot })
    : corpus;
  const checklist = filesWritten.length > 0
    ? buildRebaselineChecklist(postCorpus)
    : undefined;
  const rows = plan.rows;
  return {
    rows,
    written: rows.filter(({ status }) => status === 'written').length,
    refused: rows.filter(({ status }) => status === 'refused').length,
    skipped: rows.filter(({ status }) => status === 'skipped').length,
    filesWritten,
    checklist,
  };
}

export interface DualDisagreement {
  id: string;
  packet: ReviewPacketKind;
  reason: 'disagreement' | 'coverage-mismatch' | 'context-mismatch';
  a: string;
  b: string;
}

export interface DualAgreementPlan {
  agreed: readonly ReviewedImportRow[];
  refused: readonly DualDisagreement[];
  skipped: readonly ReviewedImportRow[];
}

/** NFC + outer trim only. Deliberately NOT tsheg- or inner-whitespace-insensitive: tsheg placement
 *  changes segmentation, so a tsheg difference is a real disagreement, not a formatting one. */
function canonicalBo(value: string): string {
  return value.normalize('NFC').trim();
}

/** Two hand-typed JSON arrays may differ only in spacing. Compare element-wise; re-serialize on
 *  agreement so the written form is deterministic rather than whichever packet we happened to read
 *  first. Returns null when the cell is not a JSON string array. */
function parseAlternativeArray(value: string): string[] | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) return null;
  return parsed.map((item) => canonicalBo(item));
}

/** Every reviewer-visible column except bo. If these differ across packets, one reviewer approved
 *  Tibetan against a different (falsified or stale) source than the other. */
const CROSS_PACKET_SOURCE_COLUMNS = [
  'zh',
  'en',
  'key',
  'unit',
  'context',
  'specimen',
  'aliases',
  'screen',
  'leakageNote',
  'alternatives',
  'placeholders',
  'sourceHash',
] as const;

/**
 * The dual gate. Pairs two independently reviewed packets and decides, per row, whether the two
 * reviewers agree. FAILS CLOSED: it never picks a winner between two differing translations —
 * legitimate synonymy is a human adjudication, not something code may resolve by preference.
 */
export function planDualAgreement(
  rowsA: readonly ReviewedImportRow[],
  rowsB: readonly ReviewedImportRow[],
): DualAgreementPlan {
  // Must precede pairing: the per-row IDENTITY duplicate guard runs later, so a Map keyed by id
  // would silently keep last-wins and quietly drop a reviewer's answer.
  for (const [label, rows] of [['A', rowsA], ['B', rowsB]] as const) {
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${row.packet}:${row.id}`;
      if (row.id.length > 0 && seen.has(key)) {
        throw new Error(
          `Packet ${label} contains duplicate row id ${row.id} in ${row.packet}. Nothing was imported.`,
        );
      }
      seen.add(key);
    }
  }

  const byKeyB = new Map(rowsB.map((row) => [`${row.packet}:${row.id}`, row]));
  const agreed: ReviewedImportRow[] = [];
  const refused: DualDisagreement[] = [];
  const skipped: ReviewedImportRow[] = [];

  for (const rowA of rowsA) {
    const key = `${rowA.packet}:${rowA.id}`;
    const rowB = byKeyB.get(key);
    if (!rowB) continue; // row-set equality is enforced by the completeness gate before this runs

    const mismatched = CROSS_PACKET_SOURCE_COLUMNS.find(
      (column) => (rowA[column] ?? '') !== (rowB[column] ?? ''),
    );
    if (mismatched) {
      refused.push({
        id: rowA.id,
        packet: rowA.packet,
        reason: 'context-mismatch',
        a: String(rowA[mismatched] ?? ''),
        b: String(rowB[mismatched] ?? ''),
      });
      continue;
    }

    const aFilled = rowA.bo.trim().length > 0;
    const bFilled = rowB.bo.trim().length > 0;
    if (!aFilled && !bFilled) {
      skipped.push(rowA);
      continue;
    }
    if (aFilled !== bFilled) {
      // Fail closed. One reviewer proposing and the other silent is exactly the single-opinion
      // situation this whole mechanism exists to refuse.
      refused.push({
        id: rowA.id,
        packet: rowA.packet,
        reason: 'coverage-mismatch',
        a: rowA.bo,
        b: rowB.bo,
      });
      continue;
    }

    const altA = parseAlternativeArray(rowA.bo);
    const altB = parseAlternativeArray(rowB.bo);
    if (altA && altB) {
      if (altA.length === altB.length && altA.every((item, index) => item === altB[index])) {
        agreed.push({ ...rowA, bo: JSON.stringify(altA) });
      } else {
        refused.push({ id: rowA.id, packet: rowA.packet, reason: 'disagreement', a: rowA.bo, b: rowB.bo });
      }
      continue;
    }

    const canonA = canonicalBo(rowA.bo);
    if (canonA === canonicalBo(rowB.bo)) {
      // Forward the canonical form, not either raw cell, so A5 NFC-stability holds even if a
      // reviewer typed decomposed codepoints.
      agreed.push({ ...rowA, bo: canonA });
    } else {
      refused.push({ id: rowA.id, packet: rowA.packet, reason: 'disagreement', a: rowA.bo, b: rowB.bo });
    }
  }

  return { agreed, refused, skipped };
}

/**
 * Row-set completeness. Catches a reviewer who deleted rows (their packet then diverges from the
 * other) and fabricated rows (ids the corpus does not contain). Missing-from-both is source DRIFT,
 * not tampering — a defineText added since export — and is reported, not thrown, so it does not
 * preempt the per-row B13 "re-export and re-review" diagnostics.
 */
export function planPacketCompleteness(input: {
  repoRoot: string;
  rowsA: readonly ReviewedImportRow[];
  rowsB: readonly ReviewedImportRow[];
  labTable?: readonly ReferenceEntry[];
}): { drift: readonly string[] } {
  const corpus = extractLocalizedTextCorpus({ repoRoot: path.resolve(input.repoRoot) });
  const labTable = input.labTable ?? REFERENCE_LABS;
  const labKeys = new Set(labTable.map(({ key }) => key));

  const expected = new Set<string>();
  for (const call of corpus.calls) {
    if (call.reference?.field === 'name') {
      if (labKeys.has(call.reference.key)) expected.add(`glossary-names:${call.id}`);
      continue;
    }
    if (call.reference) continue;
    if (corpus.excludedDirectBo.some((excluded) => excluded.entry.id === call.id)) continue;
    expected.add(`floor-strings:${call.id}`);
  }

  const keysOf = (rows: readonly ReviewedImportRow[]) =>
    new Set(rows.map((row) => `${row.packet}:${row.id}`));
  const keysA = keysOf(input.rowsA);
  const keysB = keysOf(input.rowsB);

  const onlyA = [...keysA].filter((key) => !keysB.has(key));
  const onlyB = [...keysB].filter((key) => !keysA.has(key));
  if (onlyA.length > 0 || onlyB.length > 0) {
    throw new Error(
      'The two packets do not cover the same rows — one of them had rows added or deleted. '
      + `Only in A: ${onlyA.join(', ') || '(none)'}. Only in B: ${onlyB.join(', ') || '(none)'}. `
      + 'Nothing was imported.',
    );
  }

  const fabricated = [...keysA].filter((key) => !expected.has(key));
  if (fabricated.length > 0) {
    throw new Error(
      `The packets contain ${fabricated.length} row(s) with no matching source string: `
      + `${fabricated.join(', ')}. Nothing was imported.`,
    );
  }

  return { drift: [...expected].filter((key) => !keysA.has(key)) };
}

export interface DualImportResult extends TibetanImportResult {
  disagreements: readonly DualDisagreement[];
  drift: readonly string[];
  reviewers: readonly string[];
}

/**
 * Import Tibetan approved by TWO independent reviewers. There is deliberately no single-packet
 * path: see the two-person rule note at the top of this file for what that does and does not buy.
 *
 * NOTE: executeTibetanImport stays exported for in-memory tests. Calling it directly bypasses this
 * gate — the same trust level as editing this file. The control governs the packet/CLI path, which
 * is the only path a human uses.
 */
export function importReviewedPacket(
  repoRoot: string,
  packetDirectoryA: string,
  packetDirectoryB: string,
  options: { labTable?: readonly ReferenceEntry[] } = {},
): DualImportResult {
  const manifestA = readPacketManifest(packetDirectoryA);
  const manifestB = readPacketManifest(packetDirectoryB);

  if (manifestA.packetId === manifestB.packetId) {
    throw new Error(
      'Both packets carry the same packet-id, so they are the same exported packet — either the '
      + 'same directory was passed twice, or one was copied over the other. A copy is not a second '
      + 'opinion. Nothing was imported.',
    );
  }
  if (normalizeIdentity(manifestA.reviewerName) === normalizeIdentity(manifestB.reviewerName)) {
    throw new Error(
      `Both packets name the same reviewer (${manifestA.reviewerName}). Medical translation needs `
      + 'two independent reviewers; nobody may approve their own work. Nothing was imported.',
    );
  }
  if (normalizeIdentity(manifestA.reviewerContact) === normalizeIdentity(manifestB.reviewerContact)) {
    throw new Error(
      'Both packets give the same reviewer contact, so they are not two independent reviewers. '
      + 'Nothing was imported.',
    );
  }

  const rowsA = readReviewedPacket(packetDirectoryA);
  const rowsB = readReviewedPacket(packetDirectoryB);
  const { drift } = planPacketCompleteness({
    repoRoot,
    rowsA,
    rowsB,
    labTable: options.labTable,
  });
  const dual = planDualAgreement(rowsA, rowsB);

  const result = executeTibetanImport({
    repoRoot,
    rows: dual.agreed,
    labTable: options.labTable,
  });

  const refusedRows: ImportRowResult[] = dual.refused.map((disagreement) => ({
    id: disagreement.id,
    packet: disagreement.packet,
    status: 'refused' as const,
    diagnostics: [
      {
        check: 'DUAL',
        message:
          disagreement.reason === 'disagreement'
            ? 'The two reviewers submitted different Tibetan for this row. The importer does not '
              + 'choose between them: agree on one form, put it in BOTH packets, and re-import.'
            : disagreement.reason === 'coverage-mismatch'
              ? 'Only one reviewer filled this row. One opinion is not a review; either both fill '
                + 'it or both leave it empty.'
              : 'The two packets disagree about the SOURCE text for this row, so at least one '
                + 'reviewer judged against a different original. Re-export and re-review.',
      },
    ],
  }));

  // Rows both reviewers left empty never reach executeTibetanImport, so account for them here or
  // they vanish from the tally and an untouched packet looks like a no-op with nothing in it.
  const skippedRows: ImportRowResult[] = dual.skipped.map((row) => ({
    id: row.id,
    packet: row.packet,
    status: 'skipped' as const,
    diagnostics: [],
  }));

  return {
    ...result,
    rows: [...result.rows, ...refusedRows, ...skippedRows],
    refused: result.refused + refusedRows.length,
    skipped: result.skipped + skippedRows.length,
    disagreements: dual.refused,
    drift,
    reviewers: [manifestA.reviewerName, manifestB.reviewerName],
  };
}
