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
});
