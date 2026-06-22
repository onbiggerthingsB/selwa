'use client';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { GroundedReport } from '@/lib/types';

export interface VisitRecord {
  id: string;
  createdAt: number;
  report: GroundedReport;
}

interface VisitDB extends DBSchema {
  visits: { key: string; value: VisitRecord; indexes: { 'by-date': number } };
}

let dbp: Promise<IDBPDatabase<VisitDB>> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB<VisitDB>('health-translator', 1, {
      upgrade(d) {
        const s = d.createObjectStore('visits', { keyPath: 'id' });
        s.createIndex('by-date', 'createdAt');
      },
    });
  }
  return dbp;
}

export async function saveVisit(report: GroundedReport): Promise<VisitRecord> {
  const rec: VisitRecord = { id: crypto.randomUUID(), createdAt: Date.now(), report };
  await (await db()).put('visits', rec);
  return rec;
}
export async function listVisits(): Promise<VisitRecord[]> {
  const all = await (await db()).getAllFromIndex('visits', 'by-date');
  return all.reverse(); // newest first
}
export async function getVisit(id: string): Promise<VisitRecord | undefined> {
  return (await db()).get('visits', id);
}
export async function deleteVisit(id: string): Promise<void> {
  await (await db()).delete('visits', id);
}
