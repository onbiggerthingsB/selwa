import { describe, expect, it } from 'vitest';
import {
  ADVICE_BANNER_COPY,
  ADVICE_DISCLAIMERS,
  ADVICE_ENTRY_COPY,
  ADVICE_FORM_COPY,
  ADVICE_HOTLINES,
  ADVICE_HOTLINE_VERIFICATION_ACKNOWLEDGEMENT,
  ADVICE_REFERRAL,
  ADVICE_REFUSAL_COPY,
  ADVICE_SCHOOL_COPY,
  ADVICE_UNAVAILABLE_COPY,
} from '@/lib/adviceCopy';
import { resolveText, type LocalizedText } from '@/lib/i18n';
import { extractLocalizedTextCorpus } from '@/lib/localizedTextCorpus';

const SCHOOL_COPY = Object.values(ADVICE_SCHOOL_COPY).flatMap(({ label, subtitle }) => [
  label,
  subtitle,
]);

const T1_ADVICE_COPY: readonly LocalizedText[] = [
  ...Object.values(ADVICE_ENTRY_COPY),
  ...Object.values(ADVICE_FORM_COPY),
  ...Object.values(ADVICE_UNAVAILABLE_COPY),
  ...ADVICE_DISCLAIMERS,
  ADVICE_REFERRAL,
  ...SCHOOL_COPY,
];
const T2_T3_ADVICE_COPY: readonly LocalizedText[] = [
  ...Object.values(ADVICE_BANNER_COPY),
  ...Object.values(ADVICE_REFUSAL_COPY),
];
const ALL_ADVICE_COPY = [...T1_ADVICE_COPY, ...T2_T3_ADVICE_COPY];

