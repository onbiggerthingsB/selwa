---
type: project
title: "Health Translator — Mode 2 (Live Interpreter) Architecture Sketch"
created: 2026-06-22
status: sketch
owner: agent
source: "v1 plan M5; grounded in docs/DESIGN.md (v2 milestone) + the completed v1 safety spine"
---

# Mode 2 — Live In-Visit Interpreter (Architecture Sketch)

> **Status: sketch, not a build plan.** This defines the interfaces, the reuse map onto the existing safety spine, and the sequencing/risk so Mode 2 can be picked up later as its **own** brainstorm → spec → plan cycle. It is deliberately *not* task-level TDD — Mode 2 is v2-sized and its detail will change once it's the active milestone. Do not implement from this document; use it to scope the Mode 2 design session.

## 1. What Mode 2 is

The headline v2 "wow": a real-time, two-way **spoken** interpreter for the clinical encounter — the patient speaks Mandarin, the clinician hears English (and vice versa) — **carrying the same safety guarantee as Mode 1**. Generic real-time speech translation (Google/Apple) already exists and is free; the entire reason to build this is that it **flags its own uncertainty and refuses to guess on high-stakes content** (dosages, negations, drug names, lab values), and **logs a kept record** of the conversation. If it ever degrades into "live-caption the room," Google wins — so Mode 2 is built boundary-first, on the v1 deterministic spine.

## 2. The pipeline

```
mic (patient or clinician)
  → AsrProvider           streaming speech → text (+ partial/final, +confidence), per language
  → segmenter             accumulate to clause/utterance boundaries (reuse splitClauses semantics)
  → translate(+confidence) MT/LLM translation of the finalized segment, emitting per-segment confidence
  → notesGuard.evaluateSegment(source, translated)   ← THE REUSED SAFETY CORE (R7/R8/R9)
       render  → speak + caption
       flag    → speak + caption WITH an audible/visual "confirm this" marker
       abstain → DO NOT speak the translation; show source + "please confirm with the clinician",
                 prompt a repeat/clarify, or hand to a human interpreter
  → TtsProvider           text → speech in the target language (only for render/flag, never abstain)
  → caption UI            live bilingual captions, immutables pinned, flags inline
  → visit record store    append each turn (source, translation, action, flags) to the same on-device record
```

The crucial property: **the same deterministic `notesGuard` that fences Mode 1's doctor-notes translation fences every spoken turn.** The LLM/MT proposes a translation; the guard recomputes immutables from the ASR source and refuses to let a dropped negation, altered dose, or substituted drug be *spoken*. Audio is higher-stakes than text because **you cannot un-say it** — so the abstain path must gate *before* TTS, never after.

## 3. Interfaces (defined here, implemented in the Mode 2 build)

```ts
// Streaming ASR — provider-agnostic (cloud first; on-device later for latency/privacy)
interface AsrSegment {
  text: string;
  lang: 'zh' | 'en';
  isFinal: boolean;          // partials drive live captions; only finals enter the guard
  confidence: number;        // 0..1, advisory only (never sufficient to clear a high-stakes turn)
  startMs: number; endMs: number;
}
interface AsrProvider {
  start(input: MediaStream, lang: 'zh' | 'en' | 'auto'): AsyncIterable<AsrSegment>;
  stop(): Promise<void>;
}

// Streaming TTS
interface TtsProvider {
  speak(text: string, lang: 'zh' | 'en', opts?: { interruptible?: boolean }): Promise<void>;
  cancel(): void;            // barge-in: stop speaking when the other party starts
}

// A live interpreting session — the state machine + the kept record
type TurnAction = 'render' | 'flag' | 'abstain';   // == SegmentAction, reused
interface LiveTurn {
  id: string;
  speaker: 'patient' | 'clinician';
  sourceText: string; sourceLang: 'zh' | 'en';
  translatedText: string;    // '' when action === 'abstain'
  action: TurnAction;
  flags: GuardFlag[];        // == v1 GuardFlag
  atMs: number;
}
interface LiveSession {
  turns: LiveTurn[];
  status: 'idle' | 'listening' | 'translating' | 'speaking' | 'awaiting-confirm';
  toRecord(): GroundedNotes; // fold the transcript into the same on-device record shape as Mode 1
}
```

