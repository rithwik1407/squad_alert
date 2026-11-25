/**
 * Which free model answers which question.
 *
 * Every provider is optional: the server uses the ones whose key is set, in order, and falls through to the
 * next when one is rate-limited or down. Add one by setting its key on the server; no code change needed.
 *
 *   GEMINI_API_KEY      Google AI Studio (native API, streams)
 *   GROQ_API_KEY        console.groq.com
 *   CEREBRAS_API_KEY    cloud.cerebras.ai
 *   OPENROUTER_API_KEY  openrouter.ai (":free" models)
 *   AI_EXTRA_PROVIDERS  any OpenAI-compatible service, as JSON:
 *                       [{"name":"Mistral","baseUrl":"https://api.mistral.ai/v1","apiKey":"…","model":"mistral-small-latest","lightModel":"…"}]
 *   AI_PROVIDER_ORDER   optional, e.g. "groq,gemini,cerebras" (names, lower case)
 *
 * Two tiers: "light" (fast, cheap: chat and small talk, no tools) and "strong" (team data, tools, actions).
 */
import { config } from '../config.js';

export type Tier = 'light' | 'strong';

export interface Provider {
  /** Lower-case id, e.g. "groq". */
  id: string;
  /** Shown in the chat header, e.g. "Groq". */
  label: string;
  kind: 'gemini' | 'openai';
  baseUrl: string;
  apiKey: string;
  /** Models to try for each tier, best first. */
  models: Record<Tier, string[]>;
  /** Extra request headers (OpenRouter likes a referer). */
  headers?: Record<string, string>;
}

const env = (k: string) => (process.env[k] ?? '').trim();
const list = (...xs: (string | undefined)[]) => [...new Set(xs.filter(Boolean) as string[])];

interface ExtraProvider { name?: string; baseUrl?: string; apiKey?: string; model?: string; lightModel?: string; models?: string[] }

function extras(): Provider[] {
  const raw = env('AI_EXTRA_PROVIDERS');
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as ExtraProvider[];
    return (Array.isArray(arr) ? arr : []).flatMap((p, i) => {
      if (!p?.baseUrl || !p.apiKey || !(p.model || p.models?.length)) return [];
      const name = (p.name || `extra${i + 1}`).trim();
      const strong = list(p.model, ...(p.models ?? []));
      return [{
        id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label: name, kind: 'openai' as const,
        baseUrl: p.baseUrl.replace(/\/$/, ''), apiKey: p.apiKey, models: { strong, light: list(p.lightModel, ...strong) },
      }];
    });
  } catch {
    console.warn('[ai] AI_EXTRA_PROVIDERS is not valid JSON; ignoring it.');
    return [];
  }
}

/** Every provider with a key, in the default order (best tool use first). */
export function configuredProviders(): Provider[] {
  const out: Provider[] = [];
  if (config.geminiApiKey) {
    out.push({ id: 'gemini', label: 'Gemini', kind: 'gemini', baseUrl: '', apiKey: config.geminiApiKey, models: { strong: list(config.geminiModel), light: list(env('GEMINI_LIGHT_MODEL'), 'gemini-flash-lite-latest', config.geminiModel) } });
  }
  if (config.groqApiKey) {
    out.push({
      id: 'groq', label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', apiKey: config.groqApiKey,
      models: { strong: list(env('GROQ_CHAT_MODEL'), 'llama-3.3-70b-versatile', 'openai/gpt-oss-120b'), light: list(env('GROQ_LIGHT_MODEL'), 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile') },
    });
  }
  if (env('CEREBRAS_API_KEY')) {
    out.push({
      id: 'cerebras', label: 'Cerebras', kind: 'openai', baseUrl: 'https://api.cerebras.ai/v1', apiKey: env('CEREBRAS_API_KEY'),
      models: { strong: list(env('CEREBRAS_MODEL'), 'gpt-oss-120b', 'llama-3.3-70b'), light: list(env('CEREBRAS_LIGHT_MODEL'), 'llama3.1-8b', 'gpt-oss-120b') },
    });
  }
  if (config.openRouterApiKey) {
    out.push({
      id: 'openrouter', label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', apiKey: config.openRouterApiKey,
      headers: { 'HTTP-Referer': config.clientUrl, 'X-Title': 'SquadSync' },
      models: {
        strong: list(env('OPENROUTER_CHAT_MODEL'), 'meta-llama/llama-3.3-70b-instruct:free', 'qwen/qwen3-235b-a22b:free'),
        light: list(env('OPENROUTER_LIGHT_MODEL'), 'meta-llama/llama-3.2-3b-instruct:free', 'meta-llama/llama-3.3-70b-instruct:free'),
      },
    });
  }
  out.push(...extras());
  return out;
}

/**
 * Providers to try for a tier, in order. Light questions go to the fastest small models first (Groq,
 * Cerebras), strong ones to the best tool callers first (Gemini, Groq 70B). AI_PROVIDER_ORDER wins.
 */
export function providersFor(tier: Tier, all = configuredProviders()): Provider[] {
  const custom = env('AI_PROVIDER_ORDER').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const pref = custom.length ? custom : tier === 'light' ? ['groq', 'cerebras', 'gemini', 'openrouter'] : ['gemini', 'groq', 'cerebras', 'openrouter'];
  const rank = (id: string) => (pref.includes(id) ? pref.indexOf(id) : pref.length);
  return [...all].sort((a, b) => rank(a.id) - rank(b.id));
}

const DATA_WORDS = /\b(our|we|us|team|squad|player|players|match|matches|scrim|scrims|tournament|kills?|damage|mvp|stats?|attendance|miss|late|schedule|book|remind|ping|notify|tell|message|send|cancel|move|reschedule|map|maps|erangel|miramar|sanhok|vikendi|livik|rondo|nusa|karakin|tonight|today|tomorrow|best|worst|compare|vs|report|lineup|line-up|bench|available|availability|placement|trend|perform|analy[sz]e|who)\b/i;

/**
 * Which tier a question needs. Small talk and general BGMI questions with no team data in them go to the
 * light model with no tools; anything about this team, its players or an action goes to the strong model.
 */
export function routeQuestion(q: string, roster: string[], smallTalk: boolean): Tier {
  if (smallTalk) return 'light';
  const s = q.toLowerCase();
  if (roster.some((r) => r && s.includes(r.toLowerCase().replace(/^rare\s*[|丨]\s*/i, '')))) return 'strong';
  if (DATA_WORDS.test(s)) return 'strong';
  return 'light';
}
