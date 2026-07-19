import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotesSection } from './NotesSection';
import { groundNotes } from '@/lib/notesGrounding';

describe('NotesSection — total-drop completeness fallback', () => {
  it('renders the ORIGINAL source verbatim (never an empty section) when the LLM dropped all notes', () => {
    const original = '医生说：未见占位，继续服用二甲双胍。';
    // The LLM returned no segments, but the user typed notes. The reconciliation
    // produces a single abstain fallback carrying the verbatim original.
    const notes = groundNotes({ segments: [] }, original);

    const { container } = render(<NotesSection notes={notes} lang="en" />);

    // The section is NOT null — the source text is on screen.
    expect(container.querySelector('.notes-section')).not.toBeNull();
    expect(screen.getByText(original)).toBeInTheDocument();
    // The "shown as written" abstain note is present (the row is held, not silently dropped).
    expect(screen.getByText(/shown as written/i)).toBeInTheDocument();
  });

  it('marks every bo UI fallback in readable Chinese while preserving source text verbatim', () => {
    const original = '医生说：未见占位，继续服用二甲双胍。';
    const notes = groundNotes({ segments: [] }, original);

    const { container } = render(<NotesSection notes={notes} lang="bo" />);

    expect(screen.getByText(original)).toBeInTheDocument();
    expect(screen.getByText('医生说了什么')).toBeInTheDocument();
    expect(screen.getByText('按原文显示——这一句我们无法安全地简化。')).toBeInTheDocument();

    const fallbacks = container.querySelectorAll(
      '[data-requested-lang="bo"][data-resolved-lang="zh"]',
    );
    expect(fallbacks.length).toBeGreaterThan(0);
    const markers = screen.getAllByText('翻译未经审核');
    expect(markers.length).toBe(fallbacks.length);
    expect(markers.every((marker) => marker.getAttribute('lang') === 'zh')).toBe(true);
  });
});
