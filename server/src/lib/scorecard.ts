import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { badRequest, HttpError } from './errors.js';
import { askCompat, groqProvider, openRouterProvider } from './openaiVision.js';

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
  required: ['isResultsScreen', 'placement', 'players'],
  properties: {
    isResultsScreen: { type: 'boolean', description: 'true only for a BGMI end-of-match team results table' },
    placement: { type: ['integer', 'null'], description: 'Squad finishing position shown on the screen, e.g. "#3" or "3/16" -> 3, "Winner Winner Chicken Dinner" -> 1; null if not shown' },
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
Ignore the Rating column and any "MVP" label.
Also read the squad's finishing position (placement) out of all teams in the lobby. BGMI shows it as a number after a "#" sign
(e.g. "#3", "#3/16" or "# 3 /18" -> 3), sometimes labelled Rank or Place. "WINNER WINNER CHICKEN DINNER" means placement 1.
Do not confuse it with a player's Rating, Finishes or the total number of teams. Use null only if no position is shown at all.
Set isResultsScreen to true only if the image really is this BGMI results table. For anything else (lobby, map,
inventory, chat, a photo, another game, another screen) set isResultsScreen to false and return an empty players list.`;

/** The image isn't a BGMI match results screen. The app shows a "results screenshot only" pop-up for this. */
export class NotResultsScreenError extends HttpError {
  name = 'NotResultsScreenError';
  constructor() { super(422, 'This is not a match results screenshot. Upload the BGMI results screen (Player, Finishes, Damage...).'); }
}

export const scorecardReaderReady = () =>
  Boolean(config.geminiApiKey || config.groqApiKey || config.openRouterApiKey || config.anthropicApiKey);

/** Extra line for readers without a JSON-schema mode (Groq, OpenRouter). */
const JSON_HINT = `
Reply with JSON only, no other text, in exactly this shape:
{"isResultsScreen": true, "placement": 3, "players": [{"name": "RARE | NAME", "finishes": 0, "assists": 0, "damage": 0, "survivedMin": 0}]}`;

const MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type Media = (typeof MEDIA)[number];

/** One kind of screenshot to read: what to ask, the answer's shape, and how to turn the answer into data. */
export interface VisionTask<T> {
  prompt: string;
  /** Extra line for readers without a JSON-schema mode (Groq, OpenRouter). */
  jsonHint: string;
  /** JSON schema for Claude. */
  schema: Record<string, unknown>;
  /** The same shape in Gemini's schema format. */
  geminiSchema: Record<string, unknown>;
  parse: (text: string) => T;
  /** An error from parse that is a final answer (e.g. "this is not that kind of image"): don't ask another reader. */
  isFinal: (e: unknown) => boolean;
  /** What the admin can do instead, ending the error messages, e.g. "type the numbers in". */
  manual: string;
}

export interface ScorecardRead { rows: ScorecardRow[]; placement: number | null }

const SCORECARD_TASK: VisionTask<ScorecardRead> = {
  prompt: PROMPT,
  jsonHint: JSON_HINT,
  schema: SCHEMA as unknown as Record<string, unknown>,
  get geminiSchema() { return GEMINI_SCHEMA; },
  parse: (text) => toRead(text),
  isFinal: (e) => e instanceof NotResultsScreenError,
  manual: 'type the numbers in',
};

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * Reads the screenshot with a vision model. Every reader whose key is set is tried in turn until one answers:
 *   1. Google Gemini   GEMINI_API_KEY      (free)
 *   2. Groq            GROQ_API_KEY        (free)
 *   3. OpenRouter      OPENROUTER_API_KEY  (free ":free" models)
 *   4. Claude          ANTHROPIC_API_KEY   (paid)
 * So one free tier being busy or used up for the day doesn't stop the upload.
 */
export async function readScorecard(dataUrl: string): Promise<ScorecardRow[]> {
  return (await readImage(dataUrl, SCORECARD_TASK)).rows;
}

/** Like readScorecard, plus the squad's finishing position when the screen shows it. */
export function readScorecardWithPlacement(dataUrl: string): Promise<ScorecardRead> {
  return readImage(dataUrl, SCORECARD_TASK);
}

/** Read any kind of screenshot with the reader chain above. */
export async function readImage<T>(dataUrl: string, task: VisionTask<T>): Promise<T> {
  if (!scorecardReaderReady()) {
    throw badRequest(`Screenshot reading is not set up yet (add GEMINI_API_KEY or GROQ_API_KEY on the server). ${cap(task.manual)} instead.`);
  }
  const m = /^data:(image\/[a-z]+);base64,(.+)$/s.exec(dataUrl);
  if (!m || !MEDIA.includes(m[1] as Media)) throw badRequest('Upload a JPG, PNG or WebP screenshot');
  const deadline = Date.now() + READ_BUDGET_MS;
  const readers: { name: string; run: (until: number) => Promise<string> }[] = [];
  if (config.geminiApiKey) readers.push({ name: 'Gemini', run: (until) => askGemini(task, m[1], m[2], until) });
  for (const p of [
    config.groqApiKey ? groqProvider(config.groqApiKey, config.groqModel) : null,
    config.openRouterApiKey ? openRouterProvider(config.openRouterApiKey, config.openRouterModel) : null,
  ]) {
    if (!p) continue;
    readers.push({
      name: p.name,
      run: async (until) => {
        const r = await askCompat(p, task.prompt + task.jsonHint, dataUrl, until);
        if ('text' in r) return r.text;
        throw badRequest(r.busy ? `${p.name} is busy (${r.err})` : `${p.name}: ${r.err}`);
      },
    });
  }
  if (config.anthropicApiKey) readers.push({ name: 'Claude', run: () => askClaude(task, m[1] as Media, m[2]) });

  const problems: string[] = [];
  for (let i = 0; i < readers.length; i++) {
    const left = deadline - Date.now();
    if (left < 8_000) break;
    // Leave time for the readers after this one: each gets an equal share of what's left (Gemini at least 40s).
    const share = Math.max(40_000, Math.floor(left / (readers.length - i)));
    try {
      const text = await readers[i].run(Math.min(deadline, Date.now() + share));
      return task.parse(text); // a "not that kind of image" answer is final: no need to ask another reader
    } catch (e) {
      if (task.isFinal(e)) throw e;
      const msg = (e as Error).message;
      console.warn(`[scorecard] ${readers[i].name} could not read it: ${msg}`);
      problems.push(`${readers[i].name}: ${msg}`);
      if (i === readers.length - 1 && readers.length === 1) throw e;
    }
  }
  throw badRequest(`All screenshot readers are busy or out of free uses right now (${problems.join('; ') || 'out of time'}). Try again in a few minutes, or ${task.manual}.`);
}

async function askClaude<T>(task: VisionTask<T>, media: Media, data: string): Promise<string> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey, timeout: 90_000, maxRetries: 1 });
  let res;
  try {
    res = await client.messages.create({
      model: config.scorecardModel,
      max_tokens: 4000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: task.schema } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: media, data } },
          { type: 'text', text: task.prompt },
        ],
      }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw badRequest('The ANTHROPIC_API_KEY on the server is not valid');
    if (e instanceof Anthropic.RateLimitError) throw badRequest('The screenshot reader is busy. Try again in a minute.');
    if (e instanceof Anthropic.APIError) throw badRequest(`Could not read the screenshot (${e.status ?? 'network error'}). Try again or ${task.manual}.`);
    throw e;
  }
  if (res.stop_reason === 'refusal') throw badRequest(`Could not read that screenshot. ${cap(task.manual)} instead.`);
  return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
}

/** Gemini's schema format (an OpenAPI subset). */
const GEMINI_SCHEMA = {
  type: 'OBJECT',
  required: ['isResultsScreen', 'players'],
  properties: {
    isResultsScreen: { type: 'BOOLEAN' },
    placement: { type: 'INTEGER', nullable: true },
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

export const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
/** Known-good defaults, newest first. Google retires models often, so the live list (ListModels) is checked too. */
export const GEMINI_DEFAULTS = ['gemini-3.8-flash', 'gemini-flash-latest'];
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
export function thinkingFor(model: string): Record<string, unknown> | undefined {
  const v = Number(/gemini-(\d+(?:\.\d+)?)/.exec(model)?.[1] ?? 0);
  if (v >= 3) return { thinkingLevel: 'low' };
  if (v >= 2.5) return { thinkingBudget: 0 };
  return undefined;
}

async function callGemini<T>(task: VisionTask<T>, model: string, mime: string, data: string, timeoutMs: number, withThinking = true): Promise<GeminiTry> {
  let res: Response;
  try {
    res = await fetch(`${GEMINI_API}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
      signal: AbortSignal.timeout(Math.max(5_000, timeoutMs)),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data } }, { text: task.prompt }] }],
        generationConfig: {
          temperature: 0, responseMimeType: 'application/json', responseSchema: task.geminiSchema,
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
  if (res.status === 400 && withThinking && /thinking/i.test(err)) return callGemini(task, model, mime, data, timeoutMs, false);
  // Free daily allowance used up: waiting a few seconds won't help.
  if (res.status === 429 && /per ?day|daily|PerDay/i.test(err)) return { skip: true, err: 'daily free limit reached' };
  // Busy ("high demand", overloaded) or a per-minute limit: worth waiting and trying again.
  if (res.status === 503 || res.status === 500 || res.status === 429 || /high demand|overloaded|try again/i.test(err)) return { retry: true, err };
  // Retired, unknown or not allowed for this key: move on to another model.
  return { skip: true, err };
}

