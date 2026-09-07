import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroundedReport } from './types';
import { getPendingReport, setPendingReport } from './session';

const mocks = vi.hoisted(() => ({
  openDB: vi.fn(), put: vi.fn(), get: vi.fn(), getAll: vi.fn(), delete: vi.fn(),
}));
vi.mock('idb', () => ({ openDB: mocks.openDB }));

const report: GroundedReport = { rows: [], sex: 'unknown', generatedAt: 123 };
let stored: Map<string, unknown>;
let db: typeof import('./db');

describe('saved original notes', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    sessionStorage.clear();
    stored = new Map();
    mocks.put.mockImplementation(async (_store: string, record: { id: string }) => { stored.set(record.id, structuredClone(record)); });
    mocks.get.mockImplementation(async (_store: string, id: string) => structuredClone(stored.get(id)));
    mocks.getAll.mockImplementation(async () => [...stored.values()].map((record) => structuredClone(record)));
    mocks.delete.mockImplementation(async (_store: string, id: string) => { stored.delete(id); });
    mocks.openDB.mockResolvedValue(mocks);
    db = await import('./db');
  });

  it.each(['  原文\nབོད་\ne\u0301\t ', '', ' \n\t '])('preserves the exact original through session, save, reload, and listing', async (text) => {
    setPendingReport({ report, originalNotes: text });
    const pending = getPendingReport()!;
    const saved = await db.saveVisit(pending.report, pending.originalNotes);
    expect(saved.schemaVersion).toBe(2);
    expect((await db.getVisit(saved.id))?.originalNotes).toBe(text);
    expect((await db.getVisit(saved.id))?.report).toEqual(report);
    expect(await db.listVisits()).toEqual({ visits: [saved], unreadableCount: 0 });
    // Record versioning does not unnecessarily upgrade/block old browser connections.
    expect(mocks.openDB).toHaveBeenCalledWith('health-translator', 1, expect.any(Object));
  });

  it('keeps legacy payload untouched, never infers an original, and retains it on an explicit save', async () => {
    const notes = { segments: [{ source: 'MODEL SOURCE', translated: 'GENERATED' }] };
    const old = { id: 'old', createdAt: 1, report, notes };
    stored.set('old', structuredClone(old));
    const read = await db.getVisit('old');
    expect(read).toMatchObject({ schemaVersion: 2, originalNotes: null, notes, report });
    expect(stored.get('old')).toEqual(old);
    expect(mocks.put).not.toHaveBeenCalled();
    const saved = await db.saveVisit(read!.report, read!.originalNotes, read!.notes);
    expect((await db.getVisit(saved.id))?.notes).toEqual(notes);
    expect((await db.getVisit(saved.id))?.originalNotes).toBeNull();
  });

  it('does not hide valid labs when another record is corrupt or from a future app', async () => {
    stored.set('bad', { id: 'bad', createdAt: 1, report: null });
    stored.set('future', { id: 'future', createdAt: 2, schemaVersion: 9, report, originalNotes: 'future original' });
    stored.set('missing-date', { id: 'missing-date', report });
    stored.set('invalid-date', { id: 'invalid-date', createdAt: 1e30, report });
    stored.set('bad-row', { id: 'bad-row', createdAt: 3, report: { ...report, rows: [null] } });
    const valid = await db.saveVisit(report, 'valid original');
    expect(await db.listVisits()).toEqual({ visits: [valid], unreadableCount: 5 });
    expect(stored.size).toBe(6);
    await expect(db.getVisit('future')).rejects.toThrow('Unsupported');
  });

  it('rejects an old signature that passes model segments in the original-text position', async () => {
    await expect(db.saveVisit(report, { segments: [] } as unknown as string)).rejects.toThrow('Invalid original notes');
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('surfaces a failed write and permits a later explicit retry', async () => {
    mocks.put.mockRejectedValueOnce(new DOMException('quota exceeded'));
    await expect(db.saveVisit(report, 'original')).rejects.toThrow();
    expect(stored.size).toBe(0);
    await db.saveVisit(report, 'original');
    expect(stored.size).toBe(1);
  });

  it('retries a denied database open rather than retaining a permanently rejected promise', async () => {
    mocks.openDB.mockRejectedValueOnce(new DOMException('denied'));
    await expect(db.listVisits()).rejects.toThrow();
    expect(await db.listVisits()).toEqual({ visits: [], unreadableCount: 0 });
    expect(mocks.openDB).toHaveBeenCalledTimes(2);
  });
});
