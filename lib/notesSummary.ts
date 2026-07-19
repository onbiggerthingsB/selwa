import type { GroundedNotes, Immutable, ImmutableType, SegmentAction, SegmentKind } from '@/lib/types';
import {
  defineText,
  fallback,
  reviewed,
  type LocalizedText,
} from '@/lib/i18n';

export interface NotesViewFlag {
  severity: string;
  message: LocalizedText;
}

export interface NotesViewChip {
  type: ImmutableType;
  label: string; // the verbatim source span (dose / drug / number / negation), never reworded
}

export interface NotesViewRow {
  source: string; // ALWAYS present
  translation: string; // '' when abstained — the unsafe translation is never shown
  kind: SegmentKind;
  kindLabel: LocalizedText;
  action: SegmentAction;
  abstained: boolean;
  abstainNote: LocalizedText | null; // only when abstained
  flags: NotesViewFlag[];
  chips: NotesViewChip[];
}

export interface NotesView {
  rows: NotesViewRow[];
  overallAction: SegmentAction;
}

const KIND_LABEL: Record<SegmentKind, LocalizedText> = {
  finding: defineText({
    en: reviewed('Finding'),
    zh: reviewed('检查所见'),
    bo: fallback('zh'),
  }),
  medication: defineText({
    en: reviewed('Medication'),
    zh: reviewed('用药'),
    bo: fallback('zh'),
  }),
  instruction: defineText({
    en: reviewed('Instruction'),
    zh: reviewed('医嘱'),
    bo: fallback('zh'),
  }),
  followup: defineText({
    en: reviewed('Follow-up'),
    zh: reviewed('复诊'),
    bo: fallback('zh'),
  }),
  other: defineText({
    en: reviewed('Note'),
    zh: reviewed('其他'),
    bo: fallback('zh'),
  }),
};

const ABSTAIN_NOTE = defineText({
  en: reviewed("Shown as written — we can't safely simplify this one."),
  zh: reviewed('按原文显示——这一句我们无法安全地简化。'),
  bo: fallback('zh'),
});

export function buildNotesView(notes: GroundedNotes): NotesView {
  const rows: NotesViewRow[] = notes.segments.map((seg) => {
    const abstained = seg.action === 'abstain';
    return {
      source: seg.source,
      translation: seg.translated, // already blanked to '' on abstain by groundNotes
      kind: seg.kind,
      kindLabel: KIND_LABEL[seg.kind],
      action: seg.action,
      abstained,
      abstainNote: abstained ? ABSTAIN_NOTE : null,
      flags: seg.flags.map((f) => ({
        severity: f.severity,
        message: f.message,
      })),
      chips: seg.preserved.map((im: Immutable) => ({ type: im.type, label: im.raw })),
    };
  });

  return { rows, overallAction: notes.overallAction };
}
