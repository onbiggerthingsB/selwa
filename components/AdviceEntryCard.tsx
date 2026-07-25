import Link from 'next/link';
import { LocalizedText } from '@/components/LocalizedText';
import { resolveText, type Lang } from '@/lib/i18n';
import { ADVICE_ENTRY_COPY } from '@/lib/adviceCopy';

function AdviceGlyph() {
  return (
    <svg
      aria-hidden
      className="glyph"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 5.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4.5 3v-3H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z" />
      <path d="M8 9.5h8M8 12.5h5" />
    </svg>
  );
}

export function AdviceEntryCard({ lang }: { lang: Lang }) {
  return (
    <Link
      href="/advice"
      className="advice-entry-card"
      aria-label={resolveText(ADVICE_ENTRY_COPY.title, lang).text}
    >
      <AdviceGlyph />
      <span className="advice-entry-copy">
        <LocalizedText
          className="advice-entry-title"
          value={ADVICE_ENTRY_COPY.title}
          lang={lang}
        />
        <LocalizedText
          className="advice-entry-subtitle"
          value={ADVICE_ENTRY_COPY.subtitle}
          lang={lang}
        />
      </span>
      <span className="advice-entry-arrow" aria-hidden>→</span>
    </Link>
  );
}
