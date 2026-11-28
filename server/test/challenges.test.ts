import { describe, expect, it, vi } from 'vitest';
import { askAtFor, badgeShelf, CHALLENGES, challengeByKey, challengeOptions, dailyChallenge, dayKeyIST, MINUTES_PER_MATCH } from '../src/lib/challengeCatalog.js';
import { announceResult, begunKeyboard, deliverBegunPrompt, doneKeyboard } from '../src/lib/challenges.js';
import { deliverInvite, INVITE_TTL_MS } from '../src/lib/invites.js';
import { user } from './fakes.js';

const TEAM = '65a000000000000000000001';

describe('challenge catalog', () => {
  it('has unique keys and covers Classic, WOW and TDM', () => {
    expect(new Set(CHALLENGES.map((c) => c.key)).size).toBe(CHALLENGES.length);
    expect(new Set(CHALLENGES.map((c) => c.mode))).toEqual(new Set(['Classic', 'WOW', 'TDM']));
    expect(challengeByKey('kills-25-in-3')?.matches).toBe(3);
    expect(challengeByKey('nope')).toBeNull();
  });

  it('keeps the same daily challenge all day and changes it on other days', () => {
    expect(dailyChallenge(TEAM, '2026-11-28').key).toBe(dailyChallenge(TEAM, '2026-11-28').key);
    const week = new Set(Array.from({ length: 14 }, (_, i) => dailyChallenge(TEAM, `2026-12-${String(i + 1).padStart(2, '0')}`).key));
    expect(week.size).toBeGreaterThan(3);
  });

  it('uses India time for the day', () => {
    expect(dayKeyIST(new Date('2026-11-28T18:29:00Z'))).toBe('2026-11-28');
    expect(dayKeyIST(new Date('2026-11-28T18:31:00Z'))).toBe('2026-11-29');
  });

  it('offers Classic picks, with the daily challenge first when it is a Classic one', () => {
    for (let d = 1; d <= 20; d++) {
      const day = `2026-12-${String(d).padStart(2, '0')}`;
      const opts = challengeOptions(TEAM, 4, day, () => 0.3);
      const daily = dailyChallenge(TEAM, day);
      expect(opts).toHaveLength(4);
      expect(new Set(opts.map((o) => o.key)).size).toBe(4);
      if (daily.mode === 'Classic') expect(opts[0].key).toBe(daily.key);
      expect(opts.every((o) => o.mode === 'Classic')).toBe(true);
    }
  });

  it('asks after the invite window plus the match time', () => {
    const at = askAtFor(new Date('2026-11-28T15:00:00Z'), 3, INVITE_TTL_MS);
    expect(at.getTime() - Date.parse('2026-11-28T15:00:00Z')).toBe(INVITE_TTL_MS + 3 * MINUTES_PER_MATCH * 60_000);
  });

  it('groups completed challenges into a badge shelf, gold first', () => {
    const shelf = badgeShelf([
      { challengeKey: 'pan-kill', completedAt: '2026-11-20T10:00:00Z' },
      { challengeKey: 'chicken-dinner', daily: true, completedAt: '2026-11-21T10:00:00Z' },
      { challengeKey: 'pan-kill', completedAt: '2026-11-22T10:00:00Z' },
      { challengeKey: 'gone-challenge' },
    ]);
    expect(shelf.map((b) => [b.key, b.count])).toEqual([['chicken-dinner', 1], ['pan-kill', 2]]);
    expect(shelf[0].daily).toBe(1);
    expect(shelf[1].lastAt).toBe('2026-11-22T10:00:00.000Z');
  });
});

describe('challenge messages', () => {
  const c = challengeByKey('everyone-3-kills')!;

  it('puts the picked challenge in the invite', async () => {
    const telegram = vi.fn(async () => true);
    await deliverInvite({ id: 'a'.repeat(24), message: '', fromIgn: 'VIVEK', challenge: c }, [user('u1')], { push: async () => true, telegram });
    expect((telegram.mock.calls[0] as unknown as [string, string])[1]).toContain('Challenge: Everyone gets 3 kills');
  });

  it('asks "Did the match begin?" on push, Telegram and the Inbox, with yes / no buttons', async () => {
    const push = vi.fn(async () => true);
    const telegram = vi.fn(async () => true);
    const inbox = vi.fn(async () => undefined);
    await deliverBegunPrompt('b'.repeat(24), c, [user('u1'), user('u2', { telegramChatId: null })], { push, telegram, inbox });
    expect(push).toHaveBeenCalledTimes(2);
    expect(telegram).toHaveBeenCalledTimes(1);
    const [, html, kb] = telegram.mock.calls[0] as unknown as [string, string, ReturnType<typeof begunKeyboard>];
    expect(html).toContain('Did the match begin?');
    expect(kb.inline_keyboard[0].map((b) => b.callback_data)).toEqual([`chb:${'b'.repeat(24)}:y`, `chb:${'b'.repeat(24)}:n`]);
    expect(doneKeyboard('x').inline_keyboard[0][0].callback_data).toBe('chd:x:y');
    expect((inbox.mock.calls[0] as unknown as [string[], { kind: string }])[1].kind).toBe('challenge');
  });

  it('announces a badge to the whole squad, and only notes a miss in the Inbox', async () => {
    const push = vi.fn(async () => true);
    const telegram = vi.fn(async () => true);
    const inbox = vi.fn(async () => undefined);
    await announceResult('c'.repeat(24), c, 'completed', 'VIVEK', [user('u1'), user('u2')], { push, telegram, inbox });
    expect(push).toHaveBeenCalledTimes(2);
    expect((push.mock.calls[0] as unknown as [unknown, { title: string }])[1].title).toContain('No Passengers');
    push.mockClear();
    await announceResult('c'.repeat(24), c, 'failed', 'VIVEK', [user('u1')], { push, telegram, inbox });
    expect(push).not.toHaveBeenCalled();
    expect(inbox).toHaveBeenCalledTimes(2);
  });
});
