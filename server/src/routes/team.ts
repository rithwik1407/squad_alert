import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Types } from 'mongoose';
import { ah, parse } from '../middleware/handlers.js';
import { requireAdmin, requireAuth, requireCaptain } from '../middleware/auth.js';
import { ALL_MAPS, isAdmin, Team, TEAM_SIZE, User } from '../models/index.js';
import bcrypt from 'bcryptjs';
import { normalizePhone } from '../lib/phone.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { publicUser } from '../lib/serialize.js';

export const teamRouter = Router();

/** withEmails: captains see members' login emails so they can manage accounts. */
export async function loadTeamView(teamId: Types.ObjectId | string | null | undefined, withEmails = false) {
  if (!teamId) return null;
  const team = await Team.findById(teamId).lean();
  if (!team) return null;
  const users = await User.find({ _id: { $in: [team.captainId, ...team.memberIds] } }).lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const captain = byId.get(String(team.captainId));
  return {
    id: String(team._id),
    name: team.name,
    tag: team.tag ?? '',
    logo: team.logo ?? '',
    joinCode: team.joinCode,
    drops: Object.fromEntries(team.drops instanceof Map ? team.drops : Object.entries(team.drops ?? {})),
    captain: captain ? publicUser(captain) : null,
    members: team.memberIds.map((id) => byId.get(String(id))).filter(Boolean)
      .map((u) => ({ ...publicUser(u!), ...(withEmails ? { email: u!.email, whatsappNumber: u!.whatsappNumber ?? '' } : {}) })),
  };
}

teamRouter.use(requireAuth);

teamRouter.get('/', ah(async (req, res) => {
  res.json({ team: await loadTeamView(req.user!.teamId, req.user!.role === 'captain') });
}));

/** The signed-in captain's team (works for the main captain and for approved co-captains). */
async function myTeam(req: Request) {
  const team = req.user!.teamId ? await Team.findById(req.user!.teamId) : null;
  if (!team) throw notFound('No team');
  return team;
}

/* ---------- Join requests: only the admin sees and answers them ---------- */

teamRouter.get('/requests', requireAdmin, ah(async (_req, res) => {
  const users = await User.find({ status: 'pending' }).sort({ createdAt: 1 }).lean();
  res.json({
    requests: users.map((u) => ({
      id: String(u._id), name: u.name, email: u.email, ign: u.ign, bgmiId: u.bgmiId ?? '',
      phone: u.whatsappNumber ?? '', role: u.role, createdAt: u.createdAt,
    })),
  });
}));

teamRouter.post('/requests/:userId/approve', requireAdmin, ah(async (req, res) => {
  const user = await User.findOne({ _id: String(req.params.userId), status: 'pending' });
  if (!user) throw notFound('That request was already handled');
  const adminTeamId = req.user!.teamId;
  if (!adminTeamId) throw badRequest('The admin account is not on a team yet');
  const team = await Team.findOneAndUpdate(
    { _id: adminTeamId, [`memberIds.${TEAM_SIZE - 1}`]: { $exists: false } },
    { $addToSet: { memberIds: user._id } },
    { new: true },
  );
  if (!team) throw badRequest(`The team is full (${TEAM_SIZE} players). Remove someone first.`);
  user.set({ status: 'active', teamId: team._id });
  await user.save();
  res.json({ ok: true, team: await loadTeamView(team._id, true) });
}));

teamRouter.post('/requests/:userId/reject', requireAdmin, ah(async (req, res) => {
  const r = await User.deleteOne({ _id: String(req.params.userId), status: 'pending' });
  if (!r.deletedCount) throw notFound('That request was already handled');
  res.json({ ok: true });
}));

const patchSchema = z.object({
  name: z.string().trim().min(2).max(40).optional(),
  tag: z.string().trim().max(8).optional(),
  logo: z.string().url().or(z.literal('')).optional(),
  drops: z.record(z.enum(ALL_MAPS), z.string().trim().max(30)).optional(),
});

teamRouter.patch('/', requireCaptain, ah(async (req, res) => {
  const body = parse(patchSchema, req.body);
  const team = await myTeam(req);
  if (body.name !== undefined) team.name = body.name;
  if (body.tag !== undefined) team.tag = body.tag;
  if (body.logo !== undefined) team.logo = body.logo;
  if (body.drops) for (const [map, spot] of Object.entries(body.drops)) team.drops.set(map, spot);
  await team.save();
  res.json({ team: await loadTeamView(team._id, true) });
}));

/** Captain edits a player's profile and login email. Only the admin can set a new password (players can't change their own). */
const memberSchema = z.object({
  name: z.string().trim().min(2).max(40).optional(),
  ign: z.string().trim().min(2).max(30).optional(),
  bgmiId: z.string().trim().regex(/^\d{6,15}$/, 'BGMI ID should be 6 to 15 digits').or(z.literal('')).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100).optional(),
  whatsappNumber: z.string().trim().max(20).optional(),
});

teamRouter.patch('/members/:userId', requireCaptain, ah(async (req, res) => {
  const body = parse(memberSchema, req.body);
  const team = await myTeam(req);
  const id = String(req.params.userId);
  if (!team.memberIds.some((m) => String(m) === id)) throw notFound('That player is not on your team');
  const user = await User.findById(id);
  if (!user) throw notFound('Player not found');
  if (body.email && body.email !== user.email && (await User.exists({ email: body.email }))) throw conflict('That email is already used by another account');
  const { password, whatsappNumber, ...rest } = body;
  if (password && !isAdmin(req.user)) throw forbidden('Only the admin can reset a player\'s password');
  user.set(rest);
  if (whatsappNumber !== undefined) {
    const phone = whatsappNumber ? normalizePhone(whatsappNumber) : null;
    if (whatsappNumber && !phone) throw badRequest('Enter the WhatsApp number with country code, e.g. +91 98765 43210');
    user.set('whatsappNumber', phone);
    if (phone) user.set('notifyPrefs.whatsapp', true);
  }
  if (password) user.set('passwordHash', await bcrypt.hash(password, 10));
  await user.save();
  res.json({ team: await loadTeamView(team._id, true) });
}));

teamRouter.delete('/members/:userId', requireCaptain, ah(async (req, res) => {
  const team = await myTeam(req);
  const id = String(req.params.userId);
  team.memberIds = team.memberIds.filter((m) => String(m) !== id) as typeof team.memberIds;
  await team.save();
  await User.updateOne({ _id: id, teamId: team._id }, { $set: { teamId: null } });
  res.json({ team: await loadTeamView(team._id, true) });
}));
