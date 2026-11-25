import { Router, type Request, type Response } from 'express';
import type { Types } from 'mongoose';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { ah, parse } from '../middleware/handlers.js';
import { requireAuth, requireCaptain } from '../middleware/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { AiProposal, AiTurn, MAPS, Team } from '../models/index.js';
import type { QueueLike } from '../scheduler/queue.js';
import { config } from '../config.js';
import { aiEngine, type AgentEvent } from '../ai/agent.js';
import { applySquad, canDecide, executeProposal } from '../ai/actions.js';
import { performanceTool } from '../ai/analytics.js';
import { localDateTime } from '../ai/tools.js';
import { loadRoster, loadTeamData, loadUpcoming } from '../ai/data.js';
import { eventsFromTurn, isLive, runningFor, serializeTurns, startTurn, stopTurn, subscribe } from '../ai/runs.js';
import { pickSuggestions } from '../ai/suggestions.js';

/**
 * Squad Intelligence: the AI assistant, each teammate's saved chats, the dashboard overview, and approval
 * of AI-prepared actions. Every chat belongs to the person who asked it; nobody else can read or delete it.
 */
export function aiRouter(getQueue: () => QueueLike) {
  const r = Router();
  r.use(requireAuth);

  const teamOf = (req: { user?: { teamId?: unknown } }) => {
    if (!req.user?.teamId) throw badRequest('Join a team first');
    return req.user.teamId as Types.ObjectId;
  };
  const me = (req: Request) => String(req.user!._id);
  const isId = (v: unknown) => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);

  // Free LLM tiers allow ~10-30 requests a minute per key; keep one chatty teammate from using them all.
  const chatLimit = rateLimit({
    windowMs: 60_000, limit: 6, standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: (req) => String(req.user?._id ?? req.ip),
    message: { error: 'Slow down a little: the AI takes up to 6 questions a minute per person.' },
  });
  const hourLimit = rateLimit({
    windowMs: 3600_000, limit: 60, standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: (req) => String(req.user?._id ?? req.ip),
    message: { error: "You've asked 60 questions this hour. Take a break and try again soon." },
  });

  r.get('/status', (_req, res) => { res.json(aiEngine()); });

  /** Default dashboard: Team overview (KPI tiles) and Map breakdown. No model call. */
  r.get('/overview', ah(async (req, res) => {
    const perf = performanceTool(await loadTeamData(teamOf(req), { limit: 20 }));
    const blocks = perf.blocks
      .filter((b) => b.type === 'kpis' || (b.type === 'bar' && b.xKey === 'map'))
      .map((b) => ({ ...b, id: randomUUID() }));
    res.json({ blocks });
  }));

  /** A fresh set of suggested questions, with the team's real names, maps and next match. */
  r.get('/suggestions', ah(async (req, res) => {
    const teamId = teamOf(req);
    const seen = String(req.query.seen ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 40);
    const [roster, upcoming] = await Promise.all([loadRoster(teamId), loadUpcoming(teamId, new Date(), 1)]);
    const tz = config.displayTimeZone;
    let next: string | null = null;
    if (upcoming[0]) {
      const m = upcoming[0];
      const today = localDateTime(new Date(), tz).date;
      const tomorrow = localDateTime(new Date(Date.now() + 86_400_000), tz).date;
      const k = localDateTime(m.startAt, tz).date;
      const day = k === today ? 'tonight' : k === tomorrow ? 'tomorrow' : new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'long' }).format(m.startAt);
      next = `${day}'s ${m.type === 'tournament' ? 'tournament' : 'scrim'}`;
    }
    const suggestions = pickSuggestions({
      isCaptain: req.user!.role === 'captain', players: roster.map((m) => m.ign), maps: [...MAPS], next, selfIgn: req.user!.ign,
    }, seen);
    res.json({ suggestions });
  }));

  /* ───────────────────────── Asking ───────────────────────── */

  const askBody = z.object({
    question: z.string().trim().min(1, 'Type a question').max(1000, 'Keep the question under 1000 characters'),
    conversationId: z.string().trim().max(64).nullish(),
  });

  /** Write a live answer as Server-Sent Events until it finishes or the app goes away (the answer keeps running). */
  function stream(res: Response, turnId: string, head: AgentEvent[] = []) {
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const write = (e: AgentEvent | { type: 'turn'; id: string; conversationId: string }) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`); };
    for (const e of head) write(e);
    // Comment pings keep proxies from closing a quiet stream while tools run.
    const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15_000);
    let unsub: (() => void) | null = null;
    const end = () => { clearInterval(ping); unsub?.(); if (!res.writableEnded) res.end(); };
    unsub = subscribe(turnId, (e) => (e ? write(e) : end()));
    // Closing the app only stops watching; the answer itself keeps running and is saved.
    res.on('close', end);
    return { write, end, attached: Boolean(unsub) };
  }

  /** Ask a question. The answer streams back, keeps running if the app closes, and is saved to the asker's history. */
  r.post('/chat', chatLimit, hourLimit, ah(async (req, res) => {
    const { question, conversationId } = parse(askBody, req.body);
    const teamId = teamOf(req);
    if (runningFor(me(req))) throw conflict('Your last question is still being answered. Wait for it, or tap Stop.');
    const [team, roster] = await Promise.all([Team.findById(teamId).select('name').lean(), loadRoster(teamId)]);
    const turn = await startTurn({
      teamId, userId: me(req), question, conversationId,
      ctx: { isCaptain: req.user!.role === 'captain', teamName: team?.name ?? 'the team', userIgn: req.user!.ign, roster: roster.map((m) => m.ign) },
    });
    const s = stream(res, String(turn._id), [{ type: 'turn', id: String(turn._id), conversationId: turn.conversationId } as unknown as AgentEvent]);
    if (!s.attached) {
      // Finished before we could attach (instant answer): send what was saved.
      const saved = await AiTurn.findById(turn._id);
      if (saved) for (const e of eventsFromTurn(saved)) s.write(e);
      s.write({ type: 'done' });
      s.end();
    }
  }));

  /** Re-attach to an answer (after reopening the app): replays it so far, then streams the rest. */
  r.get('/turns/:id/stream', ah(async (req, res) => {
    const turn = await AiTurn.findById(req.params.id);
    if (!turn || String(turn.userId) !== me(req)) throw notFound('That chat was deleted.');
    const id = String(turn._id);
    if (isLive(id)) { stream(res, id); return; }
    const [t] = await serializeTurns([turn]);
    const s = stream(res, id);
    for (const e of eventsFromTurn({ ...turn.toObject(), blocks: t.blocks } as never)) s.write(e);
    s.write({ type: 'done' });
    s.end();
  }));

  r.post('/turns/:id/stop', ah(async (req, res) => {
    res.json({ stopped: stopTurn(String(req.params.id), me(req)) });
  }));

  /** One chat (conversation) of the asker. `latest` = their most recent one. */
  r.get('/turns', ah(async (req, res) => {
    let conversationId = String(req.query.conversation ?? 'latest');
    if (conversationId === 'latest') {
      const last = await AiTurn.findOne({ userId: me(req) }).sort({ createdAt: -1 }).select('conversationId').lean();
      if (!last) { res.json({ conversationId: null, turns: [] }); return; }
      conversationId = last.conversationId;
    }
    const turns = await AiTurn.find({ userId: me(req), conversationId }).sort({ createdAt: 1 }).limit(60);
    res.json({ conversationId, turns: await serializeTurns(turns) });
  }));

  /** Every question this teammate asked, newest first (the History list). */
  r.get('/history', ah(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 80) || 80, 200);
    const rows = await AiTurn.find({ userId: me(req) }).sort({ createdAt: -1 }).limit(limit).select('conversationId question status blocks.type createdAt').lean();
    res.json({
      items: rows.map((t) => ({
        id: String(t._id), conversationId: t.conversationId, question: t.question, status: t.status,
        visuals: (t.blocks as { type: string }[] | undefined)?.length ?? 0, at: t.createdAt, live: isLive(String(t._id)),
      })),
    });
  }));

  r.delete('/turns/:id', ah(async (req, res) => {
    if (!isId(req.params.id)) throw notFound('Already deleted');
    const t = await AiTurn.findOne({ _id: req.params.id, userId: me(req) });
    if (!t) throw notFound('Already deleted');
    stopTurn(String(t._id), me(req));
    await t.deleteOne();
    res.json({ ok: true });
  }));

  r.delete('/turns', ah(async (req, res) => {
    const running = runningFor(me(req));
    if (running) stopTurn(running, me(req));
    const { deletedCount } = await AiTurn.deleteMany({ userId: me(req) });
    res.json({ ok: true, deleted: deletedCount });
  }));

  /* ───────────────────────── Approvals ───────────────────────── */

  /** The captain taps "Approve squad" on a recommendation card: that tap is the approval. */
  r.post('/squad', requireCaptain, ah(async (req, res) => {
    const body = parse(z.object({ matchId: z.string().regex(/^[a-f\d]{24}$/i), selectedIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)) }), req.body);
    const matchId = await applySquad(getQueue, teamOf(req), body.matchId, body.selectedIds);
    res.json({ ok: true, matchId });
  }));

  async function loadProposal(req: Request) {
    if (!isId(req.params.id)) throw notFound('This card is from an older version. Ask the AI again.');
    const p = await AiProposal.findById(req.params.id);
    if (!p || String(p.teamId) !== String(teamOf(req))) throw notFound('This card expired. Ask the AI again.');
    if (p.status === 'pending' && p.expiresAt.getTime() < Date.now()) { p.status = 'expired'; await p.save(); }
    if (!canDecide(p, req.user!)) throw forbidden(p.approver === 'self' ? 'Only the person who asked can approve this.' : 'Only the captain can approve this.');
    return p;
  }

  // Decided actions are kept 90 days as the action log (who approved what, and what happened).
  const KEEP_LOG = () => new Date(Date.now() + 90 * 86_400_000);

  r.get('/proposals/:id', ah(async (req, res) => {
    if (!isId(req.params.id)) throw notFound('Not found');
    const p = await AiProposal.findById(req.params.id).lean();
    if (!p || String(p.teamId) !== String(teamOf(req))) throw notFound('Not found');
    res.json({ id: String(p._id), status: p.status, resultId: p.resultId, result: p.result });
  }));

  r.post('/proposals/:id/reject', ah(async (req, res) => {
    const p = await loadProposal(req);
    if (p.status !== 'pending') throw conflict(`Already ${p.status}`);
    p.set({ status: 'rejected', decidedBy: req.user!._id, decidedAt: new Date(), expiresAt: KEEP_LOG() });
    await p.save();
    res.json({ id: String(p._id), status: p.status });
  }));

  /** The only place AI-prepared changes happen, and only after Approve. The body may carry the approver's edits. */
  r.post('/proposals/:id/approve', ah(async (req, res) => {
    const p = await loadProposal(req);
    if (p.status !== 'pending') throw conflict(p.status === 'expired' ? 'This card expired. Ask the AI again.' : `Already ${p.status}`);
    // Claim it first so a double tap can't do it twice.
    const claimed = await AiProposal.findOneAndUpdate({ _id: p._id, status: 'pending' }, { $set: { status: 'approved', decidedBy: req.user!._id, decidedAt: new Date() } }, { new: true });
    if (!claimed) throw conflict('Already decided');
    try {
      const out = await executeProposal(claimed, (req.body as { edits?: unknown } | undefined)?.edits, { id: me(req), ign: req.user!.ign, teamId: teamOf(req) }, getQueue);
      claimed.set({ resultId: out.resultId, result: out.result, applied: out.applied, expiresAt: KEEP_LOG() });
      await claimed.save();
      console.info(`[ai] ${req.user!.ign} approved ${claimed.kind} ${claimed._id}: ${out.result}`);
      res.json({ id: String(p._id), status: 'approved', resultId: out.resultId, result: out.result, kind: p.kind });
    } catch (e) {
      // Nothing was changed: put it back so they can fix the details and try again.
      await AiProposal.updateOne({ _id: p._id }, { $set: { status: 'pending', decidedBy: null, decidedAt: null } });
      throw e;
    }
  }));

  return r;
}
