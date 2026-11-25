/**
 * The Squad AI's tools. Read tools query MongoDB and return facts (for the model) plus visual blocks (for the
 * dashboard). Action tools never change match data: they save a proposal the captain approves or rejects.
 */
import type { Types } from 'mongoose';
import { config } from '../config.js';
import { dayRange } from '../lib/dailySummary.js';
import { matchPlayer } from '../lib/mvp.js';
import { AiProposal, MAPS, MATCH_TYPES, SQUAD_SIZE, Squad } from '../models/index.js';
import {
  attendanceTool, compareTool, hourLabel, localParts, matchLabel, matchReportTool, performanceTool, playerStatsTool,
  recommendSquad, timeSlotsTool, type AiMatch, type AiMember, type ToolOutput,
} from './analytics.js';
import type { Block, Channel, PoolPlayer, ProposalForm, ProposalKind } from './blocks.js';
import { availabilityFor, loadReach, loadRoster, loadTeamData, loadUpcoming, matchesBetween, unansweredFor } from './data.js';

export interface ToolContext { teamId: Types.ObjectId | string; userId: string; isCaptain: boolean; now?: Date }

type Schema = { type: string; description?: string; enum?: string[]; items?: Schema; properties?: Record<string, Schema>; required?: string[] };
/** write: an action tool. 'captain' = captain only; 'self' = any player, about themselves (approved by them). */
export interface ToolDef { name: string; description: string; label: string; write?: 'captain' | 'self'; parameters: Schema }

const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: 'object', properties, required });
const lastN: Schema = { type: 'integer', description: 'How many recent matches to use (default 20, max 100).' };
const mapP: Schema = { type: 'string', enum: [...MAPS], description: 'Only matches on this map.' };
const daysP: Schema = { type: 'integer', description: 'Only matches in the last N days, e.g. 30 for "this month".' };

