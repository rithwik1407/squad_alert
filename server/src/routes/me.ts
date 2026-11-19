import { Router } from 'express';
import { z } from 'zod';
import { ah, parse } from '../middleware/handlers.js';
import { requireAuth } from '../middleware/auth.js';
import { Attendance, Match, Squad, Stats, User } from '../models/index.js';
import { linkToken } from '../lib/codes.js';
import { config } from '../config.js';
import bcrypt from 'bcryptjs';
import { normalizePhone } from '../lib/phone.js';
import { badRequest, conflict } from '../lib/errors.js';

export const meRouter = Router();
meRouter.use(requireAuth);

const profileSchema = z.object({
  name: z.string().trim().min(2).max(40).optional(),
  ign: z.string().trim().min(2).max(30).optional(),
  bgmiId: z.string().trim().regex(/^\d{6,15}$/, 'BGMI ID should be 6 to 15 digits').optional(),
  avatar: z.string().url().or(z.literal('')).optional(),
  whatsappNumber: z.string().trim().max(20).optional(),
  notifyPrefs: z.object({ push: z.boolean(), telegram: z.boolean(), whatsapp: z.boolean() }).partial().optional(),
});

meRouter.patch('/', ah(async (req, res) => {
  const body = parse(profileSchema, req.body);
  const user = req.user!;
  const { notifyPrefs, whatsappNumber, ...rest } = body;
  user.set(rest);
  if (whatsappNumber !== undefined) {
    const phone = whatsappNumber ? normalizePhone(whatsappNumber) : null;
    if (whatsappNumber && !phone) throw badRequest('Enter the WhatsApp number with country code, e.g. +91 98765 43210');
    user.set('whatsappNumber', phone);
    if (phone) user.set('notifyPrefs.whatsapp', true);
  }
  if (notifyPrefs) user.set('notifyPrefs', { ...user.toObject().notifyPrefs, ...notifyPrefs });
  await user.save();
  res.json({ user: user.toJSON() });
}));

/** Change my own login email and/or password. Needs the current password. */
const accountSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  email: z.string().trim().toLowerCase().email().optional(),
  newPassword: z.string().min(8, 'New password must be at least 8 characters').max(100).optional(),
}).refine((d) => d.email || d.newPassword, { message: 'Nothing to change' });

meRouter.patch('/account', ah(async (req, res) => {
  const body = parse(accountSchema, req.body);
  const user = await User.findById(req.user!._id).select('+passwordHash');
  if (!user || !(await bcrypt.compare(body.currentPassword, user.passwordHash))) throw badRequest('Current password is wrong');
  if (body.email && body.email !== user.email) {
    if (await User.exists({ email: body.email })) throw conflict('That email is already used by another account');
    user.email = body.email;
  }
  if (body.newPassword) user.passwordHash = await bcrypt.hash(body.newPassword, 10);
  await user.save();
  res.json({ user: user.toJSON() });
}));

const tokenSchema = z.object({ token: z.string().min(20).max(4096) });

meRouter.post('/fcm-token', ah(async (req, res) => {
  const { token } = parse(tokenSchema, req.body);
  // Keep the newest 5 devices per user.
  await User.updateOne({ _id: req.user!._id }, { $pull: { fcmTokens: token } });
  await User.updateOne({ _id: req.user!._id }, { $push: { fcmTokens: { $each: [token], $slice: -5 } } });
  res.json({ ok: true });
}));

meRouter.delete('/fcm-token', ah(async (req, res) => {
  const { token } = parse(tokenSchema, req.body);
  await User.updateOne({ _id: req.user!._id }, { $pull: { fcmTokens: token } });
  res.json({ ok: true });
}));

meRouter.post('/telegram/link', ah(async (req, res) => {
  if (!config.telegram.botUsername) throw badRequest('Telegram bot is not configured on the server');
  const token = linkToken();
  await User.updateOne({ _id: req.user!._id }, { $set: { telegramLinkToken: token } });
  res.json({ url: `https://t.me/${config.telegram.botUsername}?start=${token}` });
}));

meRouter.delete('/telegram', ah(async (req, res) => {
  await User.updateOne({ _id: req.user!._id }, { $set: { telegramChatId: null, telegramLinkToken: null } });
  res.json({ ok: true });
}));

/** Personal history: attendance, stats per match, and totals for charts. */
meRouter.get('/stats', ah(async (req, res) => {
  const uid = req.user!._id;
  const [stats, attendance, squads] = await Promise.all([
    Stats.find({ userId: uid }).lean(),
    Attendance.find({ userId: uid }).lean(),
    Squad.find({ confirmed: true, $or: [{ selectedIds: uid }, { benchedId: uid }] }).lean(),
  ]);
  const matchIds = [...new Set([...stats, ...attendance, ...squads].map((x) => String(x.matchId)))];
  const matches = await Match.find({ _id: { $in: matchIds }, startAt: { $lt: new Date() } }).sort({ startAt: 1 }).lean();
  const statBy = new Map(stats.map((s) => [String(s.matchId), s]));
  const attBy = new Map(attendance.map((a) => [String(a.matchId), a]));
  const sqBy = new Map(squads.map((s) => [String(s.matchId), s]));
  const rows = matches.map((m) => {
    const s = statBy.get(String(m._id));
    const sq = sqBy.get(String(m._id));
    return {
      matchId: String(m._id),
      title: m.title,
      map: m.map,
      type: m.type,
      startAt: m.startAt.toISOString(),
      selected: Boolean(sq?.selectedIds.some((id) => String(id) === String(uid))),
      joined: attBy.get(String(m._id))?.joined ?? null,
      kills: s?.kills ?? 0,
      damage: s?.damage ?? 0,
      mvp: s?.mvp ?? false,
    };
  });
  const played = rows.filter((r) => r.selected);
  const withAtt = played.filter((r) => r.joined !== null);
  res.json({
    rows,
    totals: {
      matches: played.length,
      kills: played.reduce((a, r) => a + r.kills, 0),
      damage: played.reduce((a, r) => a + r.damage, 0),
      mvps: played.filter((r) => r.mvp).length,
      attendanceRate: withAtt.length ? Math.round((withAtt.filter((r) => r.joined).length / withAtt.length) * 100) : null,
    },
  });
}));
