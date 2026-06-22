export const DISCLAIMERS_EN: string[] = [
  'Not medical advice: this summary helps you understand your report in plain language. It is not a diagnosis or treatment recommendation. Always confirm with your clinician before making any health decision.',
  'Not a medical device: this app is an educational comprehension aid, not a medical device, and has not been reviewed by any regulator. It can make mistakes, including misreading numbers.',
  'We may misread your report: we use automatic photo reading (OCR), which can misread digits, decimal points, and units. Please check the values we show against your original report.',
  'Confirm flagged items: items marked “confirm with your clinician” are high-stakes or uncertain. Verify exact values and meaning with your doctor, nurse, or pharmacist.',
];

export const DISCLAIMERS_ZH: string[] = [
  '本工具不提供医疗建议：本摘要旨在用通俗语言帮助您理解您的报告，并非诊断或治疗建议。在做出任何健康决定之前，请务必与您的医生确认。',
  '本工具不是医疗器械：本应用是帮助理解的科普辅助工具，不是医疗器械，未经任何监管机构审核。它可能会出错，包括读错数字。',
  '我们可能读错您的报告：本工具使用自动图像识别（OCR），可能读错数字、小数点和单位。请将我们显示的数值与您的原始报告核对。',
  '请确认被标注的项目：标注“请与医生确认”的项目属于高风险或存在不确定性。请向您的医生、护士或药师核实具体数值与含义。',
];

export function disclaimers(lang: 'en' | 'zh'): string[] {
  return lang === 'zh' ? DISCLAIMERS_ZH : DISCLAIMERS_EN;
}
