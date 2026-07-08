import type { CaseResult } from './run';

export function renderChecklist(results: CaseResult[]): string {
  const passed = results.filter((r) => r.pass).length;
  const lines: string[] = [];
  lines.push('## CheckList behavioral suite (R1–R12 + notesGuard)');
  lines.push('');
  lines.push(`${passed}/${results.length} passed. MFT = minimum functionality, INV = invariance, DIR = directional.`);
  lines.push('');
  lines.push('| Case | Capability | Type | Kind | Expected | Actual | Result |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of results) {
    lines.push(
      `| ${r.id} | ${r.capability} | ${r.testType} | ${r.kind} | ${r.expected} | ${r.actual} | ${r.pass ? 'pass' : '**FAIL**'} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
