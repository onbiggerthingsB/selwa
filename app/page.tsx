'use client';
import { CaptureCard } from '@/components/CaptureCard';
import { SavedVisits } from '@/components/SavedVisits';
import { InstallPrompt } from '@/components/InstallPrompt';
import { LocalizedText } from '@/components/LocalizedText';
import { resolveText } from '@/lib/i18n';
import { useLangPreference } from '@/lib/langPreference';
import { UI_COPY } from '@/lib/uiCopy';

export default function Home() {
  const [lang, setLang] = useLangPreference();
  return (
    <main className="home">
      <header>
        <span className="wordmark">
          <span className="mark" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
              <path d="M14 3v4h4" />
              <path d="M9 13.5l2 2 4-4.5" />
            </svg>
          </span>
          Health Translator
        </span>
        <p className="tagline">
          Understand your lab report in plain language — safely.
          <span className="zh" lang="zh">用您能读懂的语言，安心了解您的化验单。</span>
        </p>
        <div
          className="lang-toggle"
          role="group"
          aria-label={resolveText(UI_COPY.language, lang).text}
        >
          <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
            EN
          </button>
          <button aria-pressed={lang === 'zh'} onClick={() => setLang('zh')}>
            中文
          </button>
          <button aria-pressed={lang === 'bo'} onClick={() => setLang('bo')}>
            TB
          </button>
        </div>
      </header>
      {lang === 'bo' && (
        <aside className="tibetan-availability" data-testid="home-tibetan-availability">
          <p>
            <LocalizedText value={UI_COPY.tibetanUnavailable} lang={lang} />
          </p>
        </aside>
      )}
      <CaptureCard lang={lang} />
      {/* Feature 2 (advice portal) entry removed 2026-07-25 — safety quarantine (C3).
          The verified defect: the deterministic advice guard checks only lexical/structural
          signals (emergency keywords, dosing, Tibetan script, model-set outOfScope) and never
          medical truth, so harmful and false prose reached users. components/AdviceEntryCard.tsx
          is preserved unmodified as research; re-adding it here re-opens the harm surface. */}
      <SavedVisits lang={lang} />
      <InstallPrompt />
    </main>
  );
}
