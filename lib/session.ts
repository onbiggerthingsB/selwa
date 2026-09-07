'use client';
import { createStoredReport, normalizeStoredReport, type ReportWithOriginalNotes, type StoredReport } from '@/lib/reportStorage';

const KEY = 'ht:pending-report';

export type PendingReport = StoredReport;

export function setPendingReport(pending: ReportWithOriginalNotes): void {
  sessionStorage.setItem(KEY, JSON.stringify(createStoredReport(pending)));
}

export function getPendingReport(): PendingReport | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  // Errors remain distinguishable from absence; callers can offer local recovery.
  // No read writes a migration or clears a malformed/future-version record.
  return normalizeStoredReport(JSON.parse(raw));
}

export function clearPendingReport(): void {
  sessionStorage.removeItem(KEY);
}
