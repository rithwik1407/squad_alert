import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { ah, parse } from '../middleware/handlers.js';
import { requireAuth, requireCaptain } from '../middleware/auth.js';
import {
  Attendance, AVAILABILITY, Availability, MAP_TBD, MATCH_MAPS, Match, MATCH_TYPES, NotificationLog, Squad, SQUAD_SIZE, Stats, Team,
  type MatchDoc,
} from '../models/index.js';
import { badRequest, locked, notFound } from '../lib/errors.js';
import { serializeMatch, type LogSummary } from '../lib/serialize.js';
import { randomUUID } from 'node:crypto';
import { markJoining } from '../lib/availability.js';
import { enqueueImmediate, removeMatchJob, upsertMatchJob, type QueueLike } from '../scheduler/queue.js';

export function matchesRouter(getQueue: () => QueueLike) {
  const r = Router();
  r.use(requireAuth);

  const teamIdOf = (req: Request) => {
    if (!req.user!.teamId) throw badRequest('Join or create a team first');
    return req.user!.teamId;
  };

  async function loadMatch(req: Request): Promise<MatchDoc> {
    const match = await Match.findById(req.params.id);
    if (!match || String(match.teamId) !== String(teamIdOf(req))) throw notFound('Match not found');
    if (req.user!.role !== 'captain') {
      const squad = await Squad.findOne({ matchId: match._id, confirmed: true, selectedIds: req.user!._id }).lean();
      if (!squad) throw notFound('Match not found');
    }
    return match;
  }

  async function summaries(matchIds: Types.ObjectId[], selectedByMatch: Map<string, string[]>) {
    const rows = await NotificationLog.aggregate<{ _id: { m: Types.ObjectId; u: Types.ObjectId }; sent: number }>([
      { $match: { matchId: { $in: matchIds }, kind: 'squad' } },
      { $group: { _id: { m: '$matchId', u: '$userId' }, sent: { $max: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } } } },
    ]);
    const out = new Map<string, LogSummary>();
    for (const id of matchIds) {
      const selected = selectedByMatch.get(String(id)) ?? [];
      const mine = rows.filter((x) => String(x._id.m) === String(id));
      const sent = mine.filter((x) => x.sent === 1).length;
      const failed = mine.filter((x) => x.sent === 0).length;
      out.set(String(id), { sent, failed, pending: Math.max(0, selected.length - sent - failed) });
    }
    return out;
  }

  async function view(matches: MatchDoc[], viewerId?: string) {
    const ids = matches.map((m) => m._id as Types.ObjectId);
    const [squads, avail] = await Promise.all([
      Squad.find({ matchId: { $in: ids } }).lean(),
      Availability.find({ matchId: { $in: ids } }).lean(),
    ]);
    const availBy = new Map<string, typeof avail>();
    for (const a of avail) {
      const k = String(a.matchId);
      if (!availBy.has(k)) availBy.set(k, []);
      availBy.get(k)!.push(a);
    }
    const byMatch = new Map(squads.map((s) => [String(s.matchId), s]));
    const sel = new Map(squads.filter((s) => s.confirmed).map((s) => [String(s.matchId), s.selectedIds.map(String)]));
    const logs = await summaries(ids, sel);
    return matches.map((m) => {
      const out = serializeMatch(m, byMatch.get(String(m._id)), m.notifiedAt ? logs.get(String(m._id)) : undefined);
      const rows = availBy.get(String(m._id)) ?? [];
      const mine = viewerId ? rows.find((a) => String(a.userId) === viewerId) : undefined;
      return {
        ...out,
        availability: Object.fromEntries(rows.filter((a) => a.status).map((a) => [String(a.userId), a.status])),
        availabilityNotes: Object.fromEntries(rows.filter((a) => a.note).map((a) => [String(a.userId), a.note])),
        joining: rows.filter((a) => a.joiningAt).map((a) => String(a.userId)),
        myAvailability: mine?.status ?? null,
        myJoining: Boolean(mine?.joiningAt),
      };
    });
  }

  // ---------- list ----------
  r.get('/', ah(async (req, res) => {
    const teamId = teamIdOf(req);
    const scope = String(req.query.scope ?? 'upcoming');
    const now = new Date();
    const filter: Record<string, unknown> = { teamId };
    if (scope === 'upcoming') {
      filter.startAt = { $gte: new Date(now.getTime() - 3 * 3600_000) };
      filter.status = { $in: ['scheduled', 'notified', 'live'] };
    } else if (scope === 'past') {
      filter.$or = [{ startAt: { $lt: now } }, { status: { $in: ['done', 'cancelled'] } }];
    }
    if (req.user!.role !== 'captain') {
      const mySquads = await Squad.find({ confirmed: true, selectedIds: req.user!._id }).select('matchId').lean();
      filter._id = { $in: mySquads.map((s) => s.matchId) };
    }
    const matches = await Match.find(filter).sort({ startAt: scope === 'past' ? -1 : 1 }).limit(100);
    res.json({ matches: await view(matches, String(req.user!._id)) });
  }));

  /** Player check-in board: every upcoming team match (no room details) and my availability. */
  r.get('/checkin', ah(async (req, res) => {
    const teamId = teamIdOf(req);
    const uid = String(req.user!._id);
    const matches = await Match.find({ teamId, status: 'scheduled', startAt: { $gte: new Date() } }).sort({ startAt: 1 }).limit(50).lean();
    const ids = matches.map((m) => m._id);
    const [avail, squads] = await Promise.all([
      Availability.find({ matchId: { $in: ids }, userId: req.user!._id }).lean(),
      Squad.find({ matchId: { $in: ids }, confirmed: true }).lean(),
    ]);
    res.json({
      matches: matches.map((m) => {
        const a = avail.find((x) => String(x.matchId) === String(m._id));
        const sq = squads.find((x) => String(x.matchId) === String(m._id));
        return {
          id: String(m._id), title: m.title, type: m.type, map: m.map, drop: m.drop ?? '', startAt: m.startAt.toISOString(),
          status: m.status, myAvailability: a?.status ?? null, myNote: a?.note ?? '',
          squadPicked: Boolean(sq), selected: Boolean(sq?.selectedIds.some((id) => String(id) === uid)),
        };
      }),
    });
  }));

  // ---------- create / edit ----------
  const matchBody = z.object({
    title: z.string().trim().min(1).max(60),
    type: z.enum(MATCH_TYPES).default('scrim'),
    map: z.enum(MATCH_MAPS).default(MAP_TBD),
    drop: z.string().trim().max(30).optional(),
    startAt: z.coerce.date(),
    notifyOffsetMin: z.coerce.number().int().min(0).max(120).default(2),
    roomId: z.string().trim().max(30).default(''),
    roomPassword: z.string().trim().max(30).default(''),
    tournamentName: z.string().trim().max(60).optional(),
  });

  r.post('/', requireCaptain, ah(async (req, res) => {
    const body = parse(matchBody, req.body);
    if (body.startAt.getTime() < Date.now()) throw badRequest('Pick a time in the future');
    const team = await Team.findById(teamIdOf(req));
    const drop = body.drop || (body.map !== MAP_TBD ? team?.drops.get(body.map) : '') || '';
    const match = await Match.create({ ...body, drop, teamId: teamIdOf(req) });
    const schedule = await upsertMatchJob(getQueue(), { id: String(match._id), ...match.toObject() });
    res.status(201).json({ match: (await view([match], String(req.user!._id)))[0], schedule });
  }));

  /** Bulk add: several matches at once (different times, optional maps). The client also uses it for "repeat daily". */
  const bulkBody = z.object({
    matches: z.array(matchBody).min(1).max(40, 'Up to 40 matches at a time'),
  });

  r.post('/bulk', requireCaptain, ah(async (req, res) => {
    const { matches: items } = parse(bulkBody, req.body);
    const now = Date.now();
    const past = items.findIndex((m) => m.startAt.getTime() < now);
    if (past >= 0) throw badRequest(`Match ${past + 1} (${items[past].title}) is in the past`);
    const times = items.map((m) => m.startAt.getTime());
    if (new Set(times).size !== times.length) throw badRequest('Two matches have the same start time');
    const team = await Team.findById(teamIdOf(req));
    const batchId = randomUUID();
    const docs = await Match.insertMany(items.map((m) => ({
      ...m,
      drop: m.drop || (m.map !== MAP_TBD ? team?.drops.get(m.map) : '') || '',
      teamId: teamIdOf(req),
      batchId,
    })));
    const created = await Match.find({ _id: { $in: docs.map((d) => d._id) } }).sort({ startAt: 1 });
    await Promise.all(created.map((m) => upsertMatchJob(getQueue(), { id: String(m._id), ...m.toObject() })));
    res.status(201).json({ matches: await view(created, String(req.user!._id)), batchId });
  }));

  r.get('/:id', ah(async (req, res) => {
    const match = await loadMatch(req);
    res.json({ match: (await view([match], String(req.user!._id)))[0] });
  }));

  r.patch('/:id', requireCaptain, ah(async (req, res) => {
    const match = await loadMatch(req);
    if (match.status === 'cancelled' || match.status === 'done') throw badRequest(`Match is ${match.status}`);
    const body = parse(matchBody.partial(), req.body);
    if (match.notifiedAt && (body.startAt || body.notifyOffsetMin !== undefined)) {
      throw locked('Notification already sent; time can no longer change');
    }
    if (body.startAt && body.startAt.getTime() < Date.now()) throw badRequest('Pick a time in the future');
    if (body.map && body.drop === undefined && body.map !== match.map) {
      const team = await Team.findById(match.teamId);
      body.drop = body.map === MAP_TBD ? '' : team?.drops.get(body.map) ?? '';
    }
    match.set(body);
    await match.save();
    const schedule = await upsertMatchJob(getQueue(), { id: String(match._id), ...match.toObject() });
    res.json({ match: (await view([match], String(req.user!._id)))[0], schedule });
  }));

  r.post('/:id/cancel', requireCaptain, ah(async (req, res) => {
    const match = await loadMatch(req);
    match.status = 'cancelled';
    await match.save();
    await removeMatchJob(getQueue(), String(match._id));
    res.json({ match: (await view([match], String(req.user!._id)))[0] });
  }));

  r.post('/:id/status', requireCaptain, ah(async (req, res) => {
    const { status, placement } = parse(
      z.object({ status: z.enum(['live', 'done']), placement: z.number().int().min(1).max(25).optional() }),
      req.body,
    );
    const match = await loadMatch(req);
    if (match.status === 'cancelled') throw badRequest('Match is cancelled');
    match.status = status;
    if (placement) match.placement = placement;
    await match.save();
    await removeMatchJob(getQueue(), String(match._id));
    res.json({ match: (await view([match], String(req.user!._id)))[0] });
  }));

  // ---------- availability & joining ----------
  r.put('/:id/availability', ah(async (req, res) => {
    const body = parse(z.object({ status: z.enum(AVAILABILITY), note: z.string().trim().max(80).default('') }), req.body);
    const match = await Match.findById(req.params.id);
    if (!match || String(match.teamId) !== String(teamIdOf(req))) throw notFound('Match not found');
    if (match.status !== 'scheduled' || match.startAt.getTime() < Date.now()) throw badRequest('Check-in is closed for this match');
    await Availability.updateOne(
      { matchId: match._id, userId: req.user!._id },
      { $set: { status: body.status, note: body.note } },
      { upsert: true },
    );
    res.json({ ok: true, status: body.status });
  }));

  r.post('/:id/joining', ah(async (req, res) => {
    const via = req.query.via === 'push' ? 'push' : 'app';
    const ok = await markJoining(String(req.params.id), String(req.user!._id), via);
    if (!ok) throw notFound('You are not in this squad');
    res.json({ ok: true });
  }));

  // ---------- squad ----------
  r.get('/:id/squad', ah(async (req, res) => {
    const match = await loadMatch(req);
    const squad = await Squad.findOne({ matchId: match._id }).lean();
    res.json({ squad: squad ? serializeMatch(match, squad).squad : null, locked: Boolean(match.notifiedAt) });
  }));

  const squadBody = z.object({
    selectedIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).length(SQUAD_SIZE, `Pick exactly ${SQUAD_SIZE} players`),
    confirm: z.boolean().default(false),
  });

  r.put('/:id/squad', requireCaptain, ah(async (req, res) => {
    const match = await loadMatch(req);
    if (match.notifiedAt) throw locked('Squad is locked: the notification already went out. Use emergency substitution.');
    if (match.status !== 'scheduled') throw badRequest(`Match is ${match.status}`);
    const body = parse(squadBody, req.body);
    const team = await Team.findById(match.teamId).lean();
    const members = (team?.memberIds ?? []).map(String);
    const unique = [...new Set(body.selectedIds)];
    if (unique.length !== SQUAD_SIZE) throw badRequest('Players must be different');
    if (!unique.every((id) => members.includes(id))) throw badRequest('Only team members can be picked');
    const benched = members.filter((m) => !unique.includes(m));
    const squad = await Squad.findOneAndUpdate(
      { matchId: match._id },
      { selectedIds: unique, benchedId: benched[0] ?? null, confirmed: body.confirm },
      { upsert: true, new: true, runValidators: true },
    ).lean();
    res.json({ squad: serializeMatch(match, squad).squad, match: (await view([match], String(req.user!._id)))[0] });
  }));

  r.post('/:id/substitute', requireCaptain, ah(async (req, res) => {
    const { outId, inId } = parse(z.object({ outId: z.string(), inId: z.string() }), req.body);
    const match = await loadMatch(req);
    if (['cancelled', 'done'].includes(match.status)) throw badRequest(`Match is ${match.status}`);
    const squad = await Squad.findOne({ matchId: match._id });
    if (!squad?.confirmed) throw badRequest('Confirm a squad first');
    const team = await Team.findById(match.teamId).lean();
    if (!team?.memberIds.map(String).includes(inId)) throw badRequest('Substitute must be on the team');
    const idx = squad.selectedIds.findIndex((id) => String(id) === outId);
    if (idx < 0) throw badRequest('That player is not in the squad');
    if (squad.selectedIds.some((id) => String(id) === inId)) throw badRequest('Substitute is already in the squad');
    squad.selectedIds.splice(idx, 1, new Types.ObjectId(inId));
    squad.benchedId = new Types.ObjectId(outId);
    squad.substitutions.push({ outId: new Types.ObjectId(outId), inId: new Types.ObjectId(inId), at: new Date() });
    await squad.save();
    // Before the lock the normal scheduled job covers the sub. After it, notify only the incoming player now.
    let jobId: string | null = null;
    if (match.notifiedAt) {
      jobId = await enqueueImmediate(getQueue(), { matchId: String(match._id), trigger: 'substitute', onlyUserIds: [inId] });
    }
    res.json({ match: (await view([match], String(req.user!._id)))[0], jobId });
  }));

  // ---------- notifications ----------
  r.post('/:id/send-now', requireCaptain, ah(async (req, res) => {
    const match = await loadMatch(req);
    if (['cancelled', 'done'].includes(match.status)) throw badRequest(`Match is ${match.status}`);
    const squad = await Squad.findOne({ matchId: match._id, confirmed: true }).lean();
    if (!squad) throw badRequest('Confirm the squad before sending');
    await removeMatchJob(getQueue(), String(match._id));
    const jobId = await enqueueImmediate(getQueue(), { matchId: String(match._id), trigger: 'manual' });
    res.status(202).json({ jobId });
  }));

  r.post('/:id/resend-failed', requireCaptain, ah(async (req, res) => {
    const match = await loadMatch(req);
    if (!match.notifiedAt) throw badRequest('Nothing has been sent yet');
    const jobId = await enqueueImmediate(getQueue(), { matchId: String(match._id), trigger: 'resend' });
    res.status(202).json({ jobId });
  }));

  r.get('/:id/notifications', requireCaptain, ah(async (req, res) => {
    const match = await loadMatch(req);
    const logs = await NotificationLog.find({ matchId: match._id }).sort({ sentAt: -1 }).populate('userId', 'name ign').lean();
    res.json({ logs: logs.map(serializeLog) });
  }));

  // ---------- attendance & stats ----------
  r.get('/:id/report', ah(async (req, res) => {
    const match = await loadMatch(req);
    const [attendance, stats] = await Promise.all([
      Attendance.find({ matchId: match._id }).lean(),
      Stats.find({ matchId: match._id }).lean(),
    ]);
    res.json({
      attendance: attendance.map((a) => ({ userId: String(a.userId), joined: a.joined })),
      stats: stats.map((s) => ({ userId: String(s.userId), kills: s.kills, damage: s.damage, mvp: s.mvp })),
    });
  }));

  r.put('/:id/attendance', requireCaptain, ah(async (req, res) => {
    const { entries } = parse(z.object({ entries: z.array(z.object({ userId: z.string(), joined: z.boolean() })).max(5) }), req.body);
    const match = await loadMatch(req);
    await Promise.all(entries.map((e) =>
      Attendance.updateOne({ matchId: match._id, userId: e.userId }, { $set: { joined: e.joined } }, { upsert: true })));
    res.json({ ok: true });
  }));

  r.put('/:id/stats', requireCaptain, ah(async (req, res) => {
    const { entries } = parse(z.object({
      entries: z.array(z.object({
        userId: z.string(), kills: z.number().int().min(0).max(99), damage: z.number().int().min(0).max(9999), mvp: z.boolean(),
      })).max(5),
    }), req.body);
    if (entries.filter((e) => e.mvp).length > 1) throw badRequest('Only one MVP per match');
    const match = await loadMatch(req);
    await Promise.all(entries.map((e) =>
      Stats.updateOne({ matchId: match._id, userId: e.userId }, { $set: { kills: e.kills, damage: e.damage, mvp: e.mvp } }, { upsert: true })));
    res.json({ ok: true });
  }));

  return r;
}

export function serializeLog(l: {
  _id: unknown; matchId: unknown; userId: unknown; kind: string; channel: string; status: string; trigger?: string | null;
  title?: string | null; body?: string | null; sentAt: Date; error?: string | null;
}) {
  const u = l.userId as { _id?: unknown; name?: string; ign?: string } | null;
  const m = l.matchId as { _id?: unknown; title?: string; map?: string; startAt?: Date } | null;
  return {
    id: String(l._id),
    matchId: String(m?._id ?? m),
    match: m?.title ? { title: m.title, map: m.map, startAt: m.startAt?.toISOString() } : undefined,
    userId: String(u?._id ?? u),
    user: u?.name ? { name: u.name, ign: u.ign } : undefined,
    kind: l.kind,
    channel: l.channel,
    status: l.status,
    trigger: l.trigger ?? 'scheduled',
    title: l.title ?? '',
    body: l.body ?? '',
    sentAt: l.sentAt.toISOString(),
    error: l.error ?? null,
  };
}

