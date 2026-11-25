/**
 * Squad Intelligence agent: a function-calling loop over the tools in tools.ts.
 *
 * Engines, tried in order (all free):
 *   1. Google Gemini  GEMINI_API_KEY  (streams token by token)
 *   2. Groq           GROQ_API_KEY    (Llama with tool calls)
 *   3. Offline analyst (no key, or both free tiers busy): picks the tools from keywords and answers with
 *      their plain-English summaries. Same numbers and charts, just less conversational.
 */
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { discoverGeminiModels, GEMINI_API, GEMINI_DEFAULTS, thinkingFor } from '../lib/scorecard.js';
import type { ToolOutput } from './analytics.js';
import type { BlockWithId } from './blocks.js';
import { runTool, TOOLS, toolByName, type ToolContext } from './tools.js';

export type AgentEvent =
  | { type: 'meta'; engine: 'gemini' | 'groq' | 'offline'; model?: string }
  | { type: 'text'; delta: string }
  | { type: 'tool'; id: string; name: string; label: string; status: 'start' | 'done' | 'error'; ms?: number }
  | { type: 'block'; block: BlockWithId }
  | { type: 'notice'; message: string }
  | { type: 'done' };

export interface ChatTurn { role: 'user' | 'assistant'; text: string }

export interface AgentInput {
  history: ChatTurn[];
  /** Small talk: answer in chat without offering any tools, so nothing is drawn. */
  chatOnly?: boolean;
  ctx: ToolContext & { teamName: string; userIgn: string; roster: string[] };
  emit: (e: AgentEvent) => void;
  signal?: AbortSignal;
}

export const aiEngine = () => (config.geminiApiKey ? 'gemini' : config.groqApiKey ? 'groq' : 'offline');

const MAX_ROUNDS = 6;

export function systemPrompt(ctx: AgentInput['ctx'], now = new Date()) {
  const tz = config.displayTimeZone;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const clock = new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true }).format(now);
  return `You are Squad Intelligence, the AI team manager and analyst for ${ctx.teamName}, a BGMI squad using SquadSync.
You analyze the team's real records, recommend squads and fixes, and act only through tools, with the captain's approval.

Context: today is ${today} (${clock}, time zone ${tz}). You are talking to ${ctx.userIgn}, who is ${ctx.isCaptain ? 'the CAPTAIN' : 'a PLAYER (not the captain)'}.
Players: ${ctx.roster.join(', ') || 'unknown'}. A squad is 4 players. The RARE admin account only manages custom rooms and is not a player: never list, rank, pick or compare it.

Ground rules
1. Never invent numbers. Every stat must come from a tool result in this conversation. If data is missing, say so and say what to log (results screenshot, check-ins, placement).
2. Chat first, visuals on demand. Greetings, thanks, small talk and general BGMI questions ("what is a third zone?", "tips for IGLs") get a short, friendly chat reply with NO tool calls. Call tools only when the answer depends on this team's data: squad picks, player stats, comparisons, performance, maps, attendance, best times, match reports, schedule checks, or actions. Then pick the right one: get_roster, list_matches, get_player_stats, compare_players, analyze_performance, get_match_report, analyze_attendance, best_time_slots, recommend_squad, check_schedule (several if needed). Every tool result is drawn on the dashboard, so never call a tool "just in case". Resolve relative dates ("tomorrow", "Friday") yourself from today's date.
3. Write actions (propose_scrim, propose_squad) only create a proposal card. Nothing changes until the captain taps Approve. Never say something was created or saved. ${ctx.isCaptain ? 'Before propose_scrim, call check_schedule for clashes. If the event name is missing, use "Scrim".' : 'This user is not the captain: do not call propose_* tools; offer the analysis and suggest they ask the captain.'}
4. Answer with a short bold headline, 2 to 4 sharp bullet insights, and one concrete next step. Plain English, BGMI terms (IGL, rotations, zone, drop, third zone), no filler, no tables in text.
5. The tools already draw charts, tables, squad cards and reports on the dashboard next to the chat. Refer to them ("see the trend chart") instead of repeating every number.
Squad recommendation score = recent form (kills, damage, MVPs, weighted to newer matches) + availability for that match + attendance reliability + a fairness bonus for players benched most often. Always name the substitute and the reason. The captain has the final say.
Out of scope (say so briefly): reading tournament PDFs or screenshots, anything outside this team's data. Reply in English.`;
}

