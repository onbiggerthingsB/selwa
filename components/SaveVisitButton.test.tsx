import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroundedNotes, GroundedReport } from '@/lib/types';

const mocks = vi.hoisted(() => ({ saveVisit: vi.fn(), clearPendingReport: vi.fn(), push: vi.fn() }));
vi.mock('@/lib/db', () => ({ saveVisit: mocks.saveVisit }));
vi.mock('@/lib/session', () => ({ clearPendingReport: mocks.clearPendingReport }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
import { SaveVisitButton } from './SaveVisitButton';
const report: GroundedReport = { rows: [], sex: 'unknown', generatedAt: 1 };
const original = '  原文\nབོད་\t ';

beforeEach(() => { vi.resetAllMocks(); mocks.saveVisit.mockResolvedValue({ id: 'saved' }); });
afterEach(cleanup);

describe('explicit durable report save', () => {
  it('sends exact originals and retained legacy data, then clears the pending copy only after a successful write', async () => {
    const notes = { segments: [], overallAction: 'abstain' } as GroundedNotes;
    let finish!: () => void;
    mocks.saveVisit.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<SaveVisitButton report={report} originalNotes={original} notes={notes} lang="en" />);
    const button = screen.getByRole('button', { name: /Keep this report/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.saveVisit).toHaveBeenCalledTimes(1);
    expect(mocks.saveVisit).toHaveBeenCalledWith(report, original, notes);
    expect(mocks.clearPendingReport).not.toHaveBeenCalled();
    expect(button).toBeDisabled();
    await act(async () => finish());
    expect(mocks.clearPendingReport).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith('/');
  });

  it('retains pending data and offers another save after a failed write', async () => {
    mocks.saveVisit.mockRejectedValueOnce(new DOMException('quota'));
    render(<SaveVisitButton report={report} originalNotes={original} lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /Keep this report/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
    expect(mocks.clearPendingReport).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Keep this report/ }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/'));
    expect(mocks.saveVisit).toHaveBeenCalledTimes(2);
    expect(mocks.saveVisit).toHaveBeenLastCalledWith(report, original, undefined);
  });

  it('does not save again when clearing the temporary copy fails after a durable write', async () => {
    mocks.clearPendingReport.mockImplementationOnce(() => { throw new DOMException('denied'); });
    render(<SaveVisitButton report={report} originalNotes={original} lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /Keep this report/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your report is saved');
    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
    expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry clearing and finish' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/'));
    expect(mocks.saveVisit).toHaveBeenCalledTimes(1);
    expect(mocks.clearPendingReport).toHaveBeenCalledTimes(2);
  });
});
