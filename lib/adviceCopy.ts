import {
  defineText,
  fallback,
  reviewed,
  type LocalizedText,
} from '@/lib/i18n';
import type { AdviceBannerId } from '@/lib/adviceGuard';

// VERIFY BEFORE RELEASE: these safety-critical hotline facts must be rechecked
// by the release owner at launch and on the project's recurring review cadence.
const MAINLAND_CHINA_EMERGENCY_NUMBER = '120';
const MAINLAND_CHINA_PSYCHOLOGICAL_ASSISTANCE_NUMBER = '12356';
const US_CANADA_CRISIS_NUMBER = '988';

export const ADVICE_HOTLINES = {
  mainlandChinaEmergency: MAINLAND_CHINA_EMERGENCY_NUMBER,
  mainlandChinaPsychologicalAssistance:
    MAINLAND_CHINA_PSYCHOLOGICAL_ASSISTANCE_NUMBER,
  usCanadaCrisis: US_CANADA_CRISIS_NUMBER,
} as const;

export const ADVICE_HOTLINE_VERIFICATION_ACKNOWLEDGEMENT =
  'VERIFY BEFORE RELEASE: owner must re-verify every advice hotline number.';

export const ADVICE_BANNER_COPY = {
  emergency: defineText({
    en: reviewed(
      'If this is happening to you or someone near you right now, get emergency help immediately — in mainland China call '
        + MAINLAND_CHINA_EMERGENCY_NUMBER
        + ' (ambulance); elsewhere call your local emergency number (for example 911 in the US). Do not wait for an answer on this page. Nothing below can replace emergency care.',
    ),
    zh: reviewed(
      '如果您或身边的人现在正出现这种情况，请立即寻求急救：中国大陆请拨打 '
        + MAINLAND_CHINA_EMERGENCY_NUMBER
        + '（急救电话），其他地区请拨打当地急救电话（如美国 911）。不要等待本页的回答。下方任何内容都不能替代急救。',
    ),
    bo: fallback('zh'),
  }),
  'emergency-self-harm': defineText({
    en: reviewed(
      'You deserve support right now. In mainland China you can call the national psychological assistance hotline '
        + MAINLAND_CHINA_PSYCHOLOGICAL_ASSISTANCE_NUMBER
        + '; in the US or Canada call or text '
        + US_CANADA_CRISIS_NUMBER
        + '; elsewhere contact your local crisis line or emergency number. If you are in immediate danger, call emergency services ('
        + MAINLAND_CHINA_EMERGENCY_NUMBER
        + ' in mainland China). This page cannot help with this — a person can.',
    ),
    zh: reviewed(
      '此刻您值得获得支持。中国大陆可拨打全国心理援助热线 '
        + MAINLAND_CHINA_PSYCHOLOGICAL_ASSISTANCE_NUMBER
        + '；美国或加拿大可拨打或发送短信至 '
        + US_CANADA_CRISIS_NUMBER
        + '；其他地区请联系当地心理危机热线或急救电话。如有即时危险，请拨打急救电话（中国大陆 '
        + MAINLAND_CHINA_EMERGENCY_NUMBER
        + '）。本页无法为此提供帮助——但真实的人可以。',
    ),
    bo: fallback('zh'),
  }),
  'see-doctor': defineText({
    en: reviewed(
      'Please discuss this question with a doctor or another qualified health professional, especially if symptoms continue or get worse.',
    ),
    zh: reviewed(
      '请就此问题咨询医生或其他合格的医疗专业人员，尤其是在症状持续或加重时。',
    ),
    bo: fallback('zh'),
  }),
} as const satisfies Record<AdviceBannerId, LocalizedText>;

