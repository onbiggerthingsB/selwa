'use client';

import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';
import { LocalizedText } from '@/components/LocalizedText';
import {
  ADVICE_BANNER_COPY,
  ADVICE_CONSENT_COPY,
  ADVICE_DISCLAIMERS,
  ADVICE_ENTRY_COPY,
  ADVICE_ERROR_COPY,
  ADVICE_FORM_COPY,
  ADVICE_REFERRAL,
  ADVICE_REFUSAL_COPY,
  ADVICE_SCHOOL_COPY,
} from '@/lib/adviceCopy';
import {
  ADVICE_CONSENT_VERSION,
  grantAdviceConsent,
  hasAdviceConsent,
  revokeAdviceConsent,
} from '@/lib/adviceConsent';
import { ADVICE_CONSENT_HEADER } from '@/lib/consentGate';
import type {
  AdviceBannerId,
  AdviceRefusalReason,
  AdviceResult,
  AdviceSchoolId,
  SchoolAdvice,
} from '@/lib/adviceGuard';
import {
  resolveText,
  type Lang,
  type LocalizedText as LocalizedTextValue,
} from '@/lib/i18n';
import { useLangPreference } from '@/lib/langPreference';
import type { Sex } from '@/lib/types';
import { UI_COPY } from '@/lib/uiCopy';

type Phase = 'form' | 'consent' | 'asking' | 'result' | 'error';
type AdviceLanguageMode = 'en' | 'zh';
type FailureCause =
  | 'rate-limited'
  | 'too-long'
  | 'could-not-answer'
  | 'unavailable';
type FailureLogCause = FailureCause | 'consent';

interface AdviceFailure {
  status: number | null;
  cause: FailureCause;
}

// Keep Zod and the model-output schema out of the client bundle. The page test
// locks this value to MAX_ADVICE_QUESTION_CHARS from lib/adviceSchema.ts.
const QUESTION_CHAR_LIMIT = 2000;
const SCHOOL_ORDER = [
  'tcm',
  'tibetan',
  'western',
] as const satisfies readonly AdviceSchoolId[];
const BANNER_IDS = [
  'emergency',
  'emergency-self-harm',
  'see-doctor',
] as const satisfies readonly AdviceBannerId[];
const REFUSAL_REASONS = [
  'dosing',
  'tibetan-output',
  'emergency-only',
  'out-of-scope',
] as const satisfies readonly AdviceRefusalReason[];

const BANNER_COPY_BY_ID = {
  emergency: ADVICE_BANNER_COPY.emergency,
  'emergency-self-harm': ADVICE_BANNER_COPY['emergency-self-harm'],
  'see-doctor': ADVICE_BANNER_COPY['see-doctor'],
} as const satisfies Record<AdviceBannerId, LocalizedTextValue>;

type DisplayableRefusal = Exclude<AdviceRefusalReason, 'emergency-only'>;
const REFUSAL_COPY_BY_REASON = {
  dosing: ADVICE_REFUSAL_COPY.dosing,
  'tibetan-output': ADVICE_REFUSAL_COPY['tibetan-output'],
  'out-of-scope': ADVICE_REFUSAL_COPY['out-of-scope'],
} as const satisfies Record<DisplayableRefusal, LocalizedTextValue>;

const FAILURE_COPY_BY_CAUSE = ADVICE_ERROR_COPY satisfies Record<
  FailureCause,
  Readonly<{ message: LocalizedTextValue; action: LocalizedTextValue }>
>;

function localized(value: LocalizedTextValue, lang: Lang): string {
  return resolveText(value, lang).text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSchoolAdvice(value: unknown): value is SchoolAdvice {
  return (
    isRecord(value) &&
    Array.isArray(value.suggestions) &&
    value.suggestions.length > 0 &&
    value.suggestions.every((suggestion) => typeof suggestion === 'string') &&
    typeof value.seekCare === 'string'
  );
}

function isAdviceResult(value: unknown): value is AdviceResult {
  if (!isRecord(value)) return false;
  if (
    value.presentation !== 'normal' &&
    value.presentation !== 'banner' &&
    value.presentation !== 'blocked'
  ) {
    return false;
  }
  if (
    !Array.isArray(value.banners) ||
    !value.banners.every(
      (banner): banner is AdviceBannerId =>
        typeof banner === 'string' &&
        BANNER_IDS.includes(banner as AdviceBannerId),
    )
  ) {
    return false;
  }
  if (
    value.refused !== null &&
    (typeof value.refused !== 'string' ||
      !REFUSAL_REASONS.includes(value.refused as AdviceRefusalReason))
  ) {
    return false;
  }

  if (value.presentation === 'blocked') {
    return value.refused !== null && value.schools === undefined;
  }

  if (value.refused !== null) return false;

  return (
    isRecord(value.schools) &&
    isSchoolAdvice(value.schools.tcm) &&
    isSchoolAdvice(value.schools.tibetan) &&
    isSchoolAdvice(value.schools.western)
  );
}

function resultFromPayload(payload: unknown): AdviceResult | null {
  if (!isRecord(payload) || !isAdviceResult(payload.data)) return null;
  return payload.data;
}

function failureCauseForStatus(status: number): FailureCause {
  if (status === 429) return 'rate-limited';
  if (status === 413) return 'too-long';
  if (status === 422) return 'could-not-answer';
  if (status >= 500) return 'unavailable';
  return 'could-not-answer';
}

function logFailure(status: number | null, cause: FailureLogCause): void {
  // Never log the question, response body, caught error, headers, or model prose.
  console.error('advice request failed', { status, cause });
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
            <h2>
              <LocalizedText value={copy.label} lang={lang} />
            </h2>
            <p>
              <LocalizedText value={copy.subtitle} lang={lang} />
            </p>
            <div className="skel-card" aria-hidden />
          </article>
        );
      })}
    </div>
  );
}

