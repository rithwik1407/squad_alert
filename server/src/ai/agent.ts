/**
 * Squad Intelligence agent: a function-calling loop over the tools in tools.ts.
 *
 * Each question is routed to a tier (providers.ts): "light" for chat and general BGMI questions (fast small
 * model, no tools), "strong" for anything about the team (best tool caller). Every provider with a key is
 * tried in order until one answers. If none can, the offline analyst picks tools from keywords and answers
 * with their plain-English summaries: same numbers and charts, just less conversational.
 */
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { discoverGeminiModels, GEMINI_API, GEMINI_DEFAULTS, thinkingFor } from '../lib/scorecard.js';
import type { ToolOutput } from './analytics.js';
import type { BlockWithId } from './blocks.js';
import { configuredProviders, providersFor, routeQuestion, type Provider, type Tier } from './providers.js';
import { runTool, TOOLS, toolByName, type ToolContext } from './tools.js';

export type AgentEvent =
  /** engine: provider id ('groq', 'gemini', …) or 'offline'. label: shown in the chat header. */
  | { type: 'meta'; engine: string; label: string; model?: string; tier?: Tier }
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

/** What the chat header shows before the first answer: the first strong provider, or the offline analyst. */
export function aiEngine() {
  const p = providersFor('strong')[0];
  return p ? { engine: p.id, label: p.label, providers: configuredProviders().map((x) => x.label) } : { engine: 'offline', label: 'Built-in analyst', providers: [] as string[] };
}

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
3. Actions only create an approval card. Nothing changes until someone taps Approve, so never say something was done, sent or saved: say the card is ready. ${ctx.isCaptain
    ? 'Captain actions: propose_scrim (call check_schedule first; if the event name is missing use "Scrim"), propose_squad, propose_message (message chosen teammates or "all" by Telegram and/or push), propose_ping_unanswered (remind everyone who has not checked in for a match), propose_reschedule, propose_cancel, propose_set_map. Use get_roster or list_matches first when you need a match id.'
    : 'This user is NOT the captain: never call captain actions (propose_scrim, propose_squad, propose_message, propose_ping_unanswered, propose_reschedule, propose_cancel, propose_set_map). They can use propose_my_availability (their own check-in, e.g. "I\'ll join late at 9:15") and propose_captain_request (send the captain a request). For anything else, give the analysis and suggest they ask the captain.'}
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
      // Approval cards keep their proposal id (Approve / Dismiss use it); every other visual gets a fresh one.
      for (const b of out.blocks) emit({ type: 'block', block: { ...b, id: b.type === 'proposal' ? b.id : randomUUID() } as BlockWithId });
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

/** Tools this user may call: captains get the captain actions, players get their self-service ones. */
export function toolsFor(isCaptain: boolean) {
  return TOOLS.filter((t) => !t.write || (isCaptain ? t.write === 'captain' : t.write === 'self'));
}

