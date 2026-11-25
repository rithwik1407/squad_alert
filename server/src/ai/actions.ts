/**
 * Carrying out an AI-prepared action after someone taps Approve. This is the only place the Squad AI
 * changes team data or sends messages. Every input is checked again here, because the approver may have
 * edited the draft and the team may have changed since the AI prepared it.
 */
import type { Types } from 'mongoose';
import { z } from 'zod';
import { config } from '../config.js';
import { badRequest, locked, notFound } from '../lib/errors.js';
import { Availability, Match, MAP_TBD, PICKABLE_MAPS, MATCH_TYPES, Squad, SQUAD_SIZE, Team, type AiProposalDoc } from '../models/index.js';
import { FcmProvider } from '../notifications/fcm.js';
import { TelegramProvider } from '../notifications/telegram.js';
import type { NotificationProvider } from '../notifications/types.js';
import { mongoDispatchRepo } from '../scheduler/repo.js';
import { enqueueImmediate, removeMatchJob, upsertMatchJob, type QueueLike } from '../scheduler/queue.js';
import type { Channel, ProposalForm } from './blocks.js';
import { loadRoster } from './data.js';
import { whenLabel, zonedToUtc } from './tools.js';

type Id = Types.ObjectId | string;

export interface Approver { id: string; ign: string; teamId: Id }
export interface ActionResult { resultId: string | null; result: string; applied: Record<string, unknown> }

/* ───────────────────────── Direct messages (Telegram / push) ───────────────────────── */

export interface DirectMessage { title: string; body: string; url: string; tag: string }
export interface DeliveryReport { sent: string[]; failed: string[]; unreachable: string[] }

const providerFor: Record<Channel, () => NotificationProvider> = { telegram: () => new TelegramProvider(), push: () => new FcmProvider() };

/** Send one message to each user on the chosen channels (each user gets it once per channel that works). */
export async function sendDirect(userIds: string[], msg: DirectMessage, channels: Channel[]): Promise<DeliveryReport> {
  const providers = channels.map((c) => providerFor[c]()).filter((p) => p.isConfigured());
  const users = await mongoDispatchRepo.getRecipients([...new Set(userIds)]);
  const report: DeliveryReport = { sent: [], failed: [], unreachable: [] };
  await Promise.all(users.map(async (u) => {
    const usable = providers.filter((p) => p.canReach(u));
    if (!usable.length) { report.unreachable.push(u.ign || u.name); return; }
    let ok = false;
    for (const p of usable) {
      try {
        const res = await p.send(u, { ...msg, matchId: '' });
        if (res.invalidTokens?.length) await mongoDispatchRepo.removeFcmTokens(u.id, res.invalidTokens).catch(() => undefined);
        if (res.telegramGone) await mongoDispatchRepo.clearTelegramChat?.(u.id).catch(() => undefined);
        ok ||= res.ok;
        if (!res.ok) console.warn(`[ai] ${p.channel} to ${u.ign} failed: ${res.error}`);
      } catch (e) {
        console.warn(`[ai] ${p.channel} to ${u.ign} failed:`, (e as Error).message);
      }
    }
    (ok ? report.sent : report.failed).push(u.ign || u.name);
  }));
  return report;
}

const describe = (r: DeliveryReport, total: number) => {
  const parts = [`Sent to ${r.sent.length} of ${total}`];
  if (r.unreachable.length) parts.push(`not linked: ${r.unreachable.join(', ')}`);
  if (r.failed.length) parts.push(`failed: ${r.failed.join(', ')}`);
  return parts.join(' · ');
};

/** Tell the whole team (except whoever approved) about a schedule change. Never fails the action. */
async function tellTeam(a: Approver, msg: DirectMessage) {
  try {
    const ids = (await loadRoster(a.teamId)).map((m) => m.id).filter((id) => id !== a.id);
    if (!ids.length) return 'No teammates to tell.';
    return `Team told: ${describe(await sendDirect(ids, msg, ['telegram', 'push']), ids.length)}.`;
  } catch (e) {
    console.error('[ai] could not tell the team:', (e as Error).message);
    return 'The team could not be messaged right now.';
  }
}

/* ───────────────────────── Edit validation ───────────────────────── */

const hhmm = z.string().regex(/^\d{1,2}:\d{2}$/, 'Use a time like 21:00');
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date');
const oid = z.string().regex(/^[a-f\d]{24}$/i);
const channels = z.array(z.enum(['telegram', 'push'])).min(1, 'Pick Telegram, push or both').max(2);

