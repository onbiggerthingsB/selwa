'use client';

import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';
import { LocalizedText } from '@/components/LocalizedText';
import {
  ADVICE_DISCLAIMERS,
  ADVICE_ENTRY_COPY,
  ADVICE_FORM_COPY,
  ADVICE_REFERRAL,
  ADVICE_SCHOOL_COPY,
  ADVICE_UNAVAILABLE_COPY,
} from '@/lib/adviceCopy';
import { resolveText, type Lang } from '@/lib/i18n';
import { useLangPreference } from '@/lib/langPreference';
import type { Sex } from '@/lib/types';
import { UI_COPY } from '@/lib/uiCopy';

type Phase = 'form' | 'loading' | 'result';
type AdviceLanguageMode = 'en' | 'zh';

const QUESTION_CHAR_LIMIT = 2000;
const SCHOOL_ORDER = ['tcm', 'tibetan', 'western'] as const;
const STUB_TRANSITION_MS = 50;

function localized(value: (typeof ADVICE_FORM_COPY)[keyof typeof ADVICE_FORM_COPY], lang: Lang) {
  return resolveText(value, lang).text;
}

function AdviceFrame({ lang, children }: { lang: Lang; children: ReactNode }) {
  return (
    <section className="advice-frame">
      <div className="advice-state">{children}</div>

      <section className="disclaimers advice-disclaimers" data-testid="advice-disclaimers">
        <p className="disc-lead" data-testid="advice-disclaimer">
          <LocalizedText value={ADVICE_DISCLAIMERS[0]} lang={lang} />
        </p>
        <ul>
          {ADVICE_DISCLAIMERS.slice(1).map((copy, index) => (
            <li key={index} data-testid="advice-disclaimer">
              <LocalizedText value={copy} lang={lang} />
            </li>
          ))}
        </ul>
      </section>

      <aside className="advice-referral" role="note" data-testid="advice-referral">
        <LocalizedText value={ADVICE_REFERRAL} lang={lang} />
      </aside>
    </section>
  );
}

function AdviceSchoolSkeletons({ lang }: { lang: Lang }) {
  return (
    <div className="advice-school-grid">
      {SCHOOL_ORDER.map((school) => {
        const copy = ADVICE_SCHOOL_COPY[school];
        return (
          <article className="advice-school-card" key={school}>
            <h2><LocalizedText value={copy.label} lang={lang} /></h2>
            <p><LocalizedText value={copy.subtitle} lang={lang} /></p>
            <div className="skel-card" aria-hidden />
          </article>
        );
      })}
    </div>
  );
}

