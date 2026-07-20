import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroundedReport } from '@/lib/types';
import ResultPage from './page';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
}));

const report: GroundedReport = {
  rows: [
    {
      extracted: {
        name: 'unmatched source row',
        value: '1',
        unit: null,
        printedRange: null,
        confidence: 'low',
        specimen: 'unknown',
      },
      entry: null,
      matchedVia: 'unmatched',
      valueNum: 1,
      classification: 'unclassified',
      action: 'abstain',
      needsConfirm: true,
      needsReview: false,
      flags: [],
    },
  ],
  sex: 'unknown',
  generatedAt: 0,
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock('@/lib/session', () => ({
  getPendingReport: () => ({ report }),
}));

describe('ResultPage language toggle', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.replace.mockClear();
  });

  it('offers TB and visibly explains its screen-level Chinese fallback', async () => {
    const user = userEvent.setup();
    render(<ResultPage />);

    const tb = await screen.findByRole('button', { name: 'TB' });
    expect(tb).toHaveAttribute('aria-pressed', 'false');

    await user.click(tb);

    expect(tb).toHaveAttribute('aria-pressed', 'true');
    const notice = screen.getByTestId('tibetan-availability');
    expect(notice).toHaveTextContent('藏语暂不可用；目前显示中文内容。');
    expect(notice.querySelectorAll('[data-translation-review="unverified"]').length)
      .toBe(0);
    const fallbackNotice = screen.getByText('藏语暂不可用；目前显示中文内容。');
    expect(fallbackNotice).toHaveAttribute('lang', 'zh');
    expect(fallbackNotice.closest('[data-requested-lang="bo"]')).toHaveAttribute(
      'data-resolved-lang',
      'zh',
    );

    const sample = screen.getByTestId('tibetan-typography-sample');
    expect(sample).toHaveAttribute('lang', 'bo');
    expect(sample).not.toHaveAttribute('dir');
    expect(sample.querySelectorAll('wbr[data-tsheg-break]').length).toBeGreaterThan(0);
  });
});