/* ───────────────────────── Tool execution shared by every engine ───────────────────────── */

function makeRunner({ ctx, emit }: AgentInput) {
  const done: ToolOutput[] = [];
  const run = async (name: string, args: Record<string, unknown>) => {
    const id = randomUUID();
    const def = toolByName.get(name);
    emit({ type: 'tool', id, name, label: def?.label ?? name, status: 'start' });
    const t0 = Date.now();
    try {
      const out = await runTool(name, args ?? {}, ctx);
      for (const b of out.blocks) emit({ type: 'block', block: { ...b, id: randomUUID() } as BlockWithId });
      emit({ type: 'tool', id, name, label: def?.label ?? name, status: 'done', ms: Date.now() - t0 });
      done.push(out);
      return out.facts;
    } catch (e) {
      console.error(`[ai] tool ${name} failed:`, e);
      emit({ type: 'tool', id, name, label: def?.label ?? name, status: 'error', ms: Date.now() - t0 });
      return { error: 'The tool failed while reading the data.' };
    }
  };
  return { run, done };
}

const clip = (v: unknown) => {
  const s = JSON.stringify(v);
  return s.length > 14_000 ? JSON.parse(JSON.stringify({ truncated: true, data: s.slice(0, 14_000) })) : v;
};

/* ───────────────────────── Gemini ───────────────────────── */

type Part = { text?: string; thought?: boolean; functionCall?: { name: string; args?: Record<string, unknown>; id?: string }; thoughtSignature?: string; functionResponse?: unknown };
type Content = { role: 'user' | 'model'; parts: Part[] };

/** OpenAPI-style schema with upper-case types, as Gemini's function declarations want. */
function geminiSchema(s: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...s, type: String(s.type).toUpperCase() };
  if (s.properties) out.properties = Object.fromEntries(Object.entries(s.properties as Record<string, Record<string, unknown>>).map(([k, v]) => [k, geminiSchema(v)]));
  if (s.items) out.items = geminiSchema(s.items as Record<string, unknown>);
  if (Array.isArray(s.required) && !s.required.length) delete out.required;
  return out;
}

const geminiTools = [{
  functionDeclarations: TOOLS.map((t) => {
    const hasProps = Object.keys(t.parameters.properties ?? {}).length > 0;
    return { name: t.name, description: t.description, ...(hasProps ? { parameters: geminiSchema(t.parameters as unknown as Record<string, unknown>) } : {}) };
  }),
}];

class EngineError extends Error {
  constructor(message: string, public kind: 'busy' | 'skip' | 'fatal') { super(message); }
}

let lastGoodGemini: string | null = null;

async function* sse(res: Response): AsyncGenerator<unknown> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
      const data = chunk.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (data && data !== '[DONE]') { try { yield JSON.parse(data); } catch { /* partial line */ } }
    }
  }
}

