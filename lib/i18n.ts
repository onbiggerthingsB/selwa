export const LANGS = ['en', 'zh', 'bo'] as const;

export type Lang = (typeof LANGS)[number];

/**
 * Languages the deterministic clinical text detectors and translation-model
 * validation corpus can parse. This is intentionally narrower than the UI
 * display language set: Tibetan is scaffolded for display only in this tranche.
 */
export const SOURCE_LANGS = ['en', 'zh'] as const satisfies readonly Lang[];

export type SourceLang = (typeof SOURCE_LANGS)[number];

export type ReviewStatus = 'reviewed' | 'unverified';

export type DirectText = Readonly<{
  text: string;
  /** Omitted deliberately means unverified. Review must always be opt-in. */
  review?: ReviewStatus;
  fallback?: never;
}>;

export type FallbackText = Readonly<{
  fallback: Lang;
  text?: never;
  review?: never;
}>;

export type LocalizedVariant = DirectText | FallbackText;

/**
 * Every supported language must have an explicit entry. A language may point to
 * another language, but it may never disappear and silently fall back at runtime.
 */
export type LocalizedText = Readonly<{
  readonly [Language in Lang]: LocalizedVariant;
}>;

export const LANGUAGE_CONFIG = {
  en: { fallback: 'en', secondary: 'zh' },
  zh: { fallback: 'zh', secondary: 'en' },
  // Tibetan copy is not available yet. Every bo entry must explicitly use this
  // Chinese fallback until reviewed Tibetan content is supplied for that string.
  //
  // SECONDARY IS zh, NOT en. This only became load-bearing now: with nameBo curated on 0 of 175
  // entries, every bo string fell back to Chinese and the pair rendered zh+en, so the screen
  // merely LOOKED Chinese-annotating. The first reviewed Tibetan import ends that — a recognised
  // row would have shown Tibetan over ENGLISH, with the printed Chinese name gone from the one
  // screen that persists. Two independent reasons it must be Chinese: the product is stated to
  // carry no English at all, and reviewer 2's cross-institution argument (a Tibetan reader
  // showing the phone to a clinician needs the Chinese term the report actually prints).
  bo: { fallback: 'zh', secondary: 'zh' },
} as const satisfies Record<Lang, Readonly<{ fallback: Lang; secondary: Lang }>>;

/** Identity helper that makes missing language entries a compile-time error. */
export function defineText<const Text extends LocalizedText>(text: Text): Text {
  return text;
}

export function reviewed(text: string): DirectText {
  return { text, review: 'reviewed' };
}

export function unverified(text: string): DirectText {
  return { text, review: 'unverified' };
}

export function fallback(language: Lang): FallbackText {
  return { fallback: language };
}

export interface ResolvedText {
  text: string;
  requestedLang: Lang;
  resolvedLang: Lang;
  review: ReviewStatus;
  usedFallback: boolean;
  /** Requested language first and the language containing the text last. */
  path: readonly Lang[];
}

export interface PrimarySecondaryText {
  primary: ResolvedText;
  secondary: ResolvedText;
}

/**
 * Resolves only explicit fallback links. Invalid cycles throw instead of hiding
 * missing content or looping forever.
 */
export function resolveText(text: LocalizedText, requestedLang: Lang): ResolvedText {
  const seen = new Set<Lang>();
  const path: Lang[] = [];
  let current = requestedLang;

  while (true) {
    if (seen.has(current)) {
      throw new Error(`Localized text fallback cycle: ${[...path, current].join(' -> ')}`);
    }

    seen.add(current);
    path.push(current);
    const variant = text[current];

    if (typeof variant.text === 'string') {
      return {
        text: variant.text,
        requestedLang,
        resolvedLang: current,
        // A reviewed source string does not make its use as another language a
        // reviewed translation. Explicit fallbacks always fail closed.
        review: current === requestedLang ? (variant.review ?? 'unverified') : 'unverified',
        usedFallback: current !== requestedLang,
        path,
      };
    }

    current = variant.fallback;
  }
}

/**
 * Resolves the selected language and its configured secondary display language.
 * Renderers use each result's resolvedLang for their lang/font attributes.
 */
export function resolvePrimarySecondary(
  text: LocalizedText,
  requestedLang: Lang,
): PrimarySecondaryText {
  return {
    primary: resolveText(text, requestedLang),
    secondary: resolveText(text, LANGUAGE_CONFIG[requestedLang].secondary),
  };
}
