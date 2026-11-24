import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { ah, parse } from '../middleware/handlers.js';
import { requireAuth, requireCaptain } from '../middleware/auth.js';
import {
  Attendance, AVAILABILITY, Availability, MAP_TBD, MatchScreenshot, MATCH_MAPS, PICKABLE_MAPS, Match, MATCH_TYPES, NotificationLog, Squad, SQUAD_SIZE, Stats, Team, User,
  type MatchDoc,
} from '../models/index.js';
import { badRequest, locked, notFound } from '../lib/errors.js';
import { serializeMatch, type LogSummary } from '../lib/serialize.js';
import { randomUUID } from 'node:crypto';
import { markJoining } from '../lib/availability.js';
import { enqueueImmediate, removeMatchJob, scheduleResults, sendResultsNow, upsertMatchJob, type QueueLike } from '../scheduler/queue.js';
import { readScorecardWithPlacement, scorecardReaderReady } from '../lib/scorecard.js';
import { getScorecardJob, startScorecardJob } from '../lib/scorecardJobs.js';
import { readSchedule } from '../lib/schedule.js';
import { saveScorecardStats } from '../lib/matchStats.js';
import { matchPlayer, scoreMvp } from '../lib/mvp.js';
import { deleteMatchData } from '../lib/deleteMatches.js';
import { buildCalendarDays, isMonthKey, monthRange, PLACEMENT_POINTS, POINTS_PER_KILL } from '../lib/calendar.js';
import { dayKey } from '../lib/dailySummary.js';
import { config } from '../config.js';

/** Stats from a screenshot go out to players this long after reading, unless the admin hits Save first. */
const RESULTS_DELAY_MS = 5 * 60_000;

/** How long after its start an unfinished match stays on the Upcoming tab (as live) before moving to History. */
const LIVE_WINDOW_MS = 12 * 3600_000;

