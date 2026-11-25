import type { Types } from 'mongoose';
import { config } from '../config.js';
import { Attendance, Availability, isAdmin, Match, Squad, Stats, Team, User } from '../models/index.js';
import type { AiMatch, AiMember, TeamData } from './analytics.js';

type Id = Types.ObjectId | string;

export interface LoadOptions {
  /** How many past matches to look at (newest first). */
  limit?: number;
  /** Only matches on this map. */
  map?: string;
  /** Only matches in the last N days. */
  days?: number;
  /** Only this type (scrim / tournament). */
  type?: string;
}

const toMatch = (m: { _id: Id; title: string; tournamentName?: string | null; type?: string | null; map?: string | null; startAt: Date; status: string; placement?: number | null }): AiMatch => ({
  id: String(m._id), title: m.title, tournamentName: m.tournamentName ?? '', type: m.type ?? 'scrim', map: m.map ?? 'TBD',
  startAt: m.startAt, status: m.status, placement: m.placement ?? null,
});

export async function loadRoster(teamId: Id): Promise<AiMember[]> {
  const team = await Team.findById(teamId).lean();
  if (!team) return [];
  const pool = new Set(team.memberIds.map(String));
  const ids = [...new Set([String(team.captainId), ...pool])];
  const users = await User.find({ _id: { $in: ids } }).select('name ign avatar role gameRole email').lean();
  // The RARE admin account only manages custom rooms: it is never a player in any AI result.
  const byId = new Map(users.filter((u) => !isAdmin(u)).map((u) => [String(u._id), u]));
  return ids.map((id) => byId.get(id)).filter(Boolean).map((u) => ({
    id: String(u!._id), ign: u!.ign, name: u!.name, avatar: u!.avatar ?? '', gameRole: u!.gameRole ?? '', role: u!.role, inPool: pool.has(String(u!._id)),
  }));
}

/** Everything the analytics need, for one team, in one round of queries. */
export async function loadTeamData(teamId: Id, opts: LoadOptions = {}, now = new Date()): Promise<TeamData> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
  const q: Record<string, unknown> = { teamId, startAt: { $lte: now }, status: { $ne: 'cancelled' } };
  if (opts.map) q.map = opts.map;
  if (opts.type) q.type = opts.type;
  if (opts.days) q.startAt = { $lte: now, $gte: new Date(now.getTime() - opts.days * 86_400_000) };
  const [members, matches] = await Promise.all([
    loadRoster(teamId),
    Match.find(q).sort({ startAt: -1 }).limit(limit).select('title tournamentName type map startAt status placement').lean(),
  ]);
  const ids = matches.map((m) => m._id);
  const [stats, attendance, availability, squads] = await Promise.all([
    Stats.find({ matchId: { $in: ids } }).lean(),
    Attendance.find({ matchId: { $in: ids } }).lean(),
    Availability.find({ matchId: { $in: ids } }).lean(),
    Squad.find({ matchId: { $in: ids } }).select('matchId selectedIds confirmed').lean(),
  ]);
  return {
    tz: config.displayTimeZone,
    now,
    members,
    matches: matches.map(toMatch),
    stats: stats.map((s) => ({
      matchId: String(s.matchId), userId: String(s.userId), kills: s.kills ?? 0, damage: s.damage ?? 0, assists: s.assists ?? 0,
      survivalMin: s.survivalMin ?? 0, mvp: Boolean(s.mvp), mvpScore: s.mvpScore ?? 0,
    })),
    attendance: attendance.map((a) => ({ matchId: String(a.matchId), userId: String(a.userId), joined: a.joined })),
    availability: availability.map((a) => ({
      matchId: String(a.matchId), userId: String(a.userId), status: a.status ?? null, joiningAt: a.joiningAt ?? null, updatedAt: a.updatedAt ?? a.createdAt ?? new Date(0),
    })),
    squads: squads.map((s) => ({ matchId: String(s.matchId), selectedIds: (s.selectedIds ?? []).map(String), confirmed: Boolean(s.confirmed) })),
  };
}

/** Upcoming (not started, not cancelled) matches, soonest first. */
export async function loadUpcoming(teamId: Id, now = new Date(), limit = 10) {
  const ms = await Match.find({ teamId, startAt: { $gt: now }, status: { $ne: 'cancelled' } })
    .sort({ startAt: 1 }).limit(limit).select('title tournamentName type map startAt status placement notifiedAt').lean();
  return ms.map((m) => ({ ...toMatch(m), notified: Boolean(m.notifiedAt) }));
}

export async function availabilityFor(matchId: Id) {
  const rows = await Availability.find({ matchId }).select('userId status').lean();
  return new Map(rows.filter((r) => r.status).map((r) => [String(r.userId), r.status as string]));
}

/** Matches between two instants (for clash checks). */
export async function matchesBetween(teamId: Id, from: Date, to: Date) {
  const ms = await Match.find({ teamId, startAt: { $gte: from, $lt: to }, status: { $ne: 'cancelled' } })
    .sort({ startAt: 1 }).select('title tournamentName type map startAt status placement').lean();
  return ms.map(toMatch);
}
