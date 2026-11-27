import { matchPoints } from './points.js';
import { dayKey, dayRange } from './dailySummary.js';
import { seriesKey } from './seriesName.js';
import { isCompleted } from './matchGroups.js';

/**
 * Match calendar and day-by-day points tables: pure helpers (no DB) so they are easy to test.
 * The route that loads the data is GET /api/matches/calendar.
 */

export { PLACEMENT_POINTS, POINTS_PER_KILL, placementPoints } from './points.js';

/** "2026-11" → [first day of the month, first day of the next month) in `tz`. */
export function monthRange(month: string, tz: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { start: dayRange(`${month}-01`, tz).start, end: dayRange(next, tz).start };
}

export function isMonthKey(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

export interface CalendarInputMatch {
  id: string;
  title: string;
  tournamentName?: string | null;
  type: string;
  map: string;
  startAt: Date;
  status: string;
  placement?: number | null;
}

export interface CalendarInputStat {
  matchId: string;
  userId: string;
  kills: number;
  damage: number;
  assists: number;
  mvp: boolean;
}

export interface CalendarMatch {
  id: string;
  title: string;
  /** Scrim / tournament name the match is grouped under (falls back to the match title). */
  series: string;
  seriesKey: string;
  type: string;
  map: string;
  startAt: string;
  status: string;
  placement: number | null;
  /** Team finishes from the saved scorecard; null when no scorecard was saved. */
  kills: number | null;
  placementPts: number;
  killPts: number;
  total: number;
  /** True once a placement or a scorecard is saved. */
  hasResult: boolean;
  /** Finished (see isCompleted). Only completed matches count toward points, totals and player numbers. */
  completed: boolean;
  stats: { userId: string; kills: number; damage: number; assists: number; mvp: boolean }[];
}

export interface DayTotals {
  /** Completed matches. */
  matches: number;
  /** Matches this day that haven't finished yet (upcoming or still running). */
  upcoming: number;
  withResult: number;
  kills: number;
  placementPts: number;
  killPts: number;
  total: number;
  /** Number of #1 finishes. */
  wins: number;
  bestPlacement: number | null;
}

export interface CalendarPlayerDay {
  userId: string;
  matches: number;
  kills: number;
  damage: number;
  assists: number;
  mvps: number;
}

export interface CalendarDay {
  day: string;
  matches: CalendarMatch[];
  totals: DayTotals;
  players: CalendarPlayerDay[];
}

export function buildCalendarMatch(m: CalendarInputMatch, stats: CalendarInputStat[], now = Date.now()): CalendarMatch {
  const series = (m.tournamentName ?? '').trim() || m.title.trim();
  const completed = isCompleted(m, stats.length > 0, now);
  // Nothing counts until the match is finished.
  const counted = completed ? stats : [];
  const kills = counted.length ? counted.reduce((a, s) => a + (s.kills || 0), 0) : null;
  const placement = completed ? m.placement ?? null : null;
  const { placementPts, killPts, total } = matchPoints(placement, kills);
  return {
    id: m.id,
    title: m.title,
    series,
    seriesKey: seriesKey(series) || m.id,
    type: m.type,
    map: m.map,
    startAt: m.startAt.toISOString(),
    status: m.status,
    placement,
    kills,
    placementPts,
    killPts,
    total,
    hasResult: placement != null || kills != null,
    completed,
    stats: counted.map((s) => ({ userId: s.userId, kills: s.kills || 0, damage: s.damage || 0, assists: s.assists || 0, mvp: Boolean(s.mvp) })),
  };
}

export function sumTotals(all: CalendarMatch[]): DayTotals {
  const matches = all.filter((m) => m.completed);
  const placed = matches.map((m) => m.placement).filter((p): p is number => p != null && p > 0);
  return {
    matches: matches.length,
    upcoming: all.length - matches.length,
    withResult: matches.filter((m) => m.hasResult).length,
    kills: matches.reduce((a, m) => a + (m.kills ?? 0), 0),
    placementPts: matches.reduce((a, m) => a + m.placementPts, 0),
    killPts: matches.reduce((a, m) => a + m.killPts, 0),
    total: matches.reduce((a, m) => a + m.total, 0),
    wins: placed.filter((p) => p === 1).length,
    bestPlacement: placed.length ? Math.min(...placed) : null,
  };
}

function playerTotals(matches: CalendarMatch[]): CalendarPlayerDay[] {
  const by = new Map<string, CalendarPlayerDay>();
  for (const m of matches) {
    if (!m.completed) continue;
    for (const s of m.stats) {
      const p = by.get(s.userId) ?? { userId: s.userId, matches: 0, kills: 0, damage: 0, assists: 0, mvps: 0 };
      p.matches += 1;
      p.kills += s.kills;
      p.damage += s.damage;
      p.assists += s.assists;
      if (s.mvp) p.mvps += 1;
      by.set(s.userId, p);
    }
  }
  return [...by.values()].sort((a, b) => b.kills - a.kills || b.damage - a.damage);
}

/** Group the month's matches by day (in `tz`), oldest first, each with its points table. */
export function buildCalendarDays(matches: CalendarInputMatch[], stats: CalendarInputStat[], tz: string, now = Date.now()): CalendarDay[] {
  const statsBy = new Map<string, CalendarInputStat[]>();
  for (const s of stats) statsBy.set(s.matchId, [...(statsBy.get(s.matchId) ?? []), s]);
  const days = new Map<string, CalendarMatch[]>();
  for (const m of [...matches].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())) {
    const k = dayKey(m.startAt, tz);
    days.set(k, [...(days.get(k) ?? []), buildCalendarMatch(m, statsBy.get(m.id) ?? [], now)]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, ms]) => ({ day, matches: ms, totals: sumTotals(ms), players: playerTotals(ms) }));
}
