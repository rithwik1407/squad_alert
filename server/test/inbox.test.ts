import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dispatchMatch, type DispatchDeps } from '../src/scheduler/dispatch.js';
import { announceReply, deliverInvite } from '../src/lib/invites.js';
import { FakeProvider, MemoryRepo, user } from './fakes.js';

const START = new Date('2026-11-19T15:30:00.000Z');
const FIRE = new Date(START.getTime() - 2 * 60_000);

describe('inbox: every phone alert is copied to each member it went to', () => {
  let repo: MemoryRepo;
  let fcm: FakeProvider;
  let deps: DispatchDeps;

  beforeEach(() => {
    repo = new MemoryRepo();
    for (const p of ['a', 'b', 'c', 'd', 'bench']) repo.users.set(p, user(p));
    repo.users.set('nopush', user('nopush', { fcmTokens: [], telegramChatId: null }));
    repo.captains.set('team', 'cap');
    repo.matches.set('m1', {
      id: 'm1', teamId: 'team', title: 'Scrim 1', map: 'Erangel', startAt: START, notifyOffsetMin: 2,
      roomId: '4471823', roomPassword: 'rare21', status: 'scheduled', notifiedAt: null,
    });
    repo.squads.set('m1', { selectedIds: ['a', 'b', 'c', 'nopush'], confirmed: true });
    fcm = new FakeProvider('fcm', (r) => r.fcmTokens.length > 0);
    deps = { repo, providers: [fcm], now: () => FIRE };
  });

  it('one squad alert gives exactly one inbox item per squad member, push on or off; benched gets none', async () => {
    fcm.failFor.add('b');
    await dispatchMatch('m1', { trigger: 'scheduled' }, deps);
    const owners = [...repo.inbox.values()].map((i) => i.userId).sort();
    expect(owners).toEqual(['a', 'b', 'c', 'nopush']);
    expect([...repo.inbox.values()].every((i) => i.kind === 'squad' && i.title.length > 0)).toBe(true);
  });

  it('running the alert again does not add a second copy', async () => {
    await dispatchMatch('m1', { trigger: 'scheduled' }, deps);
    await dispatchMatch('m1', { trigger: 'manual' }, deps);
    expect(repo.inbox.size).toBe(4);
  });

  it('a new room update replaces the older room item', async () => {
    await dispatchMatch('m1', { trigger: 'room' }, deps);
    repo.matches.get('m1')!.roomPassword = 'new99';
    await dispatchMatch('m1', { trigger: 'room' }, deps);
    const room = [...repo.inbox.values()].filter((i) => i.kind === 'room');
    expect(room).toHaveLength(4);
    expect(room.every((i) => i.body.includes('new99'))).toBe(true);
  });
});

describe('inbox: classic invites', () => {
  it('saves one invite item per invited teammate, even when push and Telegram both fail', async () => {
    const inbox = vi.fn(async (_ids: string[], _e: unknown) => undefined);
    await deliverInvite({ id: 'a'.repeat(24), message: 'Classic?', fromIgn: 'X' }, [user('u1'), user('u2')],
      { push: async () => false, telegram: async () => false, inbox });
    expect(inbox).toHaveBeenCalledTimes(1);
    expect(inbox.mock.calls[0]).toEqual([['u1', 'u2'], expect.objectContaining({ kind: 'invite', url: `/classic/${'a'.repeat(24)}` })]);
  });

  it('answers go to everyone else on the invite, not the person who answered', async () => {
    const inbox = vi.fn(async (_ids: string[], _e: unknown) => undefined);
    await announceReply({ id: 'b'.repeat(24), recipientsIn: 1 }, user('u1'), 'in', [user('u1'), user('u2'), user('cap')],
      { push: async () => true, telegram: async () => true, inbox });
    expect(inbox.mock.calls[0][0]).toEqual(['u2', 'cap']);
  });
});
