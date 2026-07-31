import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
      screen.getByText('让我们核对照片中的几项结果。请确认下面的结果、单位和范围都与您的报告完全一致。'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('请逐字核对报告上打印的结果和符号。')).toHaveLength(2);
  });

  // REGRESSION LOCK (2026-07-31). The status chip is arithmetic on the printed value against the
  // printed RANGE (lib/summary.ts), but this screen could only edit value and unit. So a misread
  // range produced a wrong chip that the user could not see or correct, and confirming the row
  // attached their endorsement to it — strictly worse than not asking. Both assertions below must
  // keep holding: the range is present, and an edit to it reaches the regrounded report.
  it('shows the printed range and carries an edit to it through to the regrounded report', () => {
    const onConfirmed = vi.fn();
    render(<ConfirmValues report={report} lang="en" onConfirmed={onConfirmed} />);

    const rangeInputs = screen.getAllByLabelText(/Your report’s range/);
    expect(rangeInputs.length).toBeGreaterThan(0);
    expect((rangeInputs[0] as HTMLInputElement).value).toBe('3.9-6.1');

    // The lab printed 3.9-9.1; we misread the 9 as a 6. 7.8 is INSIDE the true range and above the
    // misread one, so this single character decides whether the user is told they are above range.
    fireEvent.change(rangeInputs[0], { target: { value: '3.9-9.1' } });
    fireEvent.click(screen.getByRole('button'));

    expect(onConfirmed).toHaveBeenCalledTimes(1);
    const regrounded = onConfirmed.mock.calls[0][0];
    const glucose = regrounded.rows.find((r: { extracted: { name: string } }) => r.extracted.name === '空腹血糖');
    expect(glucose.extracted.printedRange).toBe('3.9-9.1');
    expect(glucose.extracted.value).toBe('7.8');
  });

  it('leads with the name printed on the page, not the name our table matched', () => {
    const { container } = render(<ConfirmValues report={report} lang="en" onConfirmed={vi.fn()} />);

    // Verbatim printed text, so a value bound to the wrong analyte cannot hide behind a confident
    // curated label. Our match is still shown, but below and marked as ours.
    expect(container.querySelector('.confirm-name')).toHaveTextContent('空腹血糖');
    expect(container.querySelector('.confirm-matched')).toHaveTextContent('Fasting plasma glucose');
  });

  it('uses explicit Chinese fallback as the bo primary and keeps English secondary', () => {
    const { container } = render(
      <ConfirmValues
        report={report}
        lang="bo"
        onConfirmed={vi.fn()}
      />,
    );

    // The PRINTED name leads and is verbatim, never localized — it is what the user checks against
    // the paper. Our matched name moved below it into .confirm-matched (2026-07-31), so that a row
    // bound to the wrong analyte can no longer hide behind a confident curated label.
    const printedName = container.querySelector('.confirm-name');
    expect(printedName).not.toBeNull();
    expect(printedName!.querySelectorAll('[data-requested-lang]')).toHaveLength(0);

    const firstName = container.querySelector('.confirm-matched');
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
