import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LocalizedText } from '@/components/LocalizedText';
import { defineText, fallback, reviewed, unverified } from '@/lib/i18n';

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

  it('renders the bo Chinese fallback without a per-string unverified marker', () => {
    render(<LocalizedText data-testid="copy" value={COPY} lang="bo" />);

    const copy = screen.getByTestId('copy');
    expect(copy).toHaveAttribute('data-requested-lang', 'bo');
    expect(copy).toHaveAttribute('data-resolved-lang', 'zh');
    expect(copy).toHaveTextContent(/^已审核中文$/);
    expect(
      copy.querySelector('[data-translation-review="unverified"]'),
    ).toBeNull();
  });

  it('marks a direct unverified bo string while preserving the label language', () => {
    const directBo = defineText({
      en: reviewed('Reviewed English'),
      zh: reviewed('已审核中文'),
      bo: unverified('བོད་ཡིག་ཚོད་ལྟ།'),
    });

    render(<LocalizedText data-testid="copy" value={directBo} lang="bo" />);

    const copy = screen.getByTestId('copy');
    expect(copy).toHaveAttribute('data-resolved-lang', 'bo');
    const marker = copy.querySelector(
      '[data-translation-review="unverified"]',
    );
    expect(marker).not.toBeNull();
    // The marker label itself remains a Chinese fallback until Tier 0 is reviewed.
    expect(marker).toHaveAttribute('lang', 'zh');
  });

  it('does not mark a direct reviewed bo string', () => {
    const directBo = defineText({
      en: reviewed('Reviewed English'),
      zh: reviewed('已审核中文'),
      bo: reviewed('བོད་ཡིག་ཚོད་ལྟ།'),
    });

    render(<LocalizedText data-testid="copy" value={directBo} lang="bo" />);

    const copy = screen.getByTestId('copy');
    expect(copy).toHaveAttribute('data-resolved-lang', 'bo');
    expect(
      copy.querySelector('[data-translation-review="unverified"]'),
    ).toBeNull();
  });
});
