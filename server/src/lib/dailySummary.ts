import { scoreMvp } from './mvp.js';
import { matchPoints } from './points.js';
import { formatTimeIST } from './time.js';

/**
 * Nightly team summary: pure helpers (no DB, no network) so they are easy to test.
 * The runner that loads data and sends it lives in scheduler/dailySummary.ts.
 */

// ── Days in the display time zone ────────────────────────────────────────────

function parts(d: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { y: +p.year, m: +p.month, d: +p.day, hour: +p.hour, minute: +p.minute };
}

/** "2026-11-21" for this instant in `tz`. */
export function dayKey(d: Date, tz: string): string {
  const { y, m, d: day } = parts(d, tz);
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Minutes `tz` is ahead of UTC at this instant (IST = 330). */
function offsetMin(d: Date, tz: string) {
  const p = parts(d, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(d.getTime() / 60_000) * 60_000) / 60_000);
}

/** Midnight of `y-m-d` in `tz`, as a UTC instant. */
function zonedMidnight(y: number, m: number, d: number, tz: string) {
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - offsetMin(new Date(guess), tz) * 60_000;
  return new Date(guess - offsetMin(new Date(first), tz) * 60_000);
}

/** [start, end) of a calendar day in `tz`. */
export function dayRange(key: string, tz: string): { start: Date; end: Date } {
  const [y, m, d] = key.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return {
    start: zonedMidnight(y, m, d, tz),
    end: zonedMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), tz),
  };
}

/** The day before `key`. */
export function previousDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * Which day's report is due at `now`: from 12:00 AM until `untilHour` (default noon) the
 * previous day's report is due, so a server that was asleep at midnight still sends it when it wakes.
 * Outside that window nothing is due.
 */
export function dueReportDay(now: Date, tz: string, untilHour = 12): string | null {
  if (parts(now, tz).hour >= untilHour) return null;
  return previousDay(dayKey(now, tz));
}

// ── Building the summary ─────────────────────────────────────────────────────

export interface SummaryMatch {
  id: string;
  title: string;
  type: string;
  map: string;
  startAt: Date;
  placement: number | null;
  tournamentName?: string;
}
export interface SummaryStat { matchId: string; userId: string; kills: number; damage: number; survivalMin: number; assists: number; mvp: boolean }
export interface SummaryPlayer { id: string; ign: string }

export interface PlayerTotal { userId: string; name: string; matches: number; kills: number; damage: number; assists: number; mvps: number }

export interface DailySummary {
  teamName: string;
  day: string;
  matchesPlayed: number;
  scrims: number;
  tournaments: number;
  withResults: number;
  totalKills: number;
  totalDamage: number;
  bestPlacement: { placement: number; title: string } | null;
  avgPlacement: number | null;
  /** Points table for the day: placement points + 1 per kill, summed over the matches. */
  points: { placement: number; kills: number; total: number };
  mvp: PlayerTotal | null;
  topFragger: PlayerTotal | null;
  players: PlayerTotal[];
  matches: { title: string; type: string; map: string; startAt: Date; placement: number | null; kills: number | null; points: number; mvpName: string | null }[];
}

const SEP = /[|丨｜ǀ┃│]/;
/** "RARE丨BITTU" → "BITTU" (the team tag is the same for everyone). */
export function shortName(ign: string) {
  const bits = ign.split(SEP).map((s) => s.trim()).filter(Boolean);
  return bits[bits.length - 1] || ign.trim() || 'Player';
}

