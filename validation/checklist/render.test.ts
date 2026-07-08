import { describe, it, expect } from 'vitest';
import { renderChecklist } from './render';
import type { CaseResult } from './run';

const rows: CaseResult[] = [
  { id: 'a', capability: 'R1', testType: 'MFT', kind: 'labs', expected: 'abstain', actual: 'abstain', pass: true },
  { id: 'b', capability: 'R7', testType: 'DIR', kind: 'notes', expected: 'abstain', actual: 'render', pass: false, detail: 'x' },
];

describe('renderChecklist', () => {
  it('renders a table with a pass summary and marks failures', () => {
    const md = renderChecklist(rows);
    expect(md).toContain('1/2 passed');
    expect(md).toContain('| a | R1 | MFT');
    expect(md).toContain('**FAIL**');
  });
});
