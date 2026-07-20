import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';
import type { Lang, ReviewStatus } from '@/lib/i18n';

export const LOCALIZED_TEXT_SOURCE_DIRS = ['app', 'components', 'data', 'lib'] as const;

export interface StaticTextExpression {
  kind: 'static';
  text: string;
  raw: string;
}

export interface TemplateTextExpression {
  kind: 'template';
  segments: readonly string[];
  placeholders: readonly string[];
  raw: string;
}

export interface ConditionalTextExpression {
  kind: 'conditional';
  condition: string;
  whenTrue: TextExpression;
  whenFalse: TextExpression;
  raw: string;
}

export interface DynamicTextExpression {
  kind: 'dynamic';
  raw: string;
}

export type TextExpression =
  | StaticTextExpression
  | TemplateTextExpression
  | ConditionalTextExpression
  | DynamicTextExpression;

export type ExtractedVariant =
  | Readonly<{
      kind: 'fallback';
      target: Lang;
      raw: string;
    }>
  | Readonly<{
      kind: 'direct';
      review: ReviewStatus;
      expression: TextExpression;
      raw: string;
    }>;

export interface ReferenceTextContext {
  key: string;
  field: 'name' | 'definition' | 'plain';
}

export interface LocalizedTextCall {
  id: string;
  sourceFile: string;
  start: number;
  end: number;
  line: number;
  column: number;
  sourceHash: string;
  context: string;
  ownerProperty?: string;
  reference?: ReferenceTextContext;
  variants: Readonly<Record<Lang, ExtractedVariant>>;
}

export interface ExcludedDirectBo {
  entry: LocalizedTextCall;
  reason: 'verbatim-ocr-echo';
}

export interface LocalizedTextCorpus {
  calls: readonly LocalizedTextCall[];
  sourceFiles: readonly string[];
  curatedBo: readonly LocalizedTextCall[];
  excludedDirectBo: readonly ExcludedDirectBo[];
}

export interface StaticTextTemplate {
  segments: readonly string[];
  placeholders: readonly string[];
  /** Static literal text only. Runtime placeholder expressions are deliberately omitted. */
  literalText: string;
}

interface I18nBindings {
  defineText: Set<string>;
  fallback: Set<string>;
  reviewed: Set<string>;
  unverified: Set<string>;
  namespaces: Set<string>;
}

interface ParseContext {
  sourceFile: ts.SourceFile;
  bindings: I18nBindings;
  constants: ReadonlyMap<string, ts.Expression>;
}

const LANG_SET = new Set<string>(['en', 'zh', 'bo']);
const REFERENCE_FIELDS = new Set(['name', 'definition', 'plain']);
const TEST_FILE_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

