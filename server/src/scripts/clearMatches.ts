/**
 * Delete matches (and everything hanging off them) and their scheduled alerts.
 *   npm run clear-matches            → every match in the database
 * Teams and players are kept.
 */
import { Redis } from 'ioredis';
import { config } from '../config.js';
import type { Types } from 'mongoose';
import { Match } from '../models/index.js';
import { deleteMatchData } from '../lib/deleteMatches.js';
import { closeQueue, getQueue } from '../scheduler/bull.js';

async function redisReachable() {
  const r = new Redis(config.redisUrl, { lazyConnect: true, connectTimeout: 3000, maxRetriesPerRequest: 0, retryStrategy: () => null });
  try { await r.connect(); await r.ping(); return true; } catch { return false; } finally { r.disconnect(); }
}

/** Delete matches matching `filter` plus their squads, logs, check-ins, stats and pending alert jobs. */
export async function deleteMatchesFor(filter: Record<string, unknown>) {
  const ids = await Match.find(filter).distinct('_id');
  if (!ids.length) return 0;
  if (await redisReachable()) {
    const q = getQueue();
    for (const id of ids) {
      const job = await q.getJob(String(id));
      if (job && (await job.getState()) !== 'active') await job.remove();
    }
    await closeQueue();
  } else {
    console.warn('[clear] Redis not reachable: any queued alerts will be skipped by the worker since their matches are gone.');
  }
  return deleteMatchData(ids as Types.ObjectId[]);
}