export const ADVICE_REFUSAL_COPY = {
  dosing: defineText({
    en: reviewed(
      "We can't show this answer because it included specific medication or remedy amounts, which this app never provides. For any medicine — including herbal or traditional remedies — and how much or how often to take it, please ask a doctor or pharmacist.",
    ),
    zh: reviewed(
      '此回答包含具体的用药或用量信息，本应用一律不提供此类内容，因此无法显示。任何药物（包括中药、藏药等传统药物）的品种、用量和服用频次，请咨询医生或药师。',
    ),
    bo: fallback('zh'),
  }),
  'tibetan-output': defineText({
    en: reviewed(
      "We can't show this answer because it contained Tibetan-language text that this safety system cannot verify. Please ask again in Chinese or English.",
    ),
    zh: reviewed(
      '此回答包含本安全系统无法核验的藏文内容，因此无法显示。请使用中文或英文重新提问。',
    ),
    bo: fallback('zh'),
  }),
  'out-of-scope': defineText({
    en: reviewed(
      "We can't answer this here because this page is only for personal health questions. Please ask a question about your own health.",
    ),
    zh: reviewed(
      '此页面仅用于个人健康问题，因此无法回答当前问题。请提出与您本人健康有关的问题。',
    ),
    bo: fallback('zh'),
  }),
} as const satisfies Record<string, LocalizedText>;

export const ADVICE_ENTRY_COPY = {
  title: defineText({
    en: reviewed('Ask a health question'),
    zh: reviewed('咨询健康问题'),
    bo: fallback('zh'),
  }),
  subtitle: defineText({
    en: reviewed('General suggestions from Chinese, Tibetan, and Western medicine — not a diagnosis.'),
    zh: reviewed('来自中医、藏医、西医的一般性建议——不是诊断。'),
    bo: fallback('zh'),
  }),
} as const satisfies Record<string, LocalizedText>;

export const ADVICE_FORM_COPY = {
  homeLabel: defineText({
    en: reviewed('Back to home'),
    zh: reviewed('返回首页'),
    bo: fallback('zh'),
  }),
  genderLabel: defineText({
    en: reviewed('Gender'),
    zh: reviewed('性别'),
    bo: fallback('zh'),
  }),
  ageLabel: defineText({
    en: reviewed('Age'),
    zh: reviewed('年龄'),
    bo: fallback('zh'),
  }),
  questionLabel: defineText({
    en: reviewed('Your health question'),
    zh: reviewed('您的健康问题'),
    bo: fallback('zh'),
  }),
  questionPlaceholder: defineText({
    en: reviewed('Describe what is happening and what you would like to understand.'),
    zh: reviewed('请描述目前的情况，以及您想了解的问题。'),
    bo: fallback('zh'),
  }),
  answerLanguageLabel: defineText({
    en: reviewed('Answer language'),
    zh: reviewed('回答语言'),
    bo: fallback('zh'),
  }),
  preferNotToSay: defineText({
    en: reviewed('Prefer not to say · 不便透露'),
    zh: reviewed('Prefer not to say · 不便透露'),
    bo: fallback('zh'),
  }),
  female: defineText({
    en: reviewed('Female · 女'),
    zh: reviewed('Female · 女'),
    bo: fallback('zh'),
  }),
  male: defineText({
    en: reviewed('Male · 男'),
    zh: reviewed('Male · 男'),
    bo: fallback('zh'),
  }),
  under18: defineText({
    en: reviewed('Under 18 · 18 岁以下'),
    zh: reviewed('Under 18 · 18 岁以下'),
    bo: fallback('zh'),
  }),
  age18To64: defineText({
    en: reviewed('18–64 · 18–64 岁'),
    zh: reviewed('18–64 · 18–64 岁'),
    bo: fallback('zh'),
  }),
  age65AndOver: defineText({
    en: reviewed('65 and over · 65 岁及以上'),
    zh: reviewed('65 and over · 65 岁及以上'),
    bo: fallback('zh'),
  }),
  english: defineText({
    en: reviewed('English'),
    zh: reviewed('英文'),
    bo: fallback('zh'),
  }),
  chinese: defineText({
    en: reviewed('Chinese'),
    zh: reviewed('中文'),
    bo: fallback('zh'),
  }),
  submit: defineText({
    en: reviewed('Ask my question'),
    zh: reviewed('提交问题'),
    bo: fallback('zh'),
  }),
  loading: defineText({
    en: reviewed('Preparing your answer'),
    zh: reviewed('正在准备回答'),
    bo: fallback('zh'),
  }),
  loadingNote: defineText({
    en: reviewed('This can take a moment while the protected service prepares all three perspectives.'),
    zh: reviewed('安全回答服务正在准备三个医学视角的内容，请稍候。'),
    bo: fallback('zh'),
  }),
  tibetanAnswerLanguages: defineText({
    en: reviewed('Answers are available in Chinese and English only for now. Chinese is selected by default.'),
    zh: reviewed('目前回答仅提供中文和英文，默认选择中文。'),
    bo: fallback('zh'),
  }),
} as const satisfies Record<string, LocalizedText>;

