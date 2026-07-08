import { evaluateSegment } from '@/lib/notesGuard';
import { detectImmutables } from '@/lib/notesDetect';
import type { GroundedNotes, GroundedSegment, GuardFlag, Immutable, SegmentAction } from '@/lib/types';
import type { NotesTranslation } from '@/lib/notesSchema';

// --- R7b imperative-polarity reconciliation ---------------------------------
const N_IMPERATIVE_FLIP = 'N-IMPERATIVE-FLIP';
function imperativeFlipFlag(): GuardFlag {
  return {
    id: N_IMPERATIVE_FLIP,
    severity: 'urgent',
    messageEn:
      'A medication instruction (whether to stop, keep taking, or change the dose) may not have carried over correctly, so your notes are shown exactly as written. Please confirm this with your clinician.',
    messageZh: '用药指示（停药、继续服用或调整剂量）可能未被正确传达，已按原文显示。请务必与您的医生确认。',
  };
}

// Language-independent directive polarity (hold | continue | dose-change:dir).
function polarityKey(im: Immutable): string {
  return im.imperative === 'dose-change' ? `dose-change:${im.doseDir ?? 'unknown'}` : im.imperative ?? 'unknown';
}
// Drug-scoped key — catches a per-drug SWAP: hold(A)+continue(B) rendered as continue(A)+
// hold(B), which a polarity-only multiset would miss. Cross-language safe (二甲双胍 and
// "metformin" → same drugId); unknown drug (null) keys by '?'.
function drugScopedKey(im: Immutable): string {
  return `${im.drugId ?? '?'}:${polarityKey(im)}`;
}

function isUnverifiable(im: Immutable): boolean {
  return im.imperative === 'unknown' || (im.imperative === 'dose-change' && im.doseDir === 'unknown');
}

// Detect imperatives under BOTH lexicons and union — so a mixed-script text (an English
// note carrying a Chinese drug name, or the reverse) can never route detection to the
// wrong lexicon and silently skip a directive (the unsafe direction). ZH markers are CJK
// and EN markers ASCII, so scanning the wrong script matches nothing → no double count.
function imperativesOf(text: string): Immutable[] {
  return [
    ...detectImmutables(text, 'zh').filter((im) => im.type === 'imperative'),
    ...detectImmutables(text, 'en').filter((im) => im.type === 'imperative'),
  ];
}

// True when the original's medication directives are NOT faithfully reproduced in the
// model's translation — a polarity flip (hold→continue), a per-drug swap, a dropped
// directive, or an inherently unverifiable one (bare "adjust"). Compares the ORIGINAL
// against the model TRANSLATION (not its echoed sourceText), because a flip is baked in at
// generation and the per-segment sourceText-vs-translatedText guard is blind to it. Bias: any doubt → true.
function imperativesInconsistent(original: string, translation: NotesTranslation): boolean {
  const origImp = imperativesOf(original);
  if (origImp.length === 0) return false; // no directive to protect
  if (origImp.some(isUnverifiable)) return true; // can't prove fidelity of an ambiguous order
  const transText = translation.segments.map((s) => s.translatedText).join('\n');
  const transImp = imperativesOf(transText);
  // A per-drug SWAP is only possible when ≥2 distinct polarities are in play. When every
  // directive on both sides is the SAME polarity, drug binding can't hide a flip — so key
  // by polarity ALONE, avoiding a false mismatch when a shared directive ("continue A and
  // B") binds to a different drug on each side after clause-splitting/reordering.
  const distinctPols = new Set([...origImp, ...transImp].map(polarityKey));
  const keyOf = distinctPols.size > 1 ? drugScopedKey : polarityKey;
  const orig = origImp.map(keyOf).sort().join('|');
  const trans = transImp.map(keyOf).sort().join('|');
  return orig !== trans;
}

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

    // R7b: a medication hold/continue/dose-direction flip is the highest-harm notes
    // failure — and unlike a DROP, a flipped segment still carries a WRONG translation that
    // the per-segment guard renders. So do not merely append: REPLACE the whole note with
    // the verbatim original (like a total drop), guaranteeing the wrong instruction is never
    // surfaced. (Requires originalText — the app always supplies it.)
    if (imperativesInconsistent(original, translation)) {
      return {
        segments: [makeFallbackSegment(original, imperativeFlipFlag())],
        overallAction: 'abstain',
      };
    }

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
