import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { REFERENCE_LABS } from '@/data/reference-labs';
import { disclaimers } from '@/lib/disclaimers';
import { resolveText, type Lang } from '@/lib/i18n';
import { UI_COPY } from '@/lib/uiCopy';

// Captured from clean pre-refactor HEAD 9c5100a85565bba784bac2ff488bd28a6e2720bb.
// Hash input is JSON.stringify's UTF-8 bytes with the property order below and no trailing LF.
// Rebaselined 2026-07-26 for the eight body-measurement entries. zh and bo remain BYTE-IDENTICAL,
// which is the invariant this lock exists for: bo still falls back to zh for every reference string,
// i.e. no unreviewed Tibetan entered the table.
const REFERENCE_BASELINE = {
  count: 125,
  en: '227120d7a4e4a596d22a8a12fdd9084ab7fda15490f76d79e4acd0175f116ee7',
  zh: 'd36429a82da7e3b367afa70a9011fad1d92a05cb0c8c951a17c9636354c54685',
  bo: 'd36429a82da7e3b367afa70a9011fad1d92a05cb0c8c951a17c9636354c54685',
} as const;

const DISCLAIMER_KEYS = [
  'lead',
  'scope',
  'photo-recognition',
  'clinician-confirm',
  'regulatory-status',
] as const;

const DISCLAIMER_BASELINE = {
  count: DISCLAIMER_KEYS.length,
  en: '6798d22c617d764288e7573731914552e1adaf886a212d650db9ca7ba20a80a4',
  zh: '26b37ac41f7ab7ca787474a8f0bd549f24937226f475fa873e7dffb3f0ccde4b',
  bo: '26b37ac41f7ab7ca787474a8f0bd549f24937226f475fa873e7dffb3f0ccde4b',
} as const;

// Exact pre-refactor strings from the four former t(en, zh) helpers plus the
// binary SummaryView/NotesSection branches. New bo-only scaffolding copy is
// intentionally absent from this legacy-output lock.
const LEGACY_UI_COPY = {
  resultEyebrow: { en: 'Your results', zh: '您的结果' },
  labReport: { en: 'Lab report', zh: '化验单' },
  language: { en: 'Language', zh: '语言' },
  confirmEyebrow: { en: 'One quick step', zh: '快速一步' },
  confirmHeading: { en: 'Please check these readings', zh: '请核对这些结果' },
  confirmHelp: {
    en: 'Let’s double-check a few results from your photo. Please confirm each result and unit below matches your report exactly.',
    zh: '让我们核对照片中的几项结果。请确认下面每项结果和单位与您的报告完全一致。',
  },
  result: { en: 'result', zh: '结果' },
  unit: { en: 'unit', zh: '单位' },
  qualitativeHint: {
    en: 'Check the result text and symbols exactly as printed.',
    zh: '请逐字核对报告上打印的结果和符号。',
  },
  decimalHint: {
    en: 'Check the decimal point (e.g. 7.0, not 70).',
    zh: '请核对小数点（例如 7.0，而不是 70）。',
  },
  confirmContinue: { en: 'Confirm and continue', zh: '确认并继续' },
  saved: { en: 'Saved', zh: '已保存' },
  saveOnDevice: { en: 'Keep this report on my device', zh: '保存到本机' },
  savedReports: { en: 'Saved reports', zh: '已保存的报告' },
  valuesOnDevice: { en: 'values · on this device', zh: '项 · 保存在本机' },
  delete: { en: 'Delete', zh: '删除' },
  reportRange: { en: 'Your report’s range ', zh: '报告所列范围 ' },
  typicalRange: {
    en: 'Typical range, varies by lab ',
    zh: '一般范围（各实验室不同） ',
  },
  source: { en: 'Source: ', zh: '来源：' },
  aboutSummary: { en: 'About this summary', zh: '关于本摘要' },
  doctorNotes: { en: 'What the doctor told you', zh: '医生说了什么' },
  doctorNotesSummary: {
    en: 'In plain words. Numbers, doses, and key terms are kept exactly as written.',
    zh: '用大白话解释。数字、剂量和关键术语均保持原文不变。',
  },
  keptExactly: { en: 'Kept exactly as written', zh: '保持原文不变' },
} as const;

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function referenceText(lang: Lang) {
  return REFERENCE_LABS.map((entry) => ({
    // The clinical key is the stable semantic identity. A value moved between
    // analytes must fail this test even when the overall string set is unchanged.
    key: entry.key,
    name: resolveText(entry.name, lang).text,
    definition: resolveText(entry.definition, lang).text,
    plain: resolveText(entry.plain, lang).text,
  }));
}

function disclaimerText(lang: Lang) {
  const text = disclaimers(lang);
  expect(text).toHaveLength(DISCLAIMER_KEYS.length);
  return text.map((value, index) => ({
    key: DISCLAIMER_KEYS[index],
    text: value,
  }));
}

describe('pre-Tibetan EN/ZH localization baseline', () => {
  it.each(['en', 'zh', 'bo'] as const)(
    'keeps every %s reference name and explanation byte-identical by semantic key',
    (lang) => {
      expect(REFERENCE_LABS).toHaveLength(REFERENCE_BASELINE.count);
      expect(sha256(referenceText(lang))).toBe(REFERENCE_BASELINE[lang]);
    },
  );

  it.each(['en', 'zh', 'bo'] as const)(
    'keeps every %s disclaimer byte-identical by semantic key',
    (lang) => {
      expect(disclaimers(lang)).toHaveLength(DISCLAIMER_BASELINE.count);
      expect(sha256(disclaimerText(lang))).toBe(DISCLAIMER_BASELINE[lang]);
    },
  );

  it.each(['en', 'zh', 'bo'] as const)(
    'keeps every migrated %s UI string byte-identical by semantic key',
    (lang) => {
      const actual = Object.fromEntries(
        Object.keys(LEGACY_UI_COPY).map((key) => [
          key,
          resolveText(UI_COPY[key as keyof typeof LEGACY_UI_COPY], lang).text,
        ]),
      );
      const sourceLang = lang === 'bo' ? 'zh' : lang;
      const expected = Object.fromEntries(
        Object.entries(LEGACY_UI_COPY).map(([key, value]) => [key, value[sourceLang]]),
      );

      expect(actual).toEqual(expected);
    },
  );
});
