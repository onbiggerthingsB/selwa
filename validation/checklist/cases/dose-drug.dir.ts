import type { BehavioralCase } from '../types';
export const DOSE_DRUG_DIR: BehavioralCase[] = [
  { id: 'dir-dose-altered', capability: 'R8-dose', testType: 'DIR', kind: 'notes',
    input: { sourceText: '二甲双胍 850mg 每日两次', translatedText: 'metformin 400mg twice daily', kind: 'medication', originalText: '二甲双胍 850mg 每日两次' },
    expect: { verdict: 'abstain' } },
  { id: 'dir-drug-substituted', capability: 'R9-drug', testType: 'DIR', kind: 'notes',
    input: { sourceText: '阿托伐他汀 20mg', translatedText: 'atenolol 20mg', kind: 'medication', originalText: '阿托伐他汀 20mg' },
    expect: { verdict: 'abstain' } },
];
