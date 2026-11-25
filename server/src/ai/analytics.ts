/**
 * Squad AI analytics: pure functions over a snapshot of the team's records (no DB, no LLM), so they are
 * easy to test and give the same numbers whether the model is online or not.
 */
import { matchPoints } from '../lib/points.js';
import type { Block, Kpi, Row, SquadPick, Tone } from './blocks.js';

export interface AiMember { id: string; ign: string; name: string; avatar: string; gameRole: string; role: string; inPool: boolean }
export interface AiMatch { id: string; title: string; tournamentName: string; type: string; map: string; startAt: Date; status: string; placement: number | null }
export interface AiStat { matchId: string; userId: string; kills: number; damage: number; assists: number; survivalMin: number; mvp: boolean; mvpScore: number }
export interface AiAttendance { matchId: string; userId: string; joined: boolean }
export interface AiAvailability { matchId: string; userId: string; status: string | null; joiningAt: Date | null; updatedAt: Date }
export interface AiSquad { matchId: string; selectedIds: string[]; confirmed: boolean }

export interface TeamData {
  tz: string;
  now: Date;
  members: AiMember[];
  /** Past (started) matches that weren't cancelled, newest first. */
  matches: AiMatch[];
  stats: AiStat[];
  attendance: AiAttendance[];
  availability: AiAvailability[];
  squads: AiSquad[];
}

export interface ToolOutput {
  /** Compact facts for the model to reason over. */
  facts: Record<string, unknown>;
  /** Plain-English headline + insights, used as the answer when no model is available. */
  summary: string;
  blocks: Block[];
}

export const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 1 });

export function localParts(d: Date, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: 'numeric', hour12: false, day: 'numeric', month: 'short',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  return { weekday: p.weekday as string, hour, day: `${p.day} ${p.month}` };
}

export const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;

export function matchLabel(m: AiMatch, tz: string) {
  const { day } = localParts(m.startAt, tz);
  return `${m.tournamentName || m.title} · ${day}`;
}

/* ───────────────────────── Per-player numbers ───────────────────────── */

export interface PlayerAgg {
  id: string; ign: string; played: number; kills: number; damage: number; assists: number; survivalMin: number; mvps: number;
  avgKills: number; avgDamage: number; avgAssists: number; avgSurvival: number; mvpRate: number; avgMvpScore: number; bestKills: number;
  /** Recency-weighted averages over the last 10 matches with stats. */
  formKills: number; formDamage: number; formMvp: number;
}

export function playerAggs(data: TeamData, matchIds?: Set<string>): Map<string, PlayerAgg> {
  const order = new Map(data.matches.map((m, i) => [m.id, i]));
  const out = new Map<string, PlayerAgg>();
  for (const mem of data.members) {
    const rows = data.stats
      .filter((s) => s.userId === mem.id && order.has(s.matchId) && (!matchIds || matchIds.has(s.matchId)))
      .sort((a, b) => order.get(a.matchId)! - order.get(b.matchId)!);
    const n = rows.length;
    const recent = rows.slice(0, 10);
    const w = recent.map((_, i) => 0.85 ** i);
    const wsum = sum(w) || 1;
    const wavg = (k: 'kills' | 'damage' | 'mvpScore') => sum(recent.map((s, i) => s[k] * w[i])) / wsum;
    out.set(mem.id, {
      id: mem.id, ign: mem.ign, played: n,
      kills: sum(rows.map((s) => s.kills)), damage: sum(rows.map((s) => s.damage)), assists: sum(rows.map((s) => s.assists)),
      survivalMin: sum(rows.map((s) => s.survivalMin)), mvps: rows.filter((s) => s.mvp).length,
      avgKills: r1(avg(rows.map((s) => s.kills))), avgDamage: Math.round(avg(rows.map((s) => s.damage))),
      avgAssists: r1(avg(rows.map((s) => s.assists))), avgSurvival: r1(avg(rows.map((s) => s.survivalMin))),
      mvpRate: n ? rows.filter((s) => s.mvp).length / n : 0, avgMvpScore: r1(avg(rows.map((s) => s.mvpScore))),
      bestKills: Math.max(0, ...rows.map((s) => s.kills)),
      formKills: n ? wavg('kills') : 0, formDamage: n ? wavg('damage') : 0, formMvp: n ? wavg('mvpScore') : 0,
    });
  }
  return out;
}

