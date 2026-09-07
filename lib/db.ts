'use client';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { GroundedReport, GroundedNotes } from '@/lib/types';
import { createStoredReport, normalizeStoredReport, type StoredReport } from '@/lib/reportStorage';

export interface VisitRecord extends StoredReport {
  id: string;
  createdAt: number;
}

interface VisitDB extends DBSchema {
  visits: { key: string; value: VisitRecord; indexes: { 'by-date': number } };
}

let dbp: Promise<IDBPDatabase<VisitDB>> | null = null;
function db() {
  if (!dbp) {
    // The object-store layout is unchanged. Version the records, not the database,
    // so an already-open older tab cannot block an unnecessary schema upgrade.
    dbp = openDB<VisitDB>('health-translator', 1, {
      upgrade(d) {
        const s = d.createObjectStore('visits', { keyPath: 'id' });
        s.createIndex('by-date', 'createdAt');
      },
    }).catch((error: unknown) => {
      dbp = null; // a denied/failed open must not poison every subsequent retry
      throw error;
    });
  }
  return dbp;
}

export async function saveVisit(report: GroundedReport, originalNotes: string | null, notes?: GroundedNotes): Promise<VisitRecord> {
  const rec: VisitRecord = {
    ...createStoredReport({ report, originalNotes, ...(notes ? { notes } : {}) }),
    id: crypto.randomUUID(), createdAt: Date.now(),
  };
  await (await db()).put('visits', rec);
  return rec;
}
function normalizeVisit(value: unknown): VisitRecord {
  const record = normalizeStoredReport(value);
  const metadata = value as { id?: unknown; createdAt?: unknown };
  if (typeof metadata.id !== 'string' || !metadata.id
    || typeof metadata.createdAt !== 'number' || !Number.isFinite(metadata.createdAt)
    || Number.isNaN(new Date(metadata.createdAt).getTime())) {
    throw new Error('Invalid saved visit');
  }
  return { ...record, id: metadata.id, createdAt: metadata.createdAt };
}

export async function listVisits(): Promise<{ visits: VisitRecord[]; unreadableCount: number }> {
  // Read the store itself: a malformed/missing date may be absent from the index.
  const all = await (await db()).getAll('visits');
  const visits: VisitRecord[] = [];
  let unreadableCount = 0;
  for (const value of all) {
    try { visits.push(normalizeVisit(value)); } catch { unreadableCount += 1; }
  }
  visits.sort((a, b) => b.createdAt - a.createdAt);
  return { visits, unreadableCount }; // newest first; unrecognized data remains stored
}
export async function getVisit(id: string): Promise<VisitRecord | undefined> {
  const value = await (await db()).get('visits', id);
  return value === undefined ? undefined : normalizeVisit(value);
}
export async function deleteVisit(id: string): Promise<void> {
  await (await db()).delete('visits', id);
}
