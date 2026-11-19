/**
 * Optional integration test against a real Redis (skipped when none is reachable).
 *   redis-server --daemonize yes && REDIS_URL=redis://127.0.0.1:6379 npm test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { removeMatchJob, upsertMatchJob, type NotifyJobData, type QueueLike } from '../src/scheduler/queue.js';
import { dispatchMatch } from '../src/scheduler/dispatch.js';
import { FakeProvider, MemoryRepo, user } from './fakes.js';

const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const name = `squadsync-test-${Date.now()}`;

async function redisUp() {
  const r = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 500, retryStrategy: () => null });
  try { await r.connect(); await r.ping(); return true; } catch { return false; } finally { r.disconnect(); }
}

const up = await redisUp();

describe.skipIf(!up)('BullMQ + Redis (integration)', () => {
  const conn = () => new Redis(url, { maxRetriesPerRequest: null });
  let queue: Queue<NotifyJobData>;
  let events: QueueEvents;
  let worker: Worker<NotifyJobData>;
  const repo = new MemoryRepo();
  const fcm = new FakeProvider('fcm', () => true);

  beforeAll(async () => {
    queue = new Queue(name, { connection: conn() });
    events = new QueueEvents(name, { connection: conn() });
    await events.waitUntilReady();
    for (const p of ['a', 'b', 'c', 'd', 'e', 'cap']) repo.users.set(p, user(p));
    repo.captains.set('t', 'cap');
    worker = new Worker<NotifyJobData>(name, (job) => dispatchMatch(job.data.matchId, job.data, { repo, providers: [fcm] }), { connection: conn() });
  });

  afterAll(async () => {
    await worker?.close();
    await queue?.obliterate({ force: true });
    await queue?.close();
    await events?.close();
  });

  it('a delayed job fires at startAt − offset and notifies only the selected 4', async () => {
    const startAt = new Date(Date.now() + 1500);
    repo.matches.set('m1', { id: 'm1', teamId: 't', title: 'Scrim 1', map: 'Erangel', startAt, notifyOffsetMin: 0, roomId: '1', roomPassword: 'p', status: 'scheduled', notifiedAt: null });
    repo.squads.set('m1', { selectedIds: ['a', 'b', 'c', 'd'], confirmed: true });
    await upsertMatchJob(queue as unknown as QueueLike, { id: 'm1', startAt, notifyOffsetMin: 0, status: 'scheduled' });
    expect(await queue.getJobState('m1')).toBe('delayed');
    const job = (await queue.getJob('m1'))!;
    await job.waitUntilFinished(events, 10_000);
    expect(fcm.calls.map((c) => c.userId).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('reschedule replaces the job; cancel removes it', async () => {
    const q = queue as unknown as QueueLike;
    const t1 = new Date(Date.now() + 10 * 60_000);
    await upsertMatchJob(q, { id: 'm2', startAt: t1, notifyOffsetMin: 2, status: 'scheduled' });
    const first = (await queue.getJob('m2'))!.delay;
    await upsertMatchJob(q, { id: 'm2', startAt: new Date(t1.getTime() + 600_000), notifyOffsetMin: 2, status: 'scheduled' });
    const second = (await queue.getJob('m2'))!.delay;
    expect(second - first).toBeGreaterThan(590_000);
    expect(await queue.getDelayedCount()).toBe(1);
    await removeMatchJob(q, 'm2');
    expect(await queue.getJob('m2')).toBeUndefined();
  });
});