export function playerStatsTool(data: TeamData, onlyIds?: string[]): ToolOutput {
  const aggs = [...playerAggs(data).values()].filter((a) => !onlyIds?.length || onlyIds.includes(a.id));
  const ranked = [...aggs].sort((a, b) => b.avgMvpScore - a.avgMvpScore || b.avgKills - a.avgKills);
  const withData = ranked.filter((a) => a.played > 0);
  const rows: Row[] = ranked.map((a) => ({
    player: a.ign, played: a.played, kills: a.avgKills, damage: a.avgDamage, assists: a.avgAssists, survival: a.avgSurvival, mvps: a.mvps,
  }));
  const blocks: Block[] = [];
  if (withData.length) {
    blocks.push({
      type: 'table', title: 'Player averages', subtitle: `Last ${data.matches.length} matches with results`,
      columns: [
        { key: 'player', label: 'Player' }, { key: 'played', label: 'Played', align: 'right' }, { key: 'kills', label: 'Kills', align: 'right' },
        { key: 'damage', label: 'Damage', align: 'right' }, { key: 'assists', label: 'Assists', align: 'right' },
        { key: 'survival', label: 'Surv (min)', align: 'right' }, { key: 'mvps', label: 'MVPs', align: 'right' },
      ],
      rows, best: ['kills', 'damage', 'assists', 'survival', 'mvps'],
    });
    blocks.push({
      type: 'bar', title: 'Average kills and assists', xKey: 'player',
      series: [{ key: 'kills', label: 'Kills' }, { key: 'assists', label: 'Assists' }],
      data: withData.map((a) => ({ player: a.ign, kills: a.avgKills, assists: a.avgAssists })),
    });
  }
  const mvp = [...withData].sort((a, b) => b.mvps - a.mvps || b.avgMvpScore - a.avgMvpScore)[0];
  const top = [...withData].sort((a, b) => b.avgKills - a.avgKills)[0];
  const summary = withData.length
    ? `**${mvp.ign} leads with ${mvp.mvps} MVP${mvp.mvps === 1 ? '' : 's'}** over the last ${data.matches.length} matches.\n\n- Top fragger: ${top.ign} (${top.avgKills} kills, ${fmt(top.avgDamage)} damage a match).\n- ${withData.length} of ${aggs.length} players have results logged.`
    : 'No match results are logged yet. Add kills and damage on a finished match (or upload the results screenshot) and I can rank the players.';
  return { facts: { matchesConsidered: data.matches.length, players: aggs.map(({ formKills, formDamage, formMvp, ...a }) => a) }, summary, blocks };
}

/* ───────────────────────── Team performance ───────────────────────── */

export interface MatchLine { id: string; label: string; map: string; placement: number | null; kills: number; damage: number; points: number; survival: number; players: number }

export function matchLines(data: TeamData): MatchLine[] {
  return data.matches.map((m) => {
    const st = data.stats.filter((s) => s.matchId === m.id);
    const kills = sum(st.map((s) => s.kills));
    return {
      id: m.id, label: localParts(m.startAt, data.tz).day, map: m.map, placement: m.placement ?? null,
      kills, damage: sum(st.map((s) => s.damage)), points: matchPoints(m.placement, kills).total,
      survival: r1(avg(st.map((s) => s.survivalMin))), players: st.length,
    };
  }).filter((l) => l.players > 0 || l.placement != null);
}

