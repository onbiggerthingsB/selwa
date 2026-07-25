import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RowManifest } from '@/components/RowManifest';
import { groundExtraction } from '@/lib/grounding';
import type { GroundedReport } from '@/lib/types';

function reportOf(
  rows: { name: string; value: string | null; unit: string | null; printedRange?: string | null }[],
): GroundedReport {
  return {
    ...groundExtraction(
      {
        rows: rows.map((r) => ({
          name: r.name,
          value: r.value,
          unit: r.unit,
          printedRange: r.printedRange ?? null,
          confidence: 'high' as const,
        })),
      },
      'unknown',
    ),
    generatedAt: 0,
  };
}

const TWO_ROWS = [
  { name: '白细胞', value: '6.84', unit: '10^9/L', printedRange: '3.5-9.5' },
  { name: 'C反应蛋白', value: '10.63', unit: 'mg/L', printedRange: '0-10' },
];

describe('RowManifest (completeness gate)', () => {
  afterEach(cleanup);

  it('states how many rows were read and lists every one of them', () => {
    render(
      <RowManifest
        report={reportOf(TWO_ROWS)}
        lang="en"
        onAcknowledged={vi.fn()}
        onRetake={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading')).toHaveTextContent('2');
    const items = within(screen.getByTestId('manifest-list')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
  });

  // The manifest exists so the user can check OUR READING against THEIR PAPER. If we showed the
  // curated table's name or our translation, they would be checking us against ourselves.
  it('echoes the report’s own printed text verbatim, not the curated name or an interpretation', () => {
    render(
      <RowManifest
        report={reportOf(TWO_ROWS)}
        lang="en"
        onAcknowledged={vi.fn()}
        onRetake={vi.fn()}
      />,
    );

    const items = within(screen.getByTestId('manifest-list')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('白细胞');
    expect(items[0]).toHaveTextContent('6.84 10^9/L');
    expect(items[1]).toHaveTextContent('C反应蛋白');

    // No status chip, no verdict, no curated English name — this screen must not interpret.
    const list = screen.getByTestId('manifest-list');
    expect(list.textContent).not.toMatch(/within|above|below|range|White blood cell|C-reactive/i);
  });

  it('renders a row we could not fully read without inventing a value', () => {
    render(
      <RowManifest
        report={reportOf([{ name: '葡萄糖', value: null, unit: null }])}
        lang="en"
        onAcknowledged={vi.fn()}
        onRetake={vi.fn()}
      />,
    );

    const items = within(screen.getByTestId('manifest-list')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('葡萄糖');
    expect(items[0].textContent).not.toMatch(/null|undefined|NaN/);
  });

  it('offers both an acknowledge and a retake path, and calls neither on its own', () => {
    const onAcknowledged = vi.fn();
    const onRetake = vi.fn();
    render(
      <RowManifest
        report={reportOf(TWO_ROWS)}
        lang="en"
        onAcknowledged={onAcknowledged}
        onRetake={onRetake}
      />,
    );

    // Critically: no auto-advance. The gate must be crossed deliberately, unlike ConfirmValues,
    // which skips itself whenever no row happens to be flagged.
    expect(onAcknowledged).not.toHaveBeenCalled();
    expect(onRetake).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Yes, they are all here' }));
    expect(onAcknowledged).toHaveBeenCalledTimes(1);
    expect(onRetake).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: 'Something is missing — retake photo' }),
    );
    expect(onRetake).toHaveBeenCalledTimes(1);
  });

  it('tells the user to compare against the paper report, never against the photo we do not keep', () => {
    const { container } = render(
      <RowManifest
        report={reportOf(TWO_ROWS)}
        lang="en"
        onAcknowledged={vi.fn()}
        onRetake={vi.fn()}
      />,
    );

    expect(container.textContent).toContain('paper report');
  });

  it('renders the Chinese copy for zh readers', () => {
    render(
      <RowManifest
        report={reportOf(TWO_ROWS)}
        lang="zh"
        onAcknowledged={vi.fn()}
        onRetake={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '是，全部都在' })).toBeInTheDocument();
    expect(screen.getByRole('heading')).toHaveTextContent('项结果读自您的照片');
  });
});
