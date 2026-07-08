import type { BehavioralCase } from '../types';
export const NEGATION_FLIP_DIR: BehavioralCase[] = [
  { id: 'dir-negation-flip', capability: 'R7-negation-polarity', testType: 'DIR', kind: 'notes',
    input: { sourceText: '未见明显积液', translatedText: 'effusion is present', kind: 'finding', originalText: '未见明显积液' },
    expect: { verdict: 'flag' } },
];
