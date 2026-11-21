import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { badRequest } from './errors.js';

/** One player row read from a BGMI results screenshot. */
export interface ScorecardRow {
  name: string;
  finishes: number;
  assists: number;
  damage: number;
  /** Minutes, e.g. "20.2m" → 20.2 */
  survivedMin: number;
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['players'],
  properties: {
    players: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'finishes', 'assists', 'damage', 'survivedMin'],
        properties: {
          name: { type: 'string', description: 'Player name exactly as shown, including any team tag' },
          finishes: { type: 'integer' },
          assists: { type: 'integer' },
          damage: { type: 'integer' },
          survivedMin: { type: 'number', description: 'Survived column in minutes, e.g. "20.2m" -> 20.2' },
        },
      },
    },
  },
} as const;

const PROMPT = `This is a BGMI (Battlegrounds Mobile India) end-of-match results screen for one squad.
It has a table with the columns Player, Rating, Finishes, Assists, Damage, Survived, Rescue, Recalls.
Read every player row (usually 4) and return each player's name exactly as written (keep the team tag, e.g. "RARE | NAME"),
Finishes, Assists, Damage, and Survived converted to minutes (e.g. "20.2m" -> 20.2, "12:30" -> 12.5).
Ignore the Rating column and any "MVP" label. If the image is not a BGMI results screen, return an empty players list.`;

export const scorecardReaderReady = () => Boolean(config.geminiApiKey || config.anthropicApiKey);

const MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type Media = (typeof MEDIA)[number];

/**
 * Reads the screenshot with a vision model. GEMINI_API_KEY (free tier from Google AI Studio) is used when set,
 * otherwise ANTHROPIC_API_KEY. With neither, the admin types the numbers in by hand.
 */
export async function readScorecard(dataUrl: string): Promise<ScorecardRow[]> {
  if (!config.geminiApiKey && !config.anthropicApiKey) {
    throw badRequest('Screenshot reading is not set up yet (add GEMINI_API_KEY on the server). Type the numbers in instead.');
  }
  const m = /^data:(image\/[a-z]+);base64,(.+)$/s.exec(dataUrl);
  if (!m || !MEDIA.includes(m[1] as Media)) throw badRequest('Upload a JPG, PNG or WebP screenshot');
  const text = config.geminiApiKey ? await askGemini(m[1], m[2]) : await askClaude(m[1] as Media, m[2]);
  return toRows(text);
}

async function askClaude(media: Media, data: string): Promise<string> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey, timeout: 90_000, maxRetries: 1 });
  let res;
  try {
    res = await client.messages.create({
      model: config.scorecardModel,
      max_tokens: 4000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA as unknown as Record<string, unknown> } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: media, data } },
          { type: 'text', text: PROMPT },
        ],
      }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw badRequest('The ANTHROPIC_API_KEY on the server is not valid');
    if (e instanceof Anthropic.RateLimitError) throw badRequest('The screenshot reader is busy. Try again in a minute.');
    if (e instanceof Anthropic.APIError) throw badRequest(`Could not read the screenshot (${e.status ?? 'network error'}). Try again or type the numbers in.`);
    throw e;
  }
  if (res.stop_reason === 'refusal') throw badRequest('Could not read that screenshot. Type the numbers in instead.');
  return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
}

/** Gemini's schema format (an OpenAPI subset). */
const GEMINI_SCHEMA = {
  type: 'OBJECT',
  required: ['players'],
  properties: {
    players: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['name', 'finishes', 'assists', 'damage', 'survivedMin'],
        properties: {
          name: { type: 'STRING' },
          finishes: { type: 'INTEGER' },
          assists: { type: 'INTEGER' },
          damage: { type: 'INTEGER' },
          survivedMin: { type: 'NUMBER' },
        },
      },
    },
  },
};

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
/** Known-good defaults, newest first. Google retires models often, so the live list (ListModels) is checked too. */
const GEMINI_DEFAULTS = ['gemini-3.8-flash', 'gemini-flash-latest'];
/** The model that last worked, tried first next time. */
let lastGoodModel: string | null = null;
let discovered: { at: number; models: string[] } | null = null;

let sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tests only: forget cached models and skip waiting between retries. */
export function _resetGeminiForTests() { lastGoodModel = null; discovered = null; sleep = async () => undefined; }

