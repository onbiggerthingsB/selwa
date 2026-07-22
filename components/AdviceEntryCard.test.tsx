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

  it('keeps the lab translator first and adds advice as the secondary home control', () => {
    const { container } = render(<Home />);

    const labEntry = screen.getByRole('button', { name: /Take a photo of your lab report/i });
    const adviceEntry = screen.getByRole('link', { name: 'Ask a health question' });
    expect(labEntry).toHaveClass('capture-card');
    expect(adviceEntry).toHaveClass('advice-entry-card');
    expect(
      labEntry.compareDocumentPosition(adviceEntry) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container.querySelectorAll('.capture-card, .advice-entry-card')).toHaveLength(2);
  });
});
