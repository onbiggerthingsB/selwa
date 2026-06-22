import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SummaryView } from './SummaryView';
import { groundExtraction } from '@/lib/grounding';
import type { LabExtraction } from '@/lib/extractionSchema';

const report = (() => {
  const extraction: LabExtraction = {
    rows: [
      { name: '空腹血糖', value: '7.8', unit: 'mmol/L', printedRange: '3.9-6.1', confidence: 'high' },
      { name: 'homocysteine', value: '15', unit: 'umol/L', printedRange: null, confidence: 'high' },
    ],
  };
  return { ...groundExtraction(extraction, 'unknown'), generatedAt: 0 };
})();

describe('SummaryView', () => {
  it('shows the analyte, value, status and a clinician flag for a high-stakes high result', () => {
    render(<SummaryView report={report} lang="en" />);
    expect(screen.getByText(/Fasting plasma glucose/)).toBeInTheDocument();
    expect(screen.getByText('7.8 mmol/L')).toBeInTheDocument();
    expect(screen.getAllByText(/High/i).length).toBeGreaterThan(0);
    // multiple flags carry the clinician phrase (R4, R12, R1) — assert at least one
    expect(screen.getAllByText(/confirm this with your clinician/i).length).toBeGreaterThan(0);
  });

  it('presents an unknown analyte without a normal/abnormal judgment', () => {
    render(<SummaryView report={report} lang="en" />);
    expect(screen.getByText(/homocysteine/)).toBeInTheDocument();
    expect(screen.getByText(/not interpreted/i)).toBeInTheDocument();
  });

  it('always renders the disclaimers', () => {
    render(<SummaryView report={report} lang="en" />);
    expect(screen.getByText(/not medical advice/i)).toBeInTheDocument();
  });
});
