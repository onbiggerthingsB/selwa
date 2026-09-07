import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroundedReport } from '@/lib/types';
import { setPendingReport } from '@/lib/session';

const mocks = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn() }, saveVisit: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('@/lib/db', () => ({ saveVisit: mocks.saveVisit }));
vi.mock('@/components/RowManifest', () => ({ RowManifest: ({ onAcknowledged }: { onAcknowledged: () => void }) => <button onClick={onAcknowledged}>Acknowledge labs</button> }));
vi.mock('@/components/ConfirmValues', () => ({ ConfirmValues: ({ report, onConfirmed }: { report: GroundedReport; onConfirmed: (report: GroundedReport) => void }) => <button onClick={() => onConfirmed(report)}>Confirm labs</button> }));
vi.mock('@/components/SummaryView', () => ({ SummaryView: () => <p>Confirmed lab facts</p> }));
import ResultPage from './page';

const report: GroundedReport = { rows: [], sex: 'unknown', generatedAt: 1 };
const notes = { segments: [{ source: 'MODEL SOURCE', translated: 'UNSAFE GENERATED INSTRUCTION', action: 'render' }], overallAction: 'render' };

beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear(); mocks.saveVisit.mockResolvedValue({ id: 'saved' }); });
afterEach(cleanup);

async function revealResult() {
  fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge labs' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm labs' }));
}

describe('result original-note wiring', () => {
  it('preserves exact originals across capture-session display and an explicit save', async () => {
    const original = '  Original\n原文\te\u0301 ';
    setPendingReport({ report, originalNotes: original });
    render(<ResultPage />);
    expect(screen.queryByTestId('original-notes')).toBeNull();
    await revealResult();
    expect(screen.getByText('Confirmed lab facts')).toBeInTheDocument();
    expect(screen.getByTestId('original-notes').textContent).toBe(original);
    fireEvent.click(screen.getByRole('button', { name: /Keep this report/ }));
    await waitFor(() => expect(mocks.saveVisit).toHaveBeenCalledWith(report, original, undefined));
    await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith('/'));
    expect(sessionStorage.getItem('ht:pending-report')).toBeNull();
  });

  it('suppresses all legacy generated text, preserving its payload when the user explicitly saves', async () => {
    sessionStorage.setItem('ht:pending-report', JSON.stringify({ report, notes }));
    const { container } = render(<ResultPage />);
    await revealResult();
    expect(screen.getByText(/original notes are unavailable/)).toBeInTheDocument();
    expect(container).not.toHaveTextContent('MODEL SOURCE');
    expect(container).not.toHaveTextContent('UNSAFE GENERATED INSTRUCTION');
    expect(container.querySelector('[data-translation-review="unverified"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Keep this report/ }));
    await waitFor(() => expect(mocks.saveVisit).toHaveBeenCalledWith(report, null, notes));
  });

  it('does not claim that an empty original is unavailable', async () => {
    setPendingReport({ report, originalNotes: '' });
    render(<ResultPage />);
    await revealResult();
    expect(screen.queryByText(/original notes are unavailable/)).toBeNull();
    expect(screen.queryByTestId('original-notes')).toBeNull();
  });

  it('reports malformed pending storage without clearing it or treating it as an absent report', async () => {
    sessionStorage.setItem('ht:pending-report', 'not JSON');
    render(<ResultPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not open');
    expect(mocks.router.replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('ht:pending-report')).toBe('not JSON');
    setPendingReport({ report, originalNotes: 'recovered' });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await revealResult();
    expect(screen.getByTestId('original-notes')).toHaveTextContent('recovered');
  });
});
