// Pluggable machine-translation baseline interface (M4.2).
//
// The validation harness scores OUR guarded pipeline against a baseline. Any
// translator that implements this interface can be dropped in: the offline
// sentinel (no key, fully deterministic), Google Cloud Translation (key-gated),
// or an unguarded Claude translate (key-gated) that isolates the safety delta of
// the guard alone.

export type Lang = 'zh' | 'en';

export interface MtBaseline {
  /** Stable id used in the report (e.g. 'offline', 'google', 'unguarded-llm'). */
  id: string;
  /** Translate `text` from `from` into `to`. Throws on a misconfigured key-gated adapter. */
  translate(text: string, from: Lang, to: Lang): Promise<string>;
}

// The exact string the offline adapter returns. Exported so the runner can
// recognize a "no translation available" result and score the baseline as a
// non-emission rather than a garbled translation.
export const BASELINE_UNAVAILABLE = '[[baseline-unavailable]]';
