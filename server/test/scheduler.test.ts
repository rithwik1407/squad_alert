import { beforeEach, describe, expect, it } from 'vitest';
import { enqueueImmediate, removeMatchJob, upsertMatchJob } from '../src/scheduler/queue.js';
import { dispatchMatch, type DispatchDeps } from '../src/scheduler/dispatch.js';
import { FakeProvider, FakeQueue, MemoryRepo, user } from './fakes.js';

const NOW = new Date('2026-11-19T15:00:00.000Z'); // 8:30 PM IST
const START = new Date('2026-11-19T15:30:00.000Z'); // 9:00 PM IST
const min = (n: number) => n * 60_000;

describe('scheduler: delayed jobs', () => {
  let q: FakeQueue;
  beforeEach(() => { q = new FakeQueue(); });

  it('create: adds one delayed job with jobId = matchId firing notifyOffsetMin before start', async () => {
    const out = await upsertMatchJob(q, { id: 'm1', startAt: START, notifyOffsetMin: 2, status: 'scheduled' }, NOW);
    expect(out.action).toBe('scheduled');
    expect(q.jobs.size).toBe(1);
    const job = q.jobs.get('m1')!;
    expect(job.data).toEqual({ matchId: 'm1', trigger: 'scheduled' });
    expect(job.delay).toBe(min(28)); // 8:58 PM IST
  });

  it('reschedule: removes the old job and re-adds it with the new delay', async () => {
    await upsertMatchJob(q, { id: 'm1', startAt: START, notifyOffsetMin: 2, status: 'scheduled' }, NOW);
    const later = new Date(START.getTime() + min(60));
    await upsertMatchJob(q, { id: 'm1', startAt: later, notifyOffsetMin: 5, status: 'scheduled' }, NOW);
    expect(q.jobs.size).toBe(1);
    expect(q.jobs.get('m1')!.delay).toBe(min(85));
  });

  it('reschedule after the old job already completed still re-adds it', async () => {
    await upsertMatchJob(q, { id: 'm1', startAt: START, notifyOffsetMin: 2, status: 'scheduled' }, NOW);
    q.jobs.get('m1')!.state = 'completed';
    await upsertMatchJob(q, { id: 'm1', startAt: new Date(START.getTime() + min(10)), notifyOffsetMin: 2, status: 'scheduled' }, NOW);
    expect(q.jobs.get('m1')!.state).toBe('delayed');
    expect(q.jobs.get('m1')!.delay).toBe(min(38));
  });

  it('cancel: removes the job', async () => {
    await upsertMatchJob(q, { id: 'm1', startAt: START, notifyOffsetMin: 2, status: 'scheduled' }, NOW);
    await removeMatchJob(q, 'm1');
    expect(q.jobs.size).toBe(0);
  });

  it('editing a cancelled match does not schedule anything', async () => {
    const out = await upsertMatchJob(q, { id: 'm1', startAt: START, notifyOffsetMin: 2, status: 'cancelled' }, NOW);
    expect(out.action).toBe('removed');
    expect(q.jobs.size).toBe(0);
  });

  it('fires immediately when the notify time is already past but the match has not started', async () => {
    const soon = new Date(NOW.getTime() + min(1));
    const out = await upsertMatchJob(q, { id: 'm1', startAt: soon, notifyOffsetMin: 2, status: 'scheduled' }, NOW);
    expect(out.action === 'scheduled' && out.delayMs).toBe(0);
  });

  it('does not schedule a match that already started or was already notified', async () => {
    await upsertMatchJob(q, { id: 'm1', startAt: new Date(NOW.getTime() - 1), notifyOffsetMin: 2, status: 'scheduled' }, NOW);
    await upsertMatchJob(q, { id: 'm2', startAt: START, notifyOffsetMin: 2, status: 'scheduled', notifiedAt: NOW }, NOW);
    expect(q.jobs.size).toBe(0);
  });

  it('never removes an active job (it is mid-send and dispatch is idempotent)', async () => {
    await upsertMatchJob(q, { id: 'm1', startAt: START, notifyOffsetMin: 2, status: 'scheduled' }, NOW);
    q.jobs.get('m1')!.state = 'active';
    await removeMatchJob(q, 'm1');
    expect(q.jobs.has('m1')).toBe(true);
  });

  it('send-now jobs get their own id and never clash with the delayed job', async () => {
    await upsertMatchJob(q, { id: 'm1', startAt: START, notifyOffsetMin: 2, status: 'scheduled' }, NOW);
    const id = await enqueueImmediate(q, { matchId: 'm1', trigger: 'manual' }, NOW);
    expect(id).not.toBe('m1');
    expect(q.jobs.size).toBe(2);
  });
});