export function performanceTool(data: TeamData): ToolOutput {
  const lines = matchLines(data);
  if (!lines.length) {
    return {
      facts: { matches: 0 },
      summary: 'There are no finished matches with results yet. Log placement and kills after a scrim and I can analyse trends, maps and weaknesses.',
      blocks: [],
    };
  }
  const placed = lines.filter((l) => l.placement != null);
  const avgPlace = placed.length ? r1(avg(placed.map((l) => l.placement!))) : null;
  const top4 = placed.length ? placed.filter((l) => l.placement! <= 4).length / placed.length : null;
  const wins = placed.filter((l) => l.placement === 1).length;
  const avgKills = r1(avg(lines.map((l) => l.kills)));
  const avgDmg = Math.round(avg(lines.map((l) => l.damage)));
  const avgPts = r1(avg(lines.map((l) => l.points)));

  // Newer half vs older half (lines are newest first).
  const half = Math.floor(lines.length / 2);
  const newer = lines.slice(0, half);
  const older = lines.slice(lines.length - half);
  const change = (k: 'kills' | 'damage' | 'points') => {
    if (half < 2) return null;
    const o = avg(older.map((l) => l[k]));
    return o > 0 ? Math.round(((avg(newer.map((l) => l[k])) - o) / o) * 100) : null;
  };
  const killDelta = change('kills');
  const ptsDelta = change('points');

  // Maps
  const byMap = new Map<string, MatchLine[]>();
  for (const l of lines) if (l.map !== 'TBD') byMap.set(l.map, [...(byMap.get(l.map) ?? []), l]);
  const maps = [...byMap.entries()].map(([map, ls]) => {
    const p = ls.filter((l) => l.placement != null);
    return {
      map, matches: ls.length, avgPlacement: p.length ? r1(avg(p.map((l) => l.placement!))) : null,
      avgKills: r1(avg(ls.map((l) => l.kills))), avgPoints: r1(avg(ls.map((l) => l.points))), avgSurvival: r1(avg(ls.map((l) => l.survival))),
    };
  }).sort((a, b) => b.avgPoints - a.avgPoints);
  const ranked = maps.filter((m) => m.matches >= 2);
  const bestMap = ranked[0];
  const worstMap = ranked.length > 1 ? ranked[ranked.length - 1] : undefined;
  const worstSurv = ranked.length > 1 ? [...ranked].sort((a, b) => a.avgSurvival - b.avgSurvival)[0] : undefined;

  const aggs = [...playerAggs(data).values()].filter((a) => a.played > 0);
  const fragger = [...aggs].sort((a, b) => b.avgKills - a.avgKills)[0];
  const assister = [...aggs].sort((a, b) => b.avgAssists - a.avgAssists)[0];

  const insights: { tone: Tone; title: string; text: string; tags?: string[] }[] = [];
  if (killDelta != null && Math.abs(killDelta) >= 8) {
    insights.push({ tone: killDelta < 0 ? 'bad' : 'good', title: `Kills ${killDelta < 0 ? 'down' : 'up'} ${Math.abs(killDelta)}%`,
      text: `Average team kills over the last ${half} matches vs the ${half} before.`, tags: ['Fights'] });
  }
  if (bestMap) insights.push({ tone: 'good', title: `Strongest on ${bestMap.map}`, text: `${bestMap.avgPoints} pts a match${bestMap.avgPlacement != null ? `, avg place #${bestMap.avgPlacement}` : ''} over ${bestMap.matches} matches.`, tags: ['Maps'] });
  if (worstMap && worstMap.map !== bestMap?.map) insights.push({ tone: 'bad', title: `Weakest on ${worstMap.map}`, text: `${worstMap.avgPoints} pts a match${worstMap.avgPlacement != null ? `, avg place #${worstMap.avgPlacement}` : ''}. Practise drops and rotations here.`, tags: ['Maps', 'Rotations'] });
  if (worstSurv && worstSurv.map !== worstMap?.map) insights.push({ tone: 'warn', title: `Short survival on ${worstSurv.map}`, text: `Players last ${worstSurv.avgSurvival} min on average there, the lowest of any map.`, tags: ['Survival'] });
  if (avgPlace != null && avgPlace > 8 && avgKills >= 8) insights.push({ tone: 'warn', title: 'Fights won, endgame lost', text: `${avgKills} kills a match but average place is #${avgPlace}. Late-zone positioning is costing placement points.`, tags: ['Zone', 'IGL'] });
  if (fragger) insights.push({ tone: 'info', title: `${fragger.ign} carries the frags`, text: `${fragger.avgKills} kills and ${fmt(fragger.avgDamage)} damage a match.`, tags: ['Players'] });
  if (assister && assister.id !== fragger?.id && assister.avgAssists >= 1) insights.push({ tone: 'good', title: `${assister.ign} sets up fights`, text: `Highest assists on the team at ${assister.avgAssists} a match.`, tags: ['Support'] });

  const kpis: Kpi[] = [
    { label: 'Matches', value: lines.length },
    { label: 'Avg place', value: avgPlace != null ? `#${avgPlace}` : '–', sub: top4 != null ? `Top 4 in ${pct(top4)}` : undefined },
    { label: 'Avg kills', value: avgKills, delta: killDelta },
    { label: 'Avg damage', value: avgDmg, delta: change('damage') },
    { label: 'Avg points', value: avgPts, delta: ptsDelta },
    { label: 'Chicken dinners', value: wins, tone: wins ? 'good' : undefined },
  ];
  const chrono = [...lines].reverse();
  const blocks: Block[] = [
    { type: 'kpis', title: `Last ${lines.length} matches`, items: kpis },
    { type: 'line', title: 'Performance trend', subtitle: 'Team kills and points per match', xKey: 'match', series: [{ key: 'kills', label: 'Kills' }, { key: 'points', label: 'Points' }],
      data: chrono.map((l, i) => ({ match: `${i + 1}`, date: l.label, kills: l.kills, points: l.points, place: l.placement })) },
  ];
  if (maps.length) {
    blocks.push({ type: 'bar', title: 'Map breakdown', subtitle: 'Average per match', xKey: 'map',
      series: [{ key: 'avgPoints', label: 'Points' }, { key: 'avgKills', label: 'Kills' }, { key: 'avgSurvival', label: 'Survival (min)' }],
      data: maps.map((m) => ({ map: m.map, avgPoints: m.avgPoints, avgKills: m.avgKills, avgSurvival: m.avgSurvival, matches: m.matches })) });
  }
  if (insights.length) blocks.push({ type: 'insights', title: 'What the data says', items: insights });

  const next = worstMap ? `Run ${worstMap.map} drops and first-rotation drills before the next scrim.`
    : avgPlace != null && avgPlace > 8 ? 'Practise final-zone rotations: placement is where points are leaking.'
      : 'Keep logging results so trends get sharper.';
  const summary = [
    `**${lines.length} matches analysed: avg place ${avgPlace != null ? `#${avgPlace}` : 'not logged'}, ${avgKills} kills, ${avgPts} points a match.**`,
    '',
    ...insights.slice(0, 4).map((i) => `- ${i.title}: ${i.text}`),
    '',
    `Next step: ${next}`,
  ].join('\n');
  return {
    facts: { matches: lines.length, avgPlacement: avgPlace, top4Rate: top4, wins, avgKills, avgDamage: avgDmg, avgPoints: avgPts, killChangePct: killDelta, pointsChangePct: ptsDelta, maps, topFragger: fragger?.ign, topAssists: assister?.ign, insights: insights.map((i) => `${i.title}. ${i.text}`) },
    summary, blocks,
  };
}

/* ───────────────────────── Player comparison ───────────────────────── */

export function compareTool(data: TeamData, a: AiMember, b: AiMember, lastN?: number): ToolOutput {
  const ids = lastN ? new Set(data.matches.slice(0, lastN).map((m) => m.id)) : undefined;
  const aggs = playerAggs(data, ids);
  const att = attendanceRows(data);
  const A = aggs.get(a.id)!, B = aggs.get(b.id)!;
  const metrics: { key: keyof PlayerAgg | 'reliability'; label: string; get: (p: PlayerAgg) => number }[] = [
    { key: 'avgKills', label: 'Avg kills', get: (p) => p.avgKills },
    { key: 'avgDamage', label: 'Avg damage', get: (p) => p.avgDamage },
    { key: 'avgAssists', label: 'Avg assists', get: (p) => p.avgAssists },
    { key: 'avgSurvival', label: 'Avg survival (min)', get: (p) => p.avgSurvival },
    { key: 'mvps', label: 'MVP count', get: (p) => p.mvps },
    { key: 'bestKills', label: 'Best kill game', get: (p) => p.bestKills },
    { key: 'played', label: 'Matches with stats', get: (p) => p.played },
  ];
  const rows: Row[] = metrics.map((m) => ({ metric: m.label, a: m.get(A), b: m.get(B) }));
  const relA = att.get(a.id)?.reliability, relB = att.get(b.id)?.reliability;
  rows.push({ metric: 'Show-up rate', a: relA != null ? `${Math.round(relA * 100)}%` : '–', b: relB != null ? `${Math.round(relB * 100)}%` : '–' });

  const all = [...aggs.values()].filter((p) => p.played);
  const norm = (k: keyof PlayerAgg, p: PlayerAgg) => {
    const max = Math.max(...all.map((x) => Number(x[k])), 0);
    return max > 0 ? Math.round((Number(p[k]) / max) * 100) : 0;
  };
  const axes: [keyof PlayerAgg, string][] = [['avgKills', 'Kills'], ['avgDamage', 'Damage'], ['avgAssists', 'Assists'], ['avgSurvival', 'Survival'], ['avgMvpScore', 'MVP score']];
  const radar = axes.map(([k, label]) => ({ axis: label, a: norm(k, A), b: norm(k, B) }));

  const edges = metrics.slice(0, 5).map((m) => {
    const x = m.get(A), y = m.get(B);
    return x === y ? null : { metric: m.label.toLowerCase(), who: x > y ? a.ign : b.ign, x, y };
  }).filter(Boolean) as { metric: string; who: string; x: number; y: number }[];
  const aWins = edges.filter((e) => e.who === a.ign).length;
  const bWins = edges.length - aWins;
  const lead = aWins === bWins ? null : aWins > bWins ? a.ign : b.ign;
  const noData = !A.played || !B.played;
  const scope = lastN ? `last ${lastN} matches` : `last ${data.matches.length} matches`;
  const summary = noData
    ? `${!A.played ? a.ign : b.ign} has no results logged in the ${scope}, so there's nothing fair to compare yet.`
    : [
      `**${lead ? `${lead} edges it` : 'Dead even'}** across the ${scope} (${a.ign} leads ${aWins}, ${b.ign} leads ${bWins} of 5 core stats).`,
      '',
      ...edges.map((e) => `- ${e.who} has more ${e.metric} (${e.x > e.y ? `${fmt(e.x)} vs ${fmt(e.y)}` : `${fmt(e.y)} vs ${fmt(e.x)}`}).`),
    ].join('\n');
  return {
    facts: { scope, [a.ign]: A, [b.ign]: B, showUpRate: { [a.ign]: relA ?? null, [b.ign]: relB ?? null } },
    summary,
    blocks: [
      { type: 'table', title: `${a.ign} vs ${b.ign}`, subtitle: scope, columns: [{ key: 'metric', label: 'Metric' }, { key: 'a', label: a.ign, align: 'right' }, { key: 'b', label: b.ign, align: 'right' }], rows, best: ['a', 'b'] },
      { type: 'radar', title: 'Skill shape', subtitle: '100 = best on the team', series: [{ key: 'a', label: a.ign }, { key: 'b', label: b.ign }], data: radar },
    ],
  };
}

/* ───────────────────────── Attendance ───────────────────────── */

export interface AttendanceRow {
  id: string; ign: string; picked: number; joined: number; missed: number; available: number; maybe: number; unavailable: number;
  noReply: number; late: number; lastMinute: number; benched: number; reliability: number | null; responseRate: number | null;
}

export function attendanceRows(data: TeamData): Map<string, AttendanceRow> {
  const past = new Map(data.matches.map((m) => [m.id, m]));
  const out = new Map<string, AttendanceRow>();
  const statKey = new Set(data.stats.map((s) => `${s.matchId}:${s.userId}`));
  const attKey = new Map(data.attendance.map((a) => [`${a.matchId}:${a.userId}`, a.joined]));
  const squads = data.squads.filter((s) => s.confirmed && past.has(s.matchId));
  for (const mem of data.members) {
    const r: AttendanceRow = { id: mem.id, ign: mem.ign, picked: 0, joined: 0, missed: 0, available: 0, maybe: 0, unavailable: 0, noReply: 0, late: 0, lastMinute: 0, benched: 0, reliability: null, responseRate: null };
    for (const sq of squads) {
      const k = `${sq.matchId}:${mem.id}`;
      if (sq.selectedIds.includes(mem.id)) {
        r.picked++;
        const j = attKey.get(k);
        // An explicit attendance mark wins; otherwise logged stats mean they played.
        if (j === true || (j === undefined && statKey.has(k))) r.joined++;
        else if (j === false) r.missed++;
      } else if (mem.inPool) r.benched++;
    }
    // Joined matches that had no confirmed squad (results logged straight away).
    for (const [k, j] of attKey) if (j && k.endsWith(`:${mem.id}`) && !squads.some((s) => `${s.matchId}:${mem.id}` === k && s.selectedIds.includes(mem.id)) && past.has(k.split(':')[0])) r.joined++;
    let replies = 0;
    for (const m of data.matches) {
      const a = data.availability.find((x) => x.matchId === m.id && x.userId === mem.id);
      if (!a?.status) { r.noReply++; continue; }
      replies++;
      if (a.status === 'available') r.available++;
      if (a.status === 'maybe') r.maybe++;
      if (a.status === 'unavailable') {
        r.unavailable++;
        if (a.updatedAt.getTime() >= m.startAt.getTime() - 60 * 60_000) r.lastMinute++;
      }
      if (a.joiningAt && a.joiningAt.getTime() > m.startAt.getTime() + 2 * 60_000) r.late++;
    }
    r.reliability = r.joined + r.missed ? r.joined / (r.joined + r.missed) : null;
    r.responseRate = data.matches.length ? replies / data.matches.length : null;
    out.set(mem.id, r);
  }
  return out;
}

export function attendanceTool(data: TeamData): ToolOutput {
  const rows = [...attendanceRows(data).values()];
  if (!data.matches.length) return { facts: { matches: 0 }, summary: 'No past matches yet, so there is no attendance to analyse.', blocks: [] };
  const missers = rows.filter((r) => r.missed > 0).sort((a, b) => b.missed - a.missed);
  const late = rows.filter((r) => r.late > 0).sort((a, b) => b.late - a.late);
  const dropouts = rows.filter((r) => r.lastMinute > 0).sort((a, b) => b.lastMinute - a.lastMinute);
  const silent = rows.filter((r) => (r.responseRate ?? 1) < 0.5).sort((a, b) => (a.responseRate ?? 0) - (b.responseRate ?? 0));
  const items: { tone: Tone; title: string; text: string; tags?: string[] }[] = [];
  if (missers[0]) items.push({ tone: 'bad', title: `${missers[0].ign} misses the most`, text: `Picked ${missers[0].picked} times, no-show ${missers[0].missed}.`, tags: ['No-shows'] });
  if (late[0]) items.push({ tone: 'warn', title: `${late[0].ign} joins late`, text: `Tapped "joining" after the start time in ${late[0].late} match${late[0].late === 1 ? '' : 'es'}.`, tags: ['Late'] });
  if (dropouts[0]) items.push({ tone: 'warn', title: `${dropouts[0].ign} drops out last minute`, text: `Switched to unavailable inside the final hour ${dropouts[0].lastMinute} time${dropouts[0].lastMinute === 1 ? '' : 's'}.`, tags: ['Cancels'] });
  if (silent[0]) items.push({ tone: 'info', title: `${silent[0].ign} rarely checks in`, text: `Answered the availability check for ${pct(silent[0].responseRate ?? 0)} of matches.`, tags: ['Check-in'] });
  const solid = rows.filter((r) => r.reliability === 1 && r.picked >= 3);
  if (solid.length) items.push({ tone: 'good', title: 'Always there', text: `${solid.map((r) => r.ign).join(', ')} never missed a match they were picked for.`, tags: ['Reliable'] });

  const tableRows: Row[] = rows.map((r) => ({
    player: r.ign, picked: r.picked, joined: r.joined, missed: r.missed, late: r.late, lastMinute: r.lastMinute, benched: r.benched,
    reliability: r.reliability != null ? `${Math.round(r.reliability * 100)}%` : '–',
  }));
  const blocks: Block[] = [
    { type: 'table', title: 'Attendance record', subtitle: `Last ${data.matches.length} matches`, columns: [
      { key: 'player', label: 'Player' }, { key: 'picked', label: 'Picked', align: 'right' }, { key: 'joined', label: 'Joined', align: 'right' },
      { key: 'missed', label: 'Missed', align: 'right' }, { key: 'late', label: 'Late', align: 'right' }, { key: 'lastMinute', label: 'Late drop', align: 'right' },
      { key: 'benched', label: 'Benched', align: 'right' }, { key: 'reliability', label: 'Show-up', align: 'right' },
    ], rows: tableRows },
    { type: 'bar', title: 'Check-in replies', subtitle: 'Availability answers per player', xKey: 'player',
      series: [{ key: 'available', label: 'Available' }, { key: 'maybe', label: 'Maybe' }, { key: 'unavailable', label: 'Unavailable' }, { key: 'noReply', label: 'No reply' }],
      data: rows.map((r) => ({ player: r.ign, available: r.available, maybe: r.maybe, unavailable: r.unavailable, noReply: r.noReply })) },
  ];
  if (items.length) blocks.push({ type: 'insights', title: 'Attendance flags', items });
  const summary = [
    `**Attendance over the last ${data.matches.length} matches.**`, '',
    ...(items.length ? items.map((i) => `- ${i.title}: ${i.text}`) : ['- No no-shows, late joins or last-minute drops recorded.']),
  ].join('\n');
  return { facts: { matches: data.matches.length, players: rows }, summary, blocks };
}

/* ───────────────────────── Best time slots ───────────────────────── */

export function timeSlotsTool(data: TeamData, upcoming: AiMatch[] = []): ToolOutput {
  const all = [...data.matches, ...upcoming];
  const poolSize = data.members.filter((m) => m.inPool).length || data.members.length;
  const byHour = new Map<number, { n: number; avail: number; joined: number }>();
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const grid = new Map<string, { n: number; avail: number }>();
  for (const m of all) {
    const av = data.availability.filter((a) => a.matchId === m.id);
    if (!av.length && !data.attendance.some((a) => a.matchId === m.id)) continue;
    const { hour, weekday } = localParts(m.startAt, data.tz);
    const available = av.filter((a) => a.status === 'available').length + 0.5 * av.filter((a) => a.status === 'maybe').length;
    const joined = data.attendance.filter((a) => a.matchId === m.id && a.joined).length;
    const h = byHour.get(hour) ?? { n: 0, avail: 0, joined: 0 };
    h.n++; h.avail += Math.max(available, joined); h.joined += joined;
    byHour.set(hour, h);
    const g = grid.get(`${weekday}:${hour}`) ?? { n: 0, avail: 0 };
    g.n++; g.avail += Math.max(available, joined);
    grid.set(`${weekday}:${hour}`, g);
  }
  if (!byHour.size) {
    return { facts: { slots: [] }, summary: 'No availability check-ins are recorded yet. Once players answer the check-in on a few matches I can find the best time.', blocks: [] };
  }
  const slots = [...byHour.entries()].map(([hour, h]) => ({ hour, label: hourLabel(hour), matches: h.n, avgAvailable: r1(h.avail / h.n), avgJoined: r1(h.joined / h.n) }))
    .sort((a, b) => a.hour - b.hour);
  const best = [...slots].sort((a, b) => b.avgAvailable - a.avgAvailable || b.matches - a.matches)[0];
  const worst = [...slots].sort((a, b) => a.avgAvailable - b.avgAvailable)[0];
  const hours = slots.map((s) => s.hour);
  const blocks: Block[] = [
    { type: 'bar', title: 'Availability by start time', subtitle: `Average players available (of ${poolSize})`, xKey: 'slot',
      series: [{ key: 'avgAvailable', label: 'Available' }, { key: 'avgJoined', label: 'Joined' }],
      data: slots.map((s) => ({ slot: s.label, avgAvailable: s.avgAvailable, avgJoined: s.avgJoined, matches: s.matches })) },
    { type: 'heatmap', title: 'Day × hour', subtitle: 'Average players available', rows: days, cols: hours.map(hourLabel),
      values: days.map((d) => hours.map((h) => { const g = grid.get(`${d}:${h}`); return g ? r1(g.avail / g.n) : null; })), unit: 'players' },
  ];
  const summary = [
    `**${best.label} is your best slot: ${best.avgAvailable} of ${poolSize} players available on average** (${best.matches} match${best.matches === 1 ? '' : 'es'} recorded).`,
    '',
    ...(worst.hour !== best.hour ? [`- Weakest: ${worst.label} with ${worst.avgAvailable} available.`] : []),
    `- Based on check-ins and attendance for ${all.length} matches.`,
  ].join('\n');
  return { facts: { poolSize, slots, best: best.label }, summary, blocks };
}

/* ───────────────────────── Squad recommendation ───────────────────────── */

export const SQUAD_WEIGHTS = { form: 0.55, availability: 0.2, reliability: 0.15, fairness: 0.1 } as const;

const AVAIL_SCORE: Record<string, number> = { available: 1, maybe: 0.55, unknown: 0.6, unavailable: 0 };

export function recommendSquad(data: TeamData, target: { match: AiMatch | null; availability: Map<string, string> }, size = 4): ToolOutput {
  const pool = data.members.filter((m) => m.inPool);
  if (pool.length < size) {
    return { facts: { error: `Only ${pool.length} players on the team` }, summary: `The team has ${pool.length} players, fewer than the ${size} a squad needs.`, blocks: [] };
  }
  const aggs = playerAggs(data);
  const att = attendanceRows(data);
  const has = pool.filter((p) => aggs.get(p.id)!.played > 0);
  const maxK = Math.max(0.1, ...has.map((p) => aggs.get(p.id)!.formKills));
  const maxD = Math.max(1, ...has.map((p) => aggs.get(p.id)!.formDamage));
  const maxM = Math.max(1, ...has.map((p) => aggs.get(p.id)!.formMvp));
  const maxBench = Math.max(1, ...pool.map((p) => att.get(p.id)!.benched));

  const scored = pool.map((p) => {
    const a = aggs.get(p.id)!;
    const r = att.get(p.id)!;
    const form = a.played ? 0.4 * (a.formKills / maxK) + 0.3 * (a.formDamage / maxD) + 0.3 * (a.formMvp / maxM) : 0.45;
    const status = target.availability.get(p.id) ?? 'unknown';
    const avail = AVAIL_SCORE[status] ?? 0.6;
    const rel = r.reliability ?? 0.75;
    const fair = r.benched / maxBench;
    const total = SQUAD_WEIGHTS.form * form + SQUAD_WEIGHTS.availability * avail + SQUAD_WEIGHTS.reliability * rel + SQUAD_WEIGHTS.fairness * fair;
    const reasons: string[] = [];
    reasons.push(a.played ? `${r1(a.formKills)} kills, ${fmt(Math.round(a.formDamage))} dmg recent form` : 'No results logged yet');
    if (a.mvps) reasons.push(`${a.mvps} MVP${a.mvps === 1 ? '' : 's'}`);
    reasons.push(status === 'unknown' ? 'No check-in yet' : `Checked in: ${status}`);
    if (r.reliability != null) reasons.push(`${Math.round(r.reliability * 100)}% show-up`);
    if (r.benched) reasons.push(`Benched ${r.benched}×`);
    const pick: SquadPick = { id: p.id, ign: p.ign, avatar: p.avatar, gameRole: p.gameRole, score: Math.round(total * 100), availability: status, reasons };
    return { pick, form, avail, rel, fair, status };
  });

  // Greedy pick with a small penalty for doubling up a set role (IGL, Sniper...), so the squad stays balanced.
  const chosen: typeof scored = [];
  const left = scored.filter((s) => s.status !== 'unavailable');
  const out = scored.filter((s) => s.status === 'unavailable');
  while (chosen.length < size && (left.length || out.length)) {
    const src = left.length ? left : out;
    const roles = new Set(chosen.map((c) => c.pick.gameRole).filter((g) => g && g !== 'Flex'));
    src.sort((x, y) => (y.pick.score - (roles.has(y.pick.gameRole) ? 8 : 0)) - (x.pick.score - (roles.has(x.pick.gameRole) ? 8 : 0)));
    chosen.push(src.shift()!);
  }
  const rest = [...left, ...out].sort((x, y) => y.pick.score - x.pick.score);
  const sub = rest[0]?.pick ?? null;
  chosen.sort((x, y) => y.pick.score - x.pick.score);

  const forced = chosen.filter((c) => c.status === 'unavailable');
  const roleSet = chosen.map((c) => c.pick.gameRole).filter(Boolean);
  const balanced = roleSet.length === size && new Set(roleSet).size === size;
  const subReason = sub
    ? sub.availability === 'unavailable' ? `${sub.ign} marked unavailable for this match.`
      : `${sub.ign} scores ${sub.score}, just below the picks${att.get(sub.id)!.benched ? `; already benched ${att.get(sub.id)!.benched}× so rotate them in next` : ''}.`
    : '';
  const reason = [
    data.matches.length ? `Scored on recent form (${data.matches.length} matches), availability, show-up rate and bench rotation.` : 'No results logged yet, so this leans on availability and attendance.',
    balanced ? 'Every role is covered.' : '',
    forced.length ? `${forced.map((f) => f.pick.ign).join(', ')} said unavailable but there aren't enough other players.` : '',
  ].filter(Boolean).join(' ');
  const mLabel = target.match ? matchLabel(target.match, data.tz) : null;
  const block: Block = {
    type: 'squad', title: 'AI squad recommendation', subtitle: mLabel ?? 'Next scrim',
    matchId: target.match?.id ?? null, matchLabel: mLabel,
    players: chosen.map((c) => c.pick), substitute: sub, reason, note: 'The captain makes the final call. Nothing is saved until you approve.',
  };
  const summary = [
    `**Recommended squad${mLabel ? ` for ${mLabel}` : ''}: ${chosen.map((c) => c.pick.ign).join(', ')}.**`, '',
    ...chosen.map((c) => `- ${c.pick.ign}${c.pick.gameRole ? ` (${c.pick.gameRole})` : ''}: score ${c.pick.score}. ${c.pick.reasons.slice(0, 2).join(', ')}.`),
    '', sub ? `Substitute: ${sub.ign}. ${subReason}` : '',
  ].join('\n');
  return {
    facts: { match: mLabel, matchId: target.match?.id ?? null, weights: SQUAD_WEIGHTS, picks: chosen.map((c) => ({ ...c.pick, form: r1(c.form), availability: c.status, reliability: r1(c.rel), fairness: r1(c.fair) })), substitute: sub, substituteReason: subReason, reason },
    summary, blocks: [block],
  };
}

/* ───────────────────────── Match report ───────────────────────── */

export function matchReportTool(data: TeamData, matchId: string): ToolOutput {
  const m = data.matches.find((x) => x.id === matchId);
  if (!m) return { facts: { error: 'Match not found among past matches' }, summary: 'I could not find that match among finished ones.', blocks: [] };
  const st = data.stats.filter((s) => s.matchId === m.id);
  const byId = new Map(data.members.map((x) => [x.id, x]));
  const kills = sum(st.map((s) => s.kills));
  const damage = sum(st.map((s) => s.damage));
  const points = matchPoints(m.placement, kills).total;
  const others = matchLines(data).filter((l) => l.id !== m.id);
  const oKills = avg(others.map((l) => l.kills));
  const oDmg = avg(others.map((l) => l.damage));
  const oPlaced = others.filter((l) => l.placement != null);
  const oPlace = avg(oPlaced.map((l) => l.placement!));
  const surv = avg(st.map((s) => s.survivalMin));
  const oSurv = avg(others.map((l) => l.survival).filter((x) => x > 0));
  const obs: { tone: Tone; text: string }[] = [];
  if (!st.length) obs.push({ tone: 'info', text: 'No player stats logged for this match yet.' });
  if (others.length && st.length) {
    obs.push(kills >= oKills * 1.15 ? { tone: 'good', text: `Strong fragging: ${kills} kills vs your usual ${r1(oKills)}.` }
      : kills <= oKills * 0.85 ? { tone: 'bad', text: `Quiet game: ${kills} kills vs your usual ${r1(oKills)}.` }
        : { tone: 'info', text: `Kills on par with your average (${r1(oKills)}).` });
    if (oDmg > 0 && Math.abs(damage - oDmg) / oDmg >= 0.15) obs.push({ tone: damage > oDmg ? 'good' : 'bad', text: `Damage ${damage > oDmg ? 'above' : 'below'} average (${fmt(damage)} vs ${fmt(Math.round(oDmg))}).` });
  }
  if (m.placement != null && oPlaced.length) {
    obs.push(m.placement < oPlace ? { tone: 'good', text: `Placed #${m.placement}, better than your #${r1(oPlace)} average.` }
      : { tone: 'bad', text: `Placed #${m.placement}, behind your #${r1(oPlace)} average. Late-game positioning needs work.` });
  }
  if (st.length && oSurv > 0 && surv < oSurv * 0.75) obs.push({ tone: 'warn', text: `Early deaths: players lasted ${r1(surv)} min vs ${r1(oSurv)} usually.` });
  const mvp = st.find((s) => s.mvp);
  if (mvp) obs.push({ tone: 'good', text: `MVP: ${byId.get(mvp.userId)?.ign ?? 'Unknown'} (${mvp.kills} kills, ${fmt(mvp.damage)} dmg).` });
  const recommendation = m.placement != null && oPlaced.length && m.placement > oPlace ? 'Practise final-zone rotations and agree a fallback compound before each move.'
    : st.length && oSurv > 0 && surv < oSurv * 0.75 ? 'Slow the early game down: trade fewer opening fights and play for zone.'
      : others.length && kills < oKills * 0.85 ? 'Take more planned fights mid-game; the squad is leaving kill points on the table.'
        : 'Keep the same plan and repeat the drop that worked.';
  const players: Row[] = st.sort((a, b) => b.kills - a.kills || b.damage - a.damage).map((s) => ({
    player: byId.get(s.userId)?.ign ?? 'Unknown', kills: s.kills, damage: s.damage, assists: s.assists, survival: s.survivalMin, mvp: s.mvp ? 'MVP' : '',
  }));
  const label = matchLabel(m, data.tz);
  const tone = m.placement != null && m.placement <= 3 ? 'Positive performance' : m.placement != null && m.placement > 10 ? 'Tough match' : 'Match summary';
  return {
    facts: { match: label, map: m.map, placement: m.placement, kills, damage, points, players, teamAverages: { kills: r1(oKills), damage: Math.round(oDmg), placement: oPlaced.length ? r1(oPlace) : null }, observations: obs.map((o) => o.text), recommendation },
    summary: [`**Match report: ${label}${m.placement != null ? `, #${m.placement}` : ''}, ${kills} kills, ${points} pts.**`, '', ...obs.map((o) => `- ${o.text}`), '', `Recommendation: ${recommendation}`].join('\n'),
    blocks: [{ type: 'report', title: `Match report · ${m.title}`, subtitle: `${tone} · ${m.map} · ${label}`, matchId: m.id, placement: m.placement, kills, damage, points, players, observations: obs, recommendation }],
  };
}
