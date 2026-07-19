// Unguarded-LLM baseline (M4.2): key-gated Claude translate WITHOUT the guard.
//
// This adapter isolates the SAFETY DELTA of the deterministic guard. It asks
// Claude for a plain translation of the same source text but DOES NOT run
// notesGuard/groundNotes over the result — so any dropped negation, rounded
// dose, or substituted drug the model introduces flows straight through. The
// runner then scores this raw translation with the same metrics as OURS; the
// gap between them is exactly what the guard buys.
//
// It constructs its own Anthropic client (it must NOT import the app's
// server-only helper or the guarded route). With no ANTHROPIC_API_KEY it throws
// a clear error; tests mock the SDK.

import Anthropic from '@anthropic-ai/sdk';
import type { SourceLang, MtBaseline } from './MtBaseline';

const TRANSLATE_PROMPT = [
  'Translate the following clinical text into the target language for a patient.',
  'Return ONLY the translation, with no preamble, notes, or formatting.',
].join(' ');

const LANG_NAME: Record<SourceLang, string> = { zh: 'Chinese', en: 'English' };

// Injectable for tests; defaults to a real client built from the env key.
export interface AnthropicLike {
  messages: {
    create(args: unknown): Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
}

let cached: AnthropicLike | null = null;
function defaultClient(): AnthropicLike {
  if (!cached) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'unguardedLlmAdapter requires ANTHROPIC_API_KEY. ' +
          'Set it to run the unguarded-LLM baseline, or use the offline adapter.',
      );
    }
    cached = new Anthropic({ apiKey }) as unknown as AnthropicLike;
  }
  return cached;
}

export function makeUnguardedLlmAdapter(client?: AnthropicLike): MtBaseline {
  return {
    id: 'unguarded-llm',
    async translate(text: string, _from: SourceLang, to: SourceLang): Promise<string> {
      const c = client ?? defaultClient();
      const message = await c.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `${TRANSLATE_PROMPT}\nTarget language: ${LANG_NAME[to]}.\n\n${text}`,
          },
        ],
      });
      const block = message.content.find((b) => b.type === 'text');
      const out = block?.text;
      if (typeof out !== 'string') {
        throw new Error('unguardedLlmAdapter: model returned no text.');
      }
      return out.trim();
    },
  };
}

// Default instance using the env-keyed client (lazily constructed on first call).
export const unguardedLlmAdapter: MtBaseline = makeUnguardedLlmAdapter();
