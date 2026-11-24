import mongoose, { type Types } from 'mongoose';
import { Attendance, Availability, DeliveryClaim, Match, MatchScreenshot, NotificationLog, Squad, Stats } from '../models/index.js';

/**
 * Delete matches and everything hanging off them: squads, delivery logs, check-ins, attendance and stats.
 * Queued alerts for deleted matches are skipped by the worker because the match no longer exists.
 */
export async function deleteMatchData(ids: Types.ObjectId[]) {
  if (!ids.length) return 0;
  const byMatch = { matchId: { $in: ids } };
  await Promise.all([
    Squad.deleteMany(byMatch), NotificationLog.deleteMany(byMatch), Attendance.deleteMany(byMatch),
    Stats.deleteMany(byMatch), Availability.deleteMany(byMatch), DeliveryClaim.deleteMany(byMatch),
    MatchScreenshot.deleteMany(byMatch),
  ]);
  await Match.deleteMany({ _id: { $in: ids } });
  return ids.length;
}

/**
 * One-time data clean-ups that run on startup. Each runs once per database: a marker is stored in the
 * "migrations" collection so a restart never repeats it.
 */
const MIGRATIONS: { id: string; run: () => Promise<string> }[] = [
  {
    // Requested Nov 2026: start fresh, remove every match and its history (teams and players stay).
    id: '2026-11-clear-all-matches',
    run: async () => {
      const ids = await Match.find({}).distinct('_id');
      const n = await deleteMatchData(ids as Types.ObjectId[]);
      return `deleted ${n} match${n === 1 ? '' : 'es'}`;
    },
  },
];

export async function runStartupMigrations() {
  const col = mongoose.connection.collection<{ _id: string; ranAt: Date; result: string }>('migrations');
  for (const m of MIGRATIONS) {
    if (await col.findOne({ _id: m.id })) continue;
    // Claim first so two instances starting together don't both run it.
    try { await col.insertOne({ _id: m.id, ranAt: new Date(), result: 'running' }); } catch { continue; }
    try {
      const result = await m.run();
      await col.updateOne({ _id: m.id }, { $set: { result } });
      console.log(`[migrate] ${m.id}: ${result}`);
    } catch (e) {
      await col.deleteOne({ _id: m.id });
      console.error(`[migrate] ${m.id} failed, will retry next start:`, (e as Error).message);
    }
  }
}
