/**
 * Free vision readers that speak the OpenAI chat format: Groq and OpenRouter (":free" models).
 * Used as fallbacks after Gemini so screenshot reading keeps working when one free tier is busy or used up.
 */
export interface CompatProvider {
  name: string;
  chatUrl: string;
  key: string;
  /** Models tried first (newest known-good). */
  models: string[];
  /** Ask the provider which vision models exist right now (models get retired often). */
  discover?: () => Promise<string[]>;
  headers?: Record<string, string>;
}

export type ReadTry = { text: string } | { err: string; busy: boolean };

let sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export function _noSleepForTests() { sleep = async () => undefined; }

async function callChat(p: CompatProvider, model: string, prompt: string, dataUrl: string, timeoutMs: number): Promise<ReadTry> {
  let res: Response;
  try {
    res = await fetch(p.chatUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${p.key}`, ...p.headers },
      signal: AbortSignal.timeout(Math.max(5_000, timeoutMs)),
      body: JSON.stringify({
        model,
        temperature: 0,
        // Room for models that think out loud (Qwen) before the JSON.
        max_tokens: 4000,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }] }],
      }),
    });
  } catch (e) {
    return { err: (e as Error).message, busy: true };
  }
  const body = await res.json().catch(() => ({})) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } | string };
  if (res.ok) {
    // Reasoning models may wrap their thinking in <think>…</think> before the answer.
    const text = (body.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    return text ? { text } : { err: 'empty answer', busy: true };
  }
  const err = (typeof body.error === 'string' ? body.error : body.error?.message) ?? `HTTP ${res.status}`;
  console.warn(`[scorecard] ${p.name} ${model} failed (${res.status}): ${err}`);
  return { err, busy: res.status === 429 || res.status >= 500 };
}

/** The model that last answered, per provider: tried first next time. */
const lastGood = new Map<string, string>();
export function _forgetLastGoodForTests() { lastGood.clear(); }

/**
 * Try the provider's models in order: busy ones get one more go after a pause, broken ones (retired, no image
 * support) are skipped. After the known list, the provider's live model list is checked, because free vision
 * models get retired every few months (Groq dropped Llama 4 Scout / Maverick in 2026).
 */
export async function askCompat(p: CompatProvider, prompt: string, dataUrl: string, deadline: number): Promise<ReadTry> {
  const left = () => deadline - Date.now();
  const tried = new Set<string>();
  let last: ReadTry = { err: 'no model available', busy: false };
  const attempt = async (model: string) => {
    if (tried.has(model) || left() < 5_000) return null;
    tried.add(model);
    for (let i = 0; i < 2 && left() > 5_000; i++) {
      const r = await callChat(p, model, prompt, dataUrl, Math.min(60_000, left()));
      if ('text' in r) { lastGood.set(p.name, model); return r; }
      last = r;
      if (!r.busy) return null;
      if (i === 0) await sleep(Math.min(3_000, Math.max(0, left() - 5_000)));
    }
    return null;
  };
  const first = [lastGood.get(p.name), ...p.models].filter(Boolean) as string[];
  for (const m of first) { const r = await attempt(m); if (r) return r; }
  const found = p.discover ? await p.discover().catch(() => []) : [];
  for (const m of found.slice(0, 4)) { const r = await attempt(m); if (r) return r; }
  return last;
}

async function getJson<T>(url: string, key: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
    return res.ok ? await res.json() as T : null;
  } catch { return null; }
}

export const GROQ_VISION = ['qwen/qwen3.8-27b'];
/** Model ids on Groq that can take an image: Qwen 3.x 27B multimodal, "-vl" / "vision" models, Muse, Llama 4. */
const GROQ_VISION_LIKE = /(vision|[-_ ]vl\b|vl-|qwen\/qwen3\.\d+-27b|muse|scout|maverick|llava|pixtral)/i;
const qwenVersion = (id: string) => Number(/qwen3\.(\d+)/i.exec(id)?.[1] ?? -1);

export function groqProvider(key: string, model?: string): CompatProvider {
  return {
    name: 'Groq',
    chatUrl: 'https://api.groq.com/openai/v1/chat/completions',
    key,
    // Groq's image model (console.groq.com/docs/vision). Llama 4 Scout / Maverick were retired in 2026 and now 404.
    models: [model, ...GROQ_VISION].filter(Boolean) as string[],
    discover: async () => {
      const body = await getJson<{ data?: { id: string; active?: boolean }[] }>('https://api.groq.com/openai/v1/models', key);
      return (body?.data ?? [])
        .filter((m) => m.active !== false && GROQ_VISION_LIKE.test(m.id) && !/(guard|whisper|tts|embed|orpheus)/i.test(m.id))
        .map((m) => m.id)
        // Newest Qwen first: Groq replaces it with a higher version number when it retires one.
        .sort((a, b) => qwenVersion(b) - qwenVersion(a));
    },
  };
}

/** Prefer free vision models from families that read tables well. */
const OR_PREFER = [/gemini/i, /qwen.*vl|qwen.*omni/i, /llama-4/i, /mistral|pixtral/i, /gemma/i];

export function openRouterProvider(key: string, model?: string): CompatProvider {
  return {
    name: 'OpenRouter',
    chatUrl: 'https://openrouter.ai/api/v1/chat/completions',
    key,
    headers: { 'X-Title': 'SquadSync' },
    models: [model].filter(Boolean) as string[],
    discover: async () => {
      const body = await getJson<{ data?: { id: string; architecture?: { input_modalities?: string[] }; pricing?: { prompt?: string; completion?: string } }[] }>(
        'https://openrouter.ai/api/v1/models', key);
      const rank = (id: string) => { const i = OR_PREFER.findIndex((r) => r.test(id)); return i < 0 ? OR_PREFER.length : i; };
      return (body?.data ?? [])
        .filter((m) => m.id.endsWith(':free') && m.architecture?.input_modalities?.includes('image')
          && Number(m.pricing?.prompt ?? 1) === 0 && Number(m.pricing?.completion ?? 1) === 0)
        .map((m) => m.id)
        .sort((a, b) => rank(a) - rank(b));
    },
  };
}