export const ADVICE_UNAVAILABLE_COPY = {
  message: defineText({
    en: reviewed('The answer service is temporarily unavailable. Please try again later.'),
    zh: reviewed('回答服务暂时不可用。请稍后重试。'),
    bo: fallback('zh'),
  }),
  action: defineText({
    en: reviewed('Try again'),
    zh: reviewed('重试'),
    bo: fallback('zh'),
  }),
} as const satisfies Record<string, LocalizedText>;

export const ADVICE_CONSENT_COPY = {
  dialogLabel: defineText({
    en: reviewed('Before you ask'),
    zh: reviewed('在提问之前'),
    bo: fallback('zh'),
  }),
  heading: defineText({
    en: reviewed('Before you ask'),
    zh: reviewed('在提问之前'),
    bo: fallback('zh'),
  }),
  body1: defineText({
    en: reviewed(
      "This page gives health suggestions written by an AI (Anthropic's Claude), from three perspectives: Chinese medicine, Tibetan medicine, and Western medicine. They are general information and ideas to discuss with a professional — not a diagnosis, not a treatment plan, and not a substitute for seeing a doctor.",
    ),
    zh: reviewed(
      '本页面由 AI（Anthropic 的 Claude）从中医、藏医、西医三个视角给出健康建议。这些是一般性信息，供您与专业人员讨论——不是诊断，不是治疗方案，也不能替代就医。',
    ),
    bo: fallback('zh'),
  }),
  body2: defineText({
    en: reviewed(
      "Your question — including any health details you type in it — is sent to Anthropic (a US company) to generate the answer. We don't save your question on our servers, it is never used for advertising, and Anthropic does not use it to train its models, though it may hold it briefly (up to 30 days) for safety checks.",
    ),
    zh: reviewed(
      '您的提问（包括其中的健康信息）会发送给美国公司 Anthropic 以生成回答。我们不会将您的提问保存在服务器上，绝不用于广告；Anthropic 不会用它训练模型，但可能为安全检查短暂保留（最多 30 天）。',
    ),
    bo: fallback('zh'),
  }),
  body3: defineText({
    en: reviewed(
      "The AI can be wrong, even when it sounds confident, and no person reviews its answers before you see them. It will never tell you what medicine to take or how much. In an emergency, don't ask here — call "
        + MAINLAND_CHINA_EMERGENCY_NUMBER
        + ' (mainland China) or your local emergency number.',
    ),
    zh: reviewed(
      'AI 可能出错，即使听起来很有把握；回答在您看到之前没有经过人工审核。它绝不会告诉您该吃什么药、吃多少。遇到紧急情况请勿在此提问——请拨打 '
        + MAINLAND_CHINA_EMERGENCY_NUMBER
        + '（中国大陆）或当地急救电话。',
    ),
    bo: fallback('zh'),
  }),
  agree: defineText({
    en: reviewed('I understand — ask my question'),
    zh: reviewed('我已了解，开始提问'),
    bo: fallback('zh'),
  }),
  back: defineText({
    en: reviewed('Back'),
    zh: reviewed('返回'),
    bo: fallback('zh'),
  }),
} as const satisfies Record<string, LocalizedText>;

const ADVICE_RETRY_COPY = ADVICE_UNAVAILABLE_COPY.action;

export const ADVICE_ERROR_COPY = {
  'rate-limited': {
    message: defineText({
      en: reviewed('Too many questions have been sent from this network. Please wait before trying again.'),
      zh: reviewed('当前网络提交的问题过多。请稍后再试。'),
      bo: fallback('zh'),
    }),
    action: ADVICE_RETRY_COPY,
  },
  'too-long': {
    message: defineText({
      en: reviewed('This question is too long. Please shorten it before trying again.'),
      zh: reviewed('这个问题太长。请缩短后再试。'),
      bo: fallback('zh'),
    }),
    action: defineText({
      en: reviewed('Edit question'),
      zh: reviewed('修改问题'),
      bo: fallback('zh'),
    }),
  },
  'could-not-answer': {
    message: defineText({
      en: reviewed("We couldn't prepare an answer. Please try again."),
      zh: reviewed('我们无法生成回答。请重试。'),
      bo: fallback('zh'),
    }),
    action: ADVICE_RETRY_COPY,
  },
  unavailable: ADVICE_UNAVAILABLE_COPY,
} as const;

