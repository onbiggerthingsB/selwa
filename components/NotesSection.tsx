'use client';
import type { GroundedNotes } from '@/lib/types';
import { buildNotesView, type NotesViewFlag, type NotesViewRow } from '@/lib/notesSummary';
import type { Lang } from '@/lib/summary';
import { LocalizedText } from '@/components/LocalizedText';
import { resolveText } from '@/lib/i18n';
import { UI_COPY } from '@/lib/uiCopy';

function FlagIcon({ severity }: { severity: string }) {
  const common = {
    width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
    className: 'flag-icon', 'aria-hidden': true,
  };
  if (severity === 'urgent') {
    return (
      <svg {...common}>
        <path d="M12 21c4-2.5 7-5.5 7-9.5V6l-7-3-7 3v5.5c0 4 3 7 7 9.5z" />
        <path d="m9 11.5 2 2 4-4" />
      </svg>
    );
  }
  if (severity === 'caution') {
    return (
      <svg {...common}>
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
        <path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function NoteCard({ r, lang }: { r: NotesViewRow; lang: Lang }) {
  return (
    <li className={`row note-row${r.abstained ? ' note-held' : ''}`}>
      <div className="note-head">
        <span className="note-kind">
          <LocalizedText value={r.kindLabel} lang={lang} />
        </span>
      </div>

      {/* The source clause is ALWAYS shown, verbatim. */}
      <p className="note-source" lang="auto">
        {r.source}
      </p>

      {r.abstained ? (
        <p className="note-held-note">
          <FlagIcon severity="urgent" />
          {r.abstainNote && <LocalizedText value={r.abstainNote} lang={lang} />}
        </p>
      ) : (
        r.translation && (
          <p className="note-translation" lang="auto">
            {r.translation}
          </p>
        )
      )}

      {r.chips.length > 0 && (
        <div
          className="note-chips"
          aria-label={resolveText(UI_COPY.keptExactly, lang).text}
        >
          {r.chips.map((c, i) => (
            <span key={i} className={`note-chip note-chip-${c.type}`}>
              {c.label}
            </span>
          ))}
        </div>
      )}

      {r.flags.length > 0 && (
        <div className="flags">
          {r.flags.map((f: NotesViewFlag, i) => (
            <div key={i} className={`flag flag-${f.severity}`}>
              <FlagIcon severity={f.severity} />
              <LocalizedText value={f.message} lang={lang} />
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

export function NotesSection({ notes, lang }: { notes: GroundedNotes; lang: Lang }) {
  const view = buildNotesView(notes);
  if (view.rows.length === 0) return null;

  return (
    <section
      className="notes-section"
      aria-label={resolveText(UI_COPY.doctorNotes, lang).text}
    >
      <div className="notes-head">
        <p className="eyebrow">
          <LocalizedText value={UI_COPY.doctorNotes} lang={lang} />
        </p>
        <p className="notes-sub">
          <LocalizedText value={UI_COPY.doctorNotesSummary} lang={lang} />
        </p>
      </div>
      <ul className="rows">
        {view.rows.map((r, i) => (
          <NoteCard key={i} r={r} lang={lang} />
        ))}
      </ul>
    </section>
  );
}