/** Whole budget for one screenshot. The app polls for the result, so this can outlast the proxy timeout. */
const READ_BUDGET_MS = 170_000;

/**
 * Google Gemini over plain REST (free tier key from aistudio.google.com).
 * Order: GEMINI_MODEL if set, the model that last worked, current defaults, then whatever ListModels offers.
 * Every model gets one go first; busy ones get up to two more after a growing pause.
 */
async function askGemini<T>(task: VisionTask<T>, mime: string, data: string, until = Date.now() + READ_BUDGET_MS): Promise<string> {
  const first = [config.geminiModel, lastGoodModel, ...GEMINI_DEFAULTS].filter(Boolean) as string[];
  let lastErr = '';
  let busy = false;
  const left = () => until - Date.now();
  // Retired / not allowed / out of daily uses: don't ask that model again for this screenshot.
  const skipped = new Set<string>();
  const tryAll = async (models: string[]) => {
    for (const model of models) {
      if (skipped.has(model) || left() < 5_000) continue;
      const r = await callGemini(task, model, mime, data, Math.min(45_000, left()));
      if ('text' in r) { lastGoodModel = model; return r.text; }
      lastErr = r.err;
      if ('skip' in r) skipped.add(model); else busy = true;
    }
    return null;
  };
  // Spread the tries over several models instead of hammering one: when the newest flash model is "high demand"
  // an older or lite one often answers straight away. One go each first, then busy ones again after a pause.
  let models = [...new Set(first)];
  let text = await tryAll(models);
  if (text) return text;
  const found = (await discoverGeminiModels()).filter((m) => !models.includes(m)).slice(0, 4);
  models = [...models, ...found];
  if ((text = await tryAll(found))) return text;
  for (const pause of [3000, 8000]) {
    if (!busy || left() < 10_000) break;
    await sleep(Math.min(pause, Math.max(0, left() - 5_000)));
    if ((text = await tryAll(models))) return text;
  }
  if (/daily free limit/.test(lastErr)) throw badRequest(`Google's free daily limit for screenshot reading is used up. It resets tomorrow; ${task.manual} for now.`);
  if (busy) throw badRequest(`Google's free screenshot reader is busy right now. Try again in a few minutes, or ${task.manual}.`);
  throw badRequest(`Could not read the screenshot (${lastErr || 'no Gemini model available'}). ${cap(task.manual)} instead.`);
}

