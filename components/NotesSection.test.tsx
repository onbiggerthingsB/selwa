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
});
