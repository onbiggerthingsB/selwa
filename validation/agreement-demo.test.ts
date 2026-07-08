import { describe, it, expect } from 'vitest';
import { AGREEMENT_DEMO } from './agreement-demo';
import { agreementStats } from './agreement';

describe('AGREEMENT_DEMO', () => {
  it('is a set of boolean verdict pairs with high raw agreement', () => {
    expect(AGREEMENT_DEMO.length).toBeGreaterThanOrEqual(10);
    expect(agreementStats(AGREEMENT_DEMO).rawAgreement).toBeGreaterThan(0.8);
  });
});
