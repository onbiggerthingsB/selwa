import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SummaryView } from './SummaryView';
import { groundExtraction } from '@/lib/grounding';
import type { LabExtraction } from '@/lib/extractionSchema';

const report = (() => {
  const extraction: LabExtraction = {
    rows: [
      { name: '空腹血糖', value: '7.8', unit: 'mmol/L', printedRange: '3.9-6.1', confidence: 'high' },
      { name: 'ceruloplasmin', value: '15', unit: 'umol/L', printedRange: null, confidence: 'high' },
    ],
  };
  return { ...groundExtraction(extraction, 'unknown'), generatedAt: 0 };
})();

describe('SummaryView', () => {
  it('shows the analyte (both languages), value, status, and a clinician flag for a high-stakes high result', () => {
    render(<SummaryView report={report} lang="en" />);
    expect(screen.getByText(/Fasting plasma glucose/)).toBeInTheDocument();
    expect(screen.getByText('空腹血糖')).toBeInTheDocument(); // ZH always present too
    expect(screen.getByText('7.8')).toBeInTheDocument();
    expect(screen.getAllByText(/High/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/confirm this with your clinician/i).length).toBeGreaterThan(0);
  });

  it('prints the reference range on the card (the grounding made visible)', () => {
    render(<SummaryView report={report} lang="en" />);
    expect(screen.getByText(/3\.9–6\.1 mmol\/L/)).toBeInTheDocument();
  });

  it('presents an unknown analyte without a normal/abnormal judgment', () => {
    render(<SummaryView report={report} lang="en" />);
    expect(screen.getByText('ceruloplasmin')).toBeInTheDocument();
    expect(screen.getAllByText(/not assessed/i).length).toBeGreaterThan(0);
  });

  it('renders the warm disclaimer lead', () => {
    render(<SummaryView report={report} lang="en" />);
    expect(screen.getByText(/not medical advice/i)).toBeInTheDocument();
  });

  it('emphasizes Mandarin when lang=zh but still shows English', () => {
    render(<SummaryView report={report} lang="zh" />);
    expect(screen.getAllByText(/偏高/).length).toBeGreaterThan(0); // zh "high" label
    expect(screen.getByText('Fasting plasma glucose')).toBeInTheDocument(); // EN still present
  });
});
