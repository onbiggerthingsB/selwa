// Offline MT baseline (M4.2): deterministic, no network, no key.
//
// Returns a recorded "baseline unavailable" sentinel so the whole harness runs
// with zero configuration. The runner recognizes the sentinel and scores the
// offline baseline as a non-emission (it neither abstains nor emits a real
// translation), which keeps the comparison honest: an unconfigured baseline
// contributes no fidelity and no abstention, never a fake 1.0.

import { BASELINE_UNAVAILABLE, type Lang, type MtBaseline } from './MtBaseline';

export const offlineAdapter: MtBaseline = {
  id: 'offline',
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async translate(_text: string, _from: Lang, _to: Lang): Promise<string> {
    return BASELINE_UNAVAILABLE;
  },
};
