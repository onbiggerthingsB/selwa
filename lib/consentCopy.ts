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
    en: reviewed('Your photo — including any names, values, hospital details or notes shown on it — is sent to Anthropic (a US company) so its text can be read. Text you enter under “What the doctor told you” stays on this device and is not translated.'),
    zh: reviewed('您的照片（包括其中的姓名、数值、医院信息或说明）会发送给美国公司 Anthropic，用于识别文字。您在“医生说了什么”中输入的文字仅保留在本设备上，不会被翻译。'),
    bo: fallback('zh'),
  }),
  onDeviceDisclosure: defineText({
    en: reviewed('The meaning of your results is worked out on this device. We don’t save your photo or typed notes on our servers, and neither is used for advertising. Anthropic does not use the photo to train its models, though it may hold it briefly (up to 30 days) for safety checks.'),
    zh: reviewed('结果的含义在本设备上计算。照片和输入的说明都不会保存在我们的服务器上，也不会用于广告。Anthropic 不会用照片训练模型，但可能为安全检查短暂保留（最多 30 天）。'),
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
