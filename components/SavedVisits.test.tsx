import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeStoredReport } from '@/lib/reportStorage';

const mocks = vi.hoisted(() => ({ listVisits: vi.fn(), deleteVisit: vi.fn() }));
vi.mock('@/lib/db', () => ({ listVisits: mocks.listVisits, deleteVisit: mocks.deleteVisit }));
vi.mock('@/components/SummaryView', () => ({ SummaryView: () => <p>Saved lab facts</p> }));
import { SavedVisits } from './SavedVisits';
const report = { rows: [], sex: 'unknown', generatedAt: 1 };
const notes = { segments: [{ source: 'MODEL-DERIVED SOURCE', translated: 'UNSAFE GENERATED INSTRUCTION', action: 'render' }], overallAction: 'render' };

beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);

async function openVisit() {
  fireEvent.click(await screen.findByRole('button', { name: /values/ }));
}

describe('saved reports suppress historical generated notes', () => {
  it('shows exact originals, retains lab rendering, and never shows model fields even if they coexist', async () => {
    const original = '  Actual input\n第二行\t ';
    mocks.listVisits.mockResolvedValue({ visits: [{ schemaVersion: 2, id: 'v', createdAt: 1, report, originalNotes: original, notes }], unreadableCount: 0 });
    const { container } = render(<SavedVisits lang="en" />);
    await openVisit();
    expect(screen.getByText('Saved lab facts')).toBeInTheDocument();
    expect(screen.getByTestId('original-notes').textContent).toBe(original);
    expect(container).not.toHaveTextContent('MODEL-DERIVED SOURCE');
    expect(container).not.toHaveTextContent('UNSAFE GENERATED INSTRUCTION');
    expect(container.querySelector('[data-translation-review="unverified"]')).toBeNull();
  });

  it('truthfully marks a legacy original unavailable without restoring any generated text', async () => {
    mocks.listVisits.mockResolvedValue({ visits: [{ ...normalizeStoredReport({ report, notes }), id: 'old', createdAt: 1 }], unreadableCount: 0 });
    const { container } = render(<SavedVisits lang="en" />);
    await openVisit();
    expect(screen.getByText(/original notes are unavailable/)).toBeInTheDocument();
    expect(container).not.toHaveTextContent('MODEL-DERIVED SOURCE');
    expect(container).not.toHaveTextContent('UNSAFE GENERATED INSTRUCTION');
  });

  it('surfaces unavailable records while letting valid reports open', async () => {
    mocks.listVisits.mockResolvedValue({ visits: [{ schemaVersion: 2, id: 'v', createdAt: 1, report, originalNotes: '' }], unreadableCount: 2 });
    render(<SavedVisits lang="en" />);
    expect(await screen.findByRole('status')).toHaveTextContent('Some saved reports cannot be displayed');
    await openVisit();
    expect(screen.getByText('Saved lab facts')).toBeInTheDocument();
    expect(screen.queryByText(/original notes are unavailable/)).toBeNull();
  });

  it('can retry a failed read and reports a failed delete without dropping the report', async () => {
    const result = { visits: [{ schemaVersion: 2, id: 'v', createdAt: 1, report, originalNotes: 'original' }], unreadableCount: 0 };
    mocks.listVisits.mockRejectedValueOnce(new DOMException('denied')).mockResolvedValue(result);
    mocks.deleteVisit.mockRejectedValueOnce(new DOMException('denied'));
    render(<SavedVisits lang="en" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not open');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await openVisit();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be deleted');
    expect(screen.getByTestId('original-notes')).toHaveTextContent('original');
  });
});
