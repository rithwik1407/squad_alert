import type { NextFunction, Request, Response } from 'express';
import type { Types } from 'mongoose';
import { Match, Team } from '../models/index.js';

/**
 * Live sync: every open app polls GET /api/team/pulse (a few bytes) and refetches its data when the
 * team's revision moves. The revision is the later of
 *  - Team.liveRevAt, bumped after any successful change through the API (stats, squads, check-ins...), and
 *  - the team's most recently updated match, which also catches changes made by the worker or background jobs.
 * Polling fits the free Render + Vercel rewrite setup better than sockets (no long-lived connections to proxy).
 */

export async function touchTeam(teamId: Types.ObjectId | string | null | undefined): Promise<void> {
  if (!teamId) return;
  await Team.updateOne({ _id: teamId }, { $set: { liveRevAt: new Date() } }, { timestamps: false })
    .catch((e) => console.error('[live] could not bump team revision:', (e as Error).message));
}

export async function teamRevision(teamId: Types.ObjectId | string): Promise<string> {
  const [team, match] = await Promise.all([
    Team.findById(teamId).select('liveRevAt').lean(),
    Match.findOne({ teamId }).sort({ updatedAt: -1 }).select('updatedAt').lean(),
  ]);
  const times = [team?.liveRevAt, match?.updatedAt].map((d) => (d ? new Date(d).getTime() : 0));
  return String(Math.max(...times));
}

/**
 * Express middleware: after a successful POST / PUT / PATCH / DELETE, bump the caller's team revision so
 * teammates' apps pick the change up on their next pulse. Mount it before the routers it should cover.
 */
export function bumpOnWrite(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') { next(); return; }
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    void touchTeam(req.user?.teamId);
  });
  next();
}
