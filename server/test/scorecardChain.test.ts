import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.GEMINI_API_KEY = 'g-key';
process.env.GROQ_API_KEY = 'groq-key';
process.env.OPENROUTER_API_KEY = 'or-key';
const { readScorecard, _resetGeminiForTests } = await import('../src/lib/scorecard.js');
const { _noSleepForTests, _forgetLastGoodForTests } = await import('../src/lib/openaiVision.js');

const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(100);
const answer = { isResultsScreen: true, players: [{ name: 'RARE | BITTU', finishes: 1, assists: 1, damage: 151, survivedMin: 20.2 }] };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const geminiBusy = () => json(503, { error: { message: 'This model is currently experiencing high demand.' } });
const chatOk = () => json(200, { choices: [{ message: { content: 'Here you go:\n' + JSON.stringify(answer) } }] });

beforeEach(() => { _resetGeminiForTests(); _noSleepForTests(); _forgetLastGoodForTests(); });
afterEach(() => vi.unstubAllGlobals());

describe('free reader chain', () => {
  it('falls back to Groq when Gemini is busy', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes('generativelanguage')) return url.includes('/models?') ? json(200, { models: [] }) : geminiBusy();
      if (url.includes('api.groq.com/openai/v1/chat')) return chatOk();
      return json(500, {});
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await readScorecard(IMG)).toEqual([{ name: 'RARE | BITTU', finishes: 1, assists: 1, damage: 151, survivedMin: 20.2 }]);
    const groqCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('groq'))!;
    const body = JSON.parse(String(groqCall[1]!.body));
    expect(body.model).toBe('qwen/qwen3.8-27b');
    expect(body.messages[0].content[1].image_url.url).toBe(IMG);
    expect((groqCall[1]!.headers as Record<string, string>).authorization).toBe('Bearer groq-key');
  });

  it('finds a newer Groq vision model when the known one is retired, and strips <think>', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('generativelanguage')) return url.includes('/models?') ? json(200, { models: [] }) : geminiBusy();
      if (url === 'https://api.groq.com/openai/v1/models') {
        return json(200, { data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'meta-llama/llama-guard-4-12b' }, { id: 'qwen/qwen3.9-27b' }] });
      }
      if (url.includes('api.groq.com/openai/v1/chat')) {
        const model = JSON.parse(String(init!.body)).model;
        if (model === 'qwen/qwen3.9-27b') return json(200, { choices: [{ message: { content: '<think>{ hmm }</think>' + JSON.stringify(answer) } }] });
        return json(404, { error: { message: `The model \`${model}\` does not exist or you do not have access to it.` } });
      }
      return json(500, {});
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await readScorecard(IMG)).toHaveLength(1);
    const models = fetchMock.mock.calls.filter((c) => String(c[0]).includes('groq.com/openai/v1/chat')).map((c) => JSON.parse(String(c[1]!.body)).model);
    expect(models).toEqual(['qwen/qwen3.8-27b', 'qwen/qwen3.9-27b']);
  });

  it('tries other Gemini models before giving up on a busy one', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/models?')) return json(200, { models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] });
      if (url.includes('gemini-3.5-flash-lite')) return json(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
      if (url.includes('generativelanguage')) return geminiBusy();
      return json(500, {});
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await readScorecard(IMG)).toHaveLength(1);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('groq'))).toBe(false);
  });

  it('then uses a free OpenRouter vision model it finds', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes('generativelanguage')) return url.includes('/models?') ? json(200, { models: [] }) : geminiBusy();
      if (url.includes('api.groq.com')) return url.endsWith('/models') ? json(200, { data: [] }) : json(429, { error: { message: 'rate limit' } });
      if (url === 'https://openrouter.ai/api/v1/models') {
        return json(200, { data: [
          { id: 'some/text-model:free', architecture: { input_modalities: ['text'] }, pricing: { prompt: '0', completion: '0' } },
          { id: 'paid/vision', architecture: { input_modalities: ['text', 'image'] }, pricing: { prompt: '0.1', completion: '0.1' } },
          { id: 'google/gemma-vision:free', architecture: { input_modalities: ['text', 'image'] }, pricing: { prompt: '0', completion: '0' } },
        ] });
      }
      if (url.includes('openrouter.ai/api/v1/chat')) return chatOk();
      return json(500, {});
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await readScorecard(IMG)).toHaveLength(1);
    const orCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('openrouter.ai/api/v1/chat'))!;
    expect(JSON.parse(String(orCall[1]!.body)).model).toBe('google/gemma-vision:free');
  });

  it('explains when every reader is busy', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/models')) return json(200, { models: [], data: [] });
      if (url.includes('generativelanguage')) return geminiBusy();
      return json(429, { error: { message: 'rate limit' } });
    }));
    await expect(readScorecard(IMG)).rejects.toThrow(/All screenshot readers are busy/);
  });
});