export const ADVICE_DISCLAIMERS = [
  defineText({
    en: reviewed('This page offers general health suggestions generated by AI, from three medical traditions. They are starting points to discuss with a professional — not a diagnosis or a treatment plan for you.'),
    zh: reviewed('本页面提供由 AI 生成的一般性健康建议，来自三种医学传统。它们是供您与专业人员讨论的参考，不是针对您个人的诊断或治疗方案。'),
    bo: fallback('zh'),
  }),
  defineText({
    en: reviewed('The AI can be wrong, even when it sounds confident. No person reviews these answers before you see them.'),
    zh: reviewed('AI 可能出错，即使听起来很有把握。回答在您看到之前没有经过人工审核。'),
    bo: fallback('zh'),
  }),
  defineText({
    en: reviewed('We never provide medication doses. For any medicine or remedy — including herbal and traditional ones — and how much to take, ask a doctor or pharmacist.'),
    zh: reviewed('我们一律不提供用药剂量。任何药物（包括中药、藏药等传统药物）的品种与用量，请咨询医生或药师。'),
    bo: fallback('zh'),
  }),
  defineText({
    en: reviewed('The Chinese-medicine and Tibetan-medicine perspectives reflect traditional practice, not modern clinical-trial evidence.'),
    zh: reviewed('中医与藏医视角反映的是传统实践，而非现代临床试验证据。'),
    bo: fallback('zh'),
  }),
  defineText({
    en: reviewed(
      "If symptoms are severe or getting worse quickly, don't wait for an answer here — in mainland China call "
        + MAINLAND_CHINA_EMERGENCY_NUMBER
        + '; elsewhere call your local emergency number.',
    ),
    zh: reviewed(
      '如症状严重或迅速加重，请不要等待本页回答——中国大陆请拨打 '
        + MAINLAND_CHINA_EMERGENCY_NUMBER
        + '，其他地区请拨打当地急救电话。',
    ),
    bo: fallback('zh'),
  }),
] as const satisfies readonly LocalizedText[];

export const ADVICE_REFERRAL = defineText({
  en: reviewed('These are general suggestions to bring to a professional — not a diagnosis or treatment plan for you. Please discuss anything you plan to act on with a doctor, and see a doctor promptly if symptoms persist or worsen.'),
  zh: reviewed('以上只是供您与专业人员讨论的一般性建议，不是针对您个人的诊断或治疗方案。任何打算实际采取的做法，请先与医生讨论；如症状持续或加重，请及时就医。'),
  bo: fallback('zh'),
});

export const ADVICE_SCHOOL_COPY = {
  tcm: {
    label: defineText({
      en: reviewed('Chinese Medicine'),
      zh: reviewed('中医'),
      bo: fallback('zh'),
    }),
    subtitle: defineText({
      en: reviewed('A traditional Chinese medicine perspective — based on traditional practice and theory, not on modern clinical-trial evidence.'),
      zh: reviewed('中医视角——基于传统实践与理论，而非现代临床试验证据。'),
      bo: fallback('zh'),
    }),
  },
  tibetan: {
    label: defineText({
      en: reviewed('Tibetan Medicine'),
      zh: reviewed('藏医'),
      bo: fallback('zh'),
    }),
    subtitle: defineText({
      en: reviewed('A traditional Tibetan medicine perspective — based on traditional practice and theory, not on modern clinical-trial evidence.'),
      zh: reviewed('藏医视角——基于传统实践与理论，而非现代临床试验证据。'),
      bo: fallback('zh'),
    }),
  },
  western: {
    label: defineText({
      en: reviewed('Western Medicine'),
      zh: reviewed('西医'),
      bo: fallback('zh'),
    }),
    subtitle: defineText({
      en: reviewed('General information from mainstream medicine — still general, not a diagnosis for you.'),
      zh: reviewed('现代医学的一般性信息——仍属一般信息，不是针对您的诊断。'),
      bo: fallback('zh'),
    }),
  },
} as const satisfies Record<
  string,
  Readonly<{ label: LocalizedText; subtitle: LocalizedText }>
>;
