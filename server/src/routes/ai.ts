import { Router, type Request } from 'express';
import type { Types } from 'mongoose';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ah, parse } from '../middleware/handlers.js';
import { requireAuth, requireCaptain } from '../middleware/auth.js';
import { badRequest, conflict, locked, notFound } from '../lib/errors.js';
import { AiProposal, Match, MAP_TBD, Squad, SQUAD_SIZE, Team } from '../models/index.js';
import { enqueueImmediate, upsertMatchJob, type QueueLike } from '../scheduler/queue.js';
import { aiEngine, runAgent, type AgentEvent } from '../ai/agent.js';
import { performanceTool, timeSlotsTool, attendanceTool, matchLabel, localParts, hourLabel } from '../ai/analytics.js';
import { loadRoster, loadTeamData, loadUpcoming } from '../ai/data.js';
import { config } from '../config.js';
import { randomUUID } from 'node:crypto';

/** Squad Intelligence: the AI assistant, its dashboard overview, and captain approval of AI-prepared actions. */
export function aiRouter(getQueue: () => QueueLike) {
  const r = Router();
  r.use(requireAuth);

  const teamOf = (req: { user?: { teamId?: unknown } }) => {
    if (!req.user?.teamId) throw badRequest('Join a team first');
    return req.user.teamId as Types.ObjectId;
  };

  // Free LLM tiers allow ~10-15 requests a minute per key; keep one chatty user from using them all.
  const chatLimit = rateLimit({
    windowMs: 60_000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false,
    keyGenerator: (req) => String(req.user?._id ?? req.ip),
    message: { error: 'Slow down a little: the AI takes up to 8 questions a minute.' },
  });

  r.get('/status', (_req, res) => {
    res.json({ engine: aiEngine() });
  });

  /** Dashboard landing view: the numbers that don't need the model. */
  r.get('/overview', ah(async (req, res) => {
    const teamId = teamOf(req);
    const [data, upcoming] = await Promise.all([loadTeamData(teamId, { limit: 20 }), loadUpcoming(teamId, new Date(), 4)]);
    const perf = performanceTool(data);
    const slots = timeSlotsTool(data);
    const att = attendanceTool(data);
    const tz = config.displayTimeZone;
    const blocks = [
      ...perf.blocks.filter((b) => b.type !== 'insights'),
      ...perf.blocks.filter((b) => b.type === 'insights'),
      ...slots.blocks.filter((b) => b.type === 'bar'),
      ...att.blocks.filter((b) => b.type === 'insights'),
    ].map((b) => ({ ...b, id: randomUUID() }));
    res.json({
      blocks,
      upcoming: upcoming.map((m) => ({ id: m.id, title: m.title, event: m.tournamentName, map: m.map, type: m.type, startAt: m.startAt, label: matchLabel(m, tz), time: hourLabel(localParts(m.startAt, tz).hour) })),
    });
  }));

  const chatBody = z.object({
    messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().trim().min(1).max(4000) })).min(1).max(20),
  });

  /** Streams the answer as Server-Sent Events: meta, text deltas, tool progress, dashboard blocks, done. */
  r.post('/chat', chatLimit, ah(async (req, res) => {
    const { messages } = parse(chatBody, req.body);
    if (messages[messages.length - 1].role !== 'user') throw badRequest('The last message must be a question');
    if (messages[messages.length - 1].text.length > 1000) throw badRequest('Keep the question under 1000 characters');
    const teamId = teamOf(req);
    const [team, roster] = await Promise.all([Team.findById(teamId).select('name').lean(), loadRoster(teamId)]);

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    const emit = (e: AgentEvent) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`); };
    // Comment pings keep proxies from closing a quiet stream while tools run.
    const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15_000);
    try {
      await runAgent({
        history: messages.slice(-12),
        ctx: {
          teamId, userId: String(req.user!._id), isCaptain: req.user!.role === 'captain',
          teamName: team?.name ?? 'the team', userIgn: req.user!.ign, roster: roster.map((m) => m.ign),
        },
        emit, signal: abort.signal,
      });
    } catch (e) {
      console.error('[ai] chat failed:', e);
      emit({ type: 'notice', message: 'Something went wrong while answering. Try again.' });
      emit({ type: 'done' });
    } finally {
      clearInterval(ping);
      res.end();
    }
  }));

  /** Save and confirm a squad, then alert the picked players. Same checks as PUT /api/matches/:id/squad. */
  async function applySquad(teamId: Types.ObjectId, matchId: string, selectedIds: string[]) {
    const match = await Match.findById(matchId);
    if (!match || String(match.teamId) !== String(teamId)) throw notFound('Match not found');
    if (match.notifiedAt) throw locked('Squad is locked: the alert already went out. Use substitution on the match page.');
    if (match.status !== 'scheduled') throw badRequest(`Match is ${match.status}`);
    const team = await Team.findById(teamId).lean();
    const members = (team?.memberIds ?? []).map(String);
    const ids = [...new Set(selectedIds)];
    if (ids.length !== SQUAD_SIZE || !ids.every((id) => members.includes(id))) throw badRequest('The squad no longer matches the team. Ask the AI again.');
    await Squad.findOneAndUpdate(
      { matchId: match._id },
      { selectedIds: ids, benchedId: members.find((m) => !ids.includes(m)) ?? null, confirmed: true },
      { upsert: true, new: true, runValidators: true },
    );
    if (match.startAt.getTime() > Date.now()) {
      await enqueueImmediate(getQueue(), { matchId: String(match._id), trigger: 'selected', onlyUserIds: ids })
        .catch((e) => console.error('[ai] could not queue squad-pick alert:', (e as Error).message));
    }
    return String(match._id);
  }

  /** The captain taps "Approve squad" on a recommendation card: that tap is the approval. */
  r.post('/squad', requireCaptain, ah(async (req, res) => {
    const body = parse(z.object({ matchId: z.string().regex(/^[a-f\d]{24}$/i), selectedIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).length(SQUAD_SIZE) }), req.body);
    const matchId = await applySquad(teamOf(req), body.matchId, body.selectedIds);
    res.json({ ok: true, matchId });
  }));

  async function loadProposal(req: Request) {
    const p = await AiProposal.findById(req.params.id);
    if (!p || String(p.teamId) !== String(teamOf(req))) throw notFound('Proposal not found');
    if (p.status === 'pending' && p.expiresAt.getTime() < Date.now()) { p.status = 'expired'; await p.save(); }
    return p;
  }

  r.get('/proposals/:id', ah(async (req, res) => {
    const p = await loadProposal(req);
    res.json({ id: String(p._id), status: p.status, resultId: p.resultId });
  }));

  r.post('/proposals/:id/reject', requireCaptain, ah(async (req, res) => {
    const p = await loadProposal(req);
    if (p.status !== 'pending') throw conflict(`Already ${p.status}`);
    p.set({ status: 'rejected', decidedBy: req.user!._id, decidedAt: new Date() });
    await p.save();
    res.json({ id: String(p._id), status: p.status });
  }));

  /** The only place AI-prepared changes are written, and only after the captain taps Approve. */
  r.post('/proposals/:id/approve', requireCaptain, ah(async (req, res) => {
    const p = await loadProposal(req);
    if (p.status !== 'pending') throw conflict(p.status === 'expired' ? 'This proposal expired. Ask the AI again.' : `Already ${p.status}`);
    // Claim it first so a double tap can't create two matches.
    const claimed = await AiProposal.findOneAndUpdate({ _id: p._id, status: 'pending' }, { $set: { status: 'approved', decidedBy: req.user!._id, decidedAt: new Date() } }, { new: true });
    if (!claimed) throw conflict('Already decided');
    const teamId = teamOf(req);
    const payload = p.payload as Record<string, unknown>;
    try {
      if (p.kind === 'scrim') {
        const startAt = new Date(String(payload.startAt));
        if (!(startAt.getTime() > Date.now())) throw badRequest('That time has passed. Ask the AI for a new time.');
        const team = await Team.findById(teamId);
        const map = String(payload.map ?? MAP_TBD);
        const match = await Match.create({
          teamId, title: String(payload.title), tournamentName: String(payload.tournamentName), type: String(payload.type ?? 'scrim'),
          map, drop: map !== MAP_TBD ? team?.drops.get(map) ?? '' : '', startAt,
        });
        claimed.resultId = String(match._id);
        await claimed.save();
        // The match exists now; a queue hiccup must not undo the approval (the catch-up sweep still sends the alert).
        await upsertMatchJob(getQueue(), { id: String(match._id), ...match.toObject() })
          .catch((e) => console.error('[ai] could not schedule alert:', (e as Error).message));
      } else {
        claimed.resultId = await applySquad(teamId, String(payload.matchId), (payload.selectedIds as string[]).map(String));
      }
      await claimed.save();
      res.json({ id: String(p._id), status: 'approved', resultId: claimed.resultId, kind: p.kind });
    } catch (e) {
      // Nothing was changed: put it back so the captain can see why and try again.
      await AiProposal.updateOne({ _id: p._id }, { $set: { status: 'pending', decidedBy: null, decidedAt: null } });
      throw e;
    }
  }));

  return r;
}