function normalizedPath(value: string): string {
  return value.split(path.sep).join('/');
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function nodeLocation(sourceFile: ts.SourceFile, node: ts.Node): string {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${sourceFile.fileName}:${position.line + 1}:${position.character + 1}`;
}

function fail(sourceFile: ts.SourceFile, node: ts.Node, message: string): never {
  throw new Error(`${nodeLocation(sourceFile, node)} — ${message}`);
}

function propertyName(
  sourceFile: ts.SourceFile,
  name: ts.PropertyName,
): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return fail(sourceFile, name, 'computed localization properties are not supported');
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function collectI18nBindings(sourceFile: ts.SourceFile): I18nBindings {
  const bindings: I18nBindings = {
    defineText: new Set(),
    fallback: new Set(),
    reviewed: new Set(),
    unverified: new Set(),
    namespaces: new Set(),
  };

  for (const statement of sourceFile.statements) {
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

    const namedBindings = statement.importClause?.namedBindings;
    if (!namedBindings) continue;
    if (ts.isNamespaceImport(namedBindings)) {
      bindings.namespaces.add(namedBindings.name.text);
      continue;
    }

    for (const element of namedBindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text;
      if (imported in bindings) {
        bindings[imported as keyof I18nBindings].add(element.name.text);
      }
    }
  }

  return bindings;
}

function importedI18nHelper(
  expression: ts.LeftHandSideExpression,
  bindings: I18nBindings,
): keyof Omit<I18nBindings, 'namespaces'> | null {
  if (ts.isIdentifier(expression)) {
    for (const helper of ['defineText', 'fallback', 'reviewed', 'unverified'] as const) {
      if (bindings[helper].has(expression.text)) return helper;
    }
    return null;
  }
  if (
    ts.isPropertyAccessExpression(expression)
    && ts.isIdentifier(expression.expression)
    && bindings.namespaces.has(expression.expression.text)
  ) {
    const helper = expression.name.text;
    return ['defineText', 'fallback', 'reviewed', 'unverified'].includes(helper)
      ? helper as keyof Omit<I18nBindings, 'namespaces'>
      : null;
  }
  return null;
}

function collectConstants(sourceFile: ts.SourceFile): ReadonlyMap<string, ts.Expression> {
  const declarations = new Map<string, ts.Expression[]>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && ts.isVariableDeclarationList(node.parent)
      && (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const existing = declarations.get(node.name.text) ?? [];
      existing.push(node.initializer);
      declarations.set(node.name.text, existing);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return new Map(
    [...declarations]
      .filter(([, initializers]) => initializers.length === 1)
      .map(([name, initializers]) => [name, initializers[0]]),
  );
}

function piecesOf(
  expression: StaticTextExpression | TemplateTextExpression,
): { segments: string[]; placeholders: string[] } {
  if (expression.kind === 'static') {
    return { segments: [expression.text], placeholders: [] };
  }
  return {
    segments: [...expression.segments],
    placeholders: [...expression.placeholders],
  };
}

function expressionFromPieces(
  segments: readonly string[],
  placeholders: readonly string[],
  raw: string,
): StaticTextExpression | TemplateTextExpression {
  if (placeholders.length === 0) {
    return { kind: 'static', text: segments.join(''), raw };
  }
  return { kind: 'template', segments, placeholders, raw };
}

function concatenateExpressions(
  left: TextExpression,
  right: TextExpression,
  raw: string,
): TextExpression {
  if (left.kind === 'dynamic' || right.kind === 'dynamic') {
    return { kind: 'dynamic', raw };
  }
  if (left.kind === 'conditional') {
    return {
      kind: 'conditional',
      condition: left.condition,
      whenTrue: concatenateExpressions(left.whenTrue, right, raw),
      whenFalse: concatenateExpressions(left.whenFalse, right, raw),
      raw,
    };
  }
  if (right.kind === 'conditional') {
    return {
      kind: 'conditional',
      condition: right.condition,
      whenTrue: concatenateExpressions(left, right.whenTrue, raw),
      whenFalse: concatenateExpressions(left, right.whenFalse, raw),
      raw,
    };
  }

  const leftPieces = piecesOf(left);
  const rightPieces = piecesOf(right);
  const segments = [
    ...leftPieces.segments.slice(0, -1),
    `${leftPieces.segments.at(-1) ?? ''}${rightPieces.segments[0] ?? ''}`,
    ...rightPieces.segments.slice(1),
  ];
  return expressionFromPieces(
    segments,
    [...leftPieces.placeholders, ...rightPieces.placeholders],
    raw,
  );
}

function parseTextExpression(
  expression: ts.Expression,
  context: ParseContext,
  resolving = new Set<string>(),
): TextExpression {
  const node = unwrapExpression(expression);
  const raw = node.getText(context.sourceFile);

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { kind: 'static', text: node.text, raw };
  }

  if (ts.isTemplateExpression(node)) {
    const segments = [node.head.text];
    const placeholders: string[] = [];
    for (const span of node.templateSpans) {
      placeholders.push(span.expression.getText(context.sourceFile).replace(/\s+/gu, ' ').trim());
      segments.push(span.literal.text);
    }
    return { kind: 'template', segments, placeholders, raw };
  }

  if (
    ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    return concatenateExpressions(
      parseTextExpression(node.left, context, new Set(resolving)),
      parseTextExpression(node.right, context, new Set(resolving)),
      raw,
    );
  }

  if (ts.isConditionalExpression(node)) {
    return {
      kind: 'conditional',
      condition: node.condition.getText(context.sourceFile).replace(/\s+/gu, ' ').trim(),
      whenTrue: parseTextExpression(node.whenTrue, context, new Set(resolving)),
      whenFalse: parseTextExpression(node.whenFalse, context, new Set(resolving)),
      raw,
    };
  }

  if (ts.isIdentifier(node)) {
    const initializer = context.constants.get(node.text);
    if (initializer && !resolving.has(node.text)) {
      const nextResolving = new Set(resolving);
      nextResolving.add(node.text);
      return parseTextExpression(initializer, context, nextResolving);
    }
  }

  return { kind: 'dynamic', raw };
}

function directVariant(
  initializer: ts.Expression,
  context: ParseContext,
): ExtractedVariant {
  const node = unwrapExpression(initializer);
  const raw = node.getText(context.sourceFile);

  if (ts.isCallExpression(node)) {
    const helper = importedI18nHelper(node.expression, context.bindings);
    if (helper === 'fallback') {
      if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) {
        return fail(context.sourceFile, node, 'fallback() must receive one literal language');
      }
      const target = node.arguments[0].text;
      if (!LANG_SET.has(target)) {
        return fail(context.sourceFile, node.arguments[0], `unsupported fallback language ${target}`);
      }
      return { kind: 'fallback', target: target as Lang, raw };
    }

    const review = helper === 'reviewed'
      ? 'reviewed'
      : helper === 'unverified'
        ? 'unverified'
        : null;
    if (review !== null) {
      if (node.arguments.length !== 1) {
        return fail(context.sourceFile, node, `${helper}() must receive exactly one expression`);
      }
      return {
        kind: 'direct',
        review,
        expression: parseTextExpression(node.arguments[0], context),
        raw,
      };
    }
  }

  if (ts.isObjectLiteralExpression(node)) {
    const properties = new Map<string, ts.PropertyAssignment>();
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) {
        return fail(context.sourceFile, property, 'direct text variants cannot use spreads or methods');
      }
      const name = propertyName(context.sourceFile, property.name);
      if (properties.has(name)) {
        return fail(context.sourceFile, property, `duplicate direct-text property ${name}`);
      }
      properties.set(name, property);
    }
    const textProperty = properties.get('text');
    if (!textProperty) {
      return fail(context.sourceFile, node, 'direct text object is missing text');
    }
    const reviewProperty = properties.get('review');
    let review: ReviewStatus = 'unverified';
    if (reviewProperty) {
      const reviewValue = unwrapExpression(reviewProperty.initializer);
      if (
        !ts.isStringLiteral(reviewValue)
        || !['reviewed', 'unverified'].includes(reviewValue.text)
      ) {
        return fail(context.sourceFile, reviewValue, 'review must be reviewed or unverified');
      }
      review = reviewValue.text as ReviewStatus;
    }
    return {
      kind: 'direct',
      review,
      expression: parseTextExpression(textProperty.initializer, context),
      raw,
    };
  }

  return fail(
    context.sourceFile,
    node,
    'localized variants must use fallback(), reviewed(), unverified(), or a direct text object',
  );
}

function nearestOwnerProperty(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): string | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isPropertyAssignment(current)) {
      return propertyName(sourceFile, current.name);
    }
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text;
    }
    current = current.parent;
  }
  return undefined;
}

function structuralContext(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  ownerProperty: string | undefined,
): string {
  if (ownerProperty) return ownerProperty;

  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) {
      return `function:${current.name.text}`;
    }
    if (ts.isMethodDeclaration(current) && current.name) {
      return `method:${propertyName(sourceFile, current.name)}`;
    }
    if (
      (ts.isFunctionExpression(current) || ts.isArrowFunction(current))
      && ts.isVariableDeclaration(current.parent)
      && ts.isIdentifier(current.parent.name)
    ) {
      return `function:${current.parent.name.text}`;
    }
    current = current.parent;
  }
  return 'module';
}

function referenceContext(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  relativePath: string,
): ReferenceTextContext | undefined {
  if (relativePath !== 'data/reference-labs.ts') return undefined;

  let current: ts.Node | undefined = call.parent;
  while (current) {
    if (ts.isPropertyAssignment(current)) {
      const field = propertyName(sourceFile, current.name);
      if (REFERENCE_FIELDS.has(field) && ts.isObjectLiteralExpression(current.parent)) {
        const keyProperty = current.parent.properties.find(
          (property): property is ts.PropertyAssignment =>
            ts.isPropertyAssignment(property)
            && propertyName(sourceFile, property.name) === 'key',
        );
        const keyValue = keyProperty && unwrapExpression(keyProperty.initializer);
        if (keyValue && ts.isStringLiteral(keyValue)) {
          return {
            key: keyValue.text,
            field: field as ReferenceTextContext['field'],
          };
        }
      }
    }
    current = current.parent;
  }
  return undefined;
}

function isVerbatimOcrEcho(entry: LocalizedTextCall): boolean {
  if (entry.sourceFile !== 'lib/summary.ts' || entry.ownerProperty !== 'name') return false;
  return (['en', 'zh', 'bo'] as const).every((lang) => {
    const variant = entry.variants[lang];
    return (
      variant.kind === 'direct'
      && variant.review === 'unverified'
      && variant.expression.kind === 'dynamic'
      && variant.expression.raw === 'row.extracted.name'
    );
  });
}

export function staticTextTemplates(expression: TextExpression): readonly StaticTextTemplate[] {
  switch (expression.kind) {
    case 'static':
      return [{
        segments: [expression.text],
        placeholders: [],
        literalText: expression.text,
      }];
    case 'template':
      return [{
        segments: expression.segments,
        placeholders: expression.placeholders,
        literalText: expression.segments.join(''),
      }];
    case 'conditional':
      return [
        ...staticTextTemplates(expression.whenTrue),
        ...staticTextTemplates(expression.whenFalse),
      ];
    case 'dynamic':
      return [];
  }
}

export function extractLocalizedTextFromSource(
  sourceFileName: string,
  source: string,
): readonly LocalizedTextCall[] {
  const relativePath = normalizedPath(sourceFileName);
  const scriptKind = relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const diagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.DiagnosticWithLocation[] }
  ).parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    const diagnostic = diagnostics[0];
    const detail = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    throw new Error(`${relativePath} has a TypeScript parse error: ${detail}`);
  }

  const bindings = collectI18nBindings(sourceFile);
  const context: ParseContext = {
    sourceFile,
    bindings,
    constants: collectConstants(sourceFile),
  };
  const calls: LocalizedTextCall[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && importedI18nHelper(node.expression, bindings) === 'defineText'
    ) {
      if (node.arguments.length !== 1 || !ts.isObjectLiteralExpression(node.arguments[0])) {
        fail(sourceFile, node, 'defineText() must receive exactly one object literal');
      }

      const localizedProperties = new Map<string, ts.PropertyAssignment>();
      for (const property of node.arguments[0].properties) {
        if (!ts.isPropertyAssignment(property)) {
          fail(sourceFile, property, 'defineText() cannot use spreads or methods');
        }
        const name = propertyName(sourceFile, property.name);
        if (!LANG_SET.has(name)) {
          fail(sourceFile, property, `unexpected defineText() property ${name}`);
        }
        if (localizedProperties.has(name)) {
          fail(sourceFile, property, `duplicate defineText() property ${name}`);
        }
        localizedProperties.set(name, property);
      }
      for (const lang of ['en', 'zh', 'bo'] as const) {
        if (!localizedProperties.has(lang)) {
          fail(sourceFile, node.arguments[0], `defineText() is missing ${lang}`);
        }
      }

      const start = node.getStart(sourceFile);
      const position = sourceFile.getLineAndCharacterOfPosition(start);
      const reference = referenceContext(node, sourceFile, relativePath);
      const ownerProperty = nearestOwnerProperty(node, sourceFile);
      const contextName = reference
        ? `REFERENCE_LABS.${reference.key}.${reference.field}`
        : structuralContext(node, sourceFile, ownerProperty);
      calls.push({
        id: '',
        sourceFile: relativePath,
        start,
        end: node.end,
        line: position.line + 1,
        column: position.character + 1,
        sourceHash: sha256(node.getText(sourceFile)),
        context: contextName,
        ownerProperty,
        reference,
        variants: {
          en: directVariant(localizedProperties.get('en')!.initializer, context),
          zh: directVariant(localizedProperties.get('zh')!.initializer, context),
          bo: directVariant(localizedProperties.get('bo')!.initializer, context),
        },
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  calls.sort((left, right) => left.start - right.start);
  const occurrenceByContext = new Map<string, number>();
  return calls.map((entry) => {
    if (entry.reference) {
      return { ...entry, id: entry.context };
    }
    const occurrence = occurrenceByContext.get(entry.context) ?? 0;
    occurrenceByContext.set(entry.context, occurrence + 1);
    return {
      ...entry,
      id: `${entry.sourceFile}:${entry.context}:${occurrence}`,
    };
  });
}

function sourceFilesUnder(repoRoot: string, sourceDirs: readonly string[]): string[] {
  const files: string[] = [];

  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (
        !entry.isFile()
        || !/\.tsx?$/u.test(entry.name)
        || /\.d\.ts$/u.test(entry.name)
        || TEST_FILE_RE.test(entry.name)
      ) {
        continue;
      }
      files.push(entryPath);
    }
  };

  for (const sourceDir of sourceDirs) {
    visit(path.join(repoRoot, sourceDir));
  }
  return files.sort((left, right) => left.localeCompare(right));
}

export function extractLocalizedTextCorpus(options: {
  repoRoot?: string;
  sourceDirs?: readonly string[];
} = {}): LocalizedTextCorpus {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const sourceDirs = options.sourceDirs ?? LOCALIZED_TEXT_SOURCE_DIRS;
  const calls: LocalizedTextCall[] = [];

  for (const absoluteFile of sourceFilesUnder(repoRoot, sourceDirs)) {
    const relativeFile = normalizedPath(path.relative(repoRoot, absoluteFile));
    calls.push(
      ...extractLocalizedTextFromSource(relativeFile, readFileSync(absoluteFile, 'utf8')),
    );
  }
  calls.sort(
    (left, right) =>
      left.sourceFile.localeCompare(right.sourceFile)
      || left.start - right.start,
  );

  const directBo = calls.filter((entry) => entry.variants.bo.kind === 'direct');
  const excludedDirectBo = directBo
    .filter(isVerbatimOcrEcho)
    .map((entry): ExcludedDirectBo => ({ entry, reason: 'verbatim-ocr-echo' }));
  const excludedIds = new Set(excludedDirectBo.map(({ entry }) => entry.id));

  return {
    calls,
    sourceFiles: [...new Set(calls.map((entry) => entry.sourceFile))],
    curatedBo: directBo.filter((entry) => !excludedIds.has(entry.id)),
    excludedDirectBo,
  };
}