describe('dispatch: who gets notified', () => {
  let repo: MemoryRepo;
  let fcm: FakeProvider;
  let tg: FakeProvider;
  let deps: DispatchDeps;
  const FIRE = new Date(START.getTime() - min(2));
  const players = ['akshay', 'dheeraj', 'bittu', 'vasanth', 'vignesh'];

  beforeEach(() => {
    repo = new MemoryRepo();
    for (const p of [...players, 'cap']) repo.users.set(p, user(p));
    repo.captains.set('team', 'cap');
    repo.matches.set('m1', {
      id: 'm1', teamId: 'team', title: 'Scrim 1', map: 'Erangel', startAt: START, notifyOffsetMin: 2,
      roomId: '4471823', roomPassword: 'rare21', status: 'scheduled', notifiedAt: null,
    });
    repo.squads.set('m1', { selectedIds: ['akshay', 'dheeraj', 'bittu', 'vasanth'], confirmed: true });
    fcm = new FakeProvider('fcm', (r) => r.fcmTokens.length > 0);
    tg = new FakeProvider('telegram', (r) => Boolean(r.telegramChatId));
    deps = { repo, providers: [fcm, tg], now: () => FIRE };
  });

  it('notifies exactly the 4 selected players; the benched player gets nothing', async () => {
    const res = await dispatchMatch('m1', { trigger: 'scheduled' }, deps);
    expect(res.outcome).toBe('squad');
    expect(res.sent.sort()).toEqual(['akshay', 'bittu', 'dheeraj', 'vasanth']);
    expect(fcm.calls.map((c) => c.userId)).not.toContain('vignesh');
    expect(tg.calls).toHaveLength(0);
    expect(repo.matches.get('m1')!.status).toBe('notified');
  });

  it('builds the expected notification content in IST', async () => {
    await dispatchMatch('m1', { trigger: 'scheduled' }, deps);
    expect(fcm.calls[0].title).toBe('Match in 2 minutes!');
    expect(fcm.calls[0].body).toBe('Scrim 1 · Erangel · 9:00 PM. Join the lobby now. Room: 4471823 / Pass: rare21');
  });

  it('duplicate prevention: running twice sends nothing new', async () => {
    await dispatchMatch('m1', { trigger: 'scheduled' }, deps);
    const second = await dispatchMatch('m1', { trigger: 'manual' }, deps);
    expect(second.sent).toHaveLength(0);
    expect(second.alreadySent).toHaveLength(4);
    expect(fcm.calls).toHaveLength(4);
    expect(repo.logs.filter((l) => l.status === 'sent')).toHaveLength(4);
  });

  it('duplicate prevention: concurrent runs still produce one sent log per player', async () => {
    await Promise.all([
      dispatchMatch('m1', { trigger: 'scheduled' }, deps),
      dispatchMatch('m1', { trigger: 'manual' }, deps),
    ]);
    const sent = repo.logs.filter((l) => l.status === 'sent');
    expect(new Set(sent.map((l) => l.userId)).size).toBe(4);
    expect(sent).toHaveLength(4);
    expect(fcm.calls).toHaveLength(4); // nobody got two pushes
  });

  it('falls back to Telegram when FCM fails, and logs both attempts', async () => {
    fcm.failFor.add('bittu');
    const res = await dispatchMatch('m1', { trigger: 'scheduled' }, deps);
    expect(res.sent).toContain('bittu');
    const bittuLogs = repo.logs.filter((l) => l.userId === 'bittu');
    expect(bittuLogs.map((l) => [l.channel, l.status])).toEqual([['fcm', 'failed'], ['telegram', 'sent']]);
  });

  it('falls back to Telegram when the player has no FCM token', async () => {
    repo.users.get('vasanth')!.fcmTokens = [];
    await dispatchMatch('m1', { trigger: 'scheduled' }, deps);
    expect(repo.logs.find((l) => l.userId === 'vasanth')).toMatchObject({ channel: 'telegram', status: 'sent' });
  });

  it('logs a failure when a player is unreachable, and "resend to failed" only retries them', async () => {
    Object.assign(repo.users.get('dheeraj')!, { fcmTokens: [], telegramChatId: null });
    const first = await dispatchMatch('m1', { trigger: 'scheduled' }, deps);
    expect(first.failed).toEqual(['dheeraj']);
    expect(repo.logs.find((l) => l.userId === 'dheeraj')).toMatchObject({ channel: 'none', status: 'failed' });

    repo.users.get('dheeraj')!.telegramChatId = 'chat-dheeraj';
    fcm.calls = []; tg.calls = [];
    const retry = await dispatchMatch('m1', { trigger: 'resend' }, deps);
    expect(retry.sent).toEqual(['dheeraj']);
    expect([...fcm.calls, ...tg.calls].map((c) => c.userId)).toEqual(['dheeraj']);
  });

  it('no confirmed squad: alerts the captain only, once, and leaves the squad unlocked', async () => {
    repo.squads.get('m1')!.confirmed = false;
    const res = await dispatchMatch('m1', { trigger: 'scheduled' }, deps);
    expect(res.outcome).toBe('captain_alert');
    expect(fcm.calls.map((c) => c.userId)).toEqual(['cap']);
    expect(fcm.calls[0].title).toBe('Squad not confirmed!');
    expect(repo.matches.get('m1')!.notifiedAt).toBeNull();
    await dispatchMatch('m1', { trigger: 'scheduled' }, deps);
    expect(fcm.calls).toHaveLength(1);
  });

  it('send-now refuses without a confirmed squad', async () => {
    repo.squads.delete('m1');
    const res = await dispatchMatch('m1', { trigger: 'manual' }, deps);
    expect(res.outcome).toBe('skipped');
    expect(fcm.calls).toHaveLength(0);
  });

  it('skips cancelled matches', async () => {
    repo.matches.get('m1')!.status = 'cancelled';
    const res = await dispatchMatch('m1', { trigger: 'scheduled' }, deps);
    expect(res.outcome).toBe('skipped');
    expect(fcm.calls).toHaveLength(0);
  });

  it('ignores a stale scheduled job after a reschedule moved the match later', async () => {
    repo.matches.get('m1')!.startAt = new Date(START.getTime() + min(30));
    const res = await dispatchMatch('m1', { trigger: 'scheduled' }, deps);
    expect(res.reason).toMatch(/stale/);
    expect(fcm.calls).toHaveLength(0);
  });

  it('emergency substitute: only the incoming player is notified after the lock', async () => {
    await dispatchMatch('m1', { trigger: 'scheduled' }, deps);
    repo.squads.get('m1')!.selectedIds = ['akshay', 'dheeraj', 'bittu', 'vignesh'];
    fcm.calls = [];
    const res = await dispatchMatch('m1', { trigger: 'substitute', onlyUserIds: ['vignesh'] }, deps);
    expect(res.sent).toEqual(['vignesh']);
    expect(fcm.calls.map((c) => c.userId)).toEqual(['vignesh']);
  });

  it('prunes dead FCM tokens reported by the provider', async () => {
    fcm.send = async (r) => ({ ok: false, error: 'dead', invalidTokens: r.fcmTokens });
    await dispatchMatch('m1', { trigger: 'scheduled' }, deps);
    expect(repo.users.get('akshay')!.fcmTokens).toEqual([]);
    expect(repo.logs.find((l) => l.userId === 'akshay' && l.status === 'sent')!.channel).toBe('telegram');
  });
});