const edits = {
  scrim: z.object({ tournamentName: z.string().trim().min(1, 'Enter the event name').max(60), title: z.string().trim().min(1, 'Enter a title').max(60), date: ymd, time: hhmm, map: z.enum(PICKABLE_MAPS), type: z.enum(MATCH_TYPES) }),
  squad: z.object({ selectedIds: z.array(oid).length(SQUAD_SIZE, `Pick exactly ${SQUAD_SIZE} players`) }),
  message: z.object({ recipientIds: z.array(oid).min(1, 'Pick at least one teammate').max(30), text: z.string().trim().min(1, 'Write the message').max(500), channels }),
  reschedule: z.object({ date: ymd, time: hhmm }),
  cancel: z.object({}),
  map: z.object({ map: z.enum(PICKABLE_MAPS) }),
  availability: z.object({ status: z.enum(['available', 'maybe', 'unavailable']), joinTime: z.union([hhmm, z.literal('')]) }),
  request: z.object({ text: z.string().trim().min(1, 'Write the request').max(400) }),
} as const;

/** The draft merged with the approver's edits, checked. */
export function mergeEdits(form: ProposalForm, input: unknown) {
  const schema = edits[form.kind];
  const merged = { ...(form as Record<string, unknown>), ...((input && typeof input === 'object') ? input as Record<string, unknown> : {}) };
  const r = schema.safeParse(merged);
  if (!r.success) throw badRequest(r.error.issues[0]?.message ?? 'Check the details and try again');
  return r.data as Record<string, unknown>;
}

/* ───────────────────────── Executors ───────────────────────── */

async function loadOpenMatch(teamId: Id, matchId: string) {
  const match = await Match.findById(matchId);
  if (!match || String(match.teamId) !== String(teamId)) throw notFound('That match no longer exists.');
  if (match.status === 'cancelled' || match.status === 'done') throw badRequest(`That match is already ${match.status}.`);
  return match;
}

