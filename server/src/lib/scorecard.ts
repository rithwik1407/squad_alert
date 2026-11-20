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

export const scorecardReaderReady = () => Boolean(config.anthropicApiKey);

const MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type Media = (typeof MEDIA)[number];

/** Reads the screenshot with Claude's vision model. Needs ANTHROPIC_API_KEY on the server. */
export async function readScorecard(dataUrl: string): Promise<ScorecardRow[]> {
  if (!config.anthropicApiKey) throw badRequest('Screenshot reading is not set up yet (ANTHROPIC_API_KEY is missing on the server). Type the numbers in instead.');
  const m = /^data:(image\/[a-z]+);base64,(.+)$/s.exec(dataUrl);
  if (!m || !MEDIA.includes(m[1] as Media)) throw badRequest('Upload a JPG, PNG or WebP screenshot');
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
          { type: 'image', source: { type: 'base64', media_type: m[1] as Media, data: m[2] } },
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
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  let parsed: { players?: ScorecardRow[] };
  try { parsed = JSON.parse(text); } catch { throw badRequest('Could not read that screenshot. Type the numbers in instead.'); }
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
