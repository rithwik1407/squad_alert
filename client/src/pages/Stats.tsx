import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CheckCircle2, Crosshair, Flame, Swords, Trophy, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { dayIST } from '@/lib/time';
import { list } from '@/lib/motion';
import { Card, PageHeader, Skeleton, Stat } from '@/components/ui';
import { EmptyState } from '@/components/EmptyState';

const ORANGE = '#ff8a1f';
const tooltipStyle = { background: '#16161f', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12, color: '#fff', fontSize: 12 };

export default function Stats() {
  const q = useQuery({ queryKey: ['mystats'], queryFn: api.myStats });
  if (q.isLoading) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  const d = q.data;
  const played = (d?.rows ?? []).filter((r) => r.selected);
  const chart = played.map((r) => ({ name: `${r.title} · ${dayIST(r.startAt)}`, short: dayIST(r.startAt).split(', ')[1] ?? r.title, kills: r.kills, damage: r.damage, map: r.map }));
  const byMap = Object.entries(played.reduce<Record<string, { kills: number; n: number }>>((a, r) => {
    a[r.map] ??= { kills: 0, n: 0 };
    a[r.map].kills += r.kills; a[r.map].n += 1;
    return a;
  }, {})).map(([map, v]) => ({ map, avg: +(v.kills / v.n).toFixed(1) }));

  return (
    <div>
      <PageHeader eyebrow="Performance" title="Your stats">Matches you played, attendance, kills, damage and MVPs.</PageHeader>
      {!played.length ? <Card><EmptyState title="No stats yet" text="Your captain records kills and damage after each match." /></Card> : (
        <motion.div variants={list} initial="initial" animate="animate" className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Matches" value={d!.totals.matches} icon={<Swords className="h-3.5 w-3.5" aria-hidden />} />
            <Stat label="Kills" value={d!.totals.kills} icon={<Crosshair className="h-3.5 w-3.5" aria-hidden />} />
            <Stat label="Avg dmg" value={Math.round(d!.totals.damage / Math.max(1, d!.totals.matches))} icon={<Flame className="h-3.5 w-3.5" aria-hidden />} />
            <Stat label="MVPs" value={d!.totals.mvps} icon={<Trophy className="h-3.5 w-3.5" aria-hidden />} />
            <Stat label="Attendance" value={d!.totals.attendanceRate != null ? `${d!.totals.attendanceRate}%` : '–'} icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden />} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="mb-4 text-lg font-bold text-white">Damage per match</h2>
              <div className="h-60" role="img" aria-label="Damage per match area chart">
                <ResponsiveContainer>
                  <AreaChart data={chart} margin={{ left: -18, right: 8, top: 6 }}>
                    <defs><linearGradient id="dmg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={ORANGE} stopOpacity={0.5} /><stop offset="1" stopColor={ORANGE} stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
                    <XAxis dataKey="short" stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={(_, p) => p?.[0]?.payload?.name ?? ''} />
                    <Area type="monotone" dataKey="damage" stroke={ORANGE} strokeWidth={2.5} fill="url(#dmg)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <h2 className="mb-4 text-lg font-bold text-white">Kills per match</h2>
              <div className="h-60" role="img" aria-label="Kills per match bar chart">
                <ResponsiveContainer>
                  <BarChart data={chart} margin={{ left: -24, right: 8, top: 6 }}>
                    <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
                    <XAxis dataKey="short" stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,.04)' }} labelFormatter={(_, p) => p?.[0]?.payload?.name ?? ''} />
                    <Bar dataKey="kills" fill={ORANGE} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <h2 className="mb-4 text-lg font-bold text-white">Avg kills by map</h2>
              <div className="h-52" role="img" aria-label="Average kills by map">
                <ResponsiveContainer>
                  <BarChart data={byMap} layout="vertical" margin={{ left: 10, right: 16 }}>
                    <XAxis type="number" stroke="#71717a" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="map" stroke="#a1a1aa" fontSize={12} tickLine={false} axisLine={false} width={70} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(255,255,255,.04)' }} />
                    <Bar dataKey="avg" fill="#ffa94d" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <h2 className="mb-3 text-lg font-bold text-white">History</h2>
              <ul className="divide-y divide-white/5 text-sm">
                {[...(d?.rows ?? [])].reverse().slice(0, 8).map((r) => (
                  <li key={r.matchId} className="flex items-center gap-3 py-2.5">
                    {r.selected ? (r.joined === false ? <XCircle className="h-4 w-4 text-red-400" aria-label="missed" /> : <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-label="played" />) : <span className="chip bg-zinc-700/60 text-zinc-300">Bench</span>}
                    <span className="flex-1 text-zinc-200">{r.title} · {r.map}</span>
                    <span className="text-xs text-zinc-500">{dayIST(r.startAt)}</span>
                    {r.selected && <span className="w-16 text-right font-mono text-zinc-300">{r.kills}K {r.mvp && <Trophy className="inline h-3.5 w-3.5 text-ember-400" aria-label="MVP" />}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </motion.div>
      )}
    </div>
  );
}
