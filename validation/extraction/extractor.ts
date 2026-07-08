// Pluggable extractor for the MedRepBench benchmark (validation-rigor cycle).
// The offline/fake path needs no key; the Claude adapter is opt-in and key-gated,
// mirroring baseline/googleAdapter + baseline/unguardedLlmAdapter.
import type { ExtractedField, ExtractionSample } from './types';

export interface Extractor {
  id: string;
  extract(sample: ExtractionSample): Promise<ExtractedField[]>;
}

/**
 * Claude-vision extractor. Reads the image from sample.imagePath and asks the
 * model to transcribe the five fields — EXTRACTION ONLY (no interpretation),
 * matching the app's OCR-only invariant. Requires ANTHROPIC_API_KEY; throws if
 * unset so callers keep it strictly opt-in. Lazy-imports the SDK so the module
 * loads without it.
 */
export function claudeExtractor(): Extractor {
  return {
    id: 'claude-vision',
    async extract(sample: ExtractionSample): Promise<ExtractedField[]> {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error('ANTHROPIC_API_KEY required for the claude-vision extractor');
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const { readFileSync } = await import('node:fs');
      const client = new Anthropic({ apiKey: key });
      const b64 = readFileSync(sample.imagePath).toString('base64');
      const mediaType = sample.imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const msg = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType as 'image/png' | 'image/jpeg', data: b64 } },
            { type: 'text', text:
              'Transcribe EVERY lab row from this report as JSON: {"rows":[{"name","value","unit","referenceRange","abnormalFlag"}]}. ' +
              'Copy exactly what is printed. Do NOT infer, convert, or interpret. Use "" for any field not printed. Output JSON only.' },
          ],
        }],
      });
      const text = msg.content.find((b) => b.type === 'text');
      const raw = text && 'text' in text ? text.text : '{"rows":[]}';
      const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
      return (json.rows ?? []).map((r: Record<string, unknown>) => ({
        name: String(r.name ?? ''), value: String(r.value ?? ''), unit: String(r.unit ?? ''),
        referenceRange: String(r.referenceRange ?? ''), abnormalFlag: String(r.abnormalFlag ?? ''),
      }));
    },
  };
}
