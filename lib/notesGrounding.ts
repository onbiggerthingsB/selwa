import { evaluateSegment } from '@/lib/notesGuard';
import { detectImmutables } from '@/lib/notesDetect';
import type { GroundedNotes, GroundedSegment, GuardFlag, Immutable, SegmentAction } from '@/lib/types';
import type { NotesTranslation } from '@/lib/notesSchema';

// Severity ordering for the overall verdict: abstain (unsafe) > flag (caution) > render (clean).
const ACTION_RANK: Record<SegmentAction, number> = { render: 0, flag: 1, abstain: 2 };
function maxAction(a: SegmentAction, b: SegmentAction): SegmentAction {
  return ACTION_RANK[a] >= ACTION_RANK[b] ? a : b;
}

// --- Completeness flag (original-text reconciliation) ------------------------
const N_COMPLETENESS_DROP = 'N-COMPLETENESS-DROP';
function completenessDropFlag(severity: GuardFlag['severity']): GuardFlag {
  return {
    id: N_COMPLETENESS_DROP,
    severity,
    messageEn:
      "Some of your notes couldn't be safely matched, so they're shown exactly as written. Please confirm this with your clinician.",
    messageZh: '部分内容无法安全匹配，已按原文显示。请与您的医生确认。',
  };
}

// Infer the note language by Chinese-character presence (mirrors notesGuard).
function inferLang(text: string): 'en' | 'zh' {
  return /[一-鿿]/u.test(text) ? 'zh' : 'en';
}

// Normalized comparison keys for the immutable classes we reconcile. We compare
// by the SAME surface/identity the detectors produce: drugs/negations by surface,
// doses by amount + unit dimension. Bare numbers are intentionally excluded —
// the per-segment guard already reconciles numbers, and a bare count dropped
// alongside its clause is caught by that clause's negation/drug/dose key.
function immutableKeys(im: Immutable): string[] {
  switch (im.type) {
    case 'negation':
      // Key by the canonical finding span the detector scopes. A negation with no
      // finding still keys (by empty finding) so its presence is tracked.
      return [`neg:${im.finding ?? ''}`];
    case 'drug':
      return [im.drugId ? `drug:${im.drugId}` : `drug:?:${im.raw}`];
    case 'dosage':
      return [`dose:${im.amount ?? ''}:${im.unitDim ?? ''}`];
    default:
      return [];
  }
}

// A dropped negation or drug flips/loses clinical meaning → high-risk (abstain).
// A dropped dose is serious but recoverable in-band → flag.
function isHighRiskType(im: Immutable): boolean {
  return im.type === 'negation' || im.type === 'drug';
}

/**
 * Ground a model translation against the deterministic notes guard, then
 * reconcile the returned segments against the user's ORIGINAL typed notes.
 *
 * Per-segment, `evaluateSegment` is authoritative on FIDELITY (sourceText vs
 * translatedText). But both of those come from the LLM, so the per-segment guard
 * cannot see a clause the LLM dropped wholesale (omitted from `segments`) or a
 * `sourceText` the LLM rewrote. `originalText` closes that fail-open seam:
 *
 *  - TOTAL DROP (no usable segments): we surface ONE abstain fallback carrying the
 *    verbatim original — nothing is ever silently lost.
 *  - PARTIAL DROP: if any negation/dosage/drug immutable present in the original is
 *    not covered by the union of the segments' source text, we append a whole-notes
 *    abstain fallback showing the original verbatim and escalate the overall verdict
 *    (abstain if a high-risk immutable was dropped, else flag). We bias to safety:
 *    when uncertain whether an immutable is covered, we treat it as dropped.
 *
 * `originalText` is optional for back-compat; the app always passes it.
 */
export function groundNotes(translation: NotesTranslation, originalText?: string): GroundedNotes {
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

  let overallAction = segments.reduce<SegmentAction>((acc, s) => maxAction(acc, s.action), 'render');

  const original = (originalText ?? '').trim();
  if (original.length > 0) {
    // The union of every segment's source text — what the LLM claims it covered.
    const coveredSource = translation.segments.map((s) => s.sourceText).join('\n');
    const hasUsableSource = translation.segments.some((s) => s.sourceText.trim().length > 0);

    if (!hasUsableSource) {
      // --- TOTAL DROP: every segment empty (or none at all). Replace the (empty)
      // segment list with a single abstain fallback showing the raw original.
      return {
        segments: [makeFallbackSegment(original, completenessDropFlag('urgent'))],
        overallAction: 'abstain',
      };
    }

    // --- PARTIAL DROP: reconcile the original's immutables against the union of
    // the segments' source text. Anything not covered (by normalized key) is
    // treated as dropped — bias to safety.
    const lang = inferLang(original);
    const originalIm = detectImmutables(original, lang);
    const coveredKeys = new Set(
      detectImmutables(coveredSource, inferLang(coveredSource)).flatMap(immutableKeys),
    );

    const dropped = originalIm.filter((im) => {
      const keys = immutableKeys(im);
      if (keys.length === 0) return false; // not a class we reconcile
      // Covered only if EVERY key is present; otherwise treat as dropped (safety).
      return !keys.every((k) => coveredKeys.has(k));
    });

    if (dropped.length > 0) {
      const highRiskDropped = dropped.some(isHighRiskType);
      const flag = completenessDropFlag(highRiskDropped ? 'urgent' : 'caution');
      segments.push(makeFallbackSegment(original, flag));
      overallAction = maxAction(overallAction, highRiskDropped ? 'abstain' : 'flag');
    }
  }

  return { segments, overallAction };
}

// A whole-notes fallback segment: the verbatim original, never simplified,
// rendered through the existing abstain path (source shown, translation blank).
function makeFallbackSegment(original: string, flag: GuardFlag): GroundedSegment {
  return {
    source: original,
    translated: '',
    kind: 'other',
    action: 'abstain',
    flags: [flag],
    preserved: [],
  };
}