export function buildDailySummary(input: {
  teamName: string;
  day: string;
  matches: SummaryMatch[];
  stats: SummaryStat[];
  players: SummaryPlayer[];
}): DailySummary {
  const { matches, stats } = input;
  const nameOf = new Map(input.players.map((p) => [p.id, shortName(p.ign)]));
  const ids = new Set(matches.map((m) => m.id));
  const dayStats = stats.filter((s) => ids.has(s.matchId));

  const totals = new Map<string, PlayerTotal & { survivalMin: number }>();
  for (const s of dayStats) {
    const t = totals.get(s.userId) ?? {
      userId: s.userId, name: nameOf.get(s.userId) ?? 'Player', matches: 0, kills: 0, damage: 0, assists: 0, mvps: 0, survivalMin: 0,
    };
    t.matches += 1;
    t.kills += s.kills || 0;
    t.damage += s.damage || 0;
    t.assists += s.assists || 0;
    t.survivalMin += s.survivalMin || 0;
    if (s.mvp) t.mvps += 1;
    totals.set(s.userId, t);
  }
  const rows = [...totals.values()];

  // MVP of the day: most match MVPs, then the same weighted score the app uses per match, over the day's totals.
  const { rows: scored } = scoreMvp(rows);
  const scoreOf = new Map(scored.map((r) => [r.userId, r.mvpScore]));
  const mvpRow = [...rows].sort((a, b) => b.mvps - a.mvps || scoreOf.get(b.userId)! - scoreOf.get(a.userId)! || b.kills - a.kills)[0];
  const mvp = mvpRow && (mvpRow.mvps > 0 || scoreOf.get(mvpRow.userId)! > 0) ? mvpRow : null;
  const fragRow = [...rows].sort((a, b) => b.kills - a.kills || b.damage - a.damage)[0];
  const topFragger = fragRow && fragRow.kills > 0 ? fragRow : null;

  const placed = matches.filter((m) => m.placement != null && m.placement > 0);
  const best = [...placed].sort((a, b) => a.placement! - b.placement!)[0];
  const strip = ({ survivalMin: _s, ...p }: PlayerTotal & { survivalMin: number }): PlayerTotal => p;

  const listed = [...matches]
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .map((m) => {
      const ms = dayStats.filter((s) => s.matchId === m.id);
      const mvpStat = ms.find((s) => s.mvp);
      const kills = ms.length ? ms.reduce((a, s) => a + (s.kills || 0), 0) : null;
      return {
        title: m.title, type: m.type, map: m.map, startAt: m.startAt, placement: m.placement ?? null,
        kills, points: matchPoints(m.placement, kills).total,
        mvpName: mvpStat ? nameOf.get(mvpStat.userId) ?? null : null,
      };
    });
  const pts = listed.map((m) => matchPoints(m.placement, m.kills));

  return {
    teamName: input.teamName,
    day: input.day,
    matchesPlayed: matches.length,
    scrims: matches.filter((m) => m.type !== 'tournament').length,
    tournaments: matches.filter((m) => m.type === 'tournament').length,
    withResults: matches.filter((m) => dayStats.some((s) => s.matchId === m.id) || m.placement != null).length,
    totalKills: rows.reduce((a, r) => a + r.kills, 0),
    totalDamage: rows.reduce((a, r) => a + r.damage, 0),
    bestPlacement: best ? { placement: best.placement!, title: best.title } : null,
    avgPlacement: placed.length ? Math.round((placed.reduce((a, m) => a + m.placement!, 0) / placed.length) * 10) / 10 : null,
    mvp: mvp ? strip(mvp) : null,
    topFragger: topFragger ? strip(topFragger) : null,
    players: rows.sort((a, b) => b.kills - a.kills || b.damage - a.damage).map(strip),
    points: {
      placement: pts.reduce((a, p) => a + p.placementPts, 0),
      kills: pts.reduce((a, p) => a + p.killPts, 0),
      total: pts.reduce((a, p) => a + p.total, 0),
    },
    matches: listed,
  };
}

// ── Telegram message (HTML parse mode) ───────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const num = (n: number) => n.toLocaleString('en-IN');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function prettyDay(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/** Fixed-width cell. Telegram shows <pre> in a monospace font. */
const cell = (s: string, w: number, right = false) => {
  const t = [...s].length > w ? [...s].slice(0, w - 1).join('') + '…' : s;
  return right ? t.padStart(w) : t.padEnd(w);
};