export const TOOLS: ToolDef[] = [
  { name: 'get_roster', label: 'Loading roster', description: 'Team roster (IGN, in-game role, captain) and the next scheduled matches with their ids. Call first when you need player names or match ids.', parameters: obj({}) },
  { name: 'list_matches', label: 'Listing matches', description: 'Recent finished matches (newest first) or upcoming matches, with ids, maps, dates and placement.', parameters: obj({ scope: { type: 'string', enum: ['past', 'upcoming'] }, limit: { type: 'integer' } }, ['scope']) },
  { name: 'get_player_stats', label: 'Reading player stats', description: 'Per-player averages (kills, damage, assists, survival, MVPs) from logged results. Use for MVP / top fragger / "how is X doing".', parameters: obj({ players: { type: 'array', items: { type: 'string' }, description: 'IGNs to include; empty = whole team.' }, last_matches: lastN, map: mapP, days: daysP }) },
  { name: 'compare_players', label: 'Comparing players', description: 'Head-to-head comparison of two players with a table and radar chart.', parameters: obj({ player_a: { type: 'string' }, player_b: { type: 'string' }, last_matches: lastN }, ['player_a', 'player_b']) },
  { name: 'analyze_performance', label: 'Analysing team performance', description: 'Team trends over recent matches: placement, kills, damage, points, change vs earlier matches, map strengths/weaknesses and survival.', parameters: obj({ last_matches: lastN, map: mapP, days: daysP, type: { type: 'string', enum: [...MATCH_TYPES] } }) },
  { name: 'get_match_report', label: 'Building match report', description: 'Report for one finished match: placement, kills, damage, points, per-player lines, observations and a recommendation. Omit match_id for the latest match with results.', parameters: obj({ match_id: { type: 'string' } }) },
  { name: 'analyze_attendance', label: 'Checking attendance', description: 'Who misses matches, joins late, drops out last minute, never checks in, and how often each player was benched.', parameters: obj({ last_matches: lastN, days: daysP }) },
  { name: 'best_time_slots', label: 'Finding best time slots', description: 'Which start times and weekdays have the most players available, from check-ins and attendance.', parameters: obj({ last_matches: lastN }) },
  { name: 'recommend_squad', label: 'Scoring the squad', description: `Recommend the best ${SQUAD_SIZE} players and a substitute for a match from form, availability, show-up rate, bench rotation and role balance. Omit match_id for the next scheduled match.`, parameters: obj({ match_id: { type: 'string' } }) },
  { name: 'check_schedule', label: 'Checking the calendar', description: 'Matches already on a date, and clashes within 90 minutes of a time. Use before proposing a scrim.', parameters: obj({ date: { type: 'string', description: 'YYYY-MM-DD in the team time zone.' }, time: { type: 'string', description: 'HH:mm 24h, optional.' } }, ['date']) },
  { name: 'propose_scrim', label: 'Preparing scrim for approval', write: 'captain', description: 'Prepare a new scrim/tournament match for the captain to approve. Does NOT create it. Captain only.', parameters: obj({ date: { type: 'string', description: 'YYYY-MM-DD in the team time zone.' }, time: { type: 'string', description: 'HH:mm 24h in the team time zone.' }, tournament_name: { type: 'string', description: 'Scrim organiser or tournament name.' }, title: { type: 'string' }, map: { type: 'string', enum: [...MAPS, 'TBD'] }, type: { type: 'string', enum: [...MATCH_TYPES] } }, ['date', 'time', 'tournament_name']) },
  { name: 'propose_squad', label: 'Preparing squad for approval', write: 'captain', description: `Prepare a squad of exactly ${SQUAD_SIZE} players for a match for the captain to approve. Omit players to use the AI recommendation. Does NOT save it. Captain only.`, parameters: obj({ match_id: { type: 'string' }, players: { type: 'array', items: { type: 'string' }, description: `${SQUAD_SIZE} IGNs.` } }) },
  { name: 'propose_message', label: 'Drafting the message', write: 'captain', description: 'Prepare a message to chosen teammates (or everyone) sent by Telegram and/or push. The captain reviews the text, recipients and channels before it is sent.', parameters: obj({ players: { type: 'array', items: { type: 'string' }, description: 'IGNs, or ["all"] for the whole team.' }, text: { type: 'string', description: 'The message, written to the players (max 500 characters).' }, channels: { type: 'string', enum: ['telegram', 'push', 'both'], description: 'Default both.' } }, ['players', 'text']) },
  { name: 'propose_ping_unanswered', label: 'Finding who has not checked in', write: 'captain', description: 'Prepare a reminder to every player who has not marked availability for a match. Omit match_id for the next match.', parameters: obj({ match_id: { type: 'string' }, text: { type: 'string', description: 'Optional custom reminder text.' } }) },
  { name: 'propose_reschedule', label: 'Preparing the new time', write: 'captain', description: 'Prepare moving an upcoming match to a new date/time; the team is notified on approval. Omit match_id for the next match.', parameters: obj({ match_id: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD in the team time zone.' }, time: { type: 'string', description: 'HH:mm 24h.' } }, ['date', 'time']) },
  { name: 'propose_cancel', label: 'Preparing the cancellation', write: 'captain', description: 'Prepare cancelling an upcoming match; the team is notified on approval. Omit match_id for the next match.', parameters: obj({ match_id: { type: 'string' } }) },
  { name: 'propose_set_map', label: 'Preparing the map change', write: 'captain', description: 'Prepare setting the map of an upcoming match. Omit match_id for the next match.', parameters: obj({ match_id: { type: 'string' }, map: { type: 'string', enum: [...MAPS, 'TBD'] } }, ['map']) },
  { name: 'propose_my_availability', label: 'Preparing your check-in', write: 'self', description: "Prepare the current user's own check-in for a match: available, maybe or unavailable, with an optional join time (\"I'll join late at 9:15\"). Omit match_id for the next match.", parameters: obj({ match_id: { type: 'string' }, status: { type: 'string', enum: ['available', 'maybe', 'unavailable'] }, join_time: { type: 'string', description: 'HH:mm 24h, only when they will join late.' } }, ['status']) },
  { name: 'propose_captain_request', label: 'Drafting your request', write: 'self', description: 'Prepare a short request from the current user to the captain (e.g. asking for a slot, a map, or time off). They confirm before it is sent.', parameters: obj({ text: { type: 'string', description: 'The request, max 400 characters.' } }, ['text']) },
];

export const toolByName = new Map(TOOLS.map((t) => [t.name, t]));

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v && Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const isId = (v: string) => /^[a-f\d]{24}$/i.test(v);

function findPlayer(name: string, members: AiMember[]) {
  return matchPlayer(name, members) ?? members.find((m) => m.ign.toLowerCase().includes(name.toLowerCase()) || m.name.toLowerCase() === name.toLowerCase()) ?? null;
}

/** "2026-11-26" + "21:00" in the team time zone → UTC instant. */
export function zonedToUtc(date: string, time: string, tz = config.displayTimeZone): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const t = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!t || Number(t[1]) > 23 || Number(t[2]) > 59) return null;
  return new Date(dayRange(date, tz).start.getTime() + (Number(t[1]) * 60 + Number(t[2])) * 60_000);
}

const fail = (msg: string): ToolOutput => ({ facts: { error: msg }, summary: msg, blocks: [] });

/** "YYYY-MM-DD" and "HH:mm" of an instant in the team time zone (the Approve form's starting values). */
export function localDateTime(at: Date, tz = config.displayTimeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export const whenLabel = (at: Date, tz = config.displayTimeZone) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).format(at);

/** Save an action for approval. Nothing in the team's data changes here. */
async function proposal(ctx: ToolContext, form: ProposalForm, title: string, lines: { label: string; value: string }[], warnings: string[]): Promise<ToolOutput> {
  const approver = form.kind === 'availability' || form.kind === 'request' ? 'self' : 'captain';
  const doc = await AiProposal.create({ teamId: ctx.teamId, createdBy: ctx.userId, kind: form.kind, payload: form, approver, expiresAt: new Date(Date.now() + 24 * 3600_000) });
  const block: Block = { type: 'proposal', id: String(doc._id), kind: form.kind, title, lines, warnings, status: 'pending', approver, createdBy: ctx.userId, form };
  const who = approver === 'self' ? 'the user' : 'the captain';
  return {
    facts: { proposalId: String(doc._id), status: `waiting for ${who} to approve`, note: `Nothing has happened yet. Tell ${who} to check the card and tap Approve (they can edit it first).`, lines, warnings },
    summary: `**${title}** is ready. Nothing happens until you tap Approve, and you can edit it first.${warnings.length ? `\n\n${warnings.map((w) => `- ${w}`).join('\n')}` : ''}`,
    blocks: [block],
  };
}

/** Team players with how each can be reached, for the message form. */
async function messagePool(ctx: ToolContext): Promise<PoolPlayer[]> {
  const members = await loadRoster(ctx.teamId);
  const reach = await loadReach(members.map((m) => m.id));
  return members.map((m) => ({ id: m.id, ign: m.ign, gameRole: m.gameRole, telegram: reach.get(m.id)?.telegram ?? false, push: reach.get(m.id)?.push ?? false }));
}

const channelsOf = (v: unknown): Channel[] => (v === 'telegram' ? ['telegram'] : v === 'push' ? ['push'] : ['telegram', 'push']);

function unreachable(pool: PoolPlayer[], ids: string[], channels: Channel[]) {
  return pool.filter((p) => ids.includes(p.id) && !channels.some((c) => (c === 'telegram' ? p.telegram : p.push))).map((p) => p.ign);
}

async function nextMatch(ctx: ToolContext, matchId?: string): Promise<(AiMatch & { notified?: boolean }) | null> {
  const upcoming = await loadUpcoming(ctx.teamId, ctx.now);
  if (matchId) return upcoming.find((m) => m.id === matchId) ?? null;
  return upcoming.find((m) => m.status === 'scheduled' && !m.notified) ?? upcoming[0] ?? null;
}

export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
  const now = ctx.now ?? new Date();
  const tz = config.displayTimeZone;
  const def = toolByName.get(name);
  if (!def) return fail(`Unknown tool ${name}`);
  if (def.write === 'captain' && !ctx.isCaptain) return fail('Only the captain can do that. I can still analyse it, or send the captain a request.');
  if (def.write === 'self' && ctx.isCaptain && name === 'propose_captain_request') return fail('You are the captain, so there is no one to send a request to.');
  const load = (o: { last_matches?: unknown; map?: unknown; days?: unknown; type?: unknown } = {}) => loadTeamData(ctx.teamId, {
    limit: num(o.last_matches, 20), map: str(o.map) || undefined, days: num(o.days, 0) || undefined, type: str(o.type) || undefined,
  }, now);

  switch (name) {
    case 'get_roster': {
      const [members, upcoming] = await Promise.all([loadRoster(ctx.teamId), loadUpcoming(ctx.teamId, now, 5)]);
      const facts = {
        teamTimeZone: tz,
        players: members.map((m) => ({ ign: m.ign, gameRole: m.gameRole || 'not set', captain: m.role === 'captain', inSquadPool: m.inPool })),
        upcoming: upcoming.map((m) => ({ id: m.id, label: matchLabel(m, tz), time: hourLabel(localParts(m.startAt, tz).hour), map: m.map, status: m.status })),
      };
      const summary = `**${members.length} players on the roster.**\n\n${members.map((m) => `- ${m.ign}${m.gameRole ? ` (${m.gameRole})` : ''}${m.role === 'captain' ? ' · captain' : ''}`).join('\n')}`;
      return { facts, summary, blocks: [] };
    }
    case 'list_matches': {
      const scope = str(args.scope) === 'upcoming' ? 'upcoming' : 'past';
      const limit = Math.min(30, num(args.limit, 10));
      const list = scope === 'upcoming' ? await loadUpcoming(ctx.teamId, now, limit) : (await loadTeamData(ctx.teamId, { limit }, now)).matches;
      const rows = list.map((m) => ({ id: m.id, match: m.title, event: m.tournamentName, map: m.map, when: matchLabel(m, tz), placement: m.placement ?? null }));
      return {
        facts: { scope, matches: rows },
        summary: rows.length ? `**${rows.length} ${scope} matches.**\n\n${rows.map((r) => `- ${r.when} · ${r.map}${r.placement ? ` · #${r.placement}` : ''}`).join('\n')}` : `No ${scope} matches.`,
        blocks: rows.length ? [{ type: 'table', title: scope === 'upcoming' ? 'Upcoming matches' : 'Recent matches', columns: [{ key: 'when', label: 'When' }, { key: 'map', label: 'Map' }, { key: 'placement', label: 'Place', align: 'right' }], rows: rows.map(({ id, ...r }) => r) }] : [],
      };
    }
    case 'get_player_stats': {
      const data = await load(args);
      const names = Array.isArray(args.players) ? args.players.map(String).filter(Boolean) : [];
      const ids = names.map((n) => findPlayer(n, data.members)?.id).filter(Boolean) as string[];
      if (names.length && !ids.length) return fail(`No player matches ${names.join(', ')}. Roster: ${data.members.map((m) => m.ign).join(', ')}`);
      return playerStatsTool(data, ids);
    }
    case 'compare_players': {
      const data = await load({ last_matches: Math.max(num(args.last_matches, 20), 20) });
      const a = findPlayer(str(args.player_a), data.members);
      const b = findPlayer(str(args.player_b), data.members);
      if (!a || !b) return fail(`Could not find ${!a ? str(args.player_a) : str(args.player_b)}. Roster: ${data.members.map((m) => m.ign).join(', ')}`);
      if (a.id === b.id) return fail('Pick two different players to compare.');
      return compareTool(data, a, b, args.last_matches ? num(args.last_matches, 20) : undefined);
    }
    case 'analyze_performance': return performanceTool(await load(args));
    case 'get_match_report': {
      const data = await load({ last_matches: 50 });
      let id = str(args.match_id);
      if (!id || !isId(id)) id = data.matches.find((m) => data.stats.some((s) => s.matchId === m.id) || m.placement != null)?.id ?? '';
      if (!id) return fail('No finished match with results yet.');
      return matchReportTool(data, id);
    }
    case 'analyze_attendance': return attendanceTool(await load(args));
    case 'best_time_slots': {
      const data = await load({ last_matches: num(args.last_matches, 40) });
      return timeSlotsTool(data, await loadUpcoming(ctx.teamId, now, 10));
    }
    case 'recommend_squad': {
      const id = str(args.match_id);
      const match = await nextMatch(ctx, isId(id) ? id : undefined);
      const data = await load({ last_matches: 20 });
      return recommendSquad(data, { match, availability: match ? await availabilityFor(match.id) : new Map() }, SQUAD_SIZE);
    }
    case 'check_schedule': {
      const date = str(args.date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail('Give the date as YYYY-MM-DD.');
      const { start, end } = dayRange(date, tz);
      const day = await matchesBetween(ctx.teamId, start, end);
      const at = str(args.time) ? zonedToUtc(date, str(args.time), tz) : null;
      const clashes = at ? day.filter((m) => Math.abs(m.startAt.getTime() - at.getTime()) < 90 * 60_000) : [];
      const rows = day.map((m) => ({ time: hourLabel(localParts(m.startAt, tz).hour), match: m.tournamentName || m.title, map: m.map, status: m.status }));
      return {
        facts: { date, matchesThatDay: rows, clashesWithin90Min: clashes.map((m) => matchLabel(m, tz)), inPast: at ? at.getTime() < now.getTime() : null },
        summary: `**${rows.length ? `${rows.length} match${rows.length === 1 ? '' : 'es'} on ${date}` : `Nothing scheduled on ${date}`}.**${clashes.length ? `\n\n- Clash: ${clashes.map((m) => matchLabel(m, tz)).join(', ')}` : at ? '\n\n- That time is free.' : ''}`,
        blocks: rows.length ? [{ type: 'table', title: `Schedule · ${date}`, columns: [{ key: 'time', label: 'Time' }, { key: 'match', label: 'Match' }, { key: 'map', label: 'Map' }, { key: 'status', label: 'Status' }], rows }] : [],
      };
    }
    case 'propose_scrim': {
      const date = str(args.date), time = str(args.time);
      const at = zonedToUtc(date, time, tz);
      if (!at) return fail('I need a date (YYYY-MM-DD) and time (HH:mm) to prepare the scrim.');
      if (at.getTime() < now.getTime() + 2 * 60_000) return fail('That time has already passed. Pick a time in the future.');
      const tournamentName = str(args.tournament_name).slice(0, 60) || 'Scrim';
      const type = (MATCH_TYPES as readonly string[]).includes(str(args.type)) ? str(args.type) : 'scrim';
      const map = [...MAPS, 'TBD'].includes(str(args.map)) ? str(args.map) : 'TBD';
      const title = (str(args.title) || `${tournamentName} ${hourLabel(localParts(at, tz).hour)}`).slice(0, 60);
      const clashes = await matchesBetween(ctx.teamId, new Date(at.getTime() - 90 * 60_000), new Date(at.getTime() + 90 * 60_000));
      return proposal(ctx, { kind: 'scrim', tournamentName, title, date, time: localDateTime(at, tz).time, map, type, maps: [...MAPS, 'TBD'], types: [...MATCH_TYPES] }, `Schedule ${type}: ${tournamentName}`,
        [{ label: 'When', value: whenLabel(at, tz) }, { label: 'Event', value: tournamentName }, { label: 'Title', value: title }, { label: 'Map', value: map }, { label: 'Type', value: type }],
        [...clashes.map((m) => `Clashes with ${matchLabel(m, tz)} at ${hourLabel(localParts(m.startAt, tz).hour)}.`), 'On approval the whole team gets a "new match" message.']);
    }
    case 'propose_squad': {
      const id = str(args.match_id);
      const match = await nextMatch(ctx, isId(id) ? id : undefined);
      if (!match) return fail('There is no upcoming match to pick a squad for. Schedule one first.');
      if (match.notified) return fail('The squad alert for that match already went out, so the squad is locked. Use substitution on the match page.');
      const members = (await loadRoster(ctx.teamId)).filter((m) => m.inPool);
      let picks: AiMember[];
      const names = Array.isArray(args.players) ? args.players.map(String).filter(Boolean) : [];
      if (names.length) {
        const found = names.map((n) => findPlayer(n, members));
        const missing = names.filter((_, i) => !found[i]);
        if (missing.length) return fail(`Not on the squad pool: ${missing.join(', ')}. Pool: ${members.map((m) => m.ign).join(', ')}`);
        picks = [...new Map(found.map((m) => [m!.id, m!])).values()];
      } else {
        const rec = recommendSquad(await load({ last_matches: 20 }), { match, availability: await availabilityFor(match.id) }, SQUAD_SIZE);
        const sq = rec.blocks.find((b) => b.type === 'squad');
        picks = sq && sq.type === 'squad' ? sq.players.map((p) => members.find((m) => m.id === p.id)!).filter(Boolean) : [];
      }
      if (picks.length !== SQUAD_SIZE) return fail(`A squad needs exactly ${SQUAD_SIZE} different players (got ${picks.length}).`);
      const avail = await availabilityFor(match.id);
      const existing = await Squad.findOne({ matchId: match.id }).select('confirmed').lean();
      const warnings = [
        ...picks.filter((p) => avail.get(p.id) === 'unavailable').map((p) => `${p.ign} marked unavailable for this match.`),
        ...(existing?.confirmed ? ['This replaces the squad already confirmed for this match.'] : []),
      ];
      const bench = members.filter((m) => !picks.some((p) => p.id === m.id));
      const label = matchLabel(match, tz);
      return proposal(ctx, {
        kind: 'squad', matchId: match.id, matchLabel: label, selectedIds: picks.map((p) => p.id), size: SQUAD_SIZE,
        pool: members.map((m) => ({ id: m.id, ign: m.ign, gameRole: m.gameRole, availability: avail.get(m.id) ?? 'no reply' })),
      }, `Confirm squad for ${label}`,
      [...picks.map((p, i) => ({ label: `Player ${i + 1}`, value: `${p.ign}${p.gameRole ? ` · ${p.gameRole}` : ''}` })), { label: 'Bench', value: bench.map((b) => b.ign).join(', ') || '–' }],
      warnings);
    }
    case 'propose_message': {
      const text = str(args.text).slice(0, 500);
      if (!text) return fail('Tell me what the message should say.');
      const pool = await messagePool(ctx);
      const names = Array.isArray(args.players) ? args.players.map(String).filter(Boolean) : [];
      const everyone = !names.length || names.some((n) => /^(all|everyone|team|squad)$/i.test(n.trim()));
      const others = pool.filter((p) => p.id !== ctx.userId);
      let ids: string[];
      if (everyone) ids = others.map((p) => p.id);
      else {
        const members = await loadRoster(ctx.teamId);
        const found = names.map((n) => findPlayer(n, members));
        const missing = names.filter((_, i) => !found[i]);
        if (missing.length) return fail(`No teammate called ${missing.join(', ')}. Team: ${pool.map((p) => p.ign).join(', ')}`);
        ids = [...new Set(found.map((m) => m!.id))];
      }
      const channels = channelsOf(args.channels);
      const out = unreachable(pool, ids, channels);
      const who = pool.filter((p) => ids.includes(p.id)).map((p) => p.ign);
      return proposal(ctx, { kind: 'message', recipientIds: ids, text, channels, pool }, `Message ${everyone ? 'the team' : who.join(', ')}`,
        [{ label: 'To', value: everyone ? `Everyone (${who.length})` : who.join(', ') }, { label: 'Message', value: text }, { label: 'Via', value: channels.map((c) => (c === 'push' ? 'Push' : 'Telegram')).join(' + ') }],
        out.length ? [`${out.join(', ')} can't get it: no Telegram linked or push turned on.`] : []);
    }
    case 'propose_ping_unanswered': {
      const id = str(args.match_id);
      const match = await nextMatch(ctx, isId(id) ? id : undefined);
      if (!match) return fail('There is no upcoming match to remind people about.');
      const missing = (await unansweredFor(ctx.teamId, match.id)).filter((m) => m.id !== ctx.userId);
      const label = matchLabel(match, tz);
      if (!missing.length) return { facts: { match: label, unanswered: [] }, summary: `**Everyone has checked in for ${label}.** No reminder needed.`, blocks: [] };
      const pool = await messagePool(ctx);
      const text = (str(args.text) || `Check in for ${label}: open SquadSync and mark if you can play.`).slice(0, 500);
      const ids = missing.map((m) => m.id);
      const out = unreachable(pool, ids, ['telegram', 'push']);
      return proposal(ctx, { kind: 'message', recipientIds: ids, text, channels: ['telegram', 'push'], pool, matchId: match.id }, `Remind ${ids.length} who haven't checked in`,
        [{ label: 'Match', value: label }, { label: 'To', value: missing.map((m) => m.ign).join(', ') }, { label: 'Message', value: text }],
        out.length ? [`${out.join(', ')} can't get it: no Telegram linked or push turned on.`] : []);
    }
    case 'propose_reschedule': {
      const id = str(args.match_id);
      const match = await nextMatch(ctx, isId(id) ? id : undefined);
      if (!match) return fail('There is no upcoming match to move.');
      if (match.notified) return fail('The alert for that match already went out, so its time can no longer change.');
      const date = str(args.date), time = str(args.time);
      const at = zonedToUtc(date, time, tz);
      if (!at) return fail('I need the new date (YYYY-MM-DD) and time (HH:mm).');
      if (at.getTime() < now.getTime() + 2 * 60_000) return fail('That time has already passed. Pick a time in the future.');
      const clashes = (await matchesBetween(ctx.teamId, new Date(at.getTime() - 90 * 60_000), new Date(at.getTime() + 90 * 60_000))).filter((m) => m.id !== match.id);
      const label = matchLabel(match, tz);
      return proposal(ctx, { kind: 'reschedule', matchId: match.id, matchLabel: label, date, time: localDateTime(at, tz).time }, `Move ${match.tournamentName || match.title}`,
        [{ label: 'Match', value: label }, { label: 'From', value: whenLabel(match.startAt, tz) }, { label: 'To', value: whenLabel(at, tz) }],
        [...clashes.map((m) => `Clashes with ${matchLabel(m, tz)}.`), 'On approval the whole team is told the new time.']);
    }
    case 'propose_cancel': {
      const id = str(args.match_id);
      const match = await nextMatch(ctx, isId(id) ? id : undefined);
      if (!match) return fail('There is no upcoming match to cancel.');
      const label = matchLabel(match, tz);
      return proposal(ctx, { kind: 'cancel', matchId: match.id, matchLabel: label }, `Cancel ${match.tournamentName || match.title}`,
        [{ label: 'Match', value: label }, { label: 'When', value: whenLabel(match.startAt, tz) }, { label: 'Map', value: match.map }],
        ['On approval its alerts stop and the whole team is told it is cancelled.']);
    }
    case 'propose_set_map': {
      const id = str(args.match_id);
      const match = await nextMatch(ctx, isId(id) ? id : undefined);
      if (!match) return fail('There is no upcoming match to set the map for.');
      const map = [...MAPS, 'TBD'].includes(str(args.map)) ? str(args.map) : '';
      if (!map) return fail(`Pick one of ${[...MAPS].join(', ')}.`);
      const label = matchLabel(match, tz);
      return proposal(ctx, { kind: 'map', matchId: match.id, matchLabel: label, map, maps: [...MAPS, 'TBD'] }, `Set map for ${match.tournamentName || match.title}`,
        [{ label: 'Match', value: label }, { label: 'Map', value: `${match.map} → ${map}` }], []);
    }
    case 'propose_my_availability': {
      const id = str(args.match_id);
      const match = await nextMatch(ctx, isId(id) ? id : undefined);
      if (!match) return fail('There is no upcoming match to check in for.');
      if (match.status !== 'scheduled') return fail('Check-in is closed for that match.');
      const status = ['available', 'maybe', 'unavailable'].includes(str(args.status)) ? str(args.status) : 'available';
      const joinTime = /^\d{1,2}:\d{2}$/.test(str(args.join_time)) && status !== 'unavailable' ? str(args.join_time).padStart(5, '0') : '';
      const label = matchLabel(match, tz);
      return proposal(ctx, { kind: 'availability', matchId: match.id, matchLabel: label, status, joinTime }, `Your check-in for ${label}`,
        [{ label: 'Match', value: label }, { label: 'Status', value: status }, ...(joinTime ? [{ label: 'Joining at', value: joinTime }] : [])], []);
    }
    case 'propose_captain_request': {
      const text = str(args.text).slice(0, 400);
      if (!text) return fail('Tell me what to ask the captain.');
      return proposal(ctx, { kind: 'request', text }, 'Request to the captain', [{ label: 'Message', value: text }], []);
    }
  }
  return fail(`Unknown tool ${name}`);
}
