'use client';
import type { GroundedReport } from '@/lib/types';

const KEY = 'ht:pending-report';

export function setPendingReport(report: GroundedReport): void {
  sessionStorage.setItem(KEY, JSON.stringify(report));
}
export function getPendingReport(): GroundedReport | null {
  const raw = sessionStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as GroundedReport) : null;
}
export function clearPendingReport(): void {
  sessionStorage.removeItem(KEY);
}
