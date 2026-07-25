import type { ComponentPropsWithoutRef } from 'react';
import {
  defineText,
  fallback,
  resolveText,
  reviewed,
  type Lang,
  type LocalizedText as LocalizedTextValue,
  type ResolvedText,
} from '@/lib/i18n';
import { TibetanText } from '@/components/TibetanText';

export const UNVERIFIED_TRANSLATION_LABEL = defineText({
  en: reviewed('Unverified translation'),
  zh: reviewed('翻译未经审核'),
  bo: fallback('zh'),
});

function ResolvedContent({ value }: { value: ResolvedText }) {
  if (value.resolvedLang === 'bo') {
    return <TibetanText>{value.text}</TibetanText>;
  }

  return (
    <span className={value.resolvedLang === 'zh' ? 'zh' : undefined} lang={value.resolvedLang}>
      {value.text}
    </span>
  );
}

export function TranslationVerificationMarker({ lang }: { lang: Lang }) {
  const label = resolveText(UNVERIFIED_TRANSLATION_LABEL, lang);

  return (
    <span
      className="translation-verification-marker"
      data-translation-review="unverified"
      lang={label.resolvedLang}
    >
      {label.text}
    </span>
  );
}

type LocalizedTextProps = Omit<ComponentPropsWithoutRef<'span'>, 'children' | 'lang'> & {
  value: LocalizedTextValue;
  lang: Lang;
  showVerification?: boolean;
};

/**
 * Renders one localized value and marks direct, unverified localized text.
 * Screen owners disclose a language fallback once instead of repeating it on
 * every fallback string.
 */
export function LocalizedText({
  value,
  lang,
  showVerification = true,
  className,
  ...props
}: LocalizedTextProps) {
  const resolved = resolveText(value, lang);

  return (
    <span
      {...props}
      className={className}
      data-requested-lang={lang}
      data-resolved-lang={resolved.resolvedLang}
    >
      <ResolvedContent value={resolved} />
      {showVerification &&
        !resolved.usedFallback &&
        resolved.review === 'unverified' && (
          <TranslationVerificationMarker lang={resolved.resolvedLang} />
        )}
    </span>
  );
}
