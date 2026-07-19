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
    // B1: the surfaced flag routes ("confirm the value we read") — it must NOT assert a verdict
    // ("your value is outside the usual range" / "critical range"), which now stays internal.
    expect(screen.getAllByText(/confirm the value we read/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/outside the usual range|critical range|seek medical/i)).toBeNull();
    // B1 blocker #2: the CARD education text is the direction-neutral definition, and the fuller
    // directional description ("can indicate prediabetes or diabetes") must NOT render beneath the
    // chip. This is the exact composition Codex flagged (directional clause under a status chip).
    expect(screen.getByText(/Blood sugar level after fasting/i)).toBeInTheDocument();
    expect(screen.queryByText(/prediabetes or diabetes/i)).toBeNull();
  });

  it('prints the reference range on the card (the grounding made visible)', () => {
    render(<SummaryView report={report} lang="en" />);
    expect(screen.getByText(/3\.9–6\.1 mmol\/L/)).toBeInTheDocument();
  });

  it('presents an unknown analyte without a normal/abnormal judgment', () => {
    const { container } = render(<SummaryView report={report} lang="en" />);
    const rawName = screen.getByText('ceruloplasmin');
    expect(rawName).toBeInTheDocument();
    expect(
      rawName.closest('.name-primary')?.querySelector(
        '[data-translation-review="unverified"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelectorAll('[data-translation-review="unverified"]').length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/not assessed/i).length).toBeGreaterThan(0);
  });

  it('renders the warm disclaimer lead', () => {
    render(<SummaryView report={report} lang="en" />);
    expect(screen.getByText(/not medical advice/i)).toBeInTheDocument();
  });

  it('emphasizes Mandarin when lang=zh but still shows English', () => {
    render(<SummaryView report={report} lang="zh" />);
    // B1: the ZH "high" signal is the report-relative status chip, not a directional verdict in the
    // education text (the card now shows the direction-neutral definition "空腹时的血糖水平").
    expect(screen.getAllByText(/高于报告所列范围/).length).toBeGreaterThan(0); // zh "above report's range" chip
    expect(screen.getByText('Fasting plasma glucose')).toBeInTheDocument(); // EN still present
  });

  it('shows explicit Chinese fallback as the bo primary and English as secondary', () => {
    const { container } = render(<SummaryView report={report} lang="bo" />);

    const firstRow = container.querySelector('.rows > .row');
    expect(firstRow).not.toBeNull();

    const primary = firstRow!.querySelector('.name-primary');
    const secondary = firstRow!.querySelector('.name-secondary');
    expect(primary).toHaveTextContent('空腹血糖翻译未经审核');
    expect(secondary).toHaveTextContent(/^Fasting plasma glucose$/);
    expect(
      primary!.querySelector('[data-requested-lang="bo"][data-resolved-lang="zh"]'),
    ).not.toBeNull();
    expect(
      secondary!.querySelector('[data-requested-lang="en"][data-resolved-lang="en"]'),
    ).not.toBeNull();

    const markers = screen.getAllByText('翻译未经审核');
    expect(markers.length).toBeGreaterThan(0);
    expect(markers.every((marker) => marker.getAttribute('lang') === 'zh')).toBe(true);
    expect(
      screen.getAllByText(/高于报告所列范围/).some((node) =>
        node.closest('[data-requested-lang="bo"][data-resolved-lang="zh"]'),
      ),
    ).toBe(true);
  });
});
