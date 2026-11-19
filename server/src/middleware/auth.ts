import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { User, type UserDoc } from '../models/index.js';

export const COOKIE_NAME = 'ss_token';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserDoc;
    }
  }
}

export function signToken(userId: string) {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: config.jwtExpiresIn } as jwt.SignOptions);
}

export function setAuthCookie(res: Response, userId: string) {
  res.cookie(COOKIE_NAME, signToken(userId), {
    httpOnly: true,
    secure: config.isProd || config.cookieSameSite === 'none',
    sameSite: config.cookieSameSite,
    maxAge: 30 * 24 * 3600 * 1000,
    path: '/',
  });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, {
    path: '/', httpOnly: true, sameSite: config.cookieSameSite, secure: config.isProd || config.cookieSameSite === 'none',
  });
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) throw unauthorized();
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    } catch {
      throw unauthorized('Session expired, please sign in again');
    }
    const user = await User.findById(payload.sub);
    if (!user) throw unauthorized();
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

export function requireCaptain(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== 'captain') return next(forbidden('Captain only'));
  next();
}