export function renderDailySummary(s: DailySummary, tz: string): string {
  const out: string[] = [];
  out.push(`📊 <b>${esc(s.teamName)} · Daily Report</b>`);
  out.push(`📅 ${esc(prettyDay(s.day))}`);
  out.push('');

  const kinds = [s.scrims && plural(s.scrims, 'scrim'), s.tournaments && plural(s.tournaments, 'tournament')].filter(Boolean).join(', ');
  out.push(`🎮 <b>Matches played:</b> ${s.matchesPlayed}${kinds ? ` (${kinds})` : ''}`);
  if (s.withResults < s.matchesPlayed) out.push(`🗂 <b>Results uploaded:</b> ${s.withResults} of ${s.matchesPlayed}`);
  if (s.points.total > 0) {
    out.push(`🏆 <b>Points:</b> ${num(s.points.total)} (${num(s.points.placement)} placement + ${num(s.points.kills)} kills)`);
  }
  if (s.players.length) out.push(`💀 <b>Team finishes:</b> ${num(s.totalKills)}   💥 <b>Damage:</b> ${num(s.totalDamage)}`);
  if (s.bestPlacement) {
    out.push(`🏁 <b>Best placement:</b> #${s.bestPlacement.placement} (${esc(s.bestPlacement.title)})` +
      (s.avgPlacement != null && s.matches.filter((m) => m.placement).length > 1 ? `   avg #${s.avgPlacement}` : ''));
  }
  out.push('');

  if (s.mvp) {
    out.push(`⭐ <b>MVP of the day: ${esc(s.mvp.name)}</b>`);
    out.push(`    ${plural(s.mvp.kills, 'finish', 'finishes')} · ${num(s.mvp.damage)} dmg` +
      (s.mvp.mvps ? ` · MVP in ${plural(s.mvp.mvps, 'match', 'matches')}` : ''));
  }
  if (s.topFragger) {
    out.push(`🔫 <b>Top fragger: ${esc(s.topFragger.name)}</b>`);
    out.push(`    ${plural(s.topFragger.kills, 'finish', 'finishes')} in ${plural(s.topFragger.matches, 'match', 'matches')}`);
  }
  if (!s.mvp && !s.topFragger) out.push('ℹ️ No results uploaded yet, so there is no MVP or top fragger for today.');

  if (s.players.length) {
    out.push('');
    out.push('<b>Player board</b>');
    const lines = [`${cell('#', 2)} ${cell('Player', 10)} ${cell('M', 2, true)} ${cell('K', 3, true)} ${cell('Dmg', 6, true)} ${cell('MVP', 3, true)}`];
    s.players.forEach((p, i) => {
      lines.push(`${cell(String(i + 1), 2)} ${cell(p.name, 10)} ${cell(String(p.matches), 2, true)} ${cell(String(p.kills), 3, true)} ${cell(String(p.damage), 6, true)} ${cell(p.mvps ? String(p.mvps) : '-', 3, true)}`);
    });
    out.push(`<pre>${esc(lines.join('\n'))}</pre>`);
  }

  out.push('');
  out.push('<b>Matches</b>');
  const MAX_LISTED = 12; // keeps the message well under Telegram's 4096-character limit
  s.matches.slice(0, MAX_LISTED).forEach((m, i) => {
    const bits = [formatTimeIST(m.startAt, tz), m.map !== 'TBD' ? m.map : null].filter(Boolean).join(' · ');
    const result = [
      m.placement ? `#${m.placement}` : null,
      m.kills != null ? `${m.kills} K` : null,
      m.placement || m.kills != null ? `${m.points} pts` : null,
      m.mvpName ? `⭐ ${m.mvpName}` : null,
    ].filter(Boolean).join(' · ');
    out.push(`${i + 1}. ${esc(bits)} · ${esc(m.title)}${m.type === 'tournament' ? ' 🏆' : ''}`);
    out.push(`    ${result ? esc(result) : '<i>results pending</i>'}`);
  });
  if (s.matches.length > MAX_LISTED) out.push(`…and ${s.matches.length - MAX_LISTED} more`);

  out.push('');
  out.push('GG, see you in the next one 🔥');
  return out.join('\n');
}
