import { Match } from '../models/index.js';
import { fireAt } from '../lib/time.js';
import { JOB_NAME, type QueueLike } from './queue.js';

/**
 * Catch-up sweep for hosts that can sleep (Render free plan).
 *
 * BullMQ delayed jobs live in Redis, but while the instance is asleep nothing runs them.
 * On startup and then every minute we look in MongoDB for matches whose alert time has
 * passed but that were never notified, and queue them right away. dispatchMatch is
 * idempotent, so a match that also gets its normal delayed job is never sent twice.
 */

export interface DueMatch {
  id: string;
  startAt: Date;
  notifyOffsetMin: number;
}

export interface CatchupRepo {
  /** Scheduled, never notified or captain-alerted, starting after `startedAfter` and before `startsBefore`. */
  findPending(startedAfter: Date, startsBefore: Date): Promise<DueMatch[]>;
}

/** The longest notify offset a match can have (see Match.notifyOffsetMin max). */
const MAX_OFFSET_MIN = 120;

export const mongoCatchupRepo: CatchupRepo = {
  async findPending(startedAfter, startsBefore) {
    const rows = await Match.find({
      status: 'scheduled',
      notifiedAt: null,
      captainAlertedAt: null,
      startAt: { $gt: startedAfter, $lte: startsBefore },
    })
      .select({ startAt: 1, notifyOffsetMin: 1 })
      .lean();
    return rows.map((m) => ({ id: String(m._id), startAt: m.startAt, notifyOffsetMin: m.notifyOffsetMin ?? 2 }));
  },
};

/**
 * Queue every match whose alert is due now. `graceMin` is how long after the match start a late
 * alert is still worth sending (room ID / password are still useful for a few minutes).
 * Returns the ids it queued.
 */
export async function catchUpDueMatches(
  queue: QueueLike,
  repo: CatchupRepo,
  now = new Date(),
  graceMin = 10,
): Promise<string[]> {
  const startedAfter = new Date(now.getTime() - graceMin * 60_000);
  const startsBefore = new Date(now.getTime() + MAX_OFFSET_MIN * 60_000);
  const candidates = await repo.findPending(startedAfter, startsBefore);
  const queued: string[] = [];
  for (const m of candidates) {
    const due = fireAt(m.startAt, m.notifyOffsetMin);
    if (due.getTime() > now.getTime()) continue;
    // One catch-up job per (match, alert time): BullMQ ignores a second add with the same id.
    await queue.add(JOB_NAME, { matchId: m.id, trigger: 'scheduled' }, {
      jobId: `${m.id}-catchup-${due.getTime()}`,
      delay: 0,
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
    });
    queued.push(m.id);
  }
  return queued;
}

/** Run the sweep now and then every `everyMs`. Returns a stop function. */
export function startCatchupLoop(queue: QueueLike, repo: CatchupRepo = mongoCatchupRepo, everyMs = 60_000, graceMin = 10) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const ids = await catchUpDueMatches(queue, repo, new Date(), graceMin);
      if (ids.length) console.log(`[catchup] queued ${ids.length} due alert(s): ${ids.join(', ')}`);
    } catch (e) {
      console.error('[catchup] sweep failed:', (e as Error).message);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(tick, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
