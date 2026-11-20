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

/** Google Gemini over plain REST (free tier key from aistudio.google.com). Tries the configured model, then a fallback. */
async function askGemini(mime: string, data: string): Promise<string> {
  const models = [...new Set([config.geminiModel, 'gemini-2.5-flash', 'gemini-2.0-flash'])];
  let lastErr = '';
  for (const model of models) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data } }, { text: PROMPT }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA },
      }),
    }).catch((e: Error) => { lastErr = e.message; return null; });
    if (!res) continue;
    const body = await res.json().catch(() => ({})) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      error?: { message?: string; status?: string };
    };
    if (res.ok) {
      const text = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
      if (text) return text;
      lastErr = 'empty answer';
      continue;
    }
    lastErr = body.error?.message ?? `HTTP ${res.status}`;
    console.warn(`[scorecard] Gemini ${model} failed: ${lastErr}`);
    if (res.status === 400 && /api key/i.test(lastErr)) throw badRequest('The GEMINI_API_KEY on the server is not valid');
    if (res.status === 403) throw badRequest('The GEMINI_API_KEY on the server is not allowed to use Gemini');
    if (res.status === 429) throw badRequest('The free screenshot reader is busy (daily or per-minute limit). Try again in a minute, or type the numbers in.');
    // 404 (model retired) or 5xx: try the next model.
  }
  throw badRequest(`Could not read the screenshot (${lastErr || 'unknown error'}). Try again or type the numbers in.`);
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
