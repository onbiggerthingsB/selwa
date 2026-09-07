'use client';
import type { Lang } from '@/lib/i18n';
import { resolveText } from '@/lib/i18n';
import { LocalizedText } from '@/components/LocalizedText';
import { UI_COPY } from '@/lib/uiCopy';
import { REPORT_STORAGE_COPY } from '@/lib/reportStorageCopy';

// This interface intentionally cannot accept GroundedNotes. Historical model-supplied
// source strings and translations must never reappear as authoritative original notes.
export function NotesSection({ originalNotes, lang }: { originalNotes: string | null; lang: Lang }) {
  if (typeof originalNotes === 'string' && originalNotes.trim().length === 0) return null;
  return (
    <section className="notes-section" aria-label={resolveText(UI_COPY.doctorNotes, lang).text}>
      <div className="notes-head">
        <p className="eyebrow"><LocalizedText value={UI_COPY.doctorNotes} lang={lang} /></p>
        {typeof originalNotes === 'string' && (
          <p className="notes-sub"><LocalizedText value={UI_COPY.doctorNotesSummary} lang={lang} /></p>
        )}
      </div>
      {typeof originalNotes === 'string' ? (
        <p className="note-source" data-testid="original-notes" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {originalNotes}
        </p>
      ) : (
        <p className="notes-sub"><LocalizedText value={REPORT_STORAGE_COPY.originalUnavailable} lang={lang} /></p>
      )}
    </section>
  );
}
