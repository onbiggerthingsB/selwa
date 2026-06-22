import type { GroundedNotes, Immutable, ImmutableType, SegmentAction, SegmentKind } from '@/lib/types';
import type { Lang } from '@/lib/summary';

export interface NotesViewFlag {
  severity: string;
  message: string;
}

export interface NotesViewChip {
  type: ImmutableType;
  label: string; // the verbatim source span (dose / drug / number / negation), never reworded
}

export interface NotesViewRow {
  source: string; // ALWAYS present
  translation: string; // '' when abstained — the unsafe translation is never shown
  kind: SegmentKind;
  kindLabel: string;
  action: SegmentAction;
  abstained: boolean;
  abstainNote: string; // localized "shown as written; we can't safely simplify this one" — only when abstained
  flags: NotesViewFlag[];
  chips: NotesViewChip[];
}

export interface NotesView {
  rows: NotesViewRow[];
  overallAction: SegmentAction;
}

const KIND_LABEL: Record<SegmentKind, { en: string; zh: string }> = {
  finding: { en: 'Finding', zh: '检查所见' },
  medication: { en: 'Medication', zh: '用药' },
  instruction: { en: 'Instruction', zh: '医嘱' },
  followup: { en: 'Follow-up', zh: '复诊' },
  other: { en: 'Note', zh: '其他' },
};

const ABSTAIN_NOTE = {
  en: "Shown as written — we can't safely simplify this one.",
  zh: '按原文显示——这一句我们无法安全地简化。',
};

export function buildNotesView(notes: GroundedNotes, lang: Lang): NotesView {
  const rows: NotesViewRow[] = notes.segments.map((seg) => {
    const abstained = seg.action === 'abstain';
    return {
      source: seg.source,
      translation: seg.translated, // already blanked to '' on abstain by groundNotes
      kind: seg.kind,
      kindLabel: lang === 'zh' ? KIND_LABEL[seg.kind].zh : KIND_LABEL[seg.kind].en,
      action: seg.action,
      abstained,
      abstainNote: abstained ? (lang === 'zh' ? ABSTAIN_NOTE.zh : ABSTAIN_NOTE.en) : '',
      flags: seg.flags.map((f) => ({
        severity: f.severity,
        message: lang === 'zh' ? f.messageZh : f.messageEn,
      })),
      chips: seg.preserved.map((im: Immutable) => ({ type: im.type, label: im.raw })),
    };
  });

  return { rows, overallAction: notes.overallAction };
}
