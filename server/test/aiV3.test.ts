import { afterEach, describe, expect, it } from 'vitest';
import { toolsFor } from '../src/ai/agent.js';
import { mergeEdits } from '../src/ai/actions.js';
import { configuredProviders, providersFor, routeQuestion, type Provider } from '../src/ai/providers.js';
import { applyEvent, emptyState, eventsFromTurn } from '../src/ai/runs.js';
import { pickSuggestions, TEMPLATES } from '../src/ai/suggestions.js';
import { localDateTime } from '../src/ai/tools.js';

const fake = (id: string): Provider => ({ id, label: id, kind: 'openai', baseUrl: '', apiKey: 'k', models: { light: ['l'], strong: ['s'] } });

describe('Squad AI model routing', () => {
  afterEach(() => { delete process.env.AI_PROVIDER_ORDER; delete process.env.AI_EXTRA_PROVIDERS; });

  it('sends chat to the light tier and team questions to the strong tier', () => {
    expect(routeQuestion('hi', [], true)).toBe('light');
    expect(routeQuestion('What is a third zone?', [], false)).toBe('light');
    expect(routeQuestion('Tips for IGLs', [], false)).toBe('light');
    expect(routeQuestion('Analyze our last 10 matches', [], false)).toBe('strong');
    expect(routeQuestion('Tell Rex to come online', [], false)).toBe('strong');
    expect(routeQuestion('how is ghost doing', ['Ghost'], false)).toBe('strong');
  });

  it('orders providers per tier and honours AI_PROVIDER_ORDER', () => {
    const all = ['openrouter', 'groq', 'gemini', 'cerebras'].map(fake);
    expect(providersFor('light', all).map((p) => p.id)).toEqual(['groq', 'cerebras', 'gemini', 'openrouter']);
    expect(providersFor('strong', all).map((p) => p.id)).toEqual(['gemini', 'groq', 'cerebras', 'openrouter']);
    process.env.AI_PROVIDER_ORDER = 'cerebras,groq';
    expect(providersFor('strong', all).map((p) => p.id).slice(0, 2)).toEqual(['cerebras', 'groq']);
  });

  it('adds OpenAI-compatible providers from AI_EXTRA_PROVIDERS and ignores bad JSON', () => {
    process.env.AI_EXTRA_PROVIDERS = JSON.stringify([{ name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1/', apiKey: 'x', model: 'mistral-small-latest' }, { name: 'broken' }]);
    const extra = configuredProviders().filter((p) => p.id === 'mistral');
    expect(extra).toHaveLength(1);
    expect(extra[0].baseUrl).toBe('https://api.mistral.ai/v1');
    expect(extra[0].models.light).toEqual(['mistral-small-latest']);
    process.env.AI_EXTRA_PROVIDERS = '{not json';
    expect(() => configuredProviders()).not.toThrow();
  });

  it('only offers captain actions to the captain and self-service ones to players', () => {
    const cap = toolsFor(true).map((t) => t.name);
    const player = toolsFor(false).map((t) => t.name);
    expect(cap).toContain('propose_message');
    expect(cap).not.toContain('propose_my_availability');
    expect(player).toContain('propose_my_availability');
    expect(player).toContain('propose_captain_request');
    expect(player.some((n) => ['propose_scrim', 'propose_message', 'propose_cancel'].includes(n))).toBe(false);
    expect(player).toContain('analyze_performance');
  });
});

describe('Squad AI suggestions', () => {
  const ctx = { isCaptain: true, players: ['Rex', 'Ghost', 'Blaze'], maps: ['Erangel', 'Miramar'], next: "tonight's scrim" };

  it('picks four from different categories with real names filled in', () => {
    const s = pickSuggestions(ctx, []);
    expect(s).toHaveLength(4);
    expect(new Set(s.map((x) => x.cat)).size).toBe(4);
    for (const x of s) expect(x.q).not.toMatch(/\{|\}/);
  });

  it('does not repeat recently shown questions', () => {
    const first = pickSuggestions(ctx, []);
    const seen = first.map((x) => x.id);
    for (let i = 0; i < 20; i++) {
      const next = pickSuggestions(ctx, seen);
      expect(next.some((x) => seen.includes(x.id))).toBe(false);
    }
  });

  it('keeps captain actions away from players', () => {
    const captainOnly = new Set(TEMPLATES.filter((t) => t.who === 'captain').map((t) => t.id));
    for (let i = 0; i < 30; i++) expect(pickSuggestions({ ...ctx, isCaptain: false }, []).some((x) => captainOnly.has(x.id))).toBe(false);
  });
});

describe('Squad AI saved answers', () => {
  it('folds streamed events into the saved answer and replays them', () => {
    let s = emptyState();
    s = applyEvent(s, { type: 'meta', engine: 'groq', label: 'Groq', model: 'llama' });
    s = applyEvent(s, { type: 'tool', id: 't1', name: 'x', label: 'Loading', status: 'start' });
    s = applyEvent(s, { type: 'tool', id: 't1', name: 'x', label: 'Loading', status: 'done', ms: 12 });
    s = applyEvent(s, { type: 'text', delta: 'Hello ' });
    s = applyEvent(s, { type: 'text', delta: 'team' });
    s = applyEvent(s, { type: 'block', block: { type: 'insights', title: 'x', items: [], id: 'b1' } });
    expect(s.text).toBe('Hello team');
    expect(s.tools).toEqual([{ id: 't1', label: 'Loading', status: 'done', ms: 12 }]);
    const replay = eventsFromTurn(s as never).reduce(applyEvent, emptyState());
    expect(replay.text).toBe('Hello team');
    expect(replay.blocks).toHaveLength(1);
    expect(replay.label).toBe('Groq');
  });
});

describe('Squad AI approvals', () => {
  const scrim = { kind: 'scrim' as const, tournamentName: 'Daily', title: 'Daily 9 PM', date: '2026-11-26', time: '21:00', map: 'TBD', type: 'scrim', maps: [], types: [] };

  it('applies the approver edits on top of the draft', () => {
    expect(mergeEdits(scrim, { map: 'Erangel', time: '22:30' })).toMatchObject({ tournamentName: 'Daily', map: 'Erangel', time: '22:30' });
  });

  it('rejects bad edits with a plain message', () => {
    expect(() => mergeEdits(scrim, { tournamentName: '' })).toThrow('Enter the event name');
    expect(() => mergeEdits({ kind: 'squad', matchId: 'a'.repeat(24), matchLabel: '', selectedIds: [], pool: [], size: 4 }, { selectedIds: ['a'.repeat(24)] })).toThrow(/exactly 4/);
    expect(() => mergeEdits({ kind: 'message', recipientIds: ['a'.repeat(24)], text: 'hi', channels: ['telegram'], pool: [] }, { channels: [] })).toThrow(/Telegram, push or both/);
  });

  it('gives the form its local date and time', () => {
    expect(localDateTime(new Date('2026-11-26T15:30:00Z'), 'Asia/Kolkata')).toEqual({ date: '2026-11-26', time: '21:00' });
  });
});