export function matchesRouter(getQueue: () => QueueLike) {
  const r = Router();
  r.use(requireAuth);

  const isCaptain = (req: Request) => req.user!.role === 'captain';
  const teamIdOf = (req: Request) => {
    if (!req.user!.teamId) throw badRequest('Join or create a team first');
    return req.user!.teamId;
  };

  /** Any team member can open a team match. Room details are only shown to the picked squad (see view()). */
  async function loadMatch(req: Request): Promise<MatchDoc> {
    const match = await Match.findById(req.params.id);
    if (!match || String(match.teamId) !== String(teamIdOf(req))) throw notFound('Match not found');
    return match;
  }

  const hasStarted = (m: { startAt: Date }) => m.startAt.getTime() <= Date.now();

  /** Matches a player played: picked in the confirmed squad (subs included), or has stats saved for them. */
  async function playedMatchIds(uid: string) {
    const [squads, stats] = await Promise.all([
      Squad.find({ confirmed: true, selectedIds: uid }).select('matchId').lean(),
      Stats.find({ userId: uid }).select('matchId').lean(),
    ]);
    return [...new Set([...squads, ...stats].map((x) => String(x.matchId)))].map((id) => new Types.ObjectId(id));
  }

  /** Mark a match finished and drop any job still queued for it. */
  async function finish(matchId: string) {
    await Match.updateOne({ _id: matchId, status: { $nin: ['cancelled', 'done'] } }, { $set: { status: 'done' } });
    await removeMatchJob(getQueue(), matchId).catch(() => undefined);
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

  async function view(matches: MatchDoc[], viewerId?: string, viewerIsCaptain = true) {
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
      const inSquad = Boolean(viewerId && out.squad?.confirmed && out.squad.selectedIds.includes(viewerId));
      if (!viewerIsCaptain && !inSquad) { out.roomId = ''; out.roomPassword = ''; out.slot = ''; }
      return {
        ...out,
        inSquad,
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
    // A match is "current" (Upcoming tab) until the admin finishes it; it goes live on its own at the start
    // time. Unfinished matches drop into History after LIVE_WINDOW so a forgotten one doesn't stick forever.
    const current = { status: { $in: ['scheduled', 'notified', 'live'] }, startAt: { $gte: new Date(now.getTime() - LIVE_WINDOW_MS) } };
    const finished = { $or: [{ status: { $in: ['done', 'cancelled'] } }, { startAt: { $lt: new Date(now.getTime() - LIVE_WINDOW_MS) } }] };
    // Players only get the history of matches they actually played: the ones the admin put them in the squad for,
    // whether or not they tapped "joining". Upcoming matches stay visible to everyone (room details stay hidden).
    const played = isCaptain(req) ? null : { _id: { $in: await playedMatchIds(String(req.user!._id)) } };
    if (scope === 'upcoming') {
      Object.assign(filter, current);
    } else if (scope === 'past') {
      filter.$and = played ? [finished, played] : [finished];
    } else if (played) {
      filter.$or = [current, played];
    }
    const matches = await Match.find(filter).sort({ startAt: scope === 'past' ? -1 : 1 }).limit(100);
    res.json({ matches: await view(matches, String(req.user!._id), isCaptain(req)) });
  }));

  /**
   * Match calendar for one month (team time zone): every non-cancelled team match grouped by day,
   * with a points table per day (placement points + 1 per finish). Open to the whole team.
   */
  r.get('/calendar', ah(async (req, res) => {
    const teamId = teamIdOf(req);
    const tz = config.displayTimeZone;
    const month = isMonthKey(req.query.month) ? req.query.month : dayKey(new Date(), tz).slice(0, 7);
    const { start, end } = monthRange(month, tz);
    const matches = await Match.find({ teamId, status: { $ne: 'cancelled' }, startAt: { $gte: start, $lt: end } })
      .sort({ startAt: 1 }).select('title tournamentName type map startAt status placement').lean();
    const stats = await Stats.find({ matchId: { $in: matches.map((m) => m._id) } }).select('matchId userId kills damage assists mvp').lean();
    const userIds = [...new Set(stats.map((s) => String(s.userId)))];
    const users = userIds.length ? await User.find({ _id: { $in: userIds } }).select('name ign avatar').lean() : [];
    const days = buildCalendarDays(
      matches.map((m) => ({
        id: String(m._id), title: m.title, tournamentName: m.tournamentName, type: m.type ?? 'scrim', map: m.map ?? MAP_TBD,
        startAt: m.startAt, status: m.status ?? 'scheduled', placement: m.placement ?? null,
      })),
      stats.map((s) => ({ matchId: String(s.matchId), userId: String(s.userId), kills: s.kills ?? 0, damage: s.damage ?? 0, assists: s.assists ?? 0, mvp: Boolean(s.mvp) })),
      tz,
    );
    res.json({
      month,
      today: dayKey(new Date(), tz),
      timeZone: tz,
      pointsSystem: { placement: PLACEMENT_POINTS, perKill: POINTS_PER_KILL },
      players: users.map((u) => ({ id: String(u._id), name: u.name, ign: u.ign, avatar: u.avatar ?? '' })),
      days,
    });
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
    map: z.enum(PICKABLE_MAPS).default(MAP_TBD),
    drop: z.string().trim().max(30).optional(),
    startAt: z.coerce.date(),
    notifyOffsetMin: z.coerce.number().int().min(0).max(120).default(2),
    roomId: z.string().trim().max(30).default(''),
    roomPassword: z.string().trim().max(30).default(''),
    slot: z.string().trim().max(10).default(''),
    /** The scrim or tournament's name (organiser / event), asked for every match. */
    tournamentName: z.string().trim().min(1, 'Enter the scrim or tournament name').max(60),
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

  /**
   * Read a scrim / tournament schedule screenshot so the admin doesn't have to type it: name, date, and one
   * match per entry at its IDP time, plus the map when shown. Nothing is created here; the app fills the form
   * and the admin presses Schedule. Runs in the background like results screenshots; poll GET /schedule-image/:jobId.
   */
  r.post('/schedule-image', requireCaptain, ah(async (req, res) => {
    const { image } = parse(z.object({ image: z.string().min(50).max(7_000_000, 'Image is too big') }), req.body);
    if (!scorecardReaderReady()) throw badRequest('Screenshot reading is not set up (GEMINI_API_KEY is missing on the server). Fill the matches in by hand.');
    const jobId = startScorecardJob(`schedule:${teamIdOf(req)}`, () => readSchedule(image));
    res.status(202).json({ jobId });
  }));

  r.get('/schedule-image/:jobId', requireCaptain, ah(async (req, res) => {
    const job = getScorecardJob(String(req.params.jobId), `schedule:${teamIdOf(req)}`);
    if (!job) throw notFound('That upload expired. Upload the image again.');
    if (job.status === 'done') res.json({ status: 'done', schedule: job.rows });
    else if (job.status === 'failed') res.json({ status: 'failed', error: job.error, notSchedule: job.notResults });
    else res.json({ status: 'reading', seconds: Math.round((Date.now() - job.startedAt) / 1000) });
  }));

  r.get('/:id', ah(async (req, res) => {
    const match = await loadMatch(req);
    res.json({ match: (await view([match], String(req.user!._id), isCaptain(req)))[0] });
  }));

  /** Delete a match for everyone: its squad, check-ins, delivery log, attendance and stats go with it. */
  r.delete('/:id', requireCaptain, ah(async (req, res) => {
    const match = await loadMatch(req);
    await removeMatchJob(getQueue(), String(match._id)).catch(() => undefined);
    await deleteMatchData([match._id as Types.ObjectId]);
    res.json({ ok: true });
  }));

  r.patch('/:id', requireCaptain, ah(async (req, res) => {
    const match = await loadMatch(req);
    if (match.status === 'cancelled' || match.status === 'done') throw badRequest(`Match is ${match.status}`);
    // An old match can keep its retired map (e.g. Sanhok) when other fields are edited, but can't be moved onto one.
    const body = parse(matchBody.partial().extend({
      map: z.enum(MATCH_MAPS).refine((v) => (PICKABLE_MAPS as readonly string[]).includes(v) || v === match.map, 'That map is no longer available').optional(),
    }), req.body);
    if (match.notifiedAt && (body.startAt || body.notifyOffsetMin !== undefined)) {
      throw locked('Notification already sent; time can no longer change');
    }
    if (body.startAt && body.startAt.getTime() < Date.now()) throw badRequest('Pick a time in the future');
    // Changing the timing needs the scrim / tournament name (older matches may not have one yet).
    if (body.startAt && !(body.tournamentName ?? match.tournamentName)) throw badRequest('Enter the scrim or tournament name');
    if (body.map && body.drop === undefined && body.map !== match.map) {
      const team = await Team.findById(match.teamId);
      body.drop = body.map === MAP_TBD ? '' : team?.drops.get(body.map) ?? '';
    }
    const oldRoom = `${match.roomId ?? ''}\u0000${match.roomPassword ?? ''}\u0000${match.slot ?? ''}`;
    match.set(body);
    await match.save();
    const schedule = await upsertMatchJob(getQueue(), { id: String(match._id), ...match.toObject() });
    // New or changed room ID / password: tell the squad right away, every time.
    if (match.roomId && `${match.roomId}\u0000${match.roomPassword ?? ''}\u0000${match.slot ?? ''}` !== oldRoom) {
      await enqueueImmediate(getQueue(), { matchId: String(match._id), trigger: 'room' })
        .catch((e) => console.error('[room] could not queue room update alert:', (e as Error).message));
    }
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
    if (status === 'live' && match.status === 'done') throw badRequest('Match is already finished');
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
    // Tell the picked players right away (push + Telegram). Players already told for this match are skipped.
    if (body.confirm && match.startAt.getTime() > Date.now()) {
      await enqueueImmediate(getQueue(), { matchId: String(match._id), trigger: 'selected', onlyUserIds: unique })
        .catch((e) => console.error('[squad] could not queue squad-pick alert:', (e as Error).message));
    }
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
    } else if (match.startAt.getTime() > Date.now()) {
      jobId = await enqueueImmediate(getQueue(), { matchId: String(match._id), trigger: 'selected', onlyUserIds: [inId] });
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
  // Attendance and stats only open once the match has started.
  r.get('/:id/report', ah(async (req, res) => {
    const match = await loadMatch(req);
    if (!hasStarted(match)) { res.json({ open: false, attendance: [], stats: [], placement: null, screenshotAt: null }); return; }
    const [attendance, stats, shot] = await Promise.all([
      Attendance.find({ matchId: match._id }).lean(),
      Stats.find({ matchId: match._id }).lean(),
      MatchScreenshot.findOne({ matchId: match._id }).select('updatedAt').lean(),
    ]);
    res.json({
      open: true,
      placement: match.placement ?? null,
      /** Set when a results screenshot is saved; fetch it from GET /:id/screenshot. */
      screenshotAt: shot?.updatedAt ?? null,
      attendance: attendance.map((a) => ({ userId: String(a.userId), joined: a.joined })),
      stats: stats.map((s) => ({
        userId: String(s.userId), kills: s.kills, damage: s.damage, survivalMin: s.survivalMin ?? 0, assists: s.assists ?? 0,
        mvp: s.mvp, mvpScore: s.mvpScore ?? 0,
      })),
    });
  }));

  /**
   * Read a BGMI results screenshot. Matched players' kills, damage, survival and assists are saved (and the MVP
   * worked out) as soon as reading finishes; the admin can then correct anything and Save again.
   * Starts a background job (reading can outlast the proxy timeout); the app polls GET /:id/scorecard/:jobId.
   */
  r.post('/:id/scorecard', requireCaptain, ah(async (req, res) => {
    const { image } = parse(z.object({ image: z.string().min(50).max(7_000_000, 'Screenshot is too big') }), req.body);
    const match = await loadMatch(req);
    if (!hasStarted(match)) throw badRequest('Stats open once the match has started');
    if (!scorecardReaderReady()) throw badRequest('Screenshot reading is not set up (GEMINI_API_KEY is missing on the server). Type the numbers in instead.');
    const matchId = String(match._id);
    const teamId = match.teamId;
    const uploaderId = req.user!._id;
    const jobId = startScorecardJob(matchId, async () => {
      const { rows, placement } = await readScorecardWithPlacement(image);
      // Keep the screenshot so the team can open it again later, and take the position from it.
      await MatchScreenshot.updateOne({ matchId }, { $set: { image, uploadedBy: uploaderId } }, { upsert: true });
      if (placement) await Match.updateOne({ _id: matchId }, { $set: { placement } });
      const team = await Team.findById(teamId).lean();
      const squad = await Squad.findOne({ matchId }).lean();
      const memberIds = [...new Set([...(squad?.selectedIds ?? []), ...(team?.memberIds ?? [])].map(String))];
      const users = await User.find({ _id: { $in: memberIds } }).select('name ign').lean();
      const players = users.map((u) => ({ id: String(u._id), ign: u.ign, name: u.name }));
      const taken = new Set<string>();
      const matched = rows.map((r) => {
        const p = matchPlayer(r.name, players.filter((x) => !taken.has(x.id)));
        if (p) taken.add(p.id);
        return { ...r, userId: p?.id ?? null };
      });
      // Save right away so the numbers land even if the admin left the page while it was reading.
      await saveScorecardStats(matchId, matched.filter((r) => r.userId).map((r) => ({
        userId: r.userId!, kills: r.finishes, damage: r.damage, survivalMin: r.survivedMin, assists: r.assists,
      })));
      // Uploading the results screenshot means the match is over.
      await finish(matchId);
      // Each player gets their own stats in a few minutes (time for the admin to correct a misread number).
      await scheduleResults(getQueue(), matchId, RESULTS_DELAY_MS)
        .catch((e) => console.error('[results] could not queue stats alerts:', (e as Error).message));
      return { rows: matched, placement };
    });
    res.status(202).json({ jobId });
  }));

  r.get('/:id/scorecard/:jobId', requireCaptain, ah(async (req, res) => {
    const match = await loadMatch(req);
    const job = getScorecardJob(String(req.params.jobId), String(match._id));
    if (!job) throw notFound('That upload expired. Upload the screenshot again.');
    if (job.status === 'done') {
      const out = job.rows as { rows: unknown[]; placement: number | null };
      res.json({ status: 'done', rows: out.rows, placement: out.placement });
    }
    else if (job.status === 'failed') res.json({ status: 'failed', error: job.error, notResults: job.notResults });
    else res.json({ status: 'reading', seconds: Math.round((Date.now() - job.startedAt) / 1000) });
  }));

  /** The saved results screenshot (any team member, once the match has started). */
  r.get('/:id/screenshot', ah(async (req, res) => {
    const match = await loadMatch(req);
    const shot = hasStarted(match) ? await MatchScreenshot.findOne({ matchId: match._id }).lean() : null;
    if (!shot) throw notFound('No screenshot saved for this match');
    res.json({ image: shot.image, uploadedAt: shot.updatedAt });
  }));

  r.put('/:id/attendance', requireCaptain, ah(async (req, res) => {
    const { entries } = parse(z.object({ entries: z.array(z.object({ userId: z.string().regex(/^[a-f\d]{24}$/i), joined: z.boolean() })).max(8) }), req.body);
    const match = await loadMatch(req);
    if (!hasStarted(match)) throw badRequest('Attendance opens once the match has started');
    await Promise.all(entries.map((e) =>
      Attendance.updateOne({ matchId: match._id, userId: e.userId }, { $set: { joined: e.joined } }, { upsert: true })));
    res.json({ ok: true });
  }));

  /** Save kills, damage, survival and assists. The MVP is worked out here from those numbers. */
  r.put('/:id/stats', requireCaptain, ah(async (req, res) => {
    const { entries, placement } = parse(z.object({
      entries: z.array(z.object({
        userId: z.string().regex(/^[a-f\d]{24}$/i),
        kills: z.number().int().min(0).max(99),
        damage: z.number().int().min(0).max(9999),
        survivalMin: z.number().min(0).max(60).default(0),
        assists: z.number().int().min(0).max(99).default(0),
      })).max(8),
      /** Squad finishing position; null clears it, left out keeps it. */
      placement: z.number().int().min(1).max(25).nullable().optional(),
    }), req.body);
    if (new Set(entries.map((e) => e.userId)).size !== entries.length) throw badRequest('A player is listed twice');
    const match = await loadMatch(req);
    if (!hasStarted(match)) throw badRequest('Stats open once the match has started');
    if (placement !== undefined) await Match.updateOne({ _id: match._id }, { $set: { placement } });
    const { rows, mvpUserId } = scoreMvp(entries);
    await Stats.deleteMany({ matchId: match._id, userId: { $nin: entries.map((e) => e.userId) } });
    await Promise.all(rows.map((e) => Stats.updateOne(
      { matchId: match._id, userId: e.userId },
      { $set: { kills: e.kills, damage: e.damage, survivalMin: e.survivalMin, assists: e.assists, mvp: e.mvp, mvpScore: e.mvpScore } },
      { upsert: true },
    )));
    // Saving is the admin's final word: send each player only their own numbers now (once per player).
    await sendResultsNow(getQueue(), String(match._id))
      .catch((e) => console.error('[results] could not queue stats alerts:', (e as Error).message));
    res.json({ ok: true, mvpUserId, scores: rows.map((r) => ({ userId: r.userId, mvpScore: r.mvpScore, mvp: r.mvp })) });
  }));

  return r;
}

export function serializeLog(l: {
  _id: unknown; matchId: unknown; userId: unknown; kind: string; channel: string; status: string; trigger?: string | null;
  title?: string | null; body?: string | null; sentAt: Date; error?: string | null; alsoVia?: string[] | null;
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
    alsoVia: l.alsoVia ?? [],
    status: l.status,
    trigger: l.trigger ?? 'scheduled',
    title: l.title ?? '',
    body: l.body ?? '',
    sentAt: l.sentAt.toISOString(),
    error: l.error ?? null,
  };
}

