import { describe, expect, it } from 'vitest';
import { batchSlotTargets, isCompleted, nightKey } from '../src/lib/matchGroups.js';

const TZ = 'Asia/Kolkata';
const at = (iso: string) => new Date(iso);

describe('scrim night', () => {
  it('keeps after-midnight matches on the evening before', () => {
    expect(nightKey(at('2026-11-27T14:30:00Z'), TZ)).toBe('2026-11-27'); // 8 PM IST
    expect(nightKey(at('2026-11-27T19:30:00Z'), TZ)).toBe('2026-11-27'); // 1 AM IST on the 28th
    expect(nightKey(at('2026-11-28T01:30:00Z'), TZ)).toBe('2026-11-28'); // 7 AM IST on the 28th
  });
});

describe('shared slot across a bulk add', () => {
  const m1 = { id: '1', batchId: 'b', startAt: at('2026-11-27T14:30:00Z'), status: 'scheduled', slot: '12' };
  const others = [
    { id: '2', batchId: 'b', startAt: at('2026-11-27T15:30:00Z'), status: 'scheduled', slot: '' },
    { id: '3', batchId: 'b', startAt: at('2026-11-27T18:30:00Z'), status: 'notified', slot: '7' }, // midnight IST, same night
    { id: '4', batchId: 'b', startAt: at('2026-11-28T14:30:00Z'), status: 'scheduled', slot: '' }, // next day of a repeat
    { id: '5', batchId: 'b', startAt: at('2026-11-27T13:30:00Z'), status: 'done', slot: '' }, // already played
    { id: '6', batchId: 'other', startAt: at('2026-11-27T16:30:00Z'), status: 'scheduled', slot: '' },
    { id: '7', batchId: 'b', startAt: at('2026-11-27T16:30:00Z'), status: 'scheduled', slot: '12' }, // already set
  ];

  it('applies to unfinished matches from the same add on the same night', () => {
    expect(batchSlotTargets(m1, others, '12', TZ).map((m) => m.id)).toEqual(['2', '3']);
  });

  it('does nothing for a match that was added on its own', () => {
    expect(batchSlotTargets({ ...m1, batchId: null }, others, '12', TZ)).toEqual([]);
  });
});

describe('completed', () => {
  const now = Date.parse('2026-11-27T15:00:00Z');
  it('needs the match to be done, or started with a result', () => {
    expect(isCompleted({ status: 'done', startAt: at('2026-11-27T14:00:00Z') }, false, now)).toBe(true);
    expect(isCompleted({ status: 'live', startAt: at('2026-11-27T14:00:00Z') }, false, now)).toBe(false);
    expect(isCompleted({ status: 'live', startAt: at('2026-11-27T14:00:00Z') }, true, now)).toBe(true);
    expect(isCompleted({ status: 'scheduled', startAt: at('2026-11-27T16:00:00Z'), placement: 1 }, true, now)).toBe(false);
    expect(isCompleted({ status: 'cancelled', startAt: at('2026-11-27T14:00:00Z') }, true, now)).toBe(false);
  });
});
