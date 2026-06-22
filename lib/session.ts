'use client';
import type { GroundedReport, GroundedNotes } from '@/lib/types';

const KEY = 'ht:pending-report';

export interface PendingReport {
  report: GroundedReport;
  notes?: GroundedNotes; // optional doctor-notes translation, grounded against the guard
}

export function setPendingReport(pending: PendingReport): void {
  sessionStorage.setItem(KEY, JSON.stringify(pending));
}

export function getPendingReport(): PendingReport | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as PendingReport | GroundedReport;
  // Back-compat: an earlier build stored a bare GroundedReport. Wrap it.
  if (parsed && typeof parsed === 'object' && 'report' in parsed) {
    return parsed as PendingReport;
  }
  return { report: parsed as GroundedReport };
}

export function clearPendingReport(): void {
  sessionStorage.removeItem(KEY);
}