describe('advice copy', () => {
  it('keeps every T1 string reviewed in en/zh and explicitly falling back to zh for bo', () => {
    expect(T1_ADVICE_COPY).toHaveLength(34);

    for (const copy of T1_ADVICE_COPY) {
      expect(copy.en).toMatchObject({ review: 'reviewed' });
      expect(copy.zh).toMatchObject({ review: 'reviewed' });
      expect(copy.bo).toEqual({ fallback: 'zh' });
      expect(resolveText(copy, 'bo')).toMatchObject({
        resolvedLang: 'zh',
        usedFallback: true,
        review: 'unverified',
        path: ['bo', 'zh'],
      });
    }
  });

  it('keeps every T2/T3 safety string reviewed in en/zh and falling back to zh for bo', () => {
    expect(T2_T3_ADVICE_COPY).toHaveLength(5);

    for (const copy of T2_T3_ADVICE_COPY) {
      expect(copy.en).toMatchObject({ review: 'reviewed' });
      expect(copy.zh).toMatchObject({ review: 'reviewed' });
      expect(copy.bo).toEqual({ fallback: 'zh' });
      expect(resolveText(copy, 'bo')).toMatchObject({
        resolvedLang: 'zh',
        usedFallback: true,
        review: 'unverified',
        path: ['bo', 'zh'],
      });
    }
  });

  it('locks the safety banners and dosing refusal to the reviewed specification copy', () => {
    expect(resolveText(ADVICE_BANNER_COPY.emergency, 'en').text).toBe(
      'If this is happening to you or someone near you right now, get emergency help immediately — in mainland China call 120 (ambulance); elsewhere call your local emergency number (for example 911 in the US). Do not wait for an answer on this page. Nothing below can replace emergency care.',
    );
    expect(resolveText(ADVICE_BANNER_COPY.emergency, 'zh').text).toBe(
      '如果您或身边的人现在正出现这种情况，请立即寻求急救：中国大陆请拨打 120（急救电话），其他地区请拨打当地急救电话（如美国 911）。不要等待本页的回答。下方任何内容都不能替代急救。',
    );
    expect(resolveText(ADVICE_BANNER_COPY['emergency-self-harm'], 'en').text).toBe(
      'You deserve support right now. In mainland China you can call the national psychological assistance hotline 12356; in the US or Canada call or text 988; elsewhere contact your local crisis line or emergency number. If you are in immediate danger, call emergency services (120 in mainland China). This page cannot help with this — a person can.',
    );
    expect(resolveText(ADVICE_BANNER_COPY['emergency-self-harm'], 'zh').text).toBe(
      '此刻您值得获得支持。中国大陆可拨打全国心理援助热线 12356；美国或加拿大可拨打或发送短信至 988；其他地区请联系当地心理危机热线或急救电话。如有即时危险，请拨打急救电话（中国大陆 120）。本页无法为此提供帮助——但真实的人可以。',
    );
    expect(resolveText(ADVICE_REFUSAL_COPY.dosing, 'en').text).toBe(
      "We can't show this answer because it included specific medication or remedy amounts, which this app never provides. For any medicine — including herbal or traditional remedies — and how much or how often to take it, please ask a doctor or pharmacist.",
    );
    expect(resolveText(ADVICE_REFUSAL_COPY.dosing, 'zh').text).toBe(
      '此回答包含具体的用药或用量信息，本应用一律不提供此类内容，因此无法显示。任何药物（包括中药、藏药等传统药物）的品种、用量和服用频次，请咨询医生或药师。',
    );
  });

  it('keeps hotline facts centralized behind a release-verification sentinel', () => {
    expect(ADVICE_HOTLINES).toEqual({
      mainlandChinaEmergency: '120',
      mainlandChinaPsychologicalAssistance: '12356',
      usCanadaCrisis: '988',
    });
    expect(ADVICE_HOTLINE_VERIFICATION_ACKNOWLEDGEMENT).toContain(
      'VERIFY BEFORE RELEASE',
    );
  });

  it('preserves the exact entry, disclaimer, and referral copy from the specification', () => {
    expect(resolveText(ADVICE_ENTRY_COPY.title, 'en').text).toBe('Ask a health question');
    expect(resolveText(ADVICE_ENTRY_COPY.title, 'zh').text).toBe('咨询健康问题');
    expect(resolveText(ADVICE_ENTRY_COPY.subtitle, 'en').text).toBe(
      'General suggestions from Chinese, Tibetan, and Western medicine — not a diagnosis.',
    );
    expect(resolveText(ADVICE_ENTRY_COPY.subtitle, 'zh').text).toBe(
      '来自中医、藏医、西医的一般性建议——不是诊断。',
    );

    expect(ADVICE_DISCLAIMERS.map((copy) => resolveText(copy, 'en').text)).toEqual([
      'This page offers general health suggestions generated by AI, from three medical traditions. They are starting points to discuss with a professional — not a diagnosis or a treatment plan for you.',
      'The AI can be wrong, even when it sounds confident. No person reviews these answers before you see them.',
      'We never provide medication doses. For any medicine or remedy — including herbal and traditional ones — and how much to take, ask a doctor or pharmacist.',
      'The Chinese-medicine and Tibetan-medicine perspectives reflect traditional practice, not modern clinical-trial evidence.',
      "If symptoms are severe or getting worse quickly, don't wait for an answer here — in mainland China call 120; elsewhere call your local emergency number.",
    ]);
    expect(ADVICE_DISCLAIMERS.map((copy) => resolveText(copy, 'zh').text)).toEqual([
      '本页面提供由 AI 生成的一般性健康建议，来自三种医学传统。它们是供您与专业人员讨论的参考，不是针对您个人的诊断或治疗方案。',
      'AI 可能出错，即使听起来很有把握。回答在您看到之前没有经过人工审核。',
      '我们一律不提供用药剂量。任何药物（包括中药、藏药等传统药物）的品种与用量，请咨询医生或药师。',
      '中医与藏医视角反映的是传统实践，而非现代临床试验证据。',
      '如症状严重或迅速加重，请不要等待本页回答——中国大陆请拨打 120，其他地区请拨打当地急救电话。',
    ]);
    expect(resolveText(ADVICE_REFERRAL, 'en').text).toBe(
      'These are general suggestions to bring to a professional — not a diagnosis or treatment plan for you. Please discuss anything you plan to act on with a doctor, and see a doctor promptly if symptoms persist or worsen.',
    );
    expect(resolveText(ADVICE_REFERRAL, 'zh').text).toBe(
      '以上只是供您与专业人员讨论的一般性建议，不是针对您个人的诊断或治疗方案。任何打算实际采取的做法，请先与医生讨论；如症状持续或加重，请及时就医。',
    );
  });

  it('keeps the three school labels fixed and includes every advice string in the static corpus', () => {
    expect(
      Object.values(ADVICE_SCHOOL_COPY).map(({ label }) => ({
        en: resolveText(label, 'en').text,
        zh: resolveText(label, 'zh').text,
      })),
    ).toEqual([
      { en: 'Chinese Medicine', zh: '中医' },
      { en: 'Tibetan Medicine', zh: '藏医' },
      { en: 'Western Medicine', zh: '西医' },
    ]);

    const extracted = extractLocalizedTextCorpus({ repoRoot: process.cwd() }).calls.filter(
      ({ sourceFile }) => sourceFile === 'lib/adviceCopy.ts',
    );
    expect(extracted).toHaveLength(ALL_ADVICE_COPY.length);
    expect(extracted.every(({ variants }) => variants.bo.kind === 'fallback')).toBe(true);
  });
});