/** Save and confirm a squad, then alert the picked players. Same checks as PUT /api/matches/:id/squad. */
export async function applySquad(getQueue: () => QueueLike, teamId: Id, matchId: string, selectedIds: string[]) {
  const match = await Match.findById(matchId);
  if (!match || String(match.teamId) !== String(teamId)) throw notFound('Match not found');
  if (match.notifiedAt) throw locked('Squad is locked: the alert already went out. Use substitution on the match page.');
  if (match.status !== 'scheduled') throw badRequest(`Match is ${match.status}`);
  const team = await Team.findById(teamId).lean();
  const members = (team?.memberIds ?? []).map(String);
  const ids = [...new Set(selectedIds)];
  if (ids.length !== SQUAD_SIZE || !ids.every((id) => members.includes(id))) throw badRequest(`Pick exactly ${SQUAD_SIZE} players from the squad pool.`);
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

const futureTime = (date: string, time: string) => {
  const at = zonedToUtc(date, time.padStart(5, '0'), config.displayTimeZone);
  if (!at) throw badRequest('Pick a valid date and time.');
  if (at.getTime() < Date.now() + 60_000) throw badRequest('That time has passed. Pick a time in the future.');
  return at;
};

export async function executeProposal(p: AiProposalDoc, input: unknown, a: Approver, getQueue: () => QueueLike): Promise<ActionResult> {
  const form = p.payload as ProposalForm;
  const v = mergeEdits(form, input);
  const tz = config.displayTimeZone;
  const team = await Team.findById(a.teamId).select('name drops captainId').lean();
  const teamName = team?.name ?? 'Team';

  switch (form.kind) {
    case 'scrim': {
      const startAt = futureTime(String(v.date), String(v.time));
      const map = String(v.map);
      const drops = team?.drops as unknown as Record<string, string> | Map<string, string> | undefined;
      const drop = map !== MAP_TBD ? (drops instanceof Map ? drops.get(map) : drops?.[map]) ?? '' : '';
      const match = await Match.create({ teamId: a.teamId, title: v.title, tournamentName: v.tournamentName, type: v.type, map, drop, startAt });
      // The match exists now; a queue hiccup must not undo the approval (the catch-up sweep still sends the alert).
      await upsertMatchJob(getQueue(), { id: String(match._id), ...match.toObject() })
        .catch((e) => console.error('[ai] could not schedule alert:', (e as Error).message));
      const told = await tellTeam(a, { title: `${teamName}: new ${v.type}`, body: `${v.tournamentName} · ${whenLabel(startAt, tz)} · ${map}. Open SquadSync to check in.`, url: `/matches/${match._id}`, tag: 'ai-new-match' });
      return { resultId: String(match._id), result: `${v.tournamentName} scheduled for ${whenLabel(startAt, tz)} on ${map}. ${told}`, applied: v };
    }
    case 'squad': {
      const id = await applySquad(getQueue, a.teamId, form.matchId, v.selectedIds as string[]);
      return { resultId: id, result: 'Squad confirmed. The picked players were alerted.', applied: v };
    }
    case 'message': {
      const ids = (await loadRoster(a.teamId)).map((m) => m.id);
      const to = (v.recipientIds as string[]).filter((id) => ids.includes(id));
      if (!to.length) throw badRequest('Those players are no longer on the team.');
      const report = await sendDirect(to, { title: `${teamName} · ${a.ign}`, body: String(v.text), url: form.matchId ? `/matches/${form.matchId}` : '/', tag: 'ai-message' }, v.channels as Channel[]);
      if (!report.sent.length) {
        throw badRequest(report.unreachable.length === to.length
          ? 'None of them can be reached on those channels (no Telegram linked or push turned on). Try the other channel.'
          : 'The message could not be delivered. Try again in a minute.');
      }
      return { resultId: null, result: `${describe(report, to.length)}.`, applied: v };
    }
    case 'reschedule': {
      const match = await loadOpenMatch(a.teamId, form.matchId);
      if (match.notifiedAt) throw locked('The alert already went out, so the time can no longer change.');
      const from = match.startAt;
      const startAt = futureTime(String(v.date), String(v.time));
      match.startAt = startAt;
      await match.save();
      await upsertMatchJob(getQueue(), { id: String(match._id), ...match.toObject() })
        .catch((e) => console.error('[ai] could not reschedule alert:', (e as Error).message));
      const told = await tellTeam(a, { title: `${teamName}: match moved`, body: `${match.tournamentName || match.title} moved from ${whenLabel(from, tz)} to ${whenLabel(startAt, tz)}.`, url: `/matches/${match._id}`, tag: 'ai-moved' });
      return { resultId: String(match._id), result: `Moved to ${whenLabel(startAt, tz)}. ${told}`, applied: v };
    }
    case 'cancel': {
      const match = await loadOpenMatch(a.teamId, form.matchId);
      match.status = 'cancelled';
      await match.save();
      await removeMatchJob(getQueue(), String(match._id)).catch(() => undefined);
      const told = await tellTeam(a, { title: `${teamName}: match cancelled`, body: `${match.tournamentName || match.title} on ${whenLabel(match.startAt, tz)} is cancelled.`, url: '/', tag: 'ai-cancelled' });
      return { resultId: String(match._id), result: `Cancelled. ${told}`, applied: v };
    }
    case 'map': {
      const match = await loadOpenMatch(a.teamId, form.matchId);
      const map = String(v.map);
      const drops = team?.drops as unknown as Record<string, string> | Map<string, string> | undefined;
      match.set({ map, drop: map === MAP_TBD ? '' : (drops instanceof Map ? drops.get(map) : drops?.[map]) ?? '' });
      await match.save();
      await upsertMatchJob(getQueue(), { id: String(match._id), ...match.toObject() }).catch(() => undefined);
      return { resultId: String(match._id), result: `Map set to ${map}.`, applied: v };
    }
    case 'availability': {
      const match = await loadOpenMatch(a.teamId, form.matchId);
      if (match.status !== 'scheduled' || match.startAt.getTime() < Date.now()) throw badRequest('Check-in is closed for this match.');
      const join = v.status !== 'unavailable' && v.joinTime ? String(v.joinTime) : '';
      await Availability.updateOne(
        { matchId: match._id, userId: a.id },
        { $set: { status: v.status, note: join ? `Joining at ${join}` : '' } },
        { upsert: true },
      );
      return { resultId: String(match._id), result: `Checked in as ${v.status}${join ? `, joining at ${join}` : ''}.`, applied: v };
    }
    case 'request': {
      const captainId = team?.captainId ? String(team.captainId) : null;
      if (!captainId) throw badRequest('Your team has no captain set.');
      const report = await sendDirect([captainId], { title: `Request from ${a.ign}`, body: String(v.text), url: '/ai', tag: 'ai-request' }, ['telegram', 'push']);
      if (!report.sent.length) throw badRequest("The captain can't be reached right now (no Telegram linked or push turned on). Message them in Team chat instead.");
      return { resultId: null, result: 'Sent to the captain.', applied: v };
    }
  }
}

/** Who may approve or dismiss: captain actions need the captain; "self" actions need the person who asked. */
export function canDecide(p: AiProposalDoc, user: { _id: unknown; role?: string }) {
  return p.approver === 'self' ? String(p.createdBy) === String(user._id) : user.role === 'captain';
}


