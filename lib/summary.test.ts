import { describe, it, expect } from 'vitest';
import { buildSummary } from './summary';
import { groundExtraction } from './grounding';
import type { LabExtraction } from '@/lib/extractionSchema';

const extraction: LabExtraction = {
  rows: [
    { name: '空腹血糖', value: '7.8', unit: 'mmol/L', printedRange: '3.9-6.1', confidence: 'high' },
    { name: 'homocysteine', value: '15', unit: 'umol/L', printedRange: '5-15', confidence: 'high' },
  ],
};

describe('buildSummary', () => {
  const report = groundExtraction(extraction, 'unknown');

  it('always includes disclaimers', () => {
    expect(buildSummary(report, 'en').disclaimers.length).toBeGreaterThan(0);
    expect(buildSummary(report, 'zh').disclaimers.length).toBeGreaterThan(0);
  });

  it('renders a known analyte with name, value, classification label, and plain meaning', () => {
    const { sections } = buildSummary(report, 'en');
    const glu = sections.find((s) => s.key === 'fasting_glucose')!;
    expect(glu.title).toContain('Fasting plasma glucose');
    expect(glu.valueText).toBe('7.8 mmol/L');
    expect(glu.statusLabel.toLowerCase()).toContain('high');
    expect(glu.plain).toMatch(/blood sugar/i);
    expect(glu.flags.length).toBeGreaterThan(0); // high-stakes
  });

  it('renders Mandarin labels when lang=zh', () => {
    const { sections } = buildSummary(report, 'zh');
    const glu = sections.find((s) => s.key === 'fasting_glucose')!;
    expect(glu.title).toContain('空腹血糖');
    expect(glu.plain).toMatch(/血糖/);
  });

  it('presents an unclassified (unknown) analyte neutrally, with no status judgment', () => {
    const { sections } = buildSummary(report, 'en');
    const hcy = sections.find((s) => s.title.includes('homocysteine'))!;
    expect(hcy.status).toBe('unclassified');
    expect(hcy.statusLabel.toLowerCase()).toContain('not interpreted');
    expect(hcy.plain).toBe(''); // no invented meaning
  });
});