`AsrSegment.confidence` and the translation confidence are **advisory** — they may gate a low-stakes turn faster, but a high-stakes turn (dose/negation/drug/result-polarity, per the v1 guard) **always** passes the deterministic guard and, where the guard abstains, the **confirm-before-speak** gate.

## 4. Reuse map (what already exists from v1)

| Mode 2 needs | Reuse from v1 (built, tested) |
|---|---|
| Translation fidelity / abstention | `lib/notesGuard.ts` `evaluateSegment` (R7/R8/R9, 18 red-team FMs, fail-safe) — **verbatim** |
| Immutable detection | `lib/notesDetect.ts` + `data/medical-lexicon.ts` |
| Clause segmentation | `splitClauses` from `lib/notesDetect.ts` |
| Per-turn rendering (source-always-shown, abstain blanks translation) | `lib/notesSummary.ts` / `components/NotesSection.tsx` patterns |
| Kept record, on-device | `lib/db.ts` `VisitRecord` (extend with a `liveSession?`), `GroundedNotes` shape |
| Safety/disclaimer spine | `DisclaimerBanner`, the "confirm with your clinician" flag language |
| Validation | `validation/` harness — add live-transcript corpus cases; the metrics generalize |

Mode 2 adds essentially **two new capabilities** (ASR, TTS) and **one new UX** (realtime confirm-before-speak); everything about *meaning safety* is already built and validated.

## 5. The hard parts (sequencing & risk — for the Mode 2 design session)

1. **You can't un-say audio.** The single biggest design problem. The abstain path must intercept *before* TTS. Design the confirm-before-speak gate: on a high-stakes/abstain turn, the app does NOT speak the machine translation — it surfaces the source + a "please confirm" prompt to a bilingual party, or escalates to a human interpreter. This is the inverse of Mode 1 (where the user reads at their own pace) and is the core UX research question.
2. **Latency vs the guard.** The deterministic guard is fast (pure TS), but ASR finalization + translation + TTS is a multi-hundred-ms pipeline. Cloud-first for quality (v2.0); move the fast path on-device later (v2.1) for latency and PHI privacy. Partial captions hide latency; only finals are spoken.
3. **ASR/TTS provider selection.** Multilingual streaming ASR with word-level confidence (and Mandarin quality) is the gating dependency. Provider-agnostic `AsrProvider`/`TtsProvider` so the choice isn't load-bearing. Evaluate on-device options (WebGPU/Whisper-class) for the privacy story.
4. **PHI in audio.** Audio is the most sensitive PHI yet. The Mode 1 promise ("nothing stored server-side") is harder with cloud ASR — audio transits a provider. Document the trade-off honestly; the on-device path is the eventual answer. Explicit consent + a clear data-handling policy before any cloud ASR.
5. **Turn-taking, barge-in, diarization.** Two speakers, interruptions, who-is-speaking. `TtsProvider.cancel()` for barge-in; speaker attribution drives the source language and the record.
6. **Failure modes are audible.** A mistranslation that gets spoken is worse than a silent one — so the bias toward abstention is even stronger than Mode 1. The validation harness must add a live-audio corpus and measure spoken-error rate, not just text fidelity.

## 6. Recommended milestone shape (when Mode 2 becomes active)

- **v2.0** — cloud ASR/TTS, one direction at a time, the confirm-before-speak gate, captions, the reused guard, the kept live record. Prove the safety UX before optimizing latency.
- **v2.1** — two-way + barge-in + latency tuning.
- **v2.2** — on-device fast path (privacy + latency), Tibetan/low-resource exploration (the DESIGN.md v3 edge) on the same spine.

Each is its own brainstorm → spec → plan cycle. The safety spine does not change; only the surface (audio) and its UX do.
