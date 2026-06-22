import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BASELINE_UNAVAILABLE } from './MtBaseline';
import { offlineAdapter } from './offlineAdapter';
import { googleAdapter } from './googleAdapter';
import { makeUnguardedLlmAdapter, unguardedLlmAdapter } from './unguardedLlmAdapter';

describe('offlineAdapter', () => {
  it('is deterministic and returns the unavailable sentinel with no key', async () => {
    const a = await offlineAdapter.translate('未见占位', 'zh', 'en');
    const b = await offlineAdapter.translate('anything else', 'en', 'zh');
    expect(a).toBe(BASELINE_UNAVAILABLE);
    expect(b).toBe(BASELINE_UNAVAILABLE);
    expect(offlineAdapter.id).toBe('offline');
  });
});

describe('googleAdapter', () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.GOOGLE_TRANSLATE_API_KEY;
  beforeEach(() => {
    delete process.env.GOOGLE_TRANSLATE_API_KEY;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.GOOGLE_TRANSLATE_API_KEY;
    else process.env.GOOGLE_TRANSLATE_API_KEY = realKey;
  });

  it('throws a clear error when no key is set', async () => {
    await expect(googleAdapter.translate('x', 'zh', 'en')).rejects.toThrow(
      /GOOGLE_TRANSLATE_API_KEY/,
    );
  });

  it('calls the API and returns the translation when a key is set (mocked fetch)', async () => {
    process.env.GOOGLE_TRANSLATE_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { translations: [{ translatedText: 'No mass seen.' }] } }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const out = await googleAdapter.translate('未见占位', 'zh', 'en');
    expect(out).toBe('No mass seen.');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('key=test-key');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      q: '未见占位',
      source: 'zh',
      target: 'en',
    });
  });

  it('throws on a non-ok response', async () => {
    process.env.GOOGLE_TRANSLATE_API_KEY = 'test-key';
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden' }) as unknown as typeof fetch;
    await expect(googleAdapter.translate('x', 'zh', 'en')).rejects.toThrow(/403/);
  });
});

describe('unguardedLlmAdapter', () => {
  const realKey = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = realKey;
  });

  it('translates via the injected client (mocked SDK), without any guard', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Chest X-ray shows a mass.' }],
    });
    const adapter = makeUnguardedLlmAdapter({ messages: { create } });
    const out = await adapter.translate('胸片未见占位', 'zh', 'en');
    expect(out).toBe('Chest X-ray shows a mass.');
    expect(adapter.id).toBe('unguarded-llm');
    // The model output is returned verbatim — no abstention, no fidelity check.
    expect(create).toHaveBeenCalledOnce();
  });

  it('throws when the model returns no text block', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'tool_use' }] });
    const adapter = makeUnguardedLlmAdapter({ messages: { create } });
    await expect(adapter.translate('x', 'zh', 'en')).rejects.toThrow(/no text/);
  });

  it('the default adapter throws a clear error when no key is set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(unguardedLlmAdapter.translate('x', 'zh', 'en')).rejects.toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });
});
