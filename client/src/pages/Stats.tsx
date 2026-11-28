import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, PolarAngleAxis, PolarGrid, Radar, RadarChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { CheckCircle2, ChevronRight, Crosshair, Flame, Medal, RotateCcw, Swords, Trophy, Users, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { dayIST, dayKeyIST, shortDayFromKey, timeIST } from '@/lib/time';
import { mapLabel, type TeamStatsMatch, type TeamStatsPlayer } from '@/lib/types';
import { list } from '@/lib/motion';
import { useAuth } from '@/context/AuthContext';
import { Avatar, Card, PageHeader, Skeleton, cx } from '@/components/ui';
import { EmptyState } from '@/components/EmptyState';
import { DateRangePicker } from '@/components/DateRangePicker';
import {
  GRID, METRICS, MUTED, ORANGE, Paged, PlayerChip, Segmented, StatTile, TooltipCard, fmtNum, metricOf, type MetricKey,
} from '@/components/StatsCharts';

type View = 'me' | 'team';
type Range = '5' | '10' | 'all';
/** Rows shown per page in the leaderboard and history cards. */
const PAGE = 5;
const inBounds = (iso: string, [from, to]: [string, string]) => {
  const k = dayKeyIST(iso);
  return (!from || k >= from) && (!to || k <= to);
};

const nameOf = (p: TeamStatsPlayer) => p.ign || p.name;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;
const axis = { stroke: MUTED, fontSize: 11, tickLine: false, axisLine: false } as const;

export default function Stats() {
  const { user } = useAuth();
  const me = useQuery({ queryKey: ['mystats'], queryFn: api.myStats });
  const team = useQuery({ queryKey: ['teamstats'], queryFn: api.teamStats });

  const [view, setView] = useState<View>('me');
  const [range, setRange] = useState<Range>('10');
  const [map, setMap] = useState<string>('all');
  const [metric, setMetric] = useState<MetricKey>('kills');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverPlayer, setHoverPlayer] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Home's "Matches" tile opens this page on the list of matches you played.
  const playedOnly = params.get('show') === 'played';
  const historyRef = useRef<HTMLDivElement>(null);
  const dated = Boolean(from || to);
  const bounds: [string, string] = from && to && from > to ? [to, from] : [from, to];

  const myId = user?._id ?? '';
  const m = metricOf(metric);

  // Roster order fixes each player's colour: me first, then by name.
  const players = useMemo(() => {
    const ps = [...(team.data?.players ?? [])].sort((a, b) =>
      a.id === myId ? -1 : b.id === myId ? 1 : nameOf(a).localeCompare(nameOf(b)));
    // You are always orange; teammates take the other series colours in a fixed order,
    // skipping the orange and yellow slots so nobody looks like you.
    const others = ['#3987e5', '#199e70', '#d55181', '#9085e9', '#e66767', '#0ca30c'];
    let k = 0;
    return ps.map((p) => ({ ...p, color: p.id === myId ? ORANGE : others[k++ % others.length] }));
  }, [team.data, myId]);
  const colorOf = (id: string) => players.find((p) => p.id === id)?.color ?? MUTED;
  const playerName = (id: string) => { const p = players.find((x) => x.id === id); return p ? nameOf(p) : 'Player'; };

  const allMatches = useMemo(() => {
    const ms = team.data?.matches ?? [];
    return ms.map((x, i) => ({ ...x, n: i + 1 }));
  }, [team.data]);
  const maps = useMemo(() => [...new Set(allMatches.map((x) => x.map).filter((x) => x !== 'TBD'))], [allMatches]);

  // Matches after the view, map and range filters.
  const matches = useMemo(() => {
    let ms = allMatches;
    if (view === 'me') ms = ms.filter((x) => x.stats.some((s) => s.userId === myId));
    if (map !== 'all') ms = ms.filter((x) => x.map === map);
    if (dated) ms = ms.filter((x) => inBounds(x.startAt, bounds));
    if (range !== 'all') ms = ms.slice(-Number(range));
    return ms;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMatches, view, map, range, myId, bounds[0], bounds[1]]);

  // Personal history (newest first) under the same date and map filters.
  const history = useMemo(() => {
    let rs = [...(me.data?.rows ?? [])].reverse();
    if (map !== 'all') rs = rs.filter((r) => r.map === map);
    if (dated) rs = rs.filter((r) => inBounds(r.startAt, bounds));
    if (playedOnly) rs = rs.filter((r) => r.played ?? r.selected);
    return rs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.data, map, playedOnly, bounds[0], bounds[1]]);

  // Days with matches (for the dots in the date picker) and a live count for any range.
  const scoped = useMemo(() => allMatches.filter((x) => (view !== 'me' || x.stats.some((s) => s.userId === myId)) && (map === 'all' || x.map === map)),
    [allMatches, view, myId, map]);
  const matchDays = useMemo(() => new Set(scoped.map((x) => dayKeyIST(x.startAt))), [scoped]);
  const countIn = (a: string, b: string) => scoped.filter((x) => inBounds(x.startAt, a && b && a > b ? [b, a] : [a, b])).length;

  useEffect(() => {
    if (!playedOnly || me.isLoading || team.isLoading) return;
    const t = setTimeout(() => historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
    return () => clearTimeout(t);
  }, [playedOnly, me.isLoading, team.isLoading]);

  const visible = players.filter((p) => !hidden.has(p.id) && matches.some((x) => x.stats.some((s) => s.userId === p.id)));

  if (me.isLoading || team.isLoading) {
    return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-72" /><Skeleton className="h-64" /></div>;
  }

  const hasAny = allMatches.length > 0;
  const statOf = (x: TeamStatsMatch, uid: string) => x.stats.find((s) => s.userId === uid);
  const teamAvgOf = (x: TeamStatsMatch) => round1(avg(x.stats.map((s) => s[metric])));

  // ---------- data for the charts ----------
  const trend = matches.map((x) => {
    const row: Record<string, number | string | null> = {
      matchId: x.matchId, label: `#${x.n}`, title: x.title, when: `${dayIST(x.startAt)} · ${timeIST(x.startAt)}`, map: mapLabel(x.map),
      teamAvg: teamAvgOf(x),
    };
    for (const p of players) row[p.id] = statOf(x, p.id)?.[metric] ?? null;
    return row;
  });

  const mine = matches.map((x) => statOf(x, myId)).filter(Boolean) as NonNullable<ReturnType<typeof statOf>>[];
  const allLines = matches.flatMap((x) => x.stats);

  // Per-player averages inside the filters, for the leaderboard and radar.
  const perPlayer = players.map((p) => {
    const lines = matches.map((x) => statOf(x, p.id)).filter(Boolean) as NonNullable<ReturnType<typeof statOf>>[];
    const a = Object.fromEntries(METRICS.map((k) => [k.key, avg(lines.map((l) => l[k.key]))])) as Record<MetricKey, number>;
    return { ...p, games: lines.length, mvps: lines.filter((l) => l.mvp).length, total: lines.reduce((s, l) => s + l[metric], 0), avg: a };
  }).filter((p) => p.games > 0);
  const best = Object.fromEntries(METRICS.map((k) => [k.key, Math.max(1e-9, ...perPlayer.map((p) => p.avg[k.key]))])) as Record<MetricKey, number>;
  const teamAvgAll = Object.fromEntries(METRICS.map((k) => [k.key, avg(perPlayer.map((p) => p.avg[k.key]))])) as Record<MetricKey, number>;
  const radar = METRICS.map((k) => {
    const r: Record<string, number | string> = { metric: k.label, teamAvg: Math.round((teamAvgAll[k.key] / best[k.key]) * 100) };
    for (const p of perPlayer) r[p.id] = Math.round((p.avg[k.key] / best[k.key]) * 100);
    return r;
  });
  const radarPlayers = view === 'me' ? perPlayer.filter((p) => p.id === myId) : perPlayer.filter((p) => visible.some((v) => v.id === p.id));

  const leaderboard = [...perPlayer].sort((a, b) => b.avg[metric] - a.avg[metric]);
  const lbMax = Math.max(1e-9, ...leaderboard.map((p) => p.avg[metric]));

  const byMap = Object.entries(matches.reduce<Record<string, number[]>>((acc, x) => {
    if (x.map === 'TBD') return acc;
    const vals = view === 'me' ? [statOf(x, myId)?.[metric]].filter((v): v is number => v != null) : x.stats.map((s) => s[metric]);
    (acc[x.map] ??= []).push(...vals);
    return acc;
  }, {})).map(([mp, vals]) => ({ map: mp, avg: round1(avg(vals)), games: vals.length })).sort((a, b) => b.avg - a.avg);

  const pickFromChart = (e: { activePayload?: { payload?: { matchId?: string } }[] } | null) => {
    const id = e?.activePayload?.[0]?.payload?.matchId;
    if (id) navigate(`/matches/${id}`);
  };
  const togglePlayer = (id: string) => setHidden((h) => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const lineOpacity = (id: string) => (hoverPlayer && hoverPlayer !== id ? 0.15 : 1);

  const withAtt = history.filter((r) => r.selected && r.joined !== null);
  const attended = withAtt.filter((r) => r.joined).length;

  const chooseDates = (a: string, b: string) => {
    setFrom(a); setTo(b);
    if (a || b) setRange('all');
  };
  const setPlayedOnly = (on: boolean) => setParams((p) => { const n = new URLSearchParams(p); on ? n.set('show', 'played') : n.delete('show'); return n; }, { replace: true });
  const clearFilters = () => { setFrom(''); setTo(''); setMap('all'); setRange('10'); };
  const filtered = dated || map !== 'all';
  const spanText = matches.length
    ? (() => {
      const a = shortDayFromKey(dayKeyIST(matches[0].startAt)); const b = shortDayFromKey(dayKeyIST(matches[matches.length - 1].startAt));
      return a === b ? a : `${a} – ${b}`;
    })()
    : '';

  return (
    <div>
      <PageHeader
        eyebrow="Performance"
        title={view === 'me' ? 'Your stats' : 'Team stats'}
        action={<Segmented id="view" value={view} onChange={setView} options={[
          { value: 'me', label: 'Me' }, { value: 'team', label: <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" aria-hidden />Team</span> },
        ]} />}
      >
        Kills, damage and MVPs from your scorecards. Tap a point to open that match.
      </PageHeader>

      {!hasAny ? (
        <Card><EmptyState title="No stats yet" text="Your captain uploads the results screenshot after each match, and the charts fill in here." /></Card>
      ) : (
        <motion.div variants={list} initial="initial" animate="animate" className="space-y-6">
          {/* Filters: apply to every card on the page. */}
          <Card className="!p-3 sm:!p-4">
            <div className="flex flex-col gap-3">
              <DateRangePicker from={bounds[0]} to={bounds[1]} onChange={chooseDates} matchDays={matchDays} countIn={countIn} />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Segmented id="metric" size="sm" value={metric} onChange={setMetric} options={METRICS.map((k) => ({ value: k.key, label: k.label }))} />
                  <Segmented id="range" size="sm" value={range} onChange={setRange} options={[
                    { value: '5', label: 'Last 5' }, { value: '10', label: 'Last 10' }, { value: 'all', label: 'All' },
                  ]} />
                  {maps.length > 1 && (
                    <select aria-label="Filter by map" value={map} onChange={(e) => setMap(e.target.value)}
                      className="rounded-xl border border-white/10 bg-ink-900/80 px-3 py-1.5 text-xs font-semibold text-zinc-200 focus:border-ember-400/70 focus:outline-none">
                      <option value="all">All maps</option>
                      {maps.map((mp) => <option key={mp} value={mp}>{mp}</option>)}
                    </select>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
                <span aria-live="polite">
                  <span className="font-semibold text-zinc-300">{matches.length}</span> {matches.length === 1 ? 'match' : 'matches'}
                  {spanText && <> · {spanText}</>}
                  {map !== 'all' && <> · {map}</>}
                </span>
                {filtered && (
                  <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 font-semibold text-ember-300 hover:text-ember-200">
                    <RotateCcw className="h-3 w-3" aria-hidden />Clear
                  </button>
                )}
              </div>
            </div>
          </Card>

          {!matches.length ? (
            <Card><EmptyState title="Nothing in this filter" text="No matches in these dates. Pick other dates or a different map." /></Card>
          ) : (
            <>
              {/* Headline tiles */}
              <div className={cx('grid grid-cols-2 gap-3', view === 'me' ? 'sm:grid-cols-4' : 'sm:grid-cols-3 lg:grid-cols-5 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1')}>
                {view === 'me' ? (
                  <>
                    <StatTile label="Matches" value={mine.length} icon={<Swords className="h-3.5 w-3.5" aria-hidden />} />
                    <StatTile label="Kills" value={mine.reduce((a, l) => a + l.kills, 0)} hint={`${round1(avg(mine.map((l) => l.kills)))} per match`} icon={<Crosshair className="h-3.5 w-3.5" aria-hidden />} accent />
                    <StatTile label="Avg dmg" value={Math.round(avg(mine.map((l) => l.damage)))} icon={<Flame className="h-3.5 w-3.5" aria-hidden />} />
                    <StatTile label="MVPs" value={mine.filter((l) => l.mvp).length} hint={withAtt.length ? `${attended}/${withAtt.length} attended` : undefined} icon={<Trophy className="h-3.5 w-3.5" aria-hidden />} />
                  </>
                ) : (
                  <>
                    <StatTile label="Matches" value={matches.length} icon={<Swords className="h-3.5 w-3.5" aria-hidden />} />
                    <StatTile label="Team kills" value={allLines.reduce((a, l) => a + l.kills, 0)} hint={`${round1(allLines.reduce((a, l) => a + l.kills, 0) / matches.length)} per match`} icon={<Crosshair className="h-3.5 w-3.5" aria-hidden />} accent />
                    <StatTile label="Team damage" value={allLines.reduce((a, l) => a + l.damage, 0)} icon={<Flame className="h-3.5 w-3.5" aria-hidden />} />
                    <StatTile label="Best place" value={Math.min(...matches.map((x) => x.placement ?? Infinity)) === Infinity ? null : Math.min(...matches.map((x) => x.placement ?? Infinity))} suffix="" hint="best finish in this filter" icon={<Medal className="h-3.5 w-3.5" aria-hidden />} />
                    <StatTile label="Top MVP" value={[...perPlayer].sort((a, b) => b.mvps - a.mvps)[0]?.mvps ?? 0} hint={[...perPlayer].sort((a, b) => b.mvps - a.mvps)[0] ? nameOf([...perPlayer].sort((a, b) => b.mvps - a.mvps)[0]) : undefined} icon={<Trophy className="h-3.5 w-3.5" aria-hidden />} />
                  </>
                )}
              </div>

              {/* Trend */}
              <Card>
                <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-white">{m.label} per match</h2>
                    <p className="text-xs text-zinc-500">{view === 'me' ? 'You vs team average' : 'Tap a name to hide or show a player'}</p>
                  </div>
                  {view === 'me' && (
                    <div className="flex items-center gap-3 text-xs text-zinc-400">
                      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: ORANGE }} />You</span>
                      <span className="inline-flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-zinc-400" />Team avg</span>
                    </div>
                  )}
                </div>
                {view === 'team' && (
                  <motion.div layout className="mb-3 flex flex-wrap gap-2">
                    {players.filter((p) => matches.some((x) => statOf(x, p.id))).map((p) => (
                      <PlayerChip key={p.id} name={nameOf(p)} color={p.color} on={!hidden.has(p.id)}
                        onClick={() => togglePlayer(p.id)} onHover={(h) => setHoverPlayer(h ? p.id : null)} />
                    ))}
                  </motion.div>
                )}
                <div className="h-64 sm:h-72" role="img" aria-label={`${m.label} per match chart`}>
                  <ResponsiveContainer>
                    {view === 'me' ? (
                      <AreaChart key={`me-${metric}`} data={trend} margin={{ left: -14, right: 8, top: 8 }} onClick={pickFromChart} style={{ cursor: 'pointer' }}>
                        <defs>
                          <linearGradient id="meFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0" stopColor={ORANGE} stopOpacity={0.45} /><stop offset="1" stopColor={ORANGE} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke={GRID} vertical={false} />
                        <XAxis dataKey="label" {...axis} />
                        <YAxis {...axis} allowDecimals={metric !== 'kills'} />
                        <Tooltip cursor={{ stroke: 'rgba(255,255,255,.2)' }} content={({ active, payload }) => {
                          const d = payload?.[0]?.payload; if (!active || !d) return null;
                          const mv = matches.find((x) => x.matchId === d.matchId);
                          return <TooltipCard title={String(d.title)} subtitle={`${d.when} · ${d.map}`} unit={m.unit} rows={[
                            ...(d[myId] != null ? [{ name: 'You', color: ORANGE, value: Number(d[myId]), mvp: mv ? statOf(mv, myId)?.mvp : false }] : []),
                            { name: 'Team avg', color: '#a1a1aa', value: Number(d.teamAvg), dashed: true },
                          ]} />;
                        }} />
                        <Area type="monotone" dataKey="teamAvg" stroke="#a1a1aa" strokeWidth={2} strokeDasharray="5 4" fill="none" dot={false} animationDuration={900} />
                        <Area type="monotone" dataKey={myId} stroke={ORANGE} strokeWidth={2.5} fill="url(#meFill)" connectNulls
                          dot={{ r: 4, fill: ORANGE, stroke: '#111118', strokeWidth: 2 }} activeDot={{ r: 7, stroke: '#111118', strokeWidth: 2 }} animationDuration={1100} />
                      </AreaChart>
                    ) : (
                      <LineChart key={`team-${metric}`} data={trend} margin={{ left: -14, right: 8, top: 8 }} onClick={pickFromChart} style={{ cursor: 'pointer' }}>
                        <CartesianGrid stroke={GRID} vertical={false} />
                        <XAxis dataKey="label" {...axis} />
                        <YAxis {...axis} />
                        <Tooltip cursor={{ stroke: 'rgba(255,255,255,.2)' }} content={({ active, payload }) => {
                          const d = payload?.[0]?.payload; if (!active || !d) return null;
                          const mv = matches.find((x) => x.matchId === d.matchId);
                          const rows = visible.filter((p) => d[p.id] != null).map((p) => ({ name: nameOf(p), color: p.color, value: Number(d[p.id]), mvp: mv ? statOf(mv, p.id)?.mvp : false }))
                            .sort((a, b) => b.value - a.value);
                          return <TooltipCard title={String(d.title)} subtitle={`${d.when} · ${d.map}`} unit={m.unit} rows={rows} />;
                        }} />
                        {visible.map((p) => (
                          <Line key={p.id} type="monotone" dataKey={p.id} name={nameOf(p)} stroke={p.color} strokeWidth={hoverPlayer === p.id ? 3.5 : 2}
                            strokeOpacity={lineOpacity(p.id)} connectNulls dot={{ r: 3.5, fill: p.color, stroke: '#111118', strokeWidth: 2, fillOpacity: lineOpacity(p.id) }}
                            activeDot={{ r: 6, stroke: '#111118', strokeWidth: 2 }} animationDuration={1100} />
                        ))}
                      </LineChart>
                    )}
                  </ResponsiveContainer>
                </div>
              </Card>

              <div className="grid gap-6 lg:grid-cols-2">
                {/* Leaderboard */}
                <Card>
                  <h2 className="text-lg font-bold text-white">Leaderboard</h2>
                  <p className="mb-3 text-xs text-zinc-500">Average {m.label.toLowerCase()} per match in this filter</p>
                  <Paged key={`${view}-${metric}`} items={leaderboard} size={PAGE} label="Leaderboard">{(rows, offset) => (
                  <ul className="space-y-2">
                    {rows.map((p, j) => { const i = offset + j; return (
                      <motion.li layout key={p.id} transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                        onMouseEnter={() => setHoverPlayer(p.id)} onMouseLeave={() => setHoverPlayer(null)}
                        className={cx('flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-white/[0.04]', p.id === myId && 'bg-ember-500/[0.06]')}>
                        <span className={cx('w-5 text-center font-display text-lg font-bold', i === 0 ? 'text-ember-400' : 'text-zinc-500')}>{i + 1}</span>
                        <Avatar name={nameOf(p)} src={p.avatar} size={32} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="truncate font-semibold text-zinc-100">{p.id === myId ? `${nameOf(p)} (you)` : nameOf(p)}</span>
                            {p.mvps > 0 && <span className="inline-flex items-center gap-0.5 text-[11px] text-ember-300"><Trophy className="h-3 w-3" aria-hidden />{p.mvps}</span>}
                            <span className="ml-auto font-mono text-white">{fmtNum(round1(p.avg[metric]))}</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                            <motion.div className="h-full rounded-full" style={{ background: p.color }}
                              initial={{ width: 0 }} animate={{ width: `${(p.avg[metric] / lbMax) * 100}%` }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} />
                          </div>
                          <div className="mt-0.5 text-[11px] text-zinc-500">{p.games} {p.games === 1 ? 'match' : 'matches'} · {fmtNum(p.total)} total</div>
                        </div>
                      </motion.li>
                    ); })}
                  </ul>
                  )}</Paged>
                </Card>

                {/* Radar */}
                <Card>
                  <h2 className="text-lg font-bold text-white">{view === 'me' ? 'Your playstyle' : 'Player comparison'}</h2>
                  <p className="mb-2 text-xs text-zinc-500">100 = best on the team</p>
                  <div className="h-72" role="img" aria-label="Radar chart comparing players across kills, damage and MVP score">
                    <ResponsiveContainer>
                      <RadarChart key={`${view}-${radarPlayers.map((p) => p.id).join()}`} data={radar} outerRadius="72%">
                        <PolarGrid stroke="rgba(255,255,255,.08)" />
                        <PolarAngleAxis dataKey="metric" tick={{ fill: '#a1a1aa', fontSize: 11 }} />
                        <Tooltip content={({ active, payload, label }) => {
                          if (!active || !payload?.length) return null;
                          return <TooltipCard title={String(label)} unit="/ 100" rows={payload.map((pl) => ({
                            name: pl.dataKey === 'teamAvg' ? 'Team avg' : pl.dataKey === myId ? 'You' : playerName(String(pl.dataKey)),
                            color: pl.dataKey === 'teamAvg' ? '#a1a1aa' : view === 'me' ? ORANGE : colorOf(String(pl.dataKey)),
                            value: Number(pl.value), dashed: pl.dataKey === 'teamAvg',
                          })).sort((a, b) => b.value - a.value)} />;
                        }} />
                        <Radar dataKey="teamAvg" stroke="#a1a1aa" strokeDasharray="4 3" fill="none" animationDuration={900} />
                        {radarPlayers.map((p) => (
                          <Radar key={p.id} dataKey={p.id} stroke={view === 'me' ? ORANGE : p.color} strokeWidth={2}
                            fill={view === 'me' ? ORANGE : p.color} fillOpacity={hoverPlayer && hoverPlayer !== p.id ? 0.03 : view === 'me' ? 0.3 : 0.12}
                            strokeOpacity={lineOpacity(p.id)} animationDuration={1000} />
                        ))}
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                {/* By map */}
                <Card>
                  <h2 className="text-lg font-bold text-white">{m.label} by map</h2>
                  <p className="mb-3 text-xs text-zinc-500">{view === 'me' ? 'Your average' : 'Average per player'} · tap a bar to filter</p>
                  {byMap.length ? (
                    <div className="h-56" role="img" aria-label={`Average ${m.label} by map`}>
                      <ResponsiveContainer>
                        <BarChart key={`map-${metric}-${view}`} data={byMap} layout="vertical" margin={{ left: 6, right: 20 }} barCategoryGap={8}>
                          <XAxis type="number" {...axis} />
                          <YAxis type="category" dataKey="map" stroke="#a1a1aa" fontSize={12} tickLine={false} axisLine={false} width={72} />
                          <Tooltip cursor={{ fill: 'rgba(255,255,255,.04)' }} content={({ active, payload }) => {
                            const d = payload?.[0]?.payload; if (!active || !d) return null;
                            return <TooltipCard title={d.map} subtitle={`${d.games} ${view === 'me' ? 'matches' : 'player games'}`} unit={m.unit} rows={[{ name: `Avg ${m.label.toLowerCase()}`, color: ORANGE, value: d.avg }]} />;
                          }} />
                          <Bar dataKey="avg" radius={[0, 4, 4, 0]} animationDuration={900} style={{ cursor: 'pointer' }}
                            onClick={(d: { map?: string }) => { if (d?.map) setMap(map === d.map ? 'all' : d.map); }}>
                            {byMap.map((b) => <Cell key={b.map} fill={map === 'all' || map === b.map ? ORANGE : 'rgba(255,138,31,.3)'} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : <p className="text-sm text-zinc-500">Set the map on matches to see this.</p>}
                </Card>
              </div>
            </>
          )}

          {/* Your matches (personal), same date and map filters. Each row opens that match. */}
          {view === 'me' && !!me.data?.rows.length && (
            <Card ref={historyRef} className="scroll-mt-24">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold text-white">{playedOnly ? 'Matches you played' : 'History'}</h2>
                  <p className="text-xs text-zinc-500">{history.length} {history.length === 1 ? 'match' : 'matches'} · tap one to open it</p>
                </div>
                <Segmented id="hist" size="sm" value={playedOnly ? 'played' : 'all'} onChange={(v) => setPlayedOnly(v === 'played')} options={[
                  { value: 'played', label: 'Played' }, { value: 'all', label: 'All' },
                ]} />
              </div>
              {!history.length ? (
                <p className="py-4 text-sm text-zinc-500">No matches in these dates.</p>
              ) : (
                <Paged key={`${playedOnly}-${bounds[0]}-${bounds[1]}-${map}`} items={history} size={PAGE} label="History">{(rows) => (
                  <ul className="divide-y divide-white/5 text-sm">
                    {rows.map((r) => (
                      <li key={r.matchId}>
                        <Link to={`/matches/${r.matchId}`}
                          className="group flex w-full items-center gap-3 rounded-lg px-1.5 py-2.5 text-left transition-colors hover:bg-white/[0.04] active:scale-[0.99]">
                          {r.selected ? (r.joined === false || r.played === false ? <XCircle className="h-4 w-4 shrink-0 text-red-400" aria-label="not played" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-label="played" />) : <span className="chip bg-zinc-700/60 text-zinc-300">Bench</span>}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-zinc-200">{r.title} · {mapLabel(r.map)}</span>
                            <span className="block text-[11px] text-zinc-500">{dayIST(r.startAt)} · {timeIST(r.startAt)}</span>
                          </span>
                          {r.selected && <span className="shrink-0 text-right font-mono text-zinc-300">{r.kills}K {r.mvp && <Trophy className="inline h-3.5 w-3.5 text-ember-400" aria-label="MVP" />}</span>}
                          <ChevronRight className="h-4 w-4 shrink-0 text-zinc-600 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-300" aria-hidden />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}</Paged>
              )}
            </Card>
          )}
        </motion.div>
      )}
    </div>
  );
}
