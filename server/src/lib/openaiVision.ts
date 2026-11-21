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
        max_tokens: 1500,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }] }],
      }),
    });
  } catch (e) {
    return { err: (e as Error).message, busy: true };
  }
  const body = await res.json().catch(() => ({})) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } | string };
  if (res.ok) {
    const text = body.choices?.[0]?.message?.content ?? '';
    return text ? { text } : { err: 'empty answer', busy: true };
  }
  const err = (typeof body.error === 'string' ? body.error : body.error?.message) ?? `HTTP ${res.status}`;
  console.warn(`[scorecard] ${p.name} ${model} failed (${res.status}): ${err}`);
  return { err, busy: res.status === 429 || res.status >= 500 };
}

/** Try the provider's models in order: busy ones get one more go after a pause, broken ones are skipped. */
export async function askCompat(p: CompatProvider, prompt: string, dataUrl: string, deadline: number): Promise<ReadTry> {
  const left = () => deadline - Date.now();
  const tried = new Set<string>();
  let last: ReadTry = { err: 'no model available', busy: false };
  const attempt = async (model: string) => {
    if (tried.has(model) || left() < 5_000) return null;
    tried.add(model);
    for (let i = 0; i < 2 && left() > 5_000; i++) {
      const r = await callChat(p, model, prompt, dataUrl, Math.min(60_000, left()));
      if ('text' in r) return r;
      last = r;
      if (!r.busy) return null;
      if (i === 0) await sleep(Math.min(3_000, Math.max(0, left() - 5_000)));
    }
    return null;
  };
  for (const m of p.models) { const r = await attempt(m); if (r) return r; }
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

export function groqProvider(key: string, model?: string): CompatProvider {
  return {
    name: 'Groq',
    chatUrl: 'https://api.groq.com/openai/v1/chat/completions',
    key,
    models: [model, 'meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct']
      .filter(Boolean) as string[],
    discover: async () => {
      const body = await getJson<{ data?: { id: string; active?: boolean }[] }>('https://api.groq.com/openai/v1/models', key);
      return (body?.data ?? [])
        .filter((m) => m.active !== false && /(vision|scout|maverick|[-_ ]vl\b|vl-)/i.test(m.id))
        .map((m) => m.id);
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
