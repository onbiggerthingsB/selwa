import {
  defineText,
  fallback,
  resolveText,
  reviewed,
  type Lang,
  type LocalizedText,
} from '@/lib/i18n';

// The first entry is the warm "lead" sentence; the rest are quieter supporting points.
export const DISCLAIMER_TEXTS: readonly LocalizedText[] = [
  defineText({
    en: reviewed('This app helps you understand your report in your own language. It is not medical advice and can’t replace your doctor — when something looks important, your clinician is the right person to ask.'),
    zh: reviewed('本应用帮助您用自己的语言理解化验单。它不是医疗建议，也不能替代您的医生——当某项结果看起来重要时，请向您的医生咨询。'),
    bo: fallback('zh'),
  }),
  defineText({
    en: reviewed('We translate and explain what your report says — including the reference ranges printed on it — but we don’t decide whether your values are normal or abnormal. Interpreting your results is your clinician’s role.'),
    zh: reviewed('我们翻译并解释您报告上的内容（包括报告自带的参考范围），但不会判断您的数值是否正常或异常。解读结果是医生的职责。'),
    bo: fallback('zh'),
  }),
  defineText({
    en: reviewed('We read your report with automatic photo recognition, which can misread a digit, a decimal point, or a unit. Please check the values against your original report.'),
    zh: reviewed('我们使用自动图像识别读取您的报告，可能读错数字、小数点或单位。请将显示的数值与您的原始报告核对。'),
    bo: fallback('zh'),
  }),
  defineText({
    en: reviewed('Anything marked “confirm with your clinician” is high-stakes or uncertain. Verify the exact values and meaning with your doctor, nurse, or pharmacist.'),
    zh: reviewed('凡标注"请与医生确认"的项目，都属于高风险或存在不确定性。请向您的医生、护士或药师核实具体数值与含义。'),
    bo: fallback('zh'),
  }),
  defineText({
    en: reviewed('This is an educational comprehension aid, not a medical device, and has not been reviewed by any regulator.'),
    zh: reviewed('本应用是帮助理解的科普工具，不是医疗器械，未经任何监管机构审核。'),
    bo: fallback('zh'),
  }),
];

export const DISCLAIMERS_EN: string[] = DISCLAIMER_TEXTS.map(
  (text) => resolveText(text, 'en').text,
);

export const DISCLAIMERS_ZH: string[] = DISCLAIMER_TEXTS.map(
  (text) => resolveText(text, 'zh').text,
);

export function disclaimers(lang: Lang): string[] {
  return DISCLAIMER_TEXTS.map((text) => resolveText(text, lang).text);
}
