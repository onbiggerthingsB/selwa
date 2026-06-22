import { describe, it, expect } from 'vitest';
import { groundNotes } from './notesGrounding';
import type { NotesTranslation } from './notesSchema';

describe('groundNotes', () => {
  it('renders a clean segment with its translation kept and preserved immutables', () => {
    const translation: NotesTranslation = {
      segments: [
        { sourceText: '二甲双胍 850mg 每日两次。', translatedText: 'Metformin 850 mg twice daily.', kind: 'medication' },
      ],
    };
    const grounded = groundNotes(translation);
    expect(grounded.segments).toHaveLength(1);
    const s = grounded.segments[0];
    expect(s.action).toBe('render');
    expect(s.translated).toBe('Metformin 850 mg twice daily.');
    expect(s.source).toBe('二甲双胍 850mg 每日两次。');
    expect(s.kind).toBe('medication');
    expect(s.preserved.length).toBeGreaterThan(0); // dose immutables pinned
    expect(grounded.overallAction).toBe('render');
  });

  it('blanks the translation of an unsafe (abstain) segment and shows the source verbatim', () => {
    // Dropped/reversed negation: asserted malignancy → "no malignant cells" reverses meaning.
    const translation: NotesTranslation = {
      segments: [
        { sourceText: '活检提示恶性肿瘤细胞。', translatedText: 'Biopsy shows no malignant tumor cells.', kind: 'finding' },
      ],
    };
    const grounded = groundNotes(translation);
    const s = grounded.segments[0];
    expect(s.action).toBe('abstain');
    expect(s.translated).toBe(''); // unsafe translation is NOT shown
    expect(s.source).toBe('活检提示恶性肿瘤细胞。'); // source always present
    expect(s.flags.map((f) => f.id)).toContain('R7-NEGATION-POLARITY-MISMATCH');
    expect(grounded.overallAction).toBe('abstain');
  });

  it('aggregates overallAction as the max severity across a mixed translation', () => {
    // clean render + a flagged (non-blocking) segment + an abstained segment
    const translation: NotesTranslation = {
      segments: [
        { sourceText: '血压偏高，建议低盐饮食。', translatedText: 'Blood pressure is a bit high; a low-salt diet is suggested.', kind: 'instruction' },
        { sourceText: '胸片未见明显占位性病变。', translatedText: 'Chest X-ray shows a space-occupying lesion.', kind: 'finding' }, // dropped negation → flag
        { sourceText: '活检提示恶性肿瘤细胞。', translatedText: 'Biopsy shows no malignant tumor cells.', kind: 'finding' }, // reversed → abstain
      ],
    };
    const grounded = groundNotes(translation);

    // segment 0: clean → render, translation kept
    expect(grounded.segments[0].action).toBe('render');
    expect(grounded.segments[0].translated).toBe('Blood pressure is a bit high; a low-salt diet is suggested.');

    // segment 1: dropped negation → flag, translation STILL shown (flag is non-blocking)
    expect(grounded.segments[1].action).toBe('flag');
    expect(grounded.segments[1].translated).toBe('Chest X-ray shows a space-occupying lesion.');
    expect(grounded.segments[1].flags.length).toBeGreaterThan(0);

    // segment 2: reversed negation → abstain, translation blanked
    expect(grounded.segments[2].action).toBe('abstain');
    expect(grounded.segments[2].translated).toBe('');

    // overall = highest severity = abstain
    expect(grounded.overallAction).toBe('abstain');
  });

  it('returns overallAction "render" for empty notes', () => {
    const grounded = groundNotes({ segments: [] });
    expect(grounded.segments).toHaveLength(0);
    expect(grounded.overallAction).toBe('render');
  });
});
