import { describe, it, expect } from 'vitest';
import { buildNotesView } from './notesSummary';
import { groundNotes } from './notesGrounding';
import type { NotesTranslation } from './notesSchema';

describe('buildNotesView', () => {
  it('shows the translation for a clean (render) segment and pins immutables as chips', () => {
    const grounded = groundNotes({
      segments: [
        { sourceText: '二甲双胍 850mg 每日两次。', translatedText: 'Metformin 850 mg twice daily.', kind: 'medication' },
      ],
    } as NotesTranslation);

    const view = buildNotesView(grounded, 'en');
    expect(view.rows).toHaveLength(1);
    const r = view.rows[0];
    expect(r.source).toBe('二甲双胍 850mg 每日两次。'); // source always present
    expect(r.translation).toBe('Metformin 850 mg twice daily.');
    expect(r.abstained).toBe(false);
    expect(r.abstainNote).toBe('');
    // verbatim immutables surfaced as chips
    expect(r.chips.map((c) => c.label)).toContain('850mg');
    expect(r.chips.map((c) => c.label)).toContain('二甲双胍');
  });

  it('hides the translation for an abstained segment and shows the source with a "shown as written" note', () => {
    const grounded = groundNotes({
      segments: [
        { sourceText: '活检提示恶性肿瘤细胞。', translatedText: 'Biopsy shows no malignant tumor cells.', kind: 'finding' },
      ],
    } as NotesTranslation);

    const viewEn = buildNotesView(grounded, 'en');
    const rEn = viewEn.rows[0];
    expect(rEn.source).toBe('活检提示恶性肿瘤细胞。'); // source still present
    expect(rEn.translation).toBe(''); // unsafe translation NEVER shown
    expect(rEn.abstained).toBe(true);
    expect(rEn.abstainNote).toMatch(/shown as written/i);
    expect(rEn.abstainNote).toMatch(/can.?t safely simplify/i);

    const viewZh = buildNotesView(grounded, 'zh');
    expect(viewZh.rows[0].abstainNote).not.toBe(''); // localized message present in zh too
    expect(viewZh.rows[0].abstainNote).not.toBe(viewEn.rows[0].abstainNote);
  });

  it('maps flags to {severity, message} in the requested language', () => {
    const grounded = groundNotes({
      segments: [
        { sourceText: '胸片未见明显占位性病变。', translatedText: 'Chest X-ray shows a space-occupying lesion.', kind: 'finding' },
      ],
    } as NotesTranslation);

    const viewEn = buildNotesView(grounded, 'en');
    const fEn = viewEn.rows[0].flags;
    expect(fEn.length).toBeGreaterThan(0);
    expect(fEn[0]).toHaveProperty('severity');
    expect(fEn[0]).toHaveProperty('message');
    expect(typeof fEn[0].message).toBe('string');

    const viewZh = buildNotesView(grounded, 'zh');
    // same flags, different language string
    expect(viewZh.rows[0].flags[0].message).not.toBe(fEn[0].message);
  });

  it('total-drop fallback: the verbatim original is shown as an abstained row (never empty)', () => {
    const original = '医生说：未见占位，继续服用二甲双胍。';
    const grounded = groundNotes({ segments: [] }, original);
    const view = buildNotesView(grounded, 'en');
    expect(view.rows).toHaveLength(1);
    const r = view.rows[0];
    expect(r.source).toBe(original); // original carried through verbatim
    expect(r.translation).toBe(''); // never a silent simplified render
    expect(r.abstained).toBe(true);
    expect(r.abstainNote).not.toBe('');
    expect(view.overallAction).toBe('abstain');
  });

  it('carries the overall action through', () => {
    const grounded = groundNotes({
      segments: [
        { sourceText: '血压偏高，建议低盐饮食。', translatedText: 'Blood pressure is a bit high; a low-salt diet is suggested.', kind: 'instruction' },
        { sourceText: '活检提示恶性肿瘤细胞。', translatedText: 'Biopsy shows no malignant tumor cells.', kind: 'finding' },
      ],
    } as NotesTranslation);
    const view = buildNotesView(grounded, 'en');
    expect(view.overallAction).toBe('abstain');
  });
});