/** Flash models this key can call with generateContent, newest version first (lite models last). */
export async function discoverGeminiModels(): Promise<string[]> {
  if (discovered && Date.now() - discovered.at < 6 * 3600_000) return discovered.models;
  try {
    const res = await fetch(`${GEMINI_API}/models?pageSize=1000`, {
      headers: { 'x-goog-api-key': config.geminiApiKey }, signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const body = await res.json() as { models?: { name?: string; supportedGenerationMethods?: string[] }[] };
    const version = (n: string) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(n)?.[1] ?? 0);
    const models = (body.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => String(m.name ?? '').replace(/^models\//, ''))
      .filter((n) => /^gemini-.*flash/.test(n) && !/(image|tts|audio|live|embed|thinking-exp)/.test(n))
      .sort((a, b) => Number(a.includes('lite')) - Number(b.includes('lite'))
        || Number(/preview|exp/.test(a)) - Number(/preview|exp/.test(b))
        || version(b) - version(a));
    discovered = { at: Date.now(), models };
    return models;
  } catch {
    return [];
  }
}

type GeminiTry = { text: string } | { retry: true; err: string } | { skip: true; err: string };

/** Less "thinking" = faster answers; reading a table needs none. Field names differ by model generation. */
function thinkingFor(model: string): Record<string, unknown> | undefined {
  const v = Number(/gemini-(\d+(?:\.\d+)?)/.exec(model)?.[1] ?? 0);
  if (v >= 3) return { thinkingLevel: 'low' };
  if (v >= 2.5) return { thinkingBudget: 0 };
  return undefined;
}

async function callGemini(model: string, mime: string, data: string, timeoutMs: number, withThinking = true): Promise<GeminiTry> {
  let res: Response;
  try {
    res = await fetch(`${GEMINI_API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
      signal: AbortSignal.timeout(Math.max(5_000, timeoutMs)),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data } }, { text: PROMPT }] }],
        generationConfig: {
          temperature: 0, responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA,
          ...(withThinking && thinkingFor(model) ? { thinkingConfig: thinkingFor(model) } : {}),
        },
      }),
    });
  } catch (e) {
    return { retry: true, err: (e as Error).message };
  }
  const body = await res.json().catch(() => ({})) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    error?: { message?: string; status?: string };
  };
  if (res.ok) {
    const text = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    return text ? { text } : { retry: true, err: 'empty answer' };
  }
  const err = body.error?.message ?? `HTTP ${res.status}`;
  console.warn(`[scorecard] Gemini ${model} failed (${res.status}): ${err}`);
  if (/api key not valid|api_key_invalid/i.test(err)) throw badRequest('The GEMINI_API_KEY on the server is not valid');
  // Older/newer models reject the other generation's thinking field: ask again without it.
  if (res.status === 400 && withThinking && /thinking/i.test(err)) return callGemini(model, mime, data, timeoutMs, false);
  // Free daily allowance used up: waiting a few seconds won't help.
  if (res.status === 429 && /per ?day|daily|PerDay/i.test(err)) return { skip: true, err: 'daily free limit reached' };
  // Busy ("high demand", overloaded) or a per-minute limit: worth waiting and trying again.
  if (res.status === 503 || res.status === 500 || res.status === 429 || /high demand|overloaded|try again/i.test(err)) return { retry: true, err };
  // Retired, unknown or not allowed for this key: move on to another model.
  return { skip: true, err };
}

/** Whole budget for one screenshot. The app polls for the result, so this can outlast the proxy timeout. */
const READ_BUDGET_MS = 150_000;

/**
 * Google Gemini over plain REST (free tier key from aistudio.google.com).
 * Order: GEMINI_MODEL if set, the model that last worked, current defaults, then whatever ListModels offers.
 * Busy models get up to three tries with a growing pause before moving on.
 */
async function askGemini(mime: string, data: string): Promise<string> {
  const first = [config.geminiModel, lastGoodModel, ...GEMINI_DEFAULTS].filter(Boolean) as string[];
  const tried = new Set<string>();
  let lastErr = '';
  let busy = false;
  const deadline = Date.now() + READ_BUDGET_MS;
  const left = () => deadline - Date.now();
  const attempt = async (model: string) => {
    if (tried.has(model)) return null;
    tried.add(model);
    for (let i = 0; i < 3 && left() > 5_000; i++) {
      const r = await callGemini(model, mime, data, Math.min(60_000, left()));
      if ('text' in r) { lastGoodModel = model; return r.text; }
      lastErr = r.err;
      if ('skip' in r) return null;
      busy = true;
      if (i < 2) await sleep(Math.min([3000, 8000][i], Math.max(0, left() - 5_000)));
    }
    return null;
  };
  for (const m of first) { const t = await attempt(m); if (t) return t; }
  for (const m of (await discoverGeminiModels()).slice(0, 4)) { const t = await attempt(m); if (t) return t; }
  if (/daily free limit/.test(lastErr)) throw badRequest('Google\'s free daily limit for screenshot reading is used up. It resets tomorrow; type the numbers in for now.');
  if (busy) throw badRequest('Google\'s free screenshot reader is busy right now. Try again in a few minutes, or type the numbers in.');
  throw badRequest(`Could not read the screenshot (${lastErr || 'no Gemini model available'}). Type the numbers in instead.`);
}

function toRows(text: string): ScorecardRow[] {
  let parsed: { players?: ScorecardRow[] };
  const json = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  try { parsed = JSON.parse(json); } catch { throw badRequest('Could not read that screenshot. Type the numbers in instead.'); }
  const rows = (parsed.players ?? []).map((p) => ({
    name: String(p.name ?? '').trim(),
    finishes: clampInt(p.finishes, 99),
    assists: clampInt(p.assists, 99),
    damage: clampInt(p.damage, 9999),
    survivedMin: Math.max(0, Math.min(60, Math.round(Number(p.survivedMin || 0) * 10) / 10)),
  })).filter((p) => p.name);
  if (!rows.length) throw badRequest('No player rows found. Make sure it is the BGMI results screen.');
  return rows;
}

function clampInt(v: unknown, max: number) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0;
}
