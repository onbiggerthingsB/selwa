import { defineText, fallback, reviewed } from '@/lib/i18n';

export const CONSENT_COPY = {
  dialogLabel: defineText({
    en: reviewed('Before we read your report'),
    // RESOLVED 2026-08-29 (open since 2026-07-21). This slot used to hold the ENGLISH string
    // registered as reviewed Chinese, so a zh or bo user's screen reader announced the dialog in
    // English. The truthful encoding (zh: fallback('en')) was rejected then because it resolves
    // bo→zh→en and breaks the product-wide "every bo string falls back to Chinese" invariant in
    // lib/directBoAudit.test.ts. The actual fix was always to supply reviewed Chinese, which the
    // old comment named: the heading's own 在读取您的化验单之前. Matching the visible heading is
    // correct for an accessible name, not a compromise.
    //
    // It stopped being cosmetic when the Tibetan packet shipped: A6 (target must contain Tibetan
    // script) and B4 (Latin token multisets) now BOTH refuse this row, so the only cell the
    // importer accepted was the English typed straight back — English in, English out, into the
    // bo slot. See lib/tibetanWellFormedness.ts A6.
    zh: reviewed('在读取您的化验单之前'),
    bo: fallback('zh'),
  }),
  heading: defineText({
    en: reviewed('Before we read your report'),
    zh: reviewed('在读取您的化验单之前'),
    bo: fallback('zh'),
  }),
  transferDisclosure: defineText({
    en: reviewed('Two things are sent to Anthropic (a US company): your photo — including any name, values, or hospital shown on it — so its text can be read; and anything you typed under “What the doctor told you”, so it can be translated.'),
    zh: reviewed('有两项内容会发送给美国公司 Anthropic：您的照片（包括其中的姓名、数值或医院信息），用于识别其中的文字；以及您在“医生说了什么”中输入的内容，用于翻译。'),
    bo: fallback('zh'),
  }),
  onDeviceDisclosure: defineText({
    en: reviewed('The meaning of your results is worked out on this device. We don’t save either on our servers, and neither is ever used for advertising. Anthropic does not use them to train its models, though it may hold them briefly (up to 30 days) for safety checks.'),
    zh: reviewed('结果的含义在本设备上计算。两者都不会保存在我们的服务器上，也绝不用于广告。Anthropic 不会用它们训练模型，但可能为安全检查短暂保留（最多 30 天）。'),
    bo: fallback('zh'),
  }),
  agree: defineText({
    en: reviewed('I agree — read my report'),
    zh: reviewed('我同意，读取报告'),
    bo: fallback('zh'),
  }),
  back: defineText({
    en: reviewed('Back'),
    zh: reviewed('返回'),
    bo: fallback('zh'),
  }),
} as const;