function AdviceSchools({
  result,
  lang,
  answerLanguage,
}: {
  result: AdviceResult;
  lang: Lang;
  answerLanguage: AdviceLanguageMode;
}) {
  if (result.presentation === 'blocked' || !result.schools) return null;

  return (
    <div className="advice-school-grid" data-testid="advice-schools">
      {SCHOOL_ORDER.map((school) => {
        const copy = ADVICE_SCHOOL_COPY[school];
        const advice = result.schools?.[school];
        if (!advice) return null;

        return (
          <article className="advice-school-card" data-school={school} key={school}>
            <h2>
              <LocalizedText value={copy.label} lang={lang} />
            </h2>
            <p>
              <LocalizedText value={copy.subtitle} lang={lang} />
            </p>
            <ul>
              {advice.suggestions.map((suggestion, index) => (
                <li key={index} lang={answerLanguage}>
                  {suggestion}
                </li>
              ))}
            </ul>
            <p className="advice-seek-care" lang={answerLanguage}>
              {advice.seekCare}
            </p>
          </article>
        );
      })}
    </div>
  );
}

function AdviceResultView({
  result,
  lang,
  answerLanguage,
}: {
  result: AdviceResult;
  lang: Lang;
  answerLanguage: AdviceLanguageMode;
}) {
  const refusalCopy =
    result.refused && result.refused !== 'emergency-only'
      ? REFUSAL_COPY_BY_REASON[result.refused]
      : null;

  return (
    <section className="advice-result-slot" data-testid="advice-result-slot">
      {result.banners.length > 0 && (
        <div className="advice-banner-slot" role="alert" data-testid="advice-banner-slot">
          {result.banners.map((banner) => (
            <p key={banner} data-banner-id={banner}>
              <LocalizedText value={BANNER_COPY_BY_ID[banner]} lang={lang} />
            </p>
          ))}
        </div>
      )}

      {refusalCopy && (
        <div className="callout-error" data-testid="advice-refusal">
          <p>
            <LocalizedText value={refusalCopy} lang={lang} />
          </p>
        </div>
      )}

      <AdviceSchools
        result={result}
        lang={lang}
        answerLanguage={answerLanguage}
      />
    </section>
  );
}

