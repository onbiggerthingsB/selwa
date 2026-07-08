import { describe, it, expect } from 'vitest';
import { groundingRecall } from './groundingRecall';
import { FIXTURE_OBSERVATIONS } from './fixture/observations';

describe('groundingRecall', () => {
  it('scores our deterministic classification agreement vs the dataset abnormal flag', () => {
    const r = groundingRecall(FIXTURE_OBSERVATIONS);
    expect(r.scored).toBeGreaterThan(0);
    expect(r.agreement).toBeGreaterThanOrEqual(0);
    expect(r.agreement).toBeLessThanOrEqual(1);
  });
});
