import { Router, type Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { ah, parse } from '../middleware/handlers.js';
import { requireAuth } from '../middleware/auth.js';
import { ClassicInvite, INVITE_RESPONSES, isAdmin, Team, User } from '../models/index.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { deliverInvite, respondToInvite } from '../lib/invites.js';
import { mongoDispatchRepo } from '../scheduler/repo.js';

/**
 * "Play classic" invites between teammates. Only players send and get them; the captain / admin is left out.
 * The sender can delete one (it disappears for everyone), and it clears itself 5 minutes after everyone answered.
 */
export const invitesRouter = Router();
invitesRouter.use(requireAuth);

const teamIdOf = (req: Request) => {
  if (!req.user!.teamId) throw badRequest('Join a team first');
  return req.user!.teamId;
};

const live = () => ({ $or: [{ expireAt: null }, { expireAt: { $gt: new Date() } }] });
const isStaff = (u: { role?: string | null; email?: string | null }) => u.role === 'captain' || isAdmin(u);

type Lean = {
  _id: unknown; fromId: unknown; message?: string | null; createdAt?: Date; expireAt?: Date | null;
  recipients: { userId: unknown; response?: string | null; respondedAt?: Date | null; via?: string | null; delivered?: string[] }[];
};

async function serialize(list: Lean[], me: string) {
  const ids = [...new Set(list.flatMap((i) => [String(i.fromId), ...i.recipients.map((r) => String(r.userId))]))];
  const users = await User.find({ _id: { $in: ids } }).select('name ign avatar').lean();
  const by = new Map(users.map((u) => [String(u._id), { id: String(u._id), name: u.name, ign: u.ign, avatar: u.avatar ?? '' }]));
  const who = (id: unknown) => by.get(String(id)) ?? { id: String(id), name: 'Player', ign: 'Player', avatar: '' };
  return list.map((i) => {
    const mine = i.recipients.find((r) => String(r.userId) === me);
    return {
      id: String(i._id),
      from: who(i.fromId),
      message: i.message ?? '',
      createdAt: i.createdAt ?? null,
      sentByMe: String(i.fromId) === me,
      /** When it clears itself (everyone answered), else null. */
      expiresAt: i.expireAt ?? null,
      myResponse: mine ? mine.response ?? null : undefined,
      recipients: i.recipients.map((r) => ({
        user: who(r.userId), response: r.response ?? null, respondedAt: r.respondedAt ?? null, delivered: r.delivered ?? [],
      })),
    };
  });
}

/** Invites from the last 24 hours that I sent or got. */
invitesRouter.get('/', ah(async (req, res) => {
  const me = req.user!._id;
  const list = await ClassicInvite.find({
    teamId: teamIdOf(req),
    createdAt: { $gte: new Date(Date.now() - 24 * 3600_000) },
    $and: [{ $or: [{ fromId: me }, { 'recipients.userId': me }] }, live()],
  }).sort({ createdAt: -1 }).limit(20).lean();
  res.json({ invites: await serialize(list as Lean[], String(me)) });
}));

invitesRouter.get('/:id', ah(async (req, res) => {
  if (!Types.ObjectId.isValid(String(req.params.id))) throw notFound('Invite not found');
  const i = await ClassicInvite.findOne({ _id: req.params.id, teamId: teamIdOf(req), ...live() }).lean();
  if (!i) throw notFound('Invite not found. It may have expired.');
  res.json({ invite: (await serialize([i as Lean], String(req.user!._id)))[0] });
}));

invitesRouter.post('/', ah(async (req, res) => {
  const { message, userIds } = parse(z.object({
    message: z.string().trim().max(300).default(''),
    userIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1, 'Pick at least one teammate').max(20),
  }), req.body);
  const teamId = teamIdOf(req);
  if (isStaff(req.user!)) throw forbidden('Classic invites are for players only');
  const me = String(req.user!._id);
  const team = await Team.findById(teamId).lean();
  // Teammates only: never the captain / admin.
  const players = await User.find({ _id: { $in: team?.memberIds ?? [] } }).select('role email').lean();
  const onTeam = new Set(players.filter((u) => String(u._id) !== String(team?.captainId) && !isStaff(u)).map((u) => String(u._id)));
  const picked = [...new Set(userIds)].filter((id) => id !== me);
  if (picked.some((id) => !onTeam.has(id))) throw badRequest('You can only invite your teammates');
  if (!picked.length) throw badRequest('Pick at least one teammate');
  const invite = await ClassicInvite.create({
    teamId, fromId: me, message, recipients: picked.map((userId) => ({ userId })),
  });
  const recipients = await mongoDispatchRepo.getRecipients(picked);
  const delivered = await deliverInvite({ id: String(invite._id), message, fromIgn: req.user!.ign || req.user!.name }, recipients);
  await Promise.all(picked.map((uid) => ClassicInvite.updateOne(
    { _id: invite._id, 'recipients.userId': new Types.ObjectId(uid) },
    { $set: { 'recipients.$.delivered': delivered.get(uid) ?? [] } },
  )));
  const fresh = await ClassicInvite.findById(invite._id).lean();
  res.status(201).json({ invite: (await serialize([fresh as Lean], me))[0] });
}));

invitesRouter.post('/:id/respond', ah(async (req, res) => {
  const { response } = parse(z.object({ response: z.enum(INVITE_RESPONSES) }), req.body);
  const via = req.query.via === 'push' ? 'push' : 'app';
  const invite = await respondToInvite(String(req.params.id), String(req.user!._id), response, via);
  if (!invite || String(invite.teamId) !== String(teamIdOf(req))) throw notFound('You are not on this invite');
  res.json({ invite: (await serialize([invite.toObject() as Lean], String(req.user!._id)))[0] });
}));

/** The sender deletes their invite; it disappears for everyone. */
invitesRouter.delete('/:id', ah(async (req, res) => {
  if (!Types.ObjectId.isValid(String(req.params.id))) throw notFound('Invite not found');
  const i = await ClassicInvite.findOne({ _id: req.params.id, teamId: teamIdOf(req) }).select('fromId').lean();
  if (!i) throw notFound('Invite not found. It may have expired.');
  if (String(i.fromId) !== String(req.user!._id)) throw forbidden('Only the player who sent it can delete it');
  await ClassicInvite.deleteOne({ _id: i._id });
  res.json({ ok: true });
}));
