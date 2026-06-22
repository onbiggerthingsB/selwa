import { describe, it, expect } from 'vitest';
import { NotesTranslationSchema, NOTES_PROMPT } from './notesSchema';

describe('NotesTranslationSchema', () => {
  it('parses a well-formed translation', () => {
    const ok = NotesTranslationSchema.safeParse({
      segments: [
        { sourceText: '胸片未见明显占位性病变。', translatedText: 'Chest X-ray shows no obvious mass.', kind: 'finding' },
        { sourceText: '二甲双胍 850mg 每日两次。', translatedText: 'Metformin 850 mg twice daily.', kind: 'medication' },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it('allows an empty segments array', () => {
    const ok = NotesTranslationSchema.safeParse({ segments: [] });
    expect(ok.success).toBe(true);
  });

  it('accepts every valid kind enum value', () => {
    for (const kind of ['finding', 'medication', 'instruction', 'followup', 'other'] as const) {
      const ok = NotesTranslationSchema.safeParse({
        segments: [{ sourceText: 's', translatedText: 't', kind }],
      });
      expect(ok.success).toBe(true);
    }
  });

  it('rejects an invalid kind enum', () => {
    const bad = NotesTranslationSchema.safeParse({
      segments: [{ sourceText: 's', translatedText: 't', kind: 'diagnosis' }],
    });
    expect(bad.success).toBe(false);
  });

  it('rejects a missing field', () => {
    const bad = NotesTranslationSchema.safeParse({
      segments: [{ sourceText: 's', kind: 'finding' }],
    });
    expect(bad.success).toBe(false);
  });

  it('exposes a translate-only prompt that forbids inference and demands verbatim preservation', () => {
    expect(NOTES_PROMPT).toMatch(/translate/i);
    expect(NOTES_PROMPT).toMatch(/simplif/i);
    // forbids inference: no added diagnosis / recommendation
    expect(NOTES_PROMPT).toMatch(/do not add|not add a diagnosis/i);
    expect(NOTES_PROMPT).toMatch(/diagnosis/i);
    expect(NOTES_PROMPT).toMatch(/recommendation/i);
    // demands verbatim preservation of the immutables
    expect(NOTES_PROMPT).toMatch(/dose/i);
    expect(NOTES_PROMPT).toMatch(/negation/i);
    expect(NOTES_PROMPT).toMatch(/drug name/i);
    expect(NOTES_PROMPT).toMatch(/number/i);
    expect(NOTES_PROMPT).toMatch(/exactly|verbatim/i);
  });
});
