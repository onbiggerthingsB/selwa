import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroundedReport } from '@/lib/types';
import ResultPage from './page';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  clearPendingReport: vi.fn(),
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
  clearPendingReport: mocks.clearPendingReport,
}));

// The completeness gate is only a control if it is WIRED IN and comes FIRST. RowManifest.test.tsx
// tests the component in isolation, so on its own it would stay green if someone removed the gate
// from this page. These tests pin the wiring: interpretation must be unreachable until the user
// has been shown what we read and has said it is complete.
describe('ResultPage completeness gate', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.replace.mockClear();
    mocks.clearPendingReport.mockClear();
  });

  it('shows the manifest first and withholds all interpretation until acknowledged', async () => {
    render(<ResultPage />);

    // The gate itself, listing what we read off the page.
    expect(await screen.findByTestId('manifest-list')).toBeInTheDocument();

    // Nothing downstream may be on screen yet: not the summary, and not even the confirm step —
    // this row has needsConfirm true, so without the gate ConfirmValues would render immediately.
    expect(screen.queryByText('Please check these readings')).toBeNull();
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
  });

  it('advances to the rest of the flow only after the user confirms the list is complete', async () => {
    const user = userEvent.setup();
    render(<ResultPage />);

    await user.click(await screen.findByRole('button', { name: 'Yes, they are all here' }));

    expect(screen.queryByTestId('manifest-list')).toBeNull();
    expect(screen.getByText('Please check these readings')).toBeInTheDocument();
  });

  // "A result is missing" must not drop the user into an interpretation of an incomplete read.
  it('clears the pending report and returns home when the user reports a missing result', async () => {
    const user = userEvent.setup();
    render(<ResultPage />);

    await user.click(
      await screen.findByRole('button', { name: 'Something is missing — retake photo' }),
    );

    expect(mocks.clearPendingReport).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith('/');
    expect(screen.queryByText('Please check these readings')).toBeNull();
  });
});

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