const geminiToolsFor = (isCaptain: boolean) => [{
  functionDeclarations: toolsFor(isCaptain).map((t) => {
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

const withTimeout = (signal?: AbortSignal, ms = 45_000) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));

interface TurnOpts { key: string; tools: unknown[] | null; withThinking?: boolean }

async function geminiTurn(model: string, system: string, contents: Content[], emit: AgentInput['emit'], signal: AbortSignal | undefined, o: TurnOpts): Promise<{ parts: Part[]; streamed: boolean }> {
  const withThinking = o.withThinking ?? true;
  const res = await fetch(`${GEMINI_API}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': o.key },
    signal: withTimeout(signal),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      ...(o.tools ? { tools: o.tools, toolConfig: { functionCallingConfig: { mode: 'AUTO' } } } : {}),
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048, ...(withThinking && thinkingFor(model) ? { thinkingConfig: thinkingFor(model) } : {}) },
    }),
  }).catch((e) => { throw new EngineError((e as Error).message, 'busy'); });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    const err = body.error?.message ?? `HTTP ${res.status}`;
    console.warn(`[ai] Gemini ${model} failed (${res.status}): ${err}`);
    if (res.status === 400 && withThinking && /thinking/i.test(err)) return geminiTurn(model, system, contents, emit, signal, { ...o, withThinking: false });
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

type Run = ReturnType<typeof makeRunner>['run'];
interface Engine { provider: Provider; tier: Tier; system: string; useTools: boolean }

async function runGemini(input: AgentInput, run: Run, e: Engine) {
  const contents: Content[] = input.history.map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] }));
  const candidates = [...new Set([...e.provider.models[e.tier], ...(e.tier === 'strong' ? [lastGoodGemini] : []), ...GEMINI_DEFAULTS].filter(Boolean) as string[])];
  const tools = e.useTools ? geminiToolsFor(input.ctx.isCaptain) : null;
  let model = '';
  let anyOutput = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let turn: Awaited<ReturnType<typeof geminiTurn>> | null = null;
    let lastErr: EngineError | null = null;
    const pool = model ? [model] : candidates;
    for (let i = 0; i < pool.length && !turn; i++) {
      try {
        turn = await geminiTurn(pool[i], e.system, contents, input.emit, input.signal, { key: e.provider.apiKey, tools });
        if (!model) {
          model = pool[i];
          if (e.tier === 'strong') lastGoodGemini = model;
          input.emit({ type: 'meta', engine: e.provider.id, label: e.provider.label, model, tier: e.tier });
        }
      } catch (err) {
        lastErr = err instanceof EngineError ? err : new EngineError((err as Error).message, 'busy');
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

/* ───────────────────────── OpenAI-compatible (Groq, Cerebras, OpenRouter, extras) ───────────────────────── */

async function runOpenAI(input: AgentInput, run: Run, e: Engine) {
  type Msg = { role: string; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]; tool_call_id?: string };
  const messages: Msg[] = [{ role: 'system', content: e.system }, ...input.history.map((t) => ({ role: t.role, content: t.text }))];
  const tools = e.useTools ? toolsFor(input.ctx.isCaptain).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) : null;
  const { provider } = e;
  let model = '';
  let anyOutput = false;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    type Body = { choices?: { message?: Msg }[]; error?: { message?: string } | string };
    let body: Body | null = null;
    let lastErr = `${provider.label} is busy`;
    for (const m of model ? [model] : provider.models[e.tier]) {
      const res = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${provider.apiKey}`, ...(provider.headers ?? {}) },
        signal: withTimeout(input.signal),
        body: JSON.stringify({ model: m, messages, ...(tools ? { tools, tool_choice: 'auto' } : {}), temperature: 0.4, max_tokens: e.tier === 'light' ? 700 : 1500 }),
      }).catch((err) => { throw Object.assign(new EngineError((err as Error).message, 'busy'), { anyOutput }); });
      const b = await res.json().catch(() => ({})) as Body;
      if (res.ok && b.choices?.[0]?.message) {
        body = b;
        if (!model) { model = m; input.emit({ type: 'meta', engine: provider.id, label: provider.label, model, tier: e.tier }); }
        break;
      }
      lastErr = (typeof b.error === 'string' ? b.error : b.error?.message) ?? `HTTP ${res.status}`;
      console.warn(`[ai] ${provider.label} ${m} failed (${res.status}): ${lastErr}`);
      if (res.status === 401 || res.status === 403) throw new EngineError(`${provider.label} key is not valid`, 'fatal');
      // A model can reject tool calls it generated badly ("tool_use_failed"): the next model may do better.
    }
    if (!body) throw Object.assign(new EngineError(lastErr, 'busy'), { anyOutput });
    const msg = body.choices![0].message!;
    if (!msg.tool_calls?.length) {
      // Not streamed: send it in small pieces so the chat still types it out smoothly.
      const text = msg.content ?? '';
      for (const piece of text.match(/[\s\S]{1,24}/g) ?? []) input.emit({ type: 'text', delta: piece });
      return;
    }
    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
    for (const c of msg.tool_calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(c.function.arguments || '{}'); } catch { /* keep empty */ }
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(clip(await run(c.function.name, args))) });
      anyOutput = true;
    }
  }
  input.emit({ type: 'text', delta: '\n\n_(Stopped after several tool rounds. Ask a narrower question for more detail.)_' });
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
  input.emit({ type: 'meta', engine: 'offline', label: 'Built-in analyst' });
  const q = [...input.history].reverse().find((t) => t.role === 'user')?.text ?? '';
  if (!input.chatOnly && /schedule|create|book|set up|add|tell|message|notify|remind|ping|send|cancel|move|reschedule/.test(q.toLowerCase())) {
    input.emit({ type: 'text', delta: `${reason} Actions from a sentence need an AI model, so use the Matches page for now. Here's what the data says:\n\n` });
  }
  const before = done.length;
  const tools = input.chatOnly ? [] : pickOfflineTools(q, input.ctx.roster);
  for (const t of tools) await run(t.name, t.args);
  const text = tools.length ? done.slice(before).map((d) => d.summary).join('\n\n') : offlineChat(q);
  for (const piece of text.match(/[\s\S]{1,18}/g) ?? []) input.emit({ type: 'text', delta: piece });
}

