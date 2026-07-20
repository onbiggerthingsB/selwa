import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ConfirmValues } from './ConfirmValues';
import { groundExtraction } from '@/lib/grounding';
import type { LabExtraction } from '@/lib/extractionSchema';

const report = (() => {
  const extraction: LabExtraction = {
    rows: [
      {
        name: '空腹血糖',
        value: '7.8',
        unit: 'mmol/L',
        printedRange: '3.9-6.1',
        confidence: 'high',
        specimen: 'blood',
      },
      {
        name: 'Nitrite',
        value: 'Positive',
        unit: null,
        printedRange: 'Negative',
        confidence: 'low',
        specimen: 'urine',
      },
      {
        name: 'Pus Cells',
        value: '0-2',
        unit: 'hpf',
        printedRange: '0-5',
        confidence: 'low',
        specimen: 'urine',
      },
    ],
  };
  return { ...groundExtraction(extraction, 'unknown'), generatedAt: 0 };
})();

describe('ConfirmValues result-shape input', () => {
  it('keeps decimal input for scalars and text input for qualitative/range results', () => {
    render(
      <ConfirmValues
        report={report}
        lang="en"
        onConfirmed={vi.fn()}
      />,
    );

    const scalar = screen.getByLabelText('result 0');
    const qualitative = screen.getByLabelText('result 1');
    const range = screen.getByLabelText('result 2');

    expect(scalar).toHaveAttribute('inputmode', 'decimal');
    expect(qualitative).toHaveAttribute('inputmode', 'text');
    expect(range).toHaveAttribute('inputmode', 'text');
    expect(
      within(qualitative.closest('li')!).getByText(
        'Check the result text and symbols exactly as printed.',
      ),
    ).toBeInTheDocument();
    expect(
      within(range.closest('li')!).getByText(
        'Check the result text and symbols exactly as printed.',
      ),
    ).toBeInTheDocument();
    expect(
      within(scalar.closest('li')!).getByText(
        'Check the decimal point (e.g. 7.0, not 70).',
      ),
    ).toBeInTheDocument();
  });

  it('uses result-neutral literal Chinese instructions', () => {
    render(
      <ConfirmValues
        report={report}
        lang="zh"
        onConfirmed={vi.fn()}
      />,
    );

    expect(screen.getByText('请核对这些结果')).toBeInTheDocument();
    expect(
      screen.getByText('让我们核对照片中的几项结果。请确认下面每项结果和单位与您的报告完全一致。'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('请逐字核对报告上打印的结果和符号。')).toHaveLength(2);
  });

  it('uses explicit Chinese fallback as the bo primary and keeps English secondary', () => {
    const { container } = render(
      <ConfirmValues
        report={report}
        lang="bo"
        onConfirmed={vi.fn()}
      />,
    );

    const firstName = container.querySelector('.confirm-name');
    expect(firstName).not.toBeNull();
    const localizedNames = firstName!.querySelectorAll('[data-requested-lang]');

    expect(localizedNames).toHaveLength(2);
    expect(localizedNames[0]).toHaveAttribute('data-requested-lang', 'bo');
    expect(localizedNames[0]).toHaveAttribute('data-resolved-lang', 'zh');
    expect(localizedNames[0]).toHaveTextContent(/^空腹血糖$/);
    expect(localizedNames[1]).toHaveAttribute('data-requested-lang', 'en');
    expect(localizedNames[1]).toHaveAttribute('data-resolved-lang', 'en');
    expect(localizedNames[1]).toHaveTextContent(/^Fasting plasma glucose$/);

    expect(screen.getByText('请核对这些结果')).toBeInTheDocument();
    expect(screen.getByLabelText('结果 0')).toBeInTheDocument();
    expect(screen.queryByText('翻译未经审核')).toBeNull();
    expect(
      container.querySelectorAll('[data-translation-review="unverified"]'),
    ).toHaveLength(0);
  });

  it('shows the verbatim report name when a specimen-scoped match abstains', () => {
    const grounded = groundExtraction(
      {
        rows: [
          {
            name: 'pH',
            value: '7.1',
            unit: 'pH',
            printedRange: '7.35-7.45',
            confidence: 'high',
            specimen: 'urine',
          },
        ],
      },
      'unknown',
    );
    const row = grounded.rows[0];
    expect(row.entry?.key).toBe('urine_ph');
    expect(row.action).toBe('abstain');
    expect(row.flags.map((flag) => flag.id)).toContain(
      'R18-SPECIMEN-MATCH-UNCORROBORATED',
    );

    // R18 itself does not force confirmation. Set only the display gate here to
    // exercise ConfirmValues' defensive name boundary without changing guard logic.
    const reportWithConfirm = {
      ...grounded,
      rows: [{ ...row, needsConfirm: true }],
      generatedAt: 0,
    };
    render(
      <ConfirmValues
        report={reportWithConfirm}
        lang="en"
        onConfirmed={vi.fn()}
      />,
    );

    expect(screen.getByText('pH')).toBeInTheDocument();
    expect(screen.queryByText('Urine pH')).toBeNull();
  });

  it('does not add internal review-only rows to the editable confirmation list', () => {
    const onConfirmed = vi.fn();
    const reviewOnly = {
      ...report,
      rows: report.rows.map((row, index) => ({
        ...row,
        needsConfirm: false,
        needsReview: index === 0,
      })),
    };

    const { container } = render(
      <ConfirmValues report={reviewOnly} lang="en" onConfirmed={onConfirmed} />,
    );

    expect(container.querySelector('.confirm')).toBeNull();
    expect(onConfirmed).toHaveBeenCalledWith(reviewOnly);
  });
});
