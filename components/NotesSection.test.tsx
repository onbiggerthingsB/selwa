import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { NotesSection } from './NotesSection';

afterEach(cleanup);

describe('NotesSection authoritative originals only', () => {
  it('renders exact entered text without normalization, generated labels, or injected markup', () => {
    const text = '  原文\nབོད་\ne\u0301\t <script>no()</script> ';
    const { container } = render(<NotesSection originalNotes={text} lang="en" />);
    expect(screen.getByTestId('original-notes').textContent).toBe(text);
    expect(screen.getByTestId('original-notes')).toHaveStyle({ whiteSpace: 'pre-wrap' });
    expect(screen.getByText(/Generated notes translations are disabled/)).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('.note-translation')).toBeNull();
  });

  it('states that the original is unavailable instead of rendering historical model fields', () => {
    const { container } = render(<NotesSection originalNotes={null} lang="en" />);
    expect(screen.getByText(/original notes are unavailable/)).toBeInTheDocument();
    expect(screen.queryByTestId('original-notes')).toBeNull();
    expect(container.querySelector('.note-translation')).toBeNull();
  });

  it.each(['', ' \n\t '])('does not create an unavailable warning for known empty input %j', (text) => {
    const { container } = render(<NotesSection originalNotes={text} lang="en" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps Tibetan interface copy as an explicit Chinese fallback without translating the original', () => {
    const original = 'བོད་ 原文';
    const { container } = render(<NotesSection originalNotes={original} lang="bo" />);
    expect(screen.getByTestId('original-notes').textContent).toBe(original);
    expect(screen.getByText('按您输入的原文显示。医生说明自动翻译已停用。')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-requested-lang="bo"][data-resolved-lang="zh"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-translation-review="unverified"]')).toHaveLength(0);
  });
});
