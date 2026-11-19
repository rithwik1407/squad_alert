import { Router } from 'express';
import { z } from 'zod';
import type { Types } from 'mongoose';
import { ah, parse } from '../middleware/handlers.js';
import { requireAuth, requireCaptain } from '../middleware/auth.js';
import { MAPS, Team, TEAM_SIZE, User } from '../models/index.js';
import bcrypt from 'bcryptjs';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { joinCode } from '../lib/codes.js';
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
      .map((u) => ({ ...publicUser(u!), ...(withEmails ? { email: u!.email } : {}) })),
  };
}

teamRouter.get('/preview/:code', ah(async (req, res) => {
  const team = await Team.findOne({ joinCode: String(req.params.code).toUpperCase() }).lean();
  if (!team) throw notFound('No team with that code');
  res.json({ name: team.name, tag: team.tag, logo: team.logo, slotsLeft: TEAM_SIZE - team.memberIds.length });
}));

teamRouter.use(requireAuth);

teamRouter.get('/', ah(async (req, res) => {
  res.json({ team: await loadTeamView(req.user!.teamId, req.user!.role === 'captain') });
}));

teamRouter.post('/join', ah(async (req, res) => {
  const { code } = parse(z.object({ code: z.string().trim().toUpperCase().min(4) }), req.body);
  const user = req.user!;
  if (user.role === 'captain') throw forbidden('Captains manage their own team');
  if (user.teamId) throw conflict('You are already on a team');
  const team = await Team.findOneAndUpdate(
    { joinCode: code, [`memberIds.${TEAM_SIZE - 1}`]: { $exists: false } },
    { $addToSet: { memberIds: user._id } },
    { new: true },
  );
  if (!team) {
    if (await Team.exists({ joinCode: code })) throw badRequest('That team already has 5 players');
    throw notFound('No team with that join code');
  }
  user.teamId = team._id;
  await user.save();
  res.json({ team: await loadTeamView(team._id) });
}));

teamRouter.post('/code/regenerate', requireCaptain, ah(async (req, res) => {
  const team = await Team.findOneAndUpdate({ captainId: req.user!._id }, { joinCode: joinCode() }, { new: true });
  if (!team) throw notFound('No team');
  res.json({ joinCode: team.joinCode });
}));

const patchSchema = z.object({
  name: z.string().trim().min(2).max(40).optional(),
  tag: z.string().trim().max(8).optional(),
  logo: z.string().url().or(z.literal('')).optional(),
  drops: z.record(z.enum(MAPS), z.string().trim().max(30)).optional(),
});

teamRouter.patch('/', requireCaptain, ah(async (req, res) => {
  const body = parse(patchSchema, req.body);
  const team = await Team.findOne({ captainId: req.user!._id });
  if (!team) throw notFound('No team');
  if (body.name !== undefined) team.name = body.name;
  if (body.tag !== undefined) team.tag = body.tag;
  if (body.logo !== undefined) team.logo = body.logo;
  if (body.drops) for (const [map, spot] of Object.entries(body.drops)) team.drops.set(map, spot);
  await team.save();
  res.json({ team: await loadTeamView(team._id, true) });
}));

/** Captain edits a player's profile and login: email and/or a new password (the player can change it later). */
const memberSchema = z.object({
  name: z.string().trim().min(2).max(40).optional(),
  ign: z.string().trim().min(2).max(30).optional(),
  bgmiId: z.string().trim().regex(/^\d{6,15}$/, 'BGMI ID should be 6 to 15 digits').or(z.literal('')).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100).optional(),
});

teamRouter.patch('/members/:userId', requireCaptain, ah(async (req, res) => {
  const body = parse(memberSchema, req.body);
  const team = await Team.findOne({ captainId: req.user!._id });
  if (!team) throw notFound('No team');
  const id = String(req.params.userId);
  if (!team.memberIds.some((m) => String(m) === id)) throw notFound('That player is not on your team');
  const user = await User.findById(id);
  if (!user) throw notFound('Player not found');
  if (body.email && body.email !== user.email && (await User.exists({ email: body.email }))) throw conflict('That email is already used by another account');
  const { password, ...rest } = body;
  user.set(rest);
  if (password) user.set('passwordHash', await bcrypt.hash(password, 10));
  await user.save();
  res.json({ team: await loadTeamView(team._id, true) });
}));

teamRouter.delete('/members/:userId', requireCaptain, ah(async (req, res) => {
  const team = await Team.findOne({ captainId: req.user!._id });
  if (!team) throw notFound('No team');
  const id = String(req.params.userId);
  team.memberIds = team.memberIds.filter((m) => String(m) !== id) as typeof team.memberIds;
  await team.save();
  await User.updateOne({ _id: id, teamId: team._id }, { $set: { teamId: null } });
  res.json({ team: await loadTeamView(team._id, true) });
}));
