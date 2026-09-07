import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPendingReport, getPendingReport, setPendingReport } from './session';
import type { GroundedReport } from './types';

const key = 'ht:pending-report';
const report: GroundedReport = { rows: [], sex: 'unknown', generatedAt: 123 };

describe('pending report original-notes provenance', () => {
  beforeEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });

  it.each(['  原文\nབོད་\ne\u0301\t ', '', ' \n\t '])('round-trips exact entered text %j in a versioned envelope', (text) => {
    setPendingReport({ report, originalNotes: text });
    expect(getPendingReport()).toEqual({ schemaVersion: 2, report, originalNotes: text });
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual({ schemaVersion: 2, report, originalNotes: text });
  });

  it('reads a bare legacy lab report without claiming an original note exists', () => {
    const raw = JSON.stringify(report);
    sessionStorage.setItem(key, raw);
    expect(getPendingReport()).toEqual({ schemaVersion: 2, report, originalNotes: null });
    expect(sessionStorage.getItem(key)).toBe(raw);
  });

  it('retains legacy generated data but never treats model source or an unversioned field as original', () => {
    const notes = { segments: [{ source: 'MODEL SOURCE', translated: 'GENERATED TRANSLATION' }] };
    const raw = JSON.stringify({ report, notes, originalNotes: 'UNPROVEN ORIGINAL' });
    sessionStorage.setItem(key, raw);
    expect(getPendingReport()).toEqual({ schemaVersion: 2, report, notes, originalNotes: null });
    expect(sessionStorage.getItem(key)).toBe(raw);
  });

  it.each([
    'invalid JSON',
    JSON.stringify({ schemaVersion: 3, report, originalNotes: 'future' }),
    JSON.stringify({ schemaVersion: 2, report }),
    JSON.stringify({ schemaVersion: 2, report, originalNotes: { text: 'not a string' } }),
    JSON.stringify({ report: null }),
    JSON.stringify({ report: { ...report, rows: [null] } }),
    JSON.stringify({ report: { ...report, rows: [{}] } }),
  ])('reports corrupt or unsupported storage without deleting it', (raw) => {
    sessionStorage.setItem(key, raw);
    expect(() => getPendingReport()).toThrow();
    expect(sessionStorage.getItem(key)).toBe(raw);
  });

  it('preserves an existing pending report when a new write is denied', () => {
    setPendingReport({ report, originalNotes: 'prior original' });
    const raw = sessionStorage.getItem(key);
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('denied'); });
    expect(() => setPendingReport({ report, originalNotes: 'new original' })).toThrow();
    write.mockRestore();
    expect(sessionStorage.getItem(key)).toBe(raw);
  });

  it('distinguishes a denied read from an absent report and clears only explicitly', () => {
    expect(getPendingReport()).toBeNull();
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied'); });
    expect(() => getPendingReport()).toThrow();
    read.mockRestore();
    setPendingReport({ report, originalNotes: 'retained' });
    clearPendingReport();
    expect(getPendingReport()).toBeNull();
  });
});
