/**
 * Background answers. A question runs on the server whether or not the app is still open: its events are
 * buffered in memory (so a reopened app can re-attach and watch the rest stream in) and saved to the
 * AiTurn document as they arrive (so the finished answer is there later, on any device).
 */
import { randomUUID } from 'node:crypto';
import type { Types } from 'mongoose';
import { AiProposal, AiTurn, type AiTurnDoc } from '../models/index.js';
import { runAgent, type AgentEvent, type ChatTurn } from './agent.js';
import type { BlockWithId, ProposalBlock } from './blocks.js';

/** The longest one answer may take. */
export const ANSWER_LIMIT_MS = 60_000;
/** Turns kept per teammate; older ones are pruned when a new question comes in. */
const KEEP_TURNS = 300;

export interface TurnState {
  text: string;
  tools: { id: string; label: string; status: string; ms?: number }[];
  blocks: BlockWithId[];
  notice: string | null;
  engine: string | null;
  label: string | null;
  model: string | null;
}

export const emptyState = (): TurnState => ({ text: '', tools: [], blocks: [], notice: null, engine: null, label: null, model: null });

/** Fold one agent event into the saved answer. Pure, so the client and server agree on the result. */
export function applyEvent(s: TurnState, e: AgentEvent): TurnState {
  switch (e.type) {
    case 'meta': return { ...s, engine: e.engine, label: e.label, model: e.model ?? null };
    case 'text': return { ...s, text: s.text + e.delta };
    case 'tool': {
      const step = { id: e.id, label: e.label, status: e.status, ms: e.ms };
      const i = s.tools.findIndex((t) => t.id === e.id);
      return { ...s, tools: i < 0 ? [...s.tools, step] : s.tools.map((t, j) => (j === i ? step : t)) };
    }
    case 'block': return { ...s, blocks: [...s.blocks, e.block] };
    case 'notice': return { ...s, notice: e.message };
    default: return s;
  }
}

/** Events that rebuild a saved answer, for an app that re-attaches after the live run is gone. */
export function eventsFromTurn(t: Pick<AiTurnDoc, 'text' | 'tools' | 'blocks' | 'notice' | 'engine' | 'label' | 'model'>): AgentEvent[] {
  const out: AgentEvent[] = [];
  if (t.engine) out.push({ type: 'meta', engine: t.engine, label: t.label ?? t.engine, model: t.model ?? undefined });
  for (const tool of t.tools ?? []) out.push({ type: 'tool', id: tool.id!, name: '', label: tool.label ?? '', status: (tool.status ?? 'done') as 'done', ms: tool.ms ?? undefined });
  for (const b of (t.blocks ?? []) as BlockWithId[]) out.push({ type: 'block', block: b });
  if (t.notice) out.push({ type: 'notice', message: t.notice });
  if (t.text) out.push({ type: 'text', delta: t.text });
  return out;
}

interface Live {
  userId: string;
  events: AgentEvent[];
  listeners: Set<(e: AgentEvent | null) => void>;
  stop: AbortController;
}

const live = new Map<string, Live>();

export const isLive = (turnId: string) => live.has(turnId);
export const runningFor = (userId: string) => [...live.entries()].find(([, l]) => l.userId === userId)?.[0] ?? null;

/** Watch a live answer: replays what happened so far, then every new event. `null` means it finished. */
export function subscribe(turnId: string, fn: (e: AgentEvent | null) => void): (() => void) | null {
  const l = live.get(turnId);
  if (!l) return null;
  for (const e of l.events) fn(e);
  l.listeners.add(fn);
  return () => l.listeners.delete(fn);
}

export function stopTurn(turnId: string, userId: string) {
  const l = live.get(turnId);
  if (!l || l.userId !== userId) return false;
  l.stop.abort(new Error('stopped'));
  return true;
}

export interface StartInput {
  teamId: Types.ObjectId | string;
  userId: string;
  question: string;
  conversationId?: string | null;
  ctx: Omit<Parameters<typeof runAgent>[0]['ctx'], 'teamId' | 'userId'>;
}

/** Earlier turns of the same chat, oldest first, as model history (last 6 questions). */
async function historyFor(userId: string, conversationId: string): Promise<ChatTurn[]> {
  const prev = await AiTurn.find({ userId, conversationId, status: 'done' }).sort({ createdAt: -1 }).limit(6).select('question text').lean();
  return prev.reverse().flatMap((t) => [{ role: 'user' as const, text: t.question }, ...(t.text.trim() ? [{ role: 'assistant' as const, text: t.text.slice(0, 3000) }] : [])]);
}

