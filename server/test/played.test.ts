import { describe, expect, it } from 'vitest';
import { didPlay, playedUserIds } from '../src/lib/played.js';
import { buildCalendarDays } from '../src/lib/calendar.js';

describe('who played a match', () => {
  it('uses the posted results once there are any: picked but left out = not played', () => {
    expect(playedUserIds({ statsUserIds: ['a', 'b', 'c'], squadIds: ['a', 'b', 'c', 'd'], attendance: { d: false } })).toEqual(['a', 'b', 'c']);
    expect(playedUserIds({ statsUserIds: ['a', 'b'], squadIds: ['a', 'b', 'c', 'd'], attendance: {} })).toEqual(['a', 'b']);
  });
  it('drops an old zero row for someone marked not joined', () => {
    expect(playedUserIds({ statsUserIds: ['a', 'b'], squadIds: [], attendance: { b: false } })).toEqual(['a']);
  });
  it('falls back to the confirmed squad before results are posted', () => {
    expect(playedUserIds({ statsUserIds: [], squadIds: ['a', 'b', 'c', 'd'], attendance: new Map([['c', false]]) })).toEqual(['a', 'b', 'd']);
  });
  it('agrees for a single player', () => {
    expect(didPlay({ matchHasStats: true, hasStats: false, inSquad: true, joined: null })).toBe(false);
    expect(didPlay({ matchHasStats: true, hasStats: true, inSquad: false, joined: true })).toBe(true);
    expect(didPlay({ matchHasStats: false, hasStats: false, inSquad: true, joined: undefined })).toBe(true);
    expect(didPlay({ matchHasStats: false, hasStats: false, inSquad: true, joined: false })).toBe(false);
  });
});

describe('calendar player counts', () => {
  const at = new Date('2026-11-20T15:00:00Z');
  const base = { title: 'T1', type: 'scrim', map: 'erangel', startAt: at, status: 'done', placement: 2 };
  it('counts a match only for teammates who played, and guest kills only in the points', () => {
    const days = buildCalendarDays([
      { ...base, id: 'm1', squadIds: ['a', 'b', 'c', 'd'], attendance: { d: false }, guests: [{ kills: 4 }] },
      // No scorecard, just finished: the squad played, minus anyone marked absent.
      { ...base, id: 'm2', startAt: new Date(at.getTime() + 3600_000), placement: 5, squadIds: ['a', 'b', 'c', 'd'], attendance: { a: false } },
    ], [
      { matchId: 'm1', userId: 'a', kills: 3, damage: 400, assists: 1, mvp: true },
      { matchId: 'm1', userId: 'b', kills: 1, damage: 200, assists: 0, mvp: false },
      { matchId: 'm1', userId: 'c', kills: 0, damage: 50, assists: 0, mvp: false },
    ], 'Asia/Kolkata');
    const [day] = days;
    expect(day.matches[0].kills).toBe(8);
    expect(day.matches[0].guestCount).toBe(1);
    const n = Object.fromEntries(day.players.map((p) => [p.userId, p.matches]));
    expect(n).toEqual({ a: 1, b: 2, c: 2, d: 1 });
    expect(day.players.find((p) => p.userId === 'a')!.kills).toBe(3);
    expect(day.players.some((p) => p.userId.startsWith('guest'))).toBe(false);
  });
});
