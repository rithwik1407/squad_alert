import { afterEach, describe, expect, it, vi } from 'vitest';

process.env.GEMINI_API_KEY = 'test-key';
const { readScorecard } = await import('../src/lib/scorecard.js');

const IMG = 'data:image/jpeg;base64,' + 'A'.repeat(100);
const answer = { players: [{ name: 'RARE | VASANTH', finishes: 1, assists: 1, damage: 550, survivedMin: 20.1 }] };
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('Gemini screenshot reader', () => {
  it('sends the image with the key and parses the rows', async () => {
    const fetchMock = vi.fn(async () => ok({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const rows = await readScorecard(IMG);
    expect(rows).toEqual([{ name: 'RARE | VASANTH', finishes: 1, assists: 1, damage: 550, survivedMin: 20.1 }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(String(init.body));
    expect(body.contents[0].parts[0].inline_data.mime_type).toBe('image/jpeg');
  });

  it('falls back to another model when one is retired', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 }))
      .mockResolvedValueOnce(ok({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(answer) + '\n```' }] } }] }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await readScorecard(IMG)).toHaveLength(1);
    expect(String(fetchMock.mock.calls[1][0])).toContain('gemini-2.5-flash');
  });

  it('explains the free-tier limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'quota' } }), { status: 429 })));
    await expect(readScorecard(IMG)).rejects.toThrow(/limit/);
  });
});
