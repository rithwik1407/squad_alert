import { describe, expect, it } from 'vitest';
import { buildCalendarDays, isMonthKey, monthRange, placementPoints } from '../src/lib/calendar.js';
import { matchPoints } from '../src/lib/points.js';

const TZ = 'Asia/Kolkata';

describe('match points', () => {
  it('adds position points and 1 point per kill', () => {
    expect(matchPoints(1, 8)).toEqual({ placementPts: 10, killPts: 8, total: 18 });
    expect(matchPoints(12, 3)).toEqual({ placementPts: 0, killPts: 3, total: 3 });
    expect(matchPoints(null, null)).toEqual({ placementPts: 0, killPts: 0, total: 0 });
  });
});

describe('placement points', () => {
  it('uses the standard BGMI table', () => {
    expect(placementPoints(1)).toBe(10);
    expect(placementPoints(2)).toBe(6);
    expect(placementPoints(8)).toBe(1);
    expect(placementPoints(9)).toBe(0);
    expect(placementPoints(null)).toBe(0);
  });
});

describe('month range', () => {
  it('covers the month in IST', () => {
    const { start, end } = monthRange('2026-11', TZ);
    expect(start.toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-11-30T18:30:00.000Z');
    expect(monthRange('2026-12', TZ).end.toISOString()).toBe('2026-12-31T18:30:00.000Z');
  });
  it('validates keys', () => {
    expect(isMonthKey('2026-11')).toBe(true);
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey('x')).toBe(false);
  });
});

describe('calendar days', () => {
  it('groups by IST day and totals points', () => {
    const days = buildCalendarDays(
      [
        // 11:30 PM IST on the 21st
        { id: 'a', title: 'Match 1', tournamentName: 'EG Scrims', type: 'scrim', map: 'Erangel', startAt: new Date('2026-11-21T18:00:00Z'), status: 'done', placement: 1 },
        // 12:30 AM IST on the 22nd
        { id: 'b', title: 'Match 2', tournamentName: 'eg scrims', type: 'scrim', map: 'Miramar', startAt: new Date('2026-11-21T19:00:00Z'), status: 'done', placement: 4 },
        { id: 'c', title: 'Solo', tournamentName: '', type: 'scrim', map: 'TBD', startAt: new Date('2026-11-21T20:00:00Z'), status: 'scheduled', placement: null },
      ],
      [
        { matchId: 'a', userId: 'u1', kills: 5, damage: 800, assists: 1, mvp: true },
        { matchId: 'a', userId: 'u2', kills: 3, damage: 400, assists: 2, mvp: false },
        { matchId: 'b', userId: 'u1', kills: 2, damage: 300, assists: 0, mvp: false },
      ],
      TZ,
    );
    expect(days.map((d) => d.day)).toEqual(['2026-11-21', '2026-11-22']);
    expect(days[0].totals).toMatchObject({ matches: 1, kills: 8, placementPts: 10, killPts: 8, total: 18, wins: 1 });
    const d2 = days[1];
    expect(d2.matches[0].seriesKey).toBe(days[0].matches[0].seriesKey);
    expect(d2.matches[1]).toMatchObject({ series: 'Solo', kills: null, total: 0, hasResult: false });
    expect(d2.totals).toMatchObject({ matches: 2, withResult: 1, total: 6, bestPlacement: 4 });
    expect(d2.players).toEqual([{ userId: 'u1', matches: 1, kills: 2, damage: 300, assists: 0, mvps: 0 }]);
  });
});