async function geminiTurn(model: string, system: string, contents: Content[], emit: AgentInput['emit'], signal?: AbortSignal, withThinking = true, useTools = true): Promise<{ parts: Part[]; streamed: boolean }> {
  const res = await fetch(`${GEMINI_API}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      ...(useTools ? { tools: geminiTools, toolConfig: { functionCallingConfig: { mode: 'AUTO' } } } : {}),
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048, ...(withThinking && thinkingFor(model) ? { thinkingConfig: thinkingFor(model) } : {}) },
    }),
  }).catch((e) => { throw new EngineError((e as Error).message, 'busy'); });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    const err = body.error?.message ?? `HTTP ${res.status}`;
    console.warn(`[ai] Gemini ${model} failed (${res.status}): ${err}`);
    if (res.status === 400 && withThinking && /thinking/i.test(err)) return geminiTurn(model, system, contents, emit, signal, false, useTools);
    if (/api key not valid|api_key_invalid/i.test(err)) throw new EngineError('GEMINI_API_KEY is not valid', 'fatal');
    if (res.status === 429 || res.status >= 500 || /overloaded|high demand/i.test(err)) throw new EngineError(err, 'busy');
    throw new EngineError(err, 'skip');
  }
  const parts: Part[] = [];
  let streamed = false;
  for await (const chunk of sse(res)) {
    const c = chunk as { candidates?: { content?: { parts?: Part[] }; finishReason?: string }[] };
    for (const p of c.candidates?.[0]?.content?.parts ?? []) {
      parts.push(p);
      if (p.text && !p.thought) { emit({ type: 'text', delta: p.text }); streamed = true; }
    }
  }
  return { parts, streamed };
}

async function runGemini(input: AgentInput, run: ReturnType<typeof makeRunner>['run']) {
  const system = systemPrompt(input.ctx);
  const contents: Content[] = input.history.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] }));
  const candidates = [...new Set([config.geminiModel, lastGoodGemini, ...GEMINI_DEFAULTS].filter(Boolean) as string[])];
  let model = '';
  let anyOutput = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let turn: Awaited<ReturnType<typeof geminiTurn>> | null = null;
    let lastErr: EngineError | null = null;
    const pool = model ? [model] : candidates;
    for (let i = 0; i < pool.length && !turn; i++) {
      try {
        turn = await geminiTurn(pool[i], system, contents, input.emit, input.signal, true, !input.chatOnly);
        if (!model) { model = pool[i]; lastGoodGemini = model; input.emit({ type: 'meta', engine: 'gemini', model }); }
      } catch (e) {
        lastErr = e instanceof EngineError ? e : new EngineError((e as Error).message, 'busy');
        if (lastErr.kind === 'fatal' || input.signal?.aborted) throw lastErr;
        if (!model && i === pool.length - 1 && lastErr.kind === 'skip') {
          // Every known model was retired or rejected: look up the live list once.
          const found = (await discoverGeminiModels()).filter((m) => !pool.includes(m)).slice(0, 3);
          pool.push(...found);
        }
      }
    }
    if (!turn) throw Object.assign(lastErr ?? new EngineError('No Gemini model answered', 'busy'), { anyOutput });
    anyOutput ||= turn.streamed;
    const calls = turn.parts.filter((p) => p.functionCall);
    if (!calls.length) return;
    contents.push({ role: 'model', parts: turn.parts });
    const responses: Part[] = [];
    for (const c of calls) {
      const facts = await run(c.functionCall!.name, c.functionCall!.args ?? {});
      responses.push({ functionResponse: { name: c.functionCall!.name, ...(c.functionCall!.id ? { id: c.functionCall!.id } : {}), response: { result: clip(facts) } } });
      anyOutput = true;
    }
    contents.push({ role: 'user', parts: responses });
  }
  input.emit({ type: 'text', delta: '\n\n_(Stopped after several tool rounds. Ask a narrower question for more detail.)_' });
}

/* ───────────────────────── Groq (OpenAI-compatible tool calls) ───────────────────────── */

const GROQ_CHAT_MODELS = [process.env.GROQ_CHAT_MODEL, 'llama-3.3-70b-versatile', 'openai/gpt-oss-120b'].filter(Boolean) as string[];

async function runGroq(input: AgentInput, run: ReturnType<typeof makeRunner>['run']) {
  type Msg = { role: string; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]; tool_call_id?: string };
  const messages: Msg[] = [{ role: 'system', content: systemPrompt(input.ctx) }, ...input.history.map((t) => ({ role: t.role, content: t.text }))];
  const tools = TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  let model = '';
  for (let round = 0; round < MAX_ROUNDS; round++) {
    type GroqBody = { choices?: { message?: Msg }[]; error?: { message?: string } };
    let body: GroqBody | null = null;
    for (const m of model ? [model] : GROQ_CHAT_MODELS) {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.groqApiKey}` },
        signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
        body: JSON.stringify({ model: m, messages, ...(input.chatOnly ? {} : { tools, tool_choice: 'auto' }), temperature: 0.4, max_tokens: 1500 }),
      }).catch((e) => { throw new EngineError((e as Error).message, 'busy'); });
      const b = await res.json().catch(() => ({})) as GroqBody;
      if (res.ok) { body = b; if (!model) { model = m; input.emit({ type: 'meta', engine: 'groq', model }); } break; }
      console.warn(`[ai] Groq ${m} failed (${res.status}): ${b.error?.message}`);
      if (res.status === 401) throw new EngineError('GROQ_API_KEY is not valid', 'fatal');
    }
    if (!body) throw new EngineError('Groq is busy', 'busy');
    const msg = body.choices?.[0]?.message;
    if (!msg) throw new EngineError('Groq gave no answer', 'busy');
    if (!msg.tool_calls?.length) {
      // Not streamed by Groq: send it in small pieces so the chat still types it out smoothly.
      const text = msg.content ?? '';
      for (const piece of text.match(/[\s\S]{1,24}/g) ?? []) input.emit({ type: 'text', delta: piece });
      return;
    }
    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
    for (const c of msg.tool_calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(c.function.arguments || '{}'); } catch { /* keep empty */ }
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(clip(await run(c.function.name, args))) });
    }
  }
}

