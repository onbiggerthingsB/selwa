import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LocalizedText } from '@/components/LocalizedText';
import { defineText, fallback, reviewed } from '@/lib/i18n';

const COPY = defineText({
  en: reviewed('Reviewed English'),
  zh: reviewed('已审核中文'),
  bo: fallback('zh'),
});

describe('LocalizedText', () => {
  it('does not alter reviewed English or Chinese visible output', () => {
    const { rerender } = render(<LocalizedText data-testid="copy" value={COPY} lang="en" />);
    expect(screen.getByTestId('copy')).toHaveTextContent(/^Reviewed English$/);
    expect(screen.queryByText('Unverified translation')).toBeNull();

    rerender(<LocalizedText data-testid="copy" value={COPY} lang="zh" />);
    expect(screen.getByTestId('copy')).toHaveTextContent(/^已审核中文$/);
    expect(screen.queryByText('翻译未经审核')).toBeNull();
  });

  it('marks an unreviewed individual string by default', () => {
    const unmarked = defineText({
      en: { text: 'Machine output' },
      zh: reviewed('已审核中文'),
      bo: fallback('zh'),
    });

    render(<LocalizedText data-testid="copy" value={unmarked} lang="en" />);

    expect(screen.getByTestId('copy')).toHaveTextContent(
      'Machine outputUnverified translation',
    );
    expect(screen.getByText('Unverified translation')).toHaveAttribute(
      'data-translation-review',
      'unverified',
    );
  });

  it('labels the bo Chinese fallback as unverified in readable Chinese', () => {
    render(<LocalizedText data-testid="copy" value={COPY} lang="bo" />);

    const copy = screen.getByTestId('copy');
    expect(copy).toHaveAttribute('data-requested-lang', 'bo');
    expect(copy).toHaveAttribute('data-resolved-lang', 'zh');
    expect(copy).toHaveTextContent('已审核中文翻译未经审核');
    expect(screen.getByText('翻译未经审核')).toHaveAttribute('lang', 'zh');
  });
});