/** The JSON object in a reader's answer (some wrap it in ``` fences or a sentence). */
export function extractJson<T>(text: string, failMessage: string): T {
  const stripped = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  const a = stripped.indexOf('{');
  const b = stripped.lastIndexOf('}');
  const json = a >= 0 && b > a ? stripped.slice(a, b + 1) : stripped;
  try { return JSON.parse(json) as T; } catch { throw badRequest(failMessage); }
}

function toRead(text: string): ScorecardRead {
  const parsed = extractJson<{ isResultsScreen?: boolean; placement?: unknown; players?: ScorecardRow[] }>(text, 'Could not read that screenshot. Type the numbers in instead.');
  const rows = (parsed.players ?? []).map((p) => ({
    name: String(p.name ?? '').trim(),
    finishes: clampInt(p.finishes, 99),
    assists: clampInt(p.assists, 99),
    damage: clampInt(p.damage, 9999),
    survivedMin: Math.max(0, Math.min(60, Math.round(Number(p.survivedMin || 0) * 10) / 10)),
  })).filter((p) => p.name);
  if (parsed.isResultsScreen === false || !rows.length) throw new NotResultsScreenError();
  // Accept 3, "3", "#3" or "#3/16".
  const place = Math.round(Number(/\d+/.exec(String(parsed.placement ?? ''))?.[0] ?? NaN));
  return { rows, placement: parsed.placement != null && place >= 1 && place <= 25 ? place : null };
}

function clampInt(v: unknown, max: number) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0;
}
