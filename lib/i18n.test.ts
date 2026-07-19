import { describe, expect, it } from 'vitest';
import {
  LANGS,
  LANGUAGE_CONFIG,
  defineText,
  fallback,
  resolvePrimarySecondary,
  resolveText,
  reviewed,
  unverified,
} from '@/lib/i18n';

const COPY = defineText({
  en: reviewed('English bytes stay exactly the same.'),
  zh: reviewed('中文字符串保持完全不变。'),
  bo: fallback('zh'),
});

describe('localized text', () => {
  it('defines all three supported languages and the explicit Chinese fallback for bo', () => {
    expect(LANGS).toEqual(['en', 'zh', 'bo']);
    expect(LANGUAGE_CONFIG.bo).toEqual({ fallback: 'zh', secondary: 'en' });
  });

  it('returns English and Chinese text byte-for-byte', () => {
    expect(resolveText(COPY, 'en').text).toBe('English bytes stay exactly the same.');
    expect(resolveText(COPY, 'zh').text).toBe('中文字符串保持完全不变。');
  });

  it('resolves bo through its explicit Chinese fallback', () => {
    expect(resolveText(COPY, 'bo')).toEqual({
      text: '中文字符串保持完全不变。',
      requestedLang: 'bo',
      resolvedLang: 'zh',
      review: 'unverified',
      usedFallback: true,
      path: ['bo', 'zh'],
    });
  });

  it('defaults an unmarked direct string to unverified', () => {
    const copy = defineText({
      en: { text: 'Not marked' },
      zh: reviewed('已审核'),
      bo: fallback('zh'),
    });

    expect(resolveText(copy, 'en').review).toBe('unverified');
    expect(resolveText(copy, 'zh').review).toBe('reviewed');
  });

  it('supports an explicit unverified marker', () => {
    const copy = defineText({
      en: unverified('Machine output'),
      zh: reviewed('已审核'),
      bo: fallback('zh'),
    });

    expect(resolveText(copy, 'en').review).toBe('unverified');
  });

  it('fails loudly and finitely on a fallback cycle', () => {
    const cycle = defineText({
      en: fallback('zh'),
      zh: fallback('en'),
      bo: fallback('zh'),
    });

    expect(() => resolveText(cycle, 'bo')).toThrow(
      'Localized text fallback cycle: bo -> zh -> en -> zh',
    );
  });

  it('resolves configured primary and secondary languages without binary call-site logic', () => {
    const en = resolvePrimarySecondary(COPY, 'en');
    expect(en.primary.text).toBe('English bytes stay exactly the same.');
    expect(en.secondary.text).toBe('中文字符串保持完全不变。');

    const bo = resolvePrimarySecondary(COPY, 'bo');
    expect(bo.primary.resolvedLang).toBe('zh');
    expect(bo.primary.usedFallback).toBe(true);
    expect(bo.secondary.resolvedLang).toBe('en');
  });

  it('requires every supported language at compile time', () => {
    // @ts-expect-error bo is required; missing locales cannot silently fall back.
    const incomplete = defineText({
      en: reviewed('English'),
      zh: reviewed('中文'),
    });
    expect(incomplete).toBeDefined();
  });
});
