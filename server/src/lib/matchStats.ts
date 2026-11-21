import type { Types } from 'mongoose';
import { Attendance, Stats } from '../models/index.js';
import { scoreMvp } from './mvp.js';

export interface StatEntry { userId: string; kills: number; damage: number; survivalMin: number; assists: number }

/**
 * Save numbers read from a results screenshot straight away (so leaving the page doesn't lose them):
 * upsert the matched players, mark them as joined, then work out the MVP again over every stats row
 * of the match. The admin can still correct anything afterwards and Save.
 */
export async function saveScorecardStats(matchId: Types.ObjectId | string, entries: StatEntry[]) {
  if (!entries.length) return { mvpUserId: null as string | null };
  await Promise.all(entries.flatMap((e) => [
    Stats.updateOne(
      { matchId, userId: e.userId },
      { $set: { kills: e.kills, damage: e.damage, survivalMin: e.survivalMin, assists: e.assists } },
      { upsert: true },
    ),
    Attendance.updateOne({ matchId, userId: e.userId }, { $set: { joined: true } }, { upsert: true }),
  ]));
  const all = await Stats.find({ matchId }).lean();
  const { rows, mvpUserId } = scoreMvp(all.map((s) => ({
    userId: String(s.userId), kills: s.kills ?? 0, damage: s.damage ?? 0, survivalMin: s.survivalMin ?? 0, assists: s.assists ?? 0,
  })));
  await Promise.all(rows.map((r) => Stats.updateOne({ matchId, userId: r.userId }, { $set: { mvp: r.mvp, mvpScore: r.mvpScore } })));
  return { mvpUserId };
}
