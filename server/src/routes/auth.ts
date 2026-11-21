import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ah, parse } from '../middleware/handlers.js';
import { clearAuthCookie, requireAuth, setAuthCookie } from '../middleware/auth.js';
import { User } from '../models/index.js';
import { badRequest, conflict, forbidden, unauthorized } from '../lib/errors.js';
import { normalizePhone } from '../lib/phone.js';
import { config } from '../config.js';
import { loadTeamView } from './team.js';

export const authRouter = Router();
/*
 * Every request reaches us through Vercel's rewrite, so for most users req.ip is one of a few shared
 * Vercel addresses, not the player's phone. A plain per-IP limit therefore locked the whole team out
 * once a handful of people signed in. Instead:
 * - wrong-password guessing is limited per email (successful sign-ins never count), and
 * - a generous per-IP backstop only counts failed attempts, so normal logins can't trip it.
 */
const tooMany = (message: string) => (_req: Request, res: Response) => res.status(429).json({ error: message });
const loginPerEmail = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `login:${String(req.body?.email ?? '').trim().toLowerCase()}`,
  handler: tooMany('Too many wrong passwords for this account. Wait 15 minutes and try again.'),
});
const failedPerIp = rateLimit({
  windowMs: 15 * 60_000,
  limit: 200,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: tooMany('Too many failed attempts from this network. Wait a few minutes and try again.'),
});
const registerPerIp = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: tooMany('Too many join requests right now. Wait a few minutes and try again.'),
});

const registerSchema = z.object({
  name: z.string().trim().min(2).max(40),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
  ign: z.string().trim().min(2).max(30),
  bgmiId: z.string().trim().regex(/^\d{6,15}$/, 'BGMI ID should be 6 to 15 digits'),
  phone: z.string().trim().min(6, 'Enter your phone number').max(20),
  mode: z.enum(['captain', 'player']),
});

/**
 * Anyone can ask to join. The account is created as "pending": it can't sign in or join a team
 * until the admin approves it from the Team page. No team or join code is involved here.
 */
authRouter.post(
  '/register',
  registerPerIp,
  ah(async (req, res) => {
    const body = parse(registerSchema, req.body);
    if (body.email === config.adminEmail) throw conflict('That email is already registered');
    const existing = await User.findOne({ email: body.email }).lean();
    if (existing) {
      throw conflict(existing.status === 'pending' ? 'You already sent a request with this email. Wait for the admin to approve it.' : 'That email is already registered');
    }
    const phone = normalizePhone(body.phone);
    if (!phone) throw badRequest('Enter the phone number with country code, e.g. +91 98765 43210', [{ path: 'phone', message: 'Add the country code, e.g. +91 98765 43210' }]);

    await User.create({
      name: body.name,
      email: body.email,
      passwordHash: await bcrypt.hash(body.password, 10),
      ign: body.ign,
      bgmiId: body.bgmiId,
      whatsappNumber: phone,
      role: body.mode,
      status: 'pending',
      teamId: null,
    });

    res.status(202).json({ pending: true, message: 'Request sent. You can sign in once the admin approves you.' });
  }),
);

const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(1) });

authRouter.post(
  '/login',
  failedPerIp,
  loginPerEmail,
  ah(async (req, res) => {
    const body = parse(loginSchema, req.body);
    const user = await User.findOne({ email: body.email.toLowerCase() }).select('+passwordHash');
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) throw unauthorized('Wrong email or password');
    if (user.status === 'pending') throw forbidden('Your request is still waiting for admin approval. Try again after the admin approves you.');
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