export default function AdvicePage() {
  const [lang, setLang] = useLangPreference();
  const [phase, setPhase] = useState<Phase>('form');
  const [gender, setGender] = useState<Sex>('unknown');
  const [age, setAge] = useState<number | undefined>(undefined);
  const [question, setQuestion] = useState('');
  const [languageOverride, setLanguageOverride] =
    useState<AdviceLanguageMode | null>(null);
  const [result, setResult] = useState<AdviceResult | null>(null);
  const [resultLanguageMode, setResultLanguageMode] =
    useState<AdviceLanguageMode | null>(null);
  const [failure, setFailure] = useState<AdviceFailure | null>(null);
  const languageMode: AdviceLanguageMode =
    languageOverride ?? (lang === 'en' ? 'en' : 'zh');
  const trimmedQuestion = question.trim();
  const questionTooLong = question.length > QUESTION_CHAR_LIMIT;
  const canSubmit = trimmedQuestion.length > 0 && !questionTooLong;
  const consentDialogLabel = resolveText(
    ADVICE_CONSENT_COPY.dialogLabel,
    lang,
  );
  const failurePresentation = failure
    ? FAILURE_COPY_BY_CAUSE[failure.cause]
    : null;

  function setRequestFailure(
    status: number | null,
    cause: FailureCause,
  ): void {
    logFailure(status, cause);
    setFailure({ status, cause });
    setPhase('error');
  }

  async function submit(event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault();
    if (!canSubmit) return;

    if (!hasAdviceConsent()) {
      setPhase('consent');
      return;
    }

    const requestedLanguageMode = languageMode;
    setResult(null);
    setResultLanguageMode(null);
    setFailure(null);
    setPhase('asking');

    let responseStatus: number | null = null;
    try {
      const response = await fetch('/api/advice', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [ADVICE_CONSENT_HEADER]: String(ADVICE_CONSENT_VERSION),
        },
        body: JSON.stringify({
          gender,
          ...(age === undefined ? {} : { age }),
          question,
          languageMode: requestedLanguageMode,
        }),
      });
      responseStatus = response.status;

      if (!response.ok) {
        if (response.status === 403) {
          logFailure(response.status, 'consent');
          revokeAdviceConsent();
          setPhase('consent');
          return;
        }
        setRequestFailure(
          response.status,
          failureCauseForStatus(response.status),
        );
        return;
      }

      const parsedResult = resultFromPayload(await response.json());
      if (!parsedResult) {
        setRequestFailure(response.status, 'could-not-answer');
        return;
      }

      setResult(parsedResult);
      setResultLanguageMode(requestedLanguageMode);
      setPhase('result');
    } catch {
      setRequestFailure(
        responseStatus,
        responseStatus === null ? 'unavailable' : 'could-not-answer',
      );
    }
  }

  function handleFailureAction(): void {
    if (!failure) return;
    if (failure.cause === 'too-long') {
      setPhase('form');
      return;
    }
    void submit();
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
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
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
          <button
            type="button"
            aria-pressed={lang === 'en'}
            onClick={() => setLang('en')}
          >
            EN
          </button>
          <button
            type="button"
            aria-pressed={lang === 'zh'}
            onClick={() => setLang('zh')}
          >
            中文
          </button>
          <button
            type="button"
            aria-pressed={lang === 'bo'}
            onClick={() => setLang('bo')}
          >
            TB
          </button>
        </div>
      </header>

      {lang === 'bo' && (
        <aside
          className="tibetan-availability"
          data-testid="advice-tibetan-availability"
        >
          <p>
            <LocalizedText
              value={ADVICE_FORM_COPY.tibetanAnswerLanguages}
              lang={lang}
            />
          </p>
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
                  <option value="unknown">
                    {localized(ADVICE_FORM_COPY.preferNotToSay, lang)}
                  </option>
                  <option value="female">
                    {localized(ADVICE_FORM_COPY.female, lang)}
                  </option>
                  <option value="male">
                    {localized(ADVICE_FORM_COPY.male, lang)}
                  </option>
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
                  onChange={(event) =>
                    setAge(
                      event.target.value === ''
                        ? undefined
                        : Number(event.target.value),
                    )
                  }
                >
                  <option value="">
                    {localized(ADVICE_FORM_COPY.preferNotToSay, lang)}
                  </option>
                  <option value="10">
                    {localized(ADVICE_FORM_COPY.under18, lang)}
                  </option>
                  <option value="40">
                    {localized(ADVICE_FORM_COPY.age18To64, lang)}
                  </option>
                  <option value="70">
                    {localized(ADVICE_FORM_COPY.age65AndOver, lang)}
                  </option>
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
                placeholder={localized(
                  ADVICE_FORM_COPY.questionPlaceholder,
                  lang,
                )}
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
              <legend>
                <LocalizedText
                  value={ADVICE_FORM_COPY.answerLanguageLabel}
                  lang={lang}
                />
              </legend>
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

            <button
              className="btn btn-primary btn-block"
              type="submit"
              disabled={!canSubmit}
            >
              <LocalizedText value={ADVICE_FORM_COPY.submit} lang={lang} />
            </button>
          </form>
        )}

        {phase === 'consent' && (
          <div
            className="callout-error"
            role="dialog"
            aria-label={consentDialogLabel.text}
            {...(lang === 'bo'
              ? {
                  'data-requested-lang': lang,
                  'data-resolved-lang': consentDialogLabel.resolvedLang,
                }
              : {})}
          >
            <div className="err-row">
              <span>
                <LocalizedText value={ADVICE_CONSENT_COPY.heading} lang={lang} />
              </span>
            </div>
            <ul className="quality-tips">
              <li>
                <LocalizedText value={ADVICE_CONSENT_COPY.body1} lang={lang} />
              </li>
              <li>
                <LocalizedText value={ADVICE_CONSENT_COPY.body2} lang={lang} />
              </li>
              <li>
                <LocalizedText value={ADVICE_CONSENT_COPY.body3} lang={lang} />
              </li>
            </ul>
            <button
              className="btn btn-primary btn-block"
              type="button"
              onClick={() => {
                grantAdviceConsent();
                void submit();
              }}
            >
              <LocalizedText value={ADVICE_CONSENT_COPY.agree} lang={lang} />
            </button>
            <button
              className="btn btn-ghost btn-block"
              type="button"
              onClick={() => setPhase('form')}
            >
              <LocalizedText value={ADVICE_CONSENT_COPY.back} lang={lang} />
            </button>
          </div>
        )}

        {phase === 'asking' && (
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

        {phase === 'result' && result && (
          <AdviceResultView
            result={result}
            lang={lang}
            answerLanguage={resultLanguageMode ?? languageMode}
          />
        )}

        {phase === 'error' && failure && failurePresentation && (
          <div className="callout-error" role="alert" data-testid="advice-error">
            <div className="err-row">
              <span>
                <LocalizedText value={failurePresentation.message} lang={lang} />
              </span>
            </div>
            <button
              className="btn btn-primary btn-block"
              type="button"
              onClick={handleFailureAction}
            >
              <LocalizedText value={failurePresentation.action} lang={lang} />
            </button>
          </div>
        )}
      </AdviceFrame>
    </main>
  );
}
