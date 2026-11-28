import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { ah, parse } from '../middleware/handlers.js';
import { requireAuth } from '../middleware/auth.js';
import { ChallengeRun, Team, User } from '../models/index.js';
import { badRequest, conflict } from '../lib/errors.js';
import { answerChallenge } from '../lib/challenges.js';
import { badgeShelf, challengeByKey, challengeOptions, dailyChallenge, dayKeyIST } from '../lib/challengeCatalog.js';

/**
 * Squad challenges and badges. Everyone on the team can see them; the players a challenge was for answer the
 * after-match check ("Did the match begin?" then "Was the challenge completed?").
 */
export const challengesRouter = Router();
challengesRouter.use(requireAuth);

const teamIdOf = (req: Request) => {
  if (!req.user!.teamId) throw badRequest('Join a team first');
  return String(req.user!.teamId);
};

/** Today's squad challenge (changes at midnight IST). */
challengesRouter.get('/today', ah(async (req, res) => {
  const teamId = teamIdOf(req);
  const dayKey = dayKeyIST();
  const challenge = dailyChallenge(teamId, dayKey);
  const done = await ChallengeRun.exists({ teamId: new Types.ObjectId(teamId), dayKey, challengeKey: challenge.key, status: 'completed' });
  res.json({ dayKey, challenge, completed: Boolean(done) });
}));

/** Challenges to pick from on a classic invite: today's first, then random Classic ones. */
challengesRouter.get('/options', ah(async (req, res) => {
  const teamId = teamIdOf(req);
  res.json({ daily: dailyChallenge(teamId).key, options: challengeOptions(teamId) });
}));

type Lean = {
  _id: unknown; fromId: unknown; challengeKey: string; daily?: boolean | null; status: string; askAt: Date; createdAt?: Date;
  playerIds: unknown[]; begun?: { by?: unknown; at?: Date; yes?: boolean } | null; done?: { by?: unknown; at?: Date; yes?: boolean } | null; completedAt?: Date | null;
};

async function serialize(list: Lean[], me: string, now = Date.now()) {
  const ids = [...new Set(list.flatMap((r) => [String(r.fromId), ...r.playerIds.map(String), String(r.begun?.by ?? ''), String(r.done?.by ?? '')]).filter((x) => Types.ObjectId.isValid(x)))];
  const users = await User.find({ _id: { $in: ids } }).select('name ign avatar').lean();
  const by = new Map(users.map((u) => [String(u._id), { id: String(u._id), name: u.name, ign: u.ign, avatar: u.avatar ?? '' }]));
  const who = (id: unknown) => (id ? by.get(String(id)) ?? null : null);
  return list.flatMap((r) => {
    const c = challengeByKey(r.challengeKey);
    if (!c) return [];
    const mine = r.playerIds.some((p) => String(p) === me);
    const open = new Date(r.askAt).getTime() <= now;
    /** What I can answer right now, if anything. */
    const ask = !mine ? null
      : (r.status === 'waiting' || r.status === 'asking') && open ? 'begun'
        : r.status === 'begun' ? 'done' : null;
    return [{
      id: String(r._id),
      challenge: c,
      daily: Boolean(r.daily),
      status: r.status,
      from: who(r.fromId),
      players: r.playerIds.map(who).filter(Boolean),
      askAt: r.askAt,
      createdAt: r.createdAt ?? null,
      completedAt: r.completedAt ?? null,
      begun: r.begun?.at ? { by: who(r.begun.by), at: r.begun.at, yes: Boolean(r.begun.yes) } : null,
      done: r.done?.at ? { by: who(r.done.by), at: r.done.at, yes: Boolean(r.done.yes) } : null,
      mine,
      ask,
    }];
  });
}

/** Recent challenges for the team, plus the checks waiting on me. */
challengesRouter.get('/', ah(async (req, res) => {
  const teamId = new Types.ObjectId(teamIdOf(req));
  const me = String(req.user!._id);
  const [recent, open] = await Promise.all([
    ChallengeRun.find({ teamId, status: { $ne: 'cancelled' } }).sort({ createdAt: -1 }).limit(30).lean(),
    ChallengeRun.find({ teamId, playerIds: req.user!._id, status: { $in: ['waiting', 'asking', 'begun'] }, askAt: { $lte: new Date() } })
      .sort({ askAt: 1 }).limit(10).lean(),
  ]);
  res.json({ runs: await serialize(recent as Lean[], me), pending: await serialize(open as Lean[], me) });
}));

/** Answer the after-match check. The first answer counts for the whole squad. */
challengesRouter.post('/:id/answer', ah(async (req, res) => {
  const { step, yes } = parse(z.object({ step: z.enum(['begun', 'done']), yes: z.boolean() }), req.body);
  const run = await answerChallenge(String(req.params.id), String(req.user!._id), step, yes);
  if (!run || String(run.teamId) !== teamIdOf(req)) {
    throw conflict('Already answered by a teammate, or this check is not for you.');
  }
  res.json({ run: (await serialize([run.toObject() as Lean], String(req.user!._id)))[0] });
}));

/** Badge shelf for the team and for each player (from completed challenges). */
challengesRouter.get('/badges', ah(async (req, res) => {
  const teamId = new Types.ObjectId(teamIdOf(req));
  const team = await Team.findById(teamId).select('memberIds captainId').lean();
  const done = await ChallengeRun.find({ teamId, status: 'completed' }).select('challengeKey daily completedAt playerIds').lean();
  const members = await User.find({ _id: { $in: team?.memberIds ?? [] } }).select('name ign avatar role').lean();
  const players = members
    .filter((u) => String(u._id) !== String(team?.captainId) && u.role !== 'captain')
    .map((u) => {
      const mine = done.filter((r) => r.playerIds.some((p) => String(p) === String(u._id)));
      return { user: { id: String(u._id), name: u.name, ign: u.ign, avatar: u.avatar ?? '' }, total: mine.length, badges: badgeShelf(mine) };
    })
    .sort((a, b) => b.total - a.total || a.user.ign.localeCompare(b.user.ign));
  res.json({ team: { total: done.length, badges: badgeShelf(done) }, players });
}));
