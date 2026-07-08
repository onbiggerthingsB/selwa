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

// --- Original-text reconciliation (completeness fail-open seam) ---------------
// The per-segment guard fences FIDELITY (sourceText vs translatedText) but both
// come from the LLM. Nothing reconciles the returned segments against the user's
// ORIGINAL typed notes. groundNotes(translation, originalText) closes that seam:
// dropped clauses can never be silently lost — the verbatim original is surfaced.
describe('groundNotes — original-text reconciliation (completeness)', () => {
  const N_DROP = 'N-COMPLETENESS-DROP';

  it('total drop: empty segments + original text → one abstain fallback showing the source verbatim', () => {
    const original = '医生说：未见占位，继续服用二甲双胍。';
    const grounded = groundNotes({ segments: [] }, original);

    expect(grounded.overallAction).toBe('abstain');
    expect(grounded.segments).toHaveLength(1);
    const s = grounded.segments[0];
    expect(s.source).toBe(original); // the raw original is shown — nothing lost
    expect(s.translated).toBe(''); // never a silent empty render
    expect(s.action).toBe('abstain');
    expect(s.flags.map((f) => f.id)).toContain(N_DROP);
  });

  it('total drop where every segment has empty sourceText → still abstain fallback with original', () => {
    const original = '未见结节。继续服药。';
    const grounded = groundNotes(
      { segments: [{ sourceText: '   ', translatedText: 'whatever', kind: 'other' }] },
      original,
    );
    expect(grounded.overallAction).toBe('abstain');
    const fallback = grounded.segments.find((s) => s.flags.some((f) => f.id === N_DROP));
    expect(fallback).toBeDefined();
    expect(fallback!.source).toBe(original);
    expect(fallback!.translated).toBe('');
  });

  it('partial drop: a dropped negation in the original raises a whole-notes flag/abstain', () => {
    // Original has TWO negated findings; the LLM only returned one segment, dropping
    // the "未见结节" clause entirely. The per-segment guard sees nothing wrong with the
    // one returned segment, but reconciliation catches the dropped negation.
    const original = '未见占位。未见结节。';
    const grounded = groundNotes(
      {
        segments: [
          { sourceText: '未见占位。', translatedText: 'No mass seen.', kind: 'finding' },
        ],
      },
      original,
    );
    // overall escalated to abstain (a high-risk negation was dropped)
    expect(grounded.overallAction).toBe('abstain');
    const fallback = grounded.segments.find((s) => s.flags.some((f) => f.id === N_DROP));
    expect(fallback).toBeDefined();
    expect(fallback!.source).toBe(original); // original shown verbatim
    expect(fallback!.translated).toBe('');
  });

  it('partial drop: a dropped drug raises a completeness flag', () => {
    // Original names two drugs; segments cover only one — aspirin is dropped. (No
    // imperative words here, so this isolates the drug-drop path; a dropped hold/
    // continue directive is covered separately by the R7b imperative-flip tests.)
    const original = '二甲双胍 850mg 每日两次。阿司匹林 100mg 每日一次。';
    const grounded = groundNotes(
      {
        segments: [
          { sourceText: '二甲双胍 850mg 每日两次。', translatedText: 'Metformin 850 mg twice daily.', kind: 'medication' },
        ],
      },
      original,
    );
    const fallback = grounded.segments.find((s) => s.flags.some((f) => f.id === N_DROP));
    expect(fallback).toBeDefined();
    expect(fallback!.source).toBe(original);
  });

  it('faithful complete case: segments fully cover the original → NO completeness flag, renders normally', () => {
    const original = '二甲双胍 850mg 每日两次。';
    const grounded = groundNotes(
      {
        segments: [
          { sourceText: '二甲双胍 850mg 每日两次。', translatedText: 'Metformin 850 mg twice daily.', kind: 'medication' },
        ],
      },
      original,
    );
    expect(grounded.segments).toHaveLength(1);
    expect(grounded.segments.every((s) => !s.flags.some((f) => f.id === N_DROP))).toBe(true);
    expect(grounded.overallAction).toBe('render');
    expect(grounded.segments[0].translated).toBe('Metformin 850 mg twice daily.');
  });

  it('back-compat: omitting originalText leaves behavior unchanged (no fallback segment)', () => {
    const grounded = groundNotes({
      segments: [
        { sourceText: '二甲双胍 850mg 每日两次。', translatedText: 'Metformin 850 mg twice daily.', kind: 'medication' },
      ],
    });
    expect(grounded.segments).toHaveLength(1);
    expect(grounded.segments.every((s) => !s.flags.some((f) => f.id === N_DROP))).toBe(true);
  });

  it('empty segments AND empty original → unchanged empty render (no spurious fallback)', () => {
    const grounded = groundNotes({ segments: [] }, '   ');
    expect(grounded.segments).toHaveLength(0);
    expect(grounded.overallAction).toBe('render');
  });
});
