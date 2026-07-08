import { describe, it, expect } from 'vitest';
import { runExtractionBenchmark } from './medrepbench';
import { FIXTURE_SAMPLES } from './fixture/samples';
import type { Extractor } from './extractor';

const perfect: Extractor = {
  id: 'perfect-fake',
  async extract(sample) { return sample.gold.map((g) => ({ ...g })); },
};

describe('runExtractionBenchmark', () => {
  it('aggregates field recall across samples with a pluggable extractor', async () => {
    const report = await runExtractionBenchmark(FIXTURE_SAMPLES, perfect);
    expect(report.sampleCount).toBe(FIXTURE_SAMPLES.length);
    expect(report.meanOverallRecall).toBeCloseTo(1, 6);
    expect(report.perField.value).toBeCloseTo(1, 6);
  });

  it('an extractor that drops a row lowers recall', async () => {
    const lossy: Extractor = { id: 'lossy', async extract(s) { return s.gold.slice(0, 1); } };
    const report = await runExtractionBenchmark(FIXTURE_SAMPLES, lossy);
    expect(report.meanOverallRecall).toBeLessThan(1);
  });
});
