import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ah, parse } from '../middleware/handlers.js';
import { clearAuthCookie, requireAuth, setAuthCookie } from '../middleware/auth.js';
import { Team, TEAM_SIZE, User } from '../models/index.js';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.js';
import { joinCode } from '../lib/codes.js';
import { loadTeamView } from './team.js';

export const authRouter = Router();
const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 50, standardHeaders: 'draft-7', legacyHeaders: false });

const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(40),
    email: z.string().trim().email(),
    password: z.string().min(8, 'Password must be at least 8 characters').max(100),
    ign: z.string().trim().min(2).max(30),
    bgmiId: z.string().trim().regex(/^\d{6,15}$/, 'BGMI ID should be 6 to 15 digits').optional().or(z.literal('')),
    mode: z.enum(['captain', 'player']),
    teamName: z.string().trim().min(2).max(40).optional(),
    joinCode: z.string().trim().toUpperCase().optional(),
  })
  .refine((d) => d.mode !== 'captain' || d.teamName, { message: 'Team name is required', path: ['teamName'] });

authRouter.post(
  '/register',
  limiter,
  ah(async (req, res) => {
    const body = parse(registerSchema, req.body);
    if (await User.exists({ email: body.email.toLowerCase() })) throw conflict('That email is already registered');

    let team = null;
    if (body.mode === 'player' && body.joinCode) {
      team = await Team.findOne({ joinCode: body.joinCode });
      if (!team) throw notFound('No team with that join code');
      if (team.memberIds.length >= TEAM_SIZE) throw badRequest('That team already has 5 players');
    }

    const user = await User.create({
      name: body.name,
      email: body.email,
      passwordHash: await bcrypt.hash(body.password, 10),
      ign: body.ign,
      bgmiId: body.bgmiId ?? '',
      role: body.mode,
    });

    if (body.mode === 'captain') {
      team = await Team.create({ name: body.teamName!, captainId: user._id, memberIds: [], joinCode: joinCode() });
      user.teamId = team._id;
      await user.save();
    } else if (team) {
      team.memberIds.push(user._id);
      await team.save();
      user.teamId = team._id;
      await user.save();
    }

    setAuthCookie(res, String(user._id));
    res.status(201).json({ user: user.toJSON(), team: await loadTeamView(user.teamId, user.role === 'captain') });
  }),
);

const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(1) });

authRouter.post(
  '/login',
  limiter,
  ah(async (req, res) => {
    const body = parse(loginSchema, req.body);
    const user = await User.findOne({ email: body.email.toLowerCase() }).select('+passwordHash');
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) throw unauthorized('Wrong email or password');
    setAuthCookie(res, String(user._id));
    res.json({ user: user.toJSON(), team: await loadTeamView(user.teamId, user.role === 'captain') });
  }),
);

authRouter.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

authRouter.get(
  '/me',
  requireAuth,
  ah(async (req, res) => {
    res.json({ user: req.user!.toJSON(), team: await loadTeamView(req.user!.teamId, req.user!.role === 'captain') });
  }),
);