/* ───────────────────────── Offline analyst ───────────────────────── */

const SMALL_TALK = /^(hi+|hii+|hey+|hello+|yo|sup|hola|namaste|good (morning|afternoon|evening|night)|gm|gn|thanks?( you)?|thank u|thx|ty|ok(ay)?|cool|nice|great|awesome|bye|see you|who are you|what can you do|help|how are you|what'?s up)[\s!.?,]*$/i;

/** Greetings and chit-chat that should get a plain chat reply, never tools or charts. */
export const isSmallTalk = (q: string) => SMALL_TALK.test(q.trim().replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim());

const HELP = `I'm Squad Intelligence, your team's analyst. Ask me things like:

- "Suggest today's best four players"
- "Compare Akshay and Bittu over the last 15 matches"
- "Analyze our last 10 matches"
- "Who misses scrims?"
- "Which time is best for our scrims?"
- "Report for our last match"

I'll answer here and chart the data on the dashboard.`;

function offlineChat(q: string) {
  const s = q.toLowerCase();
  if (/thank|thx|ty\b/.test(s)) return 'Anytime. Ask me whenever you want the numbers on the squad.';
  if (/bye|see you|gn|good night/.test(s)) return 'GG. Catch you before the next scrim.';
  if (/how are you|what'?s up|sup/.test(s)) return `Ready for scrims. ${HELP}`;
  if (/who are you|what can you do|help/.test(s)) return HELP;
  return `Hey! ${HELP}`;
}

export function pickOfflineTools(q: string, roster: string[]): { name: string; args: Record<string, unknown> }[] {
  const s = q.toLowerCase();
  const n = /last\s+(\d{1,3})/.exec(s)?.[1];
  const last = n ? { last_matches: Number(n) } : {};
  const days = /this month|30 days|month/.test(s) ? { days: 30 } : /this week|7 days|week/.test(s) ? { days: 7 } : {};
  const named = roster.filter((r) => s.includes(r.toLowerCase().replace(/^rare\s*[|丨]\s*/i, '')));
  const out: { name: string; args: Record<string, unknown> }[] = [];
  if (/compare|\bvs\.?\b|versus/.test(s) && named.length >= 2) out.push({ name: 'compare_players', args: { player_a: named[0], player_b: named[1], ...last } });
  if (/squad|line.?up|best (four|4)|who should play|play tonight|pick|bench|substitute/.test(s)) out.push({ name: 'recommend_squad', args: {} });
  if (/attend|miss|late|cancel|show.?up|absent|no.?show|reliab/.test(s)) out.push({ name: 'analyze_attendance', args: { ...last, ...days } });
  if (/best time|time slot|what time|which time|when should|availability|available/.test(s)) out.push({ name: 'best_time_slots', args: {} });
  if (/report|last (match|scrim|game)|yesterday/.test(s)) out.push({ name: 'get_match_report', args: {} });
  if (/mvp|top frag|best player|stats|kills|damage|who is our/.test(s) && !out.some((o) => o.name === 'compare_players')) out.push({ name: 'get_player_stats', args: { players: named.length === 1 ? named : [], ...last, ...days } });
  if (/analy|perform|weak|strength|trend|improve|map|mistake|placement|how are we|how did we/.test(s)) out.push({ name: 'analyze_performance', args: { ...last, ...days } });
  return out.slice(0, 3);
}

async function runOffline(input: AgentInput, run: ReturnType<typeof makeRunner>['run'], done: ToolOutput[], reason: string) {
  input.emit({ type: 'meta', engine: 'offline' });
  const q = [...input.history].reverse().find((t) => t.role === 'user')?.text ?? '';
  if (!input.chatOnly && /schedule|create|book|set up|add/.test(q.toLowerCase()) && /scrim|match|tournament/.test(q.toLowerCase())) {
    input.emit({ type: 'text', delta: `${reason} Scheduling from a sentence needs the AI engine, so add the scrim on the Matches page for now. Here's what the data says:\n\n` });
  }
  const before = done.length;
  const tools = input.chatOnly ? [] : pickOfflineTools(q, input.ctx.roster);
  for (const t of tools) await run(t.name, t.args);
  const text = tools.length ? done.slice(before).map((d) => d.summary).join('\n\n') : offlineChat(q);
  for (const piece of text.match(/[\s\S]{1,18}/g) ?? []) input.emit({ type: 'text', delta: piece });
}

/* ───────────────────────── Entry ───────────────────────── */

export async function runAgent(input: AgentInput) {
  const last = [...input.history].reverse().find((t) => t.role === 'user')?.text ?? '';
  if (input.chatOnly === undefined) input = { ...input, chatOnly: isSmallTalk(last) };
  const { run, done } = makeRunner(input);
  const engines: ('gemini' | 'groq')[] = [];
  if (config.geminiApiKey) engines.push('gemini');
  if (config.groqApiKey) engines.push('groq');
  let reason = 'AI engine is not set up (no GEMINI_API_KEY), so this is the built-in analyst.';
  for (const engine of engines) {
    const before = done.length;
    try {
      await (engine === 'gemini' ? runGemini(input, run) : runGroq(input, run));
      input.emit({ type: 'done' });
      return;
    } catch (e) {
      if (input.signal?.aborted) return;
      const err = e as EngineError & { anyOutput?: boolean };
      console.warn(`[ai] ${engine} engine failed: ${err.message}`);
      reason = err.kind === 'fatal' ? `${err.message}.` : `The free ${engine === 'gemini' ? 'Gemini' : 'Groq'} tier is busy right now.`;
      if (done.length > before || err.anyOutput) {
        // Tools already ran and drew their charts: finish with their summaries instead of starting over.
        input.emit({ type: 'notice', message: `${reason} Finished with the built-in analyst.` });
        const text = done.slice(before).map((d) => d.summary).join('\n\n');
        if (text) input.emit({ type: 'text', delta: `\n\n${text}` });
        input.emit({ type: 'done' });
        return;
      }
    }
  }
  if (engines.length && !input.chatOnly) input.emit({ type: 'notice', message: `${reason} Answering with the built-in analyst.` });
  await runOffline(input, run, done, reason);
  input.emit({ type: 'done' });
}
