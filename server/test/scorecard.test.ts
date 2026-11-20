import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.GEMINI_API_KEY = 'test-key';
const { readScorecard, _resetGeminiForTests } = await import('../src/lib/scorecard.js');

const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(100);
const answer = { players: [{ name: 'RARE | VASANTH', finishes: 1, assists: 1, damage: 550, survivedMin: 20.1 }] };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const good = () => json(200, { candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(answer) + '\n```' }] } }] });
const busy = () => json(503, { error: { message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.' } });
const retired = () => json(404, { error: { message: 'This model models/gemini-2.5-flash is no longer available to new users.' } });
const modelOf = (url: string) => /models\/([^:?]+)/.exec(url)?.[1];

beforeEach(() => _resetGeminiForTests());
afterEach(() => vi.unstubAllGlobals());

describe('Gemini screenshot reader', () => {
  it('uses gemini-3.8-flash first and parses the rows', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => good());
    vi.stubGlobal('fetch', fetchMock);
    expect(await readScorecard(IMG)).toEqual([{ name: 'RARE | VASANTH', finishes: 1, assists: 1, damage: 550, survivedMin: 20.1 }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(modelOf(url)).toBe('gemini-3.8-flash');
    expect((init!.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
  });

  it('retries a busy model, then succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(good());
    vi.stubGlobal('fetch', fetchMock);
    expect(await readScorecard(IMG)).toHaveLength(1);
    expect(fetchMock.mock.calls.map((c) => modelOf(String(c[0])))).toEqual(['gemini-3.8-flash', 'gemini-3.8-flash']);
  });

  it('finds a working model from the live list when the defaults are retired', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/models?')) {
        return json(200, { models: [
          { name: 'models/gemini-4.1-flash-lite', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-4.1-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        ] });
      }
      return modelOf(url) === 'gemini-4.1-flash' ? good() : retired();
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await readScorecard(IMG)).toHaveLength(1);
    // Remembers the model that worked for next time.
    fetchMock.mockClear();
    await readScorecard(IMG);
    expect(modelOf(String(fetchMock.mock.calls[0][0]))).toBe('gemini-4.1-flash');
  });

  it('says the free reader is busy when every model stays busy', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('/models?') ? json(200, { models: [] }) : busy())));
    await expect(readScorecard(IMG)).rejects.toThrow(/busy/);
  });
});
