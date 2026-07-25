import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdviceEntryCard } from '@/components/AdviceEntryCard';
import Home from '@/app/page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/components/SavedVisits', () => ({
  SavedVisits: () => null,
}));

vi.mock('@/components/InstallPrompt', () => ({
  InstallPrompt: () => null,
}));

describe('AdviceEntryCard', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  // PRESERVED RESEARCH: the component is no longer rendered anywhere (Feature 2 was quarantined
  // 2026-07-25 — see app/advice/page.tsx). These two direct-render tests keep the T1-T4 copy work
  // verified on the branch. The quarantine itself is asserted by the last test in this file.
  it('is a secondary link to the separate advice page with honest English framing', () => {
    render(<AdviceEntryCard lang="en" />);

    const link = screen.getByRole('link', { name: 'Ask a health question' });
    expect(link).toHaveAttribute('href', '/advice');
    expect(link).toHaveClass('advice-entry-card');
    expect(link).toHaveTextContent('Ask a health question');
    expect(link).toHaveTextContent(
      'General suggestions from Chinese, Tibetan, and Western medicine — not a diagnosis.',
    );
  });

  it('renders the specified Chinese entry copy', () => {
    render(<AdviceEntryCard lang="zh" />);

    const link = screen.getByRole('link', { name: '咨询健康问题' });
    expect(link).toHaveTextContent('咨询健康问题');
    expect(link).toHaveTextContent('来自中医、藏医、西医的一般性建议——不是诊断。');
  });

  // QUARANTINE PROOF. Feature 2's home entry was removed 2026-07-25 because the advice guard
  // enforces only lexical/structural floors and never medical truth, so harmful and false prose
  // reached users. Re-adding <AdviceEntryCard /> to app/page.tsx fails this test loudly rather
  // than silently re-opening the harm surface.
  it('is no longer rendered on the home page (Feature 2 quarantine)', () => {
    const { container } = render(<Home />);

    const labEntry = screen.getByRole('button', { name: /Take a photo of your lab report/i });
    expect(labEntry).toHaveClass('capture-card');

    expect(screen.queryByRole('link', { name: 'Ask a health question' })).toBeNull();
    expect(screen.queryByRole('link', { name: '咨询健康问题' })).toBeNull();
    expect(container.querySelectorAll('.advice-entry-card')).toHaveLength(0);
    expect(container.querySelectorAll('a[href="/advice"]')).toHaveLength(0);
    expect(container.querySelectorAll('.capture-card')).toHaveLength(1);
  });
});
