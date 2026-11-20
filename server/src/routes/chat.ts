import { Router, type Request } from 'express';
import { z } from 'zod';
import { ah, parse } from '../middleware/handlers.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { ChatMessage, ChatSettings, CHAT_MODES, isAdmin, Team, User, type ChatSettingsDoc } from '../models/index.js';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors.js';
import { HHMM, isChatOpen } from '../lib/chatHours.js';
import { formatDateTimeIST, formatTimeIST } from '../lib/time.js';
import { config } from '../config.js';

/**
 * Team group chat. Clients poll (no websockets) because the web app reaches the API
 * through a Vercel rewrite. The admin sets open hours and can mute players for a while.
 */
export const chatRouter = Router();
chatRouter.use(requireAuth);

const PAGE = 100;
const MAX_MUTE_MIN = 30 * 24 * 60;
const lastPost = new Map<string, number>();

function teamIdOf(req: Request) {
  const id = req.user!.teamId;
  if (!id) throw notFound('You are not on a team yet');
  return id;
}

async function settingsFor(teamId: unknown): Promise<ChatSettingsDoc> {
  return ChatSettings.findOneAndUpdate({ teamId }, { $setOnInsert: { teamId } }, { upsert: true, new: true });
}

const activeMutes = (s: ChatSettingsDoc, now = new Date()) =>
  s.mutes.filter((m) => m.until && m.until > now);

function stateFor(req: Request, s: ChatSettingsDoc) {
  const now = new Date();
  const admin = isAdmin(req.user);
  const open = isChatOpen({ mode: s.mode, openFrom: s.openFrom, openTo: s.openTo }, now, config.displayTimeZone);
  const myMute = activeMutes(s, now).find((m) => String(m.userId) === String(req.user!._id));
  return {
    open,
    mode: s.mode,
    openFrom: s.openFrom,
    openTo: s.openTo,
    timeZone: config.displayTimeZone,
    isAdmin: admin,
    canPost: admin || (open && !myMute),
    mutedUntil: !admin && myMute?.until ? myMute.until.toISOString() : null,
  };
}

async function serializeMessages(msgs: { _id: unknown; userId?: unknown; text: string; system?: boolean | null; createdAt?: Date | null }[], meId: string) {
  const ids = [...new Set(msgs.map((m) => (m.userId ? String(m.userId) : '')).filter(Boolean))];
  const users = ids.length ? await User.find({ _id: { $in: ids } }, { ign: 1, name: 1, avatar: 1, email: 1, role: 1 }).lean() : [];
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return msgs.map((m) => {
    const u = m.userId ? byId.get(String(m.userId)) : undefined;
    return {
      id: String(m._id),
      userId: m.userId ? String(m.userId) : null,
      ign: u?.ign ?? (m.system ? 'SquadSync' : 'Former player'),
      avatar: u?.avatar ?? '',
      isAdmin: isAdmin(u),
      role: u?.role ?? 'player',
      text: m.text,
      system: Boolean(m.system),
      mine: Boolean(m.userId) && String(m.userId) === meId,
      createdAt: m.createdAt,
    };
  });
}

/** Latest messages (oldest first) plus the chat rules as they apply to me. */
chatRouter.get('/', ah(async (req, res) => {
  const teamId = teamIdOf(req);
  const s = await settingsFor(teamId);
  const msgs = await ChatMessage.find({ teamId }).sort({ createdAt: -1 }).limit(PAGE).lean();
  msgs.reverse();
  const out: Record<string, unknown> = {
    state: stateFor(req, s),
    messages: await serializeMessages(msgs, String(req.user!._id)),
  };
  if (isAdmin(req.user)) {
    out.mutes = activeMutes(s).map((m) => ({ userId: String(m.userId), until: m.until }));
  }
  res.json(out);
}));

/** Cheap check for the unread dot while the chat window is closed. */
chatRouter.get('/unread', ah(async (req, res) => {
  const teamId = teamIdOf(req);
  const since = new Date(String(req.query.since ?? ''));
  const filter: Record<string, unknown> = { teamId, userId: { $ne: req.user!._id } };
  if (!Number.isNaN(since.getTime())) filter.createdAt = { $gt: since };
  const count = await ChatMessage.countDocuments(filter).limit(99);
  res.json({ count });
}));