/* ───────────────────────── Entry ───────────────────────── */

const LIGHT_NOTE = `\n\nThis reply has no tools and no team data. Answer from general BGMI knowledge in a few friendly lines. If the question needs this team's records, say what to ask instead (e.g. "Ask me: analyze our last 10 matches").`;

export async function runAgent(input: AgentInput) {
  const last = [...input.history].reverse().find((t) => t.role === 'user')?.text ?? '';
  const tier: Tier = input.chatOnly ? 'light' : routeQuestion(last, input.ctx.roster, isSmallTalk(last));
  input = { ...input, chatOnly: tier === 'light' };
  const { run, done } = makeRunner(input);
  const base = systemPrompt(input.ctx);
  const system = tier === 'light' ? base + LIGHT_NOTE : base;
  let reason = 'No AI model is set up on the server, so this is the built-in analyst.';
  const timedOut = () => input.signal?.aborted && (input.signal.reason as Error | undefined)?.name === 'TimeoutError';
  const finishWithSummaries = (from: number, message: string) => {
    input.emit({ type: 'notice', message });
    const text = done.slice(from).map((d) => d.summary).join('\n\n');
    if (text) input.emit({ type: 'text', delta: `\n\n${text}` });
    input.emit({ type: 'done' });
  };
  const providers = providersFor(tier);
  for (const provider of providers) {
    const before = done.length;
    const engine: Engine = { provider, tier, system, useTools: tier === 'strong' };
    try {
      await (provider.kind === 'gemini' ? runGemini(input, run, engine) : runOpenAI(input, run, engine));
      input.emit({ type: 'done' });
      return;
    } catch (e) {
      if (timedOut()) return finishWithSummaries(before, 'That took longer than 60 seconds, so I stopped. Here is what I found so far.');
      if (input.signal?.aborted) return;
      const err = e as EngineError & { anyOutput?: boolean };
      console.warn(`[ai] ${provider.label} failed: ${err.message}`);
      reason = err.kind === 'fatal' ? `${err.message}.` : `${provider.label}'s free tier is busy right now.`;
      if (done.length > before || err.anyOutput) {
        // Tools already ran and drew their charts: finish with their summaries instead of starting over.
        return finishWithSummaries(before, `${reason} Finished with the built-in analyst.`);
      }
    }
  }
  if (providers.length && !input.chatOnly) input.emit({ type: 'notice', message: `${providers.length > 1 ? 'Every AI model is busy right now.' : reason} Answering with the built-in analyst.` });
  await runOffline(input, run, done, reason);
  input.emit({ type: 'done' });
}
