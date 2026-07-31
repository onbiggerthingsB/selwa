import { defineText, fallback, reviewed, type LocalizedText } from '@/lib/i18n';

export const UI_COPY = {
  resultEyebrow: defineText({
    en: reviewed('Your results'),
    zh: reviewed('您的结果'),
    bo: fallback('zh'),
  }),
  labReport: defineText({
    en: reviewed('Lab report'),
    zh: reviewed('化验单'),
    bo: fallback('zh'),
  }),
  language: defineText({
    en: reviewed('Language'),
    zh: reviewed('语言'),
    bo: fallback('zh'),
  }),
  tibetanUnavailable: defineText({
    en: reviewed('Tibetan is not yet available; Chinese content is shown for now.'),
    zh: reviewed('藏语暂不可用；目前显示中文内容。'),
    bo: fallback('zh'),
  }),
  typographySample: defineText({
    en: reviewed('Tibetan font rendering sample'),
    zh: reviewed('藏文字体显示样例'),
    bo: fallback('zh'),
  }),

  // COMPLETENESS GATE copy (see components/RowManifest.tsx). Deliberately says "paper report",
  // never "photo": we do not keep the photo, so the only thing the user can check against is the
  // page in their hand. The wording must not imply we can tell whether something is missing —
  // we cannot; that is exactly why we are asking.
  manifestEyebrow: defineText({
    en: reviewed('Check the list'),
    zh: reviewed('核对清单'),
    bo: fallback('zh'),
  }),
  manifestCountLabel: defineText({
    en: reviewed('results read from your photo'),
    zh: reviewed('项结果读自您的照片'),
    bo: fallback('zh'),
  }),
  manifestHelp: defineText({
    en: reviewed('Please compare this list with your paper report. We can only explain the results we read — if any are missing, take the photo again.'),
    zh: reviewed('请将此清单与您的纸质报告核对。我们只能解读已读取到的结果——如有遗漏，请重新拍照。'),
    bo: fallback('zh'),
  }),
  manifestConfirmCta: defineText({
    en: reviewed('Yes, they are all here'),
    zh: reviewed('是，全部都在'),
    bo: fallback('zh'),
  }),
  manifestMissingCta: defineText({
    en: reviewed('Something is missing — retake photo'),
    zh: reviewed('有遗漏——重新拍照'),
    bo: fallback('zh'),
  }),

  confirmEyebrow: defineText({
    en: reviewed('One quick step'),
    zh: reviewed('快速一步'),
    bo: fallback('zh'),
  }),
  confirmHeading: defineText({
    en: reviewed('Please check these readings'),
    zh: reviewed('请核对这些结果'),
    bo: fallback('zh'),
  }),
  confirmHelp: defineText({
    en: reviewed('Let’s double-check a few results from your photo. Please confirm the result, the unit and the range below all match your report exactly.'),
    zh: reviewed('让我们核对照片中的几项结果。请确认下面的结果、单位和范围都与您的报告完全一致。'),
    bo: fallback('zh'),
  }),
  result: defineText({
    en: reviewed('result'),
    zh: reviewed('结果'),
    bo: fallback('zh'),
  }),
  unit: defineText({
    en: reviewed('unit'),
    zh: reviewed('单位'),
    bo: fallback('zh'),
  }),
  qualitativeHint: defineText({
    en: reviewed('Check the result text and symbols exactly as printed.'),
    zh: reviewed('请逐字核对报告上打印的结果和符号。'),
    bo: fallback('zh'),
  }),
  decimalHint: defineText({
    en: reviewed('Check the decimal point (e.g. 7.0, not 70).'),
    zh: reviewed('请核对小数点（例如 7.0，而不是 70）。'),
    bo: fallback('zh'),
  }),
  confirmContinue: defineText({
    en: reviewed('Confirm and continue'),
    zh: reviewed('确认并继续'),
    bo: fallback('zh'),
  }),

  saved: defineText({
    en: reviewed('Saved'),
    zh: reviewed('已保存'),
    bo: fallback('zh'),
  }),
  saveOnDevice: defineText({
    en: reviewed('Keep this report on my device'),
    zh: reviewed('保存到本机'),
    bo: fallback('zh'),
  }),
  savedReports: defineText({
    en: reviewed('Saved reports'),
    zh: reviewed('已保存的报告'),
    bo: fallback('zh'),
  }),
  valuesOnDevice: defineText({
    en: reviewed('values · on this device'),
    zh: reviewed('项 · 保存在本机'),
    bo: fallback('zh'),
  }),
  delete: defineText({
    en: reviewed('Delete'),
    zh: reviewed('删除'),
    bo: fallback('zh'),
  }),

  reportRange: defineText({
    en: reviewed('Your report’s range '),
    zh: reviewed('报告所列范围 '),
    bo: fallback('zh'),
  }),
  typicalRange: defineText({
    en: reviewed('Typical range, varies by lab '),
    zh: reviewed('一般范围（各实验室不同） '),
    bo: fallback('zh'),
  }),
  source: defineText({
    en: reviewed('Source: '),
    zh: reviewed('来源：'),
    bo: fallback('zh'),
  }),
  aboutSummary: defineText({
    en: reviewed('About this summary'),
    zh: reviewed('关于本摘要'),
    bo: fallback('zh'),
  }),

  doctorNotes: defineText({
    en: reviewed("What the doctor told you"),
    zh: reviewed('医生说了什么'),
    bo: fallback('zh'),
  }),
  doctorNotesSummary: defineText({
    en: reviewed('In plain words. Numbers, doses, and key terms are kept exactly as written.'),
    zh: reviewed('用大白话解释。数字、剂量和关键术语均保持原文不变。'),
    bo: fallback('zh'),
  }),
  keptExactly: defineText({
    en: reviewed('Kept exactly as written'),
    zh: reviewed('保持原文不变'),
    bo: fallback('zh'),
  }),
} as const satisfies Record<string, LocalizedText>;