export default function AdvicePage() {
  const [lang, setLang] = useLangPreference();
  const [phase, setPhase] = useState<Phase>('form');
  const [gender, setGender] = useState<Sex>('unknown');
  const [age, setAge] = useState<number | undefined>(undefined);
  const [question, setQuestion] = useState('');
  const [languageOverride, setLanguageOverride] = useState<AdviceLanguageMode | null>(null);
  const languageMode: AdviceLanguageMode = languageOverride ?? (lang === 'en' ? 'en' : 'zh');
  const trimmedQuestion = question.trim();
  const questionTooLong = question.length > QUESTION_CHAR_LIMIT;
  const canSubmit = trimmedQuestion.length > 0 && !questionTooLong;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    // T1 stub only: no request, consent check, or model call exists in this tranche.
    setPhase('loading');
    window.setTimeout(() => setPhase('result'), STUB_TRANSITION_MS);
  }

  return (
    <main className="home advice-page">
      <header>
        <Link
          href="/"
          className="wordmark advice-wordmark"
          aria-label={localized(ADVICE_FORM_COPY.homeLabel, lang)}
        >
          <span className="mark" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
              <path d="M14 3v4h4" />
              <path d="M9 13.5l2 2 4-4.5" />
            </svg>
          </span>
          Health Translator
        </Link>
        <h1 className="advice-page-title">
          <LocalizedText value={ADVICE_ENTRY_COPY.title} lang={lang} />
        </h1>
        <p className="tagline">
          <LocalizedText value={ADVICE_ENTRY_COPY.subtitle} lang={lang} />
        </p>
        <div
          className="lang-toggle"
          role="group"
          aria-label={resolveText(UI_COPY.language, lang).text}
        >
          <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
          <button type="button" aria-pressed={lang === 'zh'} onClick={() => setLang('zh')}>中文</button>
          <button type="button" aria-pressed={lang === 'bo'} onClick={() => setLang('bo')}>TB</button>
        </div>
      </header>

      {lang === 'bo' && (
        <aside className="tibetan-availability" data-testid="advice-tibetan-availability">
          <p><LocalizedText value={ADVICE_FORM_COPY.tibetanAnswerLanguages} lang={lang} /></p>
        </aside>
      )}

      <AdviceFrame lang={lang}>
        {phase === 'form' && (
          <form className="advice-form" onSubmit={submit}>
            <label className="field">
              <span className="field-label">
                <LocalizedText value={ADVICE_FORM_COPY.genderLabel} lang={lang} />
              </span>
              <span className="select-wrap">
                <select
                  name="gender"
                  value={gender}
                  onChange={(event) => setGender(event.target.value as Sex)}
                >
                  <option value="unknown">{localized(ADVICE_FORM_COPY.preferNotToSay, lang)}</option>
                  <option value="female">{localized(ADVICE_FORM_COPY.female, lang)}</option>
                  <option value="male">{localized(ADVICE_FORM_COPY.male, lang)}</option>
                </select>
              </span>
            </label>

            <label className="field">
              <span className="field-label">
                <LocalizedText value={ADVICE_FORM_COPY.ageLabel} lang={lang} />
              </span>
              <span className="select-wrap">
                <select
                  name="age"
                  value={age === undefined ? '' : String(age)}
                  onChange={(event) => setAge(event.target.value === '' ? undefined : Number(event.target.value))}
                >
                  <option value="">{localized(ADVICE_FORM_COPY.preferNotToSay, lang)}</option>
                  <option value="10">{localized(ADVICE_FORM_COPY.under18, lang)}</option>
                  <option value="40">{localized(ADVICE_FORM_COPY.age18To64, lang)}</option>
                  <option value="70">{localized(ADVICE_FORM_COPY.age65AndOver, lang)}</option>
                </select>
              </span>
            </label>

            <div className="field">
              <label className="field-label" htmlFor="advice-question">
                <LocalizedText value={ADVICE_FORM_COPY.questionLabel} lang={lang} />
              </label>
              <textarea
                id="advice-question"
                className="notes-textarea"
                name="question"
                rows={6}
                required
                aria-invalid={questionTooLong}
                aria-describedby="advice-question-count"
                placeholder={localized(ADVICE_FORM_COPY.questionPlaceholder, lang)}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
              />
              <span
                id="advice-question-count"
                className="advice-character-count num"
                data-over-limit={questionTooLong || undefined}
              >
                {question.length} / {QUESTION_CHAR_LIMIT}
              </span>
            </div>

            <fieldset className="advice-language-field">
              <legend><LocalizedText value={ADVICE_FORM_COPY.answerLanguageLabel} lang={lang} /></legend>
              <input type="hidden" name="language_mode" value={languageMode} />
              <div className="lang-toggle">
                <button
                  type="button"
                  aria-pressed={languageMode === 'zh'}
                  onClick={() => setLanguageOverride('zh')}
                >
                  <LocalizedText value={ADVICE_FORM_COPY.chinese} lang={lang} />
                </button>
                <button
                  type="button"
                  aria-pressed={languageMode === 'en'}
                  onClick={() => setLanguageOverride('en')}
                >
                  <LocalizedText value={ADVICE_FORM_COPY.english} lang={lang} />
                </button>
              </div>
            </fieldset>

            <button className="btn btn-primary btn-block" type="submit" disabled={!canSubmit}>
              <LocalizedText value={ADVICE_FORM_COPY.submit} lang={lang} />
            </button>
          </form>
        )}

        {phase === 'loading' && (
          <section className="extracting advice-loading" aria-live="polite">
            <p className="reading">
              <span className="breath" aria-hidden />
              <LocalizedText value={ADVICE_FORM_COPY.loading} lang={lang} />
            </p>
            <AdviceSchoolSkeletons lang={lang} />
            <p className="extracting-note">
              <LocalizedText value={ADVICE_FORM_COPY.loadingNote} lang={lang} />
            </p>
          </section>
        )}

        {phase === 'result' && (
          <section className="advice-result-slot" data-testid="advice-result-slot">
            <div className="advice-banner-slot" role="alert">
              <h2><LocalizedText value={ADVICE_UNAVAILABLE_COPY.heading} lang={lang} /></h2>
              <p><LocalizedText value={ADVICE_UNAVAILABLE_COPY.body} lang={lang} /></p>
            </div>
          </section>
        )}
      </AdviceFrame>
    </main>
  );
}