chatRouter.post('/', ah(async (req, res) => {
  const teamId = teamIdOf(req);
  const { text } = parse(z.object({ text: z.string().trim().min(1, 'Type a message').max(1000, 'Keep it under 1000 characters') }), req.body);
  const s = await settingsFor(teamId);
  const st = stateFor(req, s);
  if (!st.canPost) {
    if (st.mutedUntil) throw forbidden(`The admin muted you until ${formatDateTimeIST(new Date(st.mutedUntil), config.displayTimeZone)}`);
    throw forbidden('Chat is closed right now');
  }
  const me = String(req.user!._id);
  const now = Date.now();
  if (now - (lastPost.get(me) ?? 0) < 700) throw new HttpError(429, 'Slow down a little');
  lastPost.set(me, now);
  const m = await ChatMessage.create({ teamId, userId: req.user!._id, text });
  const [msg] = await serializeMessages([m.toObject()], me);
  res.status(201).json({ message: msg });
}));

/* ---------- Admin controls ---------- */

chatRouter.delete('/messages/:id', requireAdmin, ah(async (req, res) => {
  const r = await ChatMessage.deleteOne({ _id: String(req.params.id), teamId: teamIdOf(req) });
  if (!r.deletedCount) throw notFound('Message already gone');
  res.json({ ok: true });
}));

chatRouter.put('/settings', requireAdmin, ah(async (req, res) => {
  const teamId = teamIdOf(req);
  const b = parse(z.object({
    mode: z.enum(CHAT_MODES),
    openFrom: z.string().regex(HHMM, 'Use a time like 18:00').optional(),
    openTo: z.string().regex(HHMM, 'Use a time like 23:00').optional(),
  }), req.body);
  const s = await settingsFor(teamId);
  s.mode = b.mode;
  if (b.openFrom) s.openFrom = b.openFrom;
  if (b.openTo) s.openTo = b.openTo;
  await s.save();
  const note = b.mode === 'always' ? 'Chat is now open all day'
    : b.mode === 'closed' ? 'Chat is closed by the admin'
    : `Chat is open from ${s.openFrom} to ${s.openTo}`;
  await ChatMessage.create({ teamId, text: note, system: true });
  res.json({ state: stateFor(req, s) });
}));

async function teammate(teamId: unknown, userId: string) {
  const team = await Team.findById(teamId).lean();
  if (!team) throw notFound('No team');
  const onTeam = [team.captainId, ...team.memberIds].some((id) => String(id) === userId);
  const u = onTeam ? await User.findById(userId).lean() : null;
  if (!u) throw notFound('That player is not on the team');
  if (isAdmin(u)) throw badRequest('The admin cannot be muted');
  return u;
}

const durationText = (min: number) =>
  min % 1440 === 0 ? `${min / 1440} day${min === 1440 ? '' : 's'}`
  : min % 60 === 0 ? `${min / 60} hour${min === 60 ? '' : 's'}`
  : `${min} minutes`;

chatRouter.post('/mutes', requireAdmin, ah(async (req, res) => {
  const teamId = teamIdOf(req);
  const b = parse(z.object({ userId: z.string().min(1), minutes: z.number().int().min(1).max(MAX_MUTE_MIN, 'Up to 30 days') }), req.body);
  const u = await teammate(teamId, b.userId);
  const s = await settingsFor(teamId);
  const until = new Date(Date.now() + b.minutes * 60_000);
  s.mutes = [...activeMutes(s).filter((m) => String(m.userId) !== b.userId), { userId: u._id, until, at: new Date() }] as typeof s.mutes;
  await s.save();
  await ChatMessage.create({ teamId, system: true, text: `${u.ign} is muted for ${durationText(b.minutes)} (until ${formatTimeIST(until, config.displayTimeZone)})` });
  res.json({ mutes: activeMutes(s).map((m) => ({ userId: String(m.userId), until: m.until })) });
}));

chatRouter.delete('/mutes/:userId', requireAdmin, ah(async (req, res) => {
  const teamId = teamIdOf(req);
  const userId = String(req.params.userId);
  const s = await settingsFor(teamId);
  const before = activeMutes(s).length;
  s.mutes = activeMutes(s).filter((m) => String(m.userId) !== userId) as typeof s.mutes;
  await s.save();
  if (s.mutes.length < before) {
    const u = await User.findById(userId, { ign: 1 }).lean();
    await ChatMessage.create({ teamId, system: true, text: `${u?.ign ?? 'A player'} can chat again` });
  }
  res.json({ mutes: activeMutes(s).map((m) => ({ userId: String(m.userId), until: m.until })) });
}));
