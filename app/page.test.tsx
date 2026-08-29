import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroundedReport } from '@/lib/types';
import Home from './page';
import ResultPage from './result/page';

const mocks = vi.hoisted(() => ({
  push: vi.fn<(href: string) => void>(),
  replace: vi.fn<(href: string) => void>(),
  hasConsent: vi.fn<() => boolean>(),
  grantConsent: vi.fn<() => void>(),
  getPendingReport: vi.fn(),
  setPendingReport: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));

vi.mock('@/lib/consent', () => ({
  hasConsent: mocks.hasConsent,
  grantConsent: mocks.grantConsent,
  CONSENT_VERSION: 2,
}));

vi.mock('@/lib/session', () => ({
  getPendingReport: mocks.getPendingReport,
  setPendingReport: mocks.setPendingReport,
}));

vi.mock('@/components/SavedVisits', () => ({
  SavedVisits: () => null,
}));

vi.mock('@/components/InstallPrompt', () => ({
  InstallPrompt: () => null,
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

const NativeURL = globalThis.URL;

describe('shared language preference', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    mocks.push.mockReset();
    mocks.replace.mockReset();
    mocks.hasConsent.mockReset();
    mocks.grantConsent.mockReset();
    mocks.getPendingReport.mockReset();
    mocks.setPendingReport.mockReset();
    mocks.hasConsent.mockReturnValue(false);
    mocks.getPendingReport.mockReturnValue({ report });

    class TestURL extends NativeURL {
      static createObjectURL = vi.fn(() => 'blob:home-preview');
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal('URL', TestURL);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('drives the home consent dialog from the Tibetan language control', async () => {
    const user = userEvent.setup();
    const { container } = render(<Home />);

    const tb = screen.getByRole('button', { name: 'TB' });
    await user.click(tb);
    expect(tb).toHaveAttribute('aria-pressed', 'true');

    const notice = screen.getByTestId('home-tibetan-availability');
    expect(notice).toHaveTextContent('藏语暂不可用；目前显示中文内容。');
    expect(
      notice.querySelector(
        '[data-requested-lang="bo"][data-resolved-lang="zh"]',
      ),
    ).not.toBeNull();
    expect(
      notice.querySelectorAll('[data-translation-review="unverified"]'),
    ).toHaveLength(0);

    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('Capture file input not found');
    }
    await user.upload(
      input,
      new File(['image bytes'], 'lab.jpg', { type: 'image/jpeg' }),
    );
    await user.click(screen.getByRole('button', { name: /Use this photo/i }));

    // Tibetan mode falls back to Chinese, so the dialog's accessible name is the Chinese one
    // (lib/consentCopy.ts dialogLabel, resolved 2026-08-29 — it used to announce English).
    const dialog = await screen.findByRole('dialog', {
      name: '在读取您的化验单之前',
    });
    const consentNodes = [
      dialog,
      ...dialog.querySelectorAll('[data-requested-lang]'),
    ];
    expect(consentNodes).toHaveLength(6);
    expect(
      consentNodes.every(
        (node) =>
          node.getAttribute('data-requested-lang') === 'bo' &&
          node.getAttribute('data-resolved-lang') === 'zh',
      ),
    ).toBe(true);
  });

  it('persists a result-page language choice when the home page mounts', async () => {
    const user = userEvent.setup();
    const result = render(<ResultPage />);

    const chinese = await screen.findByRole('button', { name: '中文' });
    await user.click(chinese);
    expect(chinese).toHaveAttribute('aria-pressed', 'true');

    result.unmount();
    render(<Home />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '中文' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
  });
});
