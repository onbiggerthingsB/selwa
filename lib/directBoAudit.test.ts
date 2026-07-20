import { describe, expect, it } from 'vitest';
import { REFERENCE_LABS } from '@/data/reference-labs';
import { DISCLAIMER_TEXTS } from '@/lib/disclaimers';
import { groundExtraction } from '@/lib/grounding';
import { resolveText, type LocalizedText } from '@/lib/i18n';
import { buildSummary } from '@/lib/summary';
import { UI_COPY } from '@/lib/uiCopy';

const SUMMARY_DIRECT_BO_CONTEXT = 'SUMMARY.abstained-row.name';
const VERBATIM_OCR_TEST_NAME = 'VERBATIM-OCR-TEST-NAME';

const DIRECT_BO_ALLOWLIST = {
  [SUMMARY_DIRECT_BO_CONTEXT]:
    'This is the report’s verbatim OCR name, deliberately unverified in every language; '
    + 'falling back to Chinese would falsely relabel it as a translation.',
} as const satisfies Record<string, string>;

interface AuditedCopy {
  context: string;
  copy: LocalizedText;
}

interface BoAudit {
  directBo: string[];
  badFallback: string[];
  badDirect: string[];
}

function auditBoFallback(copy: LocalizedText, context: string, audit: BoAudit): void {
  const variant = copy.bo;
  if (!('fallback' in variant)) {
    audit.directBo.push(context);
    const resolved = resolveText(copy, 'bo');
    if (
      resolved.usedFallback
      || resolved.resolvedLang !== 'bo'
      || resolved.path.join('→') !== 'bo'
    ) {
      audit.badDirect.push(
        `${context} → resolved=${resolved.resolvedLang}, path=${resolved.path.join('→')}`,
      );
    }
    return;
  }

  const keys = Object.keys(variant);
  if (
    variant.fallback !== 'zh'
    || keys.length !== 1
    || keys[0] !== 'fallback'
  ) {
    audit.badFallback.push(`${context} → ${JSON.stringify(variant)}`);
    return;
  }

  const resolved = resolveText(copy, 'bo');
  if (
    !resolved.usedFallback
    || resolved.resolvedLang !== 'zh'
    || resolved.path.join('→') !== 'bo→zh'
  ) {
    audit.badFallback.push(
      `${context} → resolved=${resolved.resolvedLang}, path=${resolved.path.join('→')}`,
    );
  }
}

function abstainedRowName(): LocalizedText {
  const report = groundExtraction(
    {
      rows: [
        {
          name: VERBATIM_OCR_TEST_NAME,
          value: '1',
          unit: null,
          printedRange: null,
          confidence: 'high',
        },
      ],
    },
    'unknown',
  );
  return buildSummary(report, 'en').sections[0].name;
}

function auditedCopies(): AuditedCopy[] {
  return [
    ...DISCLAIMER_TEXTS.map((copy, index) => ({
      context: `DISCLAIMER_TEXTS[${index}]`,
      copy,
    })),
    ...Object.entries(UI_COPY).map(([key, copy]) => ({
      context: `UI_COPY.${key}`,
      copy,
    })),
    ...REFERENCE_LABS.flatMap((entry) => [
      { context: `REFERENCE_LABS.${entry.key}.name`, copy: entry.name },
      { context: `REFERENCE_LABS.${entry.key}.definition`, copy: entry.definition },
      { context: `REFERENCE_LABS.${entry.key}.plain`, copy: entry.plain },
    ]),
    {
      context: SUMMARY_DIRECT_BO_CONTEXT,
      copy: abstainedRowName(),
    },
  ];
}

describe('direct Tibetan localization audit', () => {
  it('requires every direct bo variant to be a named opt-in', () => {
    expect(DISCLAIMER_TEXTS).toHaveLength(5);
    expect(Object.keys(UI_COPY)).toHaveLength(25);
    expect(REFERENCE_LABS).toHaveLength(116);

    const copies = auditedCopies();
    expect(copies).toHaveLength(5 + 25 + (116 * 3) + 1);
    expect(
      copies.find(({ context }) => context === SUMMARY_DIRECT_BO_CONTEXT)?.copy,
      'the sole direct-bo exception must stay a verbatim unverified OCR token',
    ).toEqual({
      en: { text: VERBATIM_OCR_TEST_NAME, review: 'unverified' },
      zh: { text: VERBATIM_OCR_TEST_NAME, review: 'unverified' },
      bo: { text: VERBATIM_OCR_TEST_NAME, review: 'unverified' },
    });

    const audit: BoAudit = {
      directBo: [],
      badFallback: [],
      badDirect: [],
    };
    for (const { copy, context } of copies) auditBoFallback(copy, context, audit);

    const allowed = Object.keys(DIRECT_BO_ALLOWLIST).sort();
    expect(
      Object.values(DIRECT_BO_ALLOWLIST).every((reason) => reason.trim().length > 0),
      'every direct-bo opt-in must record a reason',
    ).toBe(true);
    expect(audit.badFallback, audit.badFallback.join('\n')).toEqual([]);
    expect(audit.badDirect, audit.badDirect.join('\n')).toEqual([]);
    expect(
      audit.directBo.sort(),
      `Direct bo variants must be named in DIRECT_BO_ALLOWLIST:\n${audit.directBo.join('\n')}`,
    ).toEqual(allowed);
  });
});