/** Save the question, start answering it in the background, and return the saved turn. */
export async function startTurn(input: StartInput) {
  const conversationId = input.conversationId || randomUUID();
  const history = [...await historyFor(input.userId, conversationId), { role: 'user' as const, text: input.question }];
  const turn = await AiTurn.create({ teamId: input.teamId, userId: input.userId, conversationId, question: input.question });
  const id = String(turn._id);
  const l: Live = { userId: input.userId, events: [], listeners: new Set(), stop: new AbortController() };
  live.set(id, l);
  void prune(input.userId);

  let state = emptyState();
  let dirty = false;
  let saving: Promise<unknown> = Promise.resolve();
  const save = (extra: Record<string, unknown> = {}) => {
    dirty = false;
    const snap = { ...state, ...extra };
    saving = saving.then(() => AiTurn.updateOne({ _id: turn._id }, { $set: snap })).catch((e) => console.error('[ai] could not save answer:', (e as Error).message));
    return saving;
  };
  const flush = setInterval(() => { if (dirty) void save(); }, 1500);

  const emit = (e: AgentEvent) => {
    l.events.push(e);
    state = applyEvent(state, e);
    dirty = true;
    if (e.type === 'block' || (e.type === 'tool' && e.status !== 'start') || e.type === 'meta') void save();
    for (const fn of l.listeners) fn(e);
  };

  const signal = AbortSignal.any([l.stop.signal, AbortSignal.timeout(ANSWER_LIMIT_MS)]);
  void (async () => {
    let status: 'done' | 'error' | 'stopped' = 'done';
    try {
      await runAgent({ history, ctx: { ...input.ctx, teamId: input.teamId, userId: input.userId }, emit, signal });
      if (l.stop.signal.aborted) status = 'stopped';
    } catch (e) {
      console.error('[ai] answer failed:', e);
      status = 'error';
      emit({ type: 'notice', message: 'Something went wrong while answering. Try again.' });
    } finally {
      clearInterval(flush);
      if (!state.text.trim()) {
        const fallback = status === 'stopped' ? '_Stopped._' : 'No answer came back. Try again.';
        emit({ type: 'text', delta: fallback });
      }
      if (!l.events.some((e) => e.type === 'done')) emit({ type: 'done' });
      await save({ status, finishedAt: new Date() });
      live.delete(id);
      for (const fn of l.listeners) fn(null);
    }
  })();
  return turn;
}

async function prune(userId: string) {
  try {
    const old = await AiTurn.find({ userId }).sort({ createdAt: -1 }).skip(KEEP_TURNS).select('_id').lean();
    if (old.length) await AiTurn.deleteMany({ _id: { $in: old.map((o) => o._id) } });
  } catch { /* best effort */ }
}

/** A turn as the app sees it, with approval cards showing their current status. */
export async function serializeTurns(turns: AiTurnDoc[] | (AiTurnDoc & object)[]) {
  // A "running" turn the server no longer holds was cut off by a restart: close it out.
  const orphaned = turns.filter((t) => t.status === 'running' && !live.has(String(t._id)) && Date.now() - new Date(t.createdAt as Date).getTime() > 5_000);
  if (orphaned.length) {
    await AiTurn.updateMany({ _id: { $in: orphaned.map((t) => t._id) }, status: 'running' }, { $set: { status: 'error', notice: 'The server restarted while answering. Ask again.', finishedAt: new Date() } });
    for (const t of orphaned) { t.status = 'error'; t.notice = 'The server restarted while answering. Ask again.'; }
  }
  const ids = turns.flatMap((t) => ((t.blocks ?? []) as BlockWithId[]).filter((b) => b.type === 'proposal').map((b) => b.id));
  const props = ids.length ? await AiProposal.find({ _id: { $in: ids } }).select('status result expiresAt').lean() : [];
  const byId = new Map(props.map((p) => [String(p._id), p]));
  return turns.map((t) => ({
    id: String(t._id),
    conversationId: t.conversationId,
    question: t.question,
    text: t.text,
    tools: t.tools ?? [],
    blocks: ((t.blocks ?? []) as BlockWithId[]).map((b) => {
      if (b.type !== 'proposal') return b;
      const p = byId.get(b.id);
      const status = !p ? 'expired' : p.status === 'pending' && p.expiresAt.getTime() < Date.now() ? 'expired' : p.status;
      return { ...b, status, result: p?.result ?? null } as ProposalBlock & { id: string };
    }),
    notice: t.notice,
    engine: t.engine,
    label: t.label,
    model: t.model,
    status: t.status,
    live: live.has(String(t._id)),
    at: t.createdAt,
  }));
}
