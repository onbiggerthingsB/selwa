import { describe, it, expect } from 'vitest';
import { CHECKLIST } from './index';
import { runBehavioralCase } from './run';

describe('CHECKLIST', () => {
  it('has unique ids and covers all three test types', () => {
    const ids = CHECKLIST.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const types = new Set(CHECKLIST.map((c) => c.testType));
    expect(types).toEqual(new Set(['MFT', 'INV', 'DIR']));
  });

  it('every behavioral case passes against the real guard (safety regression suite)', () => {
    const failures = CHECKLIST.map(runBehavioralCase).filter((r) => !r.pass);
    expect(failures, JSON.stringify(failures, null, 2)).toHaveLength(0);
  });
});
