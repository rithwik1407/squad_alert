import { fireAt } from '../lib/time.js';
import type { Trigger } from './dispatch.js';

export interface NotifyJobData {
  matchId: string;
  trigger: Trigger;
  onlyUserIds?: string[];
}

/** The subset of a BullMQ Queue the scheduler uses, so tests can pass a fake. */
export interface QueueLike {
  add(name: string, data: NotifyJobData, opts: { jobId: string; delay: number; removeOnComplete?: unknown; removeOnFail?: unknown; attempts?: number; backoff?: unknown }): Promise<unknown>;
  remove(jobId: string): Promise<unknown>;
  getJob(jobId: string): Promise<{ getState(): Promise<string>; remove(): Promise<unknown> } | undefined | null>;
}

export interface SchedulableMatch {
  id: string;
  startAt: Date;
  notifyOffsetMin: number;
  status: string;
  notifiedAt?: Date | null;
}

export const JOB_NAME = 'notify-squad';
const jobOpts = {
  removeOnComplete: { age: 7 * 24 * 3600 },
  removeOnFail: { age: 30 * 24 * 3600 },
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
};

export type ScheduleOutcome =
  | { action: 'scheduled'; jobId: string; fireAt: Date; delayMs: number }
  | { action: 'removed'; jobId: string; reason: string };

async function removeIfPresent(queue: QueueLike, jobId: string) {
  const job = await queue.getJob(jobId);
  if (!job) return;
  const state = await job.getState();
  // An active job is already sending; idempotent dispatch makes leaving it safe.
  if (state !== 'active') await job.remove();
}

/**
 * Create or replace the delayed job for a match (jobId = matchId).
 * Called on create and on every edit; a reschedule removes the old job and adds a new one.
 */
export async function upsertMatchJob(queue: QueueLike, match: SchedulableMatch, now = new Date()): Promise<ScheduleOutcome> {
  const jobId = match.id;
  await removeIfPresent(queue, jobId);

  if (match.status !== 'scheduled' || match.notifiedAt) {
    return { action: 'removed', jobId, reason: `status ${match.status}` };
  }
  if (match.startAt.getTime() <= now.getTime()) {
    return { action: 'removed', jobId, reason: 'match already started' };
  }
  const at = fireAt(match.startAt, match.notifyOffsetMin);
  const delayMs = Math.max(0, at.getTime() - now.getTime());
  await queue.add(JOB_NAME, { matchId: match.id, trigger: 'scheduled' }, { jobId, delay: delayMs, ...jobOpts });
  return { action: 'scheduled', jobId, fireAt: at, delayMs };
}

/** Cancel: drop the delayed job. */
export async function removeMatchJob(queue: QueueLike, matchId: string) {
  await removeIfPresent(queue, matchId);
  return { action: 'removed' as const, jobId: matchId, reason: 'cancelled' };
}

/** Immediate one-off job (Send now / Resend to failed / substitute). Unique id so it never collides with the delayed one. */
export async function enqueueImmediate(queue: QueueLike, data: NotifyJobData, now = new Date()) {
  const jobId = `${data.matchId}-${data.trigger}-${now.getTime()}`;
  await queue.add(JOB_NAME, data, { jobId, delay: 0, ...jobOpts, attempts: 1 });
  return jobId;
}
