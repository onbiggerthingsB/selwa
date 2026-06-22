import { evaluateSegment } from '@/lib/notesGuard';
import type { GroundedNotes, GroundedSegment, SegmentAction } from '@/lib/types';
import type { NotesTranslation } from '@/lib/notesSchema';

// Severity ordering for the overall verdict: abstain (unsafe) > flag (caution) > render (clean).
const ACTION_RANK: Record<SegmentAction, number> = { render: 0, flag: 1, abstain: 2 };
function maxAction(a: SegmentAction, b: SegmentAction): SegmentAction {
  return ACTION_RANK[a] >= ACTION_RANK[b] ? a : b;
}

/**
 * Ground a model translation against the deterministic notes guard.
 *
 * For each segment we run `evaluateSegment`. The guard's verdict is authoritative:
 * when it returns `abstain` the translation is unsafe and is BLANKED — the UI must
 * fall back to the verbatim source. `flag` keeps the translation but attaches a
 * caution; `render` is clean. The source is always carried through unchanged.
 */
export function groundNotes(translation: NotesTranslation): GroundedNotes {
  const segments: GroundedSegment[] = translation.segments.map((seg) => {
    const evaluation = evaluateSegment({
      sourceText: seg.sourceText,
      translatedText: seg.translatedText,
      kind: seg.kind,
    });
    return {
      source: seg.sourceText,
      // The unsafe translation is never surfaced; the caller shows the source verbatim instead.
      translated: evaluation.action === 'abstain' ? '' : seg.translatedText,
      kind: seg.kind,
      action: evaluation.action,
      flags: evaluation.flags,
      preserved: evaluation.preserved,
    };
  });

  const overallAction = segments.reduce<SegmentAction>((acc, s) => maxAction(acc, s.action), 'render');

  return { segments, overallAction };
}
