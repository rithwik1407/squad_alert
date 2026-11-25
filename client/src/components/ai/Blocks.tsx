import { useState, type ReactNode } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Check, CheckCircle2, Crosshair, Info, ShieldCheck, Sparkles, Swords, Target, ThumbsDown, Trophy, X, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Avatar, Button, cx } from '@/components/ui';
import { CountUp, TooltipCard } from '@/components/StatsCharts';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { aiApi } from '@/lib/ai';
import { aiStore } from '@/lib/aiStore';
import { ApproveSheet } from './ApproveSheet';
import type { Block, BlockWithId, Kpi, SquadPick, Tone } from '@/lib/aiTypes';

type B<T extends Block['type']> = Extract<BlockWithId, { type: T }>;
type ChartBlock = Extract<BlockWithId, { type: 'bar' | 'line' }>;
import { spring } from '@/lib/motion';

/** Series colours: accent first, then hues stepped for the dark surface (same family as the Stats page). */
const COLORS = ['#ff8a1f', '#3987e5', '#199e70', '#c98500', '#d55181'];
const GRID = 'rgba(255,255,255,.06)';
const AXIS = { fill: '#71717a', fontSize: 11 };

const TONE: Record<Tone, { ring: string; text: string; bg: string; icon: typeof Info; label: string }> = {
  good: { ring: 'ring-emerald-400/25', text: 'text-emerald-300', bg: 'bg-emerald-400/10', icon: CheckCircle2, label: 'Strength' },
  bad: { ring: 'ring-red-400/30', text: 'text-red-300', bg: 'bg-red-500/10', icon: ThumbsDown, label: 'High impact' },
  warn: { ring: 'ring-amber-400/30', text: 'text-amber-300', bg: 'bg-amber-400/10', icon: AlertTriangle, label: 'Medium impact' },
  info: { ring: 'ring-sky-400/25', text: 'text-sky-300', bg: 'bg-sky-400/10', icon: Info, label: 'Note' },
};

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));
/** Axis labels drop the team tag ("RARE丨BITTU" → "BITTU") so names fit on phones. */
const short = (v: unknown) => String(v).replace(/^[^|丨｜]{1,6}\s*[|丨｜]\s*/, '');
const fmt = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('en-IN', { maximumFractionDigits: 1 }) : v == null || v === '' ? '–' : String(v));

/** Panel chrome shared by every block: HUD label, optional subtitle, spring entrance. */
export function Panel({ title, subtitle, children, className, icon, action }: { title: string; subtitle?: string; children: ReactNode; className?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <motion.section layout="position" initial={{ opacity: 0, y: 16, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring}
      className={cx('glass gborder h-full min-w-0 p-4 shadow-[0_24px_48px_-24px_rgba(0,0,0,.9)] sm:p-5', className)}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="hud-label !text-zinc-300">{icon}{title}</h3>
          {subtitle && <p className="mt-1 pl-[18px] text-xs text-zinc-500">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </motion.section>
  );
}

export function BlockView({ block, isCaptain }: { block: BlockWithId; isCaptain: boolean }) {
  switch (block.type) {
    case 'kpis': return <KpiStrip block={block} />;
    case 'line': return <TrendChart block={block} />;
    case 'bar': return block.xKey === 'map' ? <MapTiles block={block} /> : <Bars block={block} />;
    case 'radar': return <RadarBlock block={block} />;
    case 'table': return <TableBlock block={block} />;
    case 'insights': return <Insights block={block} />;
    case 'squad': return <SquadCard block={block} isCaptain={isCaptain} />;
    case 'report': return <ReportCard block={block} />;
    case 'heatmap': return <Heatmap block={block} />;
    case 'proposal': return <ProposalCard block={block} isCaptain={isCaptain} />;
  }
}

/** Wide blocks take the full dashboard row; the rest pair up two by two on large screens. */
export const isWide = (b: Block) => b.type === 'kpis' || b.type === 'line' || b.type === 'table' || b.type === 'squad' || b.type === 'report' || b.type === 'heatmap' || (b.type === 'bar' && b.xKey === 'map');


/**
 * 3D tilt: the card leans toward the pointer with a spring and its content floats above the face.
 * Mouse only (touch scrolls normally) and off for reduced motion.
 */
export function Tilt({ children, className, depth = 22, max = 9 }: { children: ReactNode; className?: string; depth?: number; max?: number }) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rx = useSpring(useTransform(y, [-0.5, 0.5], [max, -max]), { stiffness: 260, damping: 22 });
  const ry = useSpring(useTransform(x, [-0.5, 0.5], [-max, max]), { stiffness: 260, damping: 22 });
  const glareX = useTransform(x, [-0.5, 0.5], ['0%', '100%']);
  const glare = useTransform(glareX, (gx) => `radial-gradient(circle at ${gx} 0%, rgba(255,255,255,.14), transparent 60%)`);
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <div style={{ perspective: 900 }} className="h-full">
      <motion.div
        className={cx('relative h-full [transform-style:preserve-3d]', className)}
        style={{ rotateX: rx, rotateY: ry }}
        onPointerMove={(e) => {
          if (e.pointerType !== 'mouse') return;
          const r = e.currentTarget.getBoundingClientRect();
          x.set((e.clientX - r.left) / r.width - 0.5);
          y.set((e.clientY - r.top) / r.height - 0.5);
        }}
        onPointerLeave={() => { x.set(0); y.set(0); }}
      >
        <div className="h-full" style={{ transform: `translateZ(${depth}px)` }}>{children}</div>
        <motion.span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ background: glare }} />
      </motion.div>
    </div>
  );
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** Extruded 3D bar for Recharts: front face plus a lit top and a shaded side. */
function Bar3D(props: { x?: number; y?: number; width?: number; height?: number; fill?: string }) {
  const { x = 0, y = 0, width: w = 0, height: h = 0, fill = COLORS[0] } = props;
  if (h <= 0 || w <= 0) return null;
  const d = Math.min(7, w * 0.4);
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={fill} />
      <rect x={x} y={y} width={w} height={h} fill="url(#bar3d-shine)" />
      <polygon points={`${x},${y} ${x + d},${y - d} ${x + w + d},${y - d} ${x + w},${y}`} fill={shade(fill, 0.35)} />
      <polygon points={`${x + w},${y} ${x + w + d},${y - d} ${x + w + d},${y + h - d} ${x + w},${y + h}`} fill={shade(fill, -0.45)} />
    </g>
  );
}

/**
 * Lays blocks out two per row on wide screens without leaving holes: a half-width block with no
 * partner (odd one out, or followed by a full-width block) stretches across the row.
 */
export function BlockGrid({ blocks, isCaptain }: { blocks: BlockWithId[]; isCaptain: boolean }) {
  const wide: boolean[] = [];
  for (let i = 0; i < blocks.length;) {
    if (isWide(blocks[i])) { wide.push(true); i++; continue; }
    if (i + 1 < blocks.length && !isWide(blocks[i + 1])) { wide.push(false, false); i += 2; } else { wide.push(true); i++; }
  }
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {blocks.map((b, i) => (
        <div key={b.id} className={cx('min-w-0', wide[i] && 'xl:col-span-2')}><BlockView block={b} isCaptain={isCaptain} /></div>
      ))}
    </div>
  );
}

/* ───────────────────────── KPI strip ───────────────────────── */

function KpiValue({ k }: { k: Kpi }) {
  const n = typeof k.value === 'number' ? k.value : null;
  if (n == null) return <>{k.value}</>;
  return <CountUp value={n} decimals={Number.isInteger(n) ? 0 : 1} />;
}

function KpiStrip({ block }: { block: B<'kpis'> }) {
  return (
    <Panel title={block.title} icon={null}>
      <div className={cx('grid gap-3', block.items.length % 3 === 0 ? 'grid-cols-2 sm:grid-cols-3 2xl:grid-cols-6' : 'grid-cols-2 sm:grid-cols-4')}>
        {block.items.map((k, i) => (
          <motion.div key={k.label} initial={{ opacity: 0, y: 14, rotateX: -25 }} animate={{ opacity: 1, y: 0, rotateX: 0 }} transition={{ ...spring, delay: i * 0.05 }} style={{ transformPerspective: 700 }}>
          <Tilt depth={16}>
          <div className="relative h-full overflow-hidden rounded-md border border-white/[0.08] bg-gradient-to-b from-ink-700/70 to-ink-900 p-3 shadow-[0_10px_0_-4px_rgba(0,0,0,.55),0_18px_30px_-12px_rgba(0,0,0,.8),inset_0_1px_0_rgba(255,255,255,.08)]">
            <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-ember-400/80 via-ember-500/30 to-transparent" />
            <p className="font-display text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500">{k.label}</p>
            <p className={cx('mt-1 font-mono text-2xl font-bold tabular-nums', k.tone === 'good' ? 'text-emerald-300' : 'text-white')}><KpiValue k={k} />{k.unit && <span className="ml-1 text-sm text-zinc-500">{k.unit}</span>}</p>
            {k.delta != null ? (
              <p title="Newer half of these matches vs the older half" className={cx('mt-0.5 inline-flex items-center gap-0.5 text-xs font-semibold', k.delta >= 0 ? 'text-emerald-300' : 'text-red-300')}>
                {k.delta >= 0 ? <ArrowUpRight className="h-3 w-3" aria-hidden /> : <ArrowDownRight className="h-3 w-3" aria-hidden />}{Math.abs(k.delta)}%
                <span className="sr-only">vs the earlier matches</span>
              </p>
            ) : k.sub ? <p className="mt-0.5 text-xs text-zinc-500">{k.sub}</p> : null}
          </div>
          </Tilt>
          </motion.div>
        ))}
      </div>
    </Panel>
  );
}

/* ───────────────────────── Charts ───────────────────────── */

function SeriesToggle({ series, active, onChange }: { series: { key: string; label: string }[]; active: string; onChange: (k: string) => void }) {
  if (series.length < 2) return null;
  return (
    <div role="tablist" className="flex shrink-0 gap-1 rounded-md border border-white/10 bg-white/[0.03] p-0.5">
      {series.map((s) => (
        <button key={s.key} role="tab" aria-selected={active === s.key} onClick={() => onChange(s.key)}
          className={cx('relative rounded px-2 py-1 text-[11px] font-semibold', active === s.key ? 'text-ink-950' : 'text-zinc-400 hover:text-white')}>
          {active === s.key && <motion.span layoutId={`tog-${series.map((x) => x.key).join()}`} className="absolute inset-0 rounded bg-ember-400" transition={spring} />}
          <span className="relative">{s.label}</span>
        </button>
      ))}
    </div>
  );
}

function TrendChart({ block }: { block: ChartBlock }) {
  const [key, setKey] = useState(block.series[0]?.key ?? '');
  const s = block.series.find((x) => x.key === key) ?? block.series[0];
  const gid = `g-${block.id}`;
  const last = block.data[block.data.length - 1];
  return (
    <Panel title={block.title} subtitle={block.subtitle} action={<SeriesToggle series={block.series} active={key} onChange={setKey} />}>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={block.data} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
            <defs>
              <filter id={`${gid}-glow`} x="-20%" y="-50%" width="140%" height="200%">
                <feGaussianBlur stdDeviation="4" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS[0]} stopOpacity={0.45} />
                <stop offset="100%" stopColor={COLORS[0]} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey={block.xKey} tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={40} allowDecimals={false} />
            <Tooltip cursor={{ stroke: 'rgba(255,255,255,.15)' }} content={({ active, payload }) => active && payload?.length ? (
              <TooltipCard title={`Match ${payload[0].payload[block.xKey]}`} subtitle={[payload[0].payload.date, payload[0].payload.place ? `#${payload[0].payload.place}` : ''].filter(Boolean).join(' · ')}
                rows={[{ name: s.label, color: COLORS[0], value: num(payload[0].value) }]} />
            ) : null} />
            <Area key={s.key} type="monotone" dataKey={s.key} stroke={COLORS[0]} strokeWidth={2.5} fill={`url(#${gid})`} filter={`url(#${gid}-glow)`}
              dot={{ r: 2.5, fill: COLORS[0], strokeWidth: 0 }} activeDot={{ r: 5, stroke: '#0c0c11', strokeWidth: 2 }} animationDuration={900} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {last && <p className="mt-1 text-right text-xs text-zinc-500">Latest: <span className="font-mono text-ember-300">{fmt(last[s.key])}</span> {s.label.toLowerCase()}</p>}
    </Panel>
  );
}

function Bars({ block }: { block: ChartBlock }) {
  const many = block.data.length > 5;
  return (
    <Panel title={block.title} subtitle={block.subtitle}>
      <div className="mb-2 flex flex-wrap gap-3">
        {block.series.map((s, i) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-zinc-400"><span className="h-2 w-2 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />{s.label}</span>
        ))}
      </div>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={block.data} margin={{ top: 12, right: 12, left: -18, bottom: 0 }} barGap={4}>
            <defs>
              <linearGradient id="bar3d-shine" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#fff" stopOpacity={0.18} />
                <stop offset="45%" stopColor="#fff" stopOpacity={0} />
                <stop offset="100%" stopColor="#000" stopOpacity={0.25} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey={block.xKey} tick={AXIS} tickFormatter={short} axisLine={false} tickLine={false} interval={0} angle={many ? -30 : 0} textAnchor={many ? 'end' : 'middle'} height={many ? 46 : 24} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={40} />
            <Tooltip cursor={{ fill: 'rgba(255,255,255,.04)' }} content={({ active, payload, label }) => active && payload?.length ? (
              <TooltipCard title={String(label)} rows={payload.map((p, i) => ({ name: String(p.name), color: COLORS[i % COLORS.length], value: num(p.value) }))} unit={block.unit} />
            ) : null} />
            {block.series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={COLORS[i % COLORS.length]} shape={<Bar3D />} maxBarSize={26} animationDuration={700} animationBegin={i * 90} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

const MAP_IMG: Record<string, string> = { Erangel: '/maps/erangel.webp', Miramar: '/maps/miramar.webp', Rondo: '/maps/rondo.webp' };

/** Map breakdown as image tiles (like a map-stats strip), best map first. */
function MapTiles({ block }: { block: ChartBlock }) {
  const best = Math.max(...block.data.map((d) => num(d.avgPoints) || 0));
  return (
    <Panel title={block.title} subtitle={block.subtitle}>
      {/* Column count follows the number of maps, so the row is always full (no empty slot on any screen). */}
      <div className={cx('grid gap-2 sm:gap-3', block.data.length === 1 ? 'grid-cols-1' : block.data.length === 2 || block.data.length === 4 ? 'grid-cols-2' : 'grid-cols-3')}>
        {block.data.map((d, i) => {
          const name = String(d.map);
          const top = num(d.avgPoints) === best;
          return (
            <motion.div key={name} initial={{ opacity: 0, y: 18, rotateX: -30 }} animate={{ opacity: 1, y: 0, rotateX: 0 }} transition={{ ...spring, delay: i * 0.07 }} style={{ transformPerspective: 800 }}>
            <Tilt depth={26} max={12}>
            <div className={cx('relative isolate h-full overflow-hidden rounded-md border p-2.5 shadow-[0_14px_0_-6px_rgba(0,0,0,.6),0_24px_40px_-16px_rgba(0,0,0,.9)] sm:p-3', top ? 'border-ember-400/60 shadow-glow' : 'border-white/10')}>
              {MAP_IMG[name] && <img src={MAP_IMG[name]} alt="" className="absolute inset-0 -z-10 h-full w-full scale-110 object-cover opacity-45" />}
              <div className="absolute inset-0 -z-10 bg-gradient-to-t from-ink-950 via-ink-950/70 to-ink-950/20" />
              <div className="flex items-center justify-between">
                <p className="truncate font-display text-sm font-bold uppercase tracking-wide text-white sm:text-lg">{name}</p>
                <span className="hidden font-mono text-[11px] text-zinc-400 sm:inline">{fmt(d.matches)} m</span>
              </div>
              {top && <span className="chip mt-1 bg-ember-500/20 !px-1.5 !py-0.5 text-[9px] text-ember-200 ring-1 ring-ember-400/40">Best</span>}
              <p className={cx('font-mono text-xl font-bold sm:text-2xl', top ? 'mt-2 text-ember-300' : 'mt-[30px] text-white')}><CountUp value={num(d.avgPoints)} decimals={1} /><span className="ml-1 text-[10px] text-zinc-400 sm:text-xs">pts</span></p>
              <p className="text-[11px] leading-snug text-zinc-400 sm:text-xs">{fmt(d.avgKills)} kills · {fmt(d.avgSurvival)}m alive</p>
            </div>
            </Tilt>
            </motion.div>
          );
        })}
      </div>
    </Panel>
  );
}

function RadarBlock({ block }: { block: B<'radar'> }) {
  return (
    <Panel title={block.title} subtitle={block.subtitle}>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={block.data} outerRadius="72%">
            <PolarGrid stroke="rgba(255,255,255,.1)" />
            <PolarAngleAxis dataKey="axis" tick={{ fill: '#a1a1aa', fontSize: 11, fontWeight: 600 }} />
            <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
            {block.series.map((s, i) => (
              <Radar key={s.key} dataKey={s.key} name={s.label} stroke={COLORS[i]} fill={COLORS[i]} fillOpacity={i ? 0.12 : 0.25} strokeWidth={2} animationDuration={900} style={{ filter: `drop-shadow(0 0 6px ${COLORS[i]}88)` }} />
            ))}
            <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
              <TooltipCard title={String(label)} rows={payload.map((p, i) => ({ name: String(p.name), color: COLORS[i], value: num(p.value) }))} />
            ) : null} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-center gap-4">
        {block.series.map((s, i) => <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-zinc-300"><span className="h-0.5 w-4" style={{ background: COLORS[i] }} />{s.label}</span>)}
      </div>
    </Panel>
  );
}

/* ───────────────────────── Table ───────────────────────── */

function TableBlock({ block }: { block: B<'table'> }) {
  // Best value per highlighted column (numeric columns only).
  const best = new Map<string, number>();
  for (const c of block.best ?? []) {
    const vals = block.rows.map((r) => r[c]).filter((v): v is number => typeof v === 'number');
    if (vals.length > 1) best.set(c, Math.max(...vals));
  }
  return (
    <Panel title={block.title} subtitle={block.subtitle}>
      <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b border-white/10">
              {block.columns.map((c) => (
                <th key={c.key} scope="col" className={cx('whitespace-nowrap pb-2 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500', c.align === 'right' ? 'text-right' : 'text-left')}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((r, i) => (
              <motion.tr key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring, delay: i * 0.03 }} className="border-b border-white/[0.04] last:border-0">
                {block.columns.map((c, j) => {
                  const top = best.has(c.key) && r[c.key] === best.get(c.key) && num(r[c.key]) > 0;
                  return (
                    <td key={c.key} className={cx('whitespace-nowrap py-2', c.align === 'right' ? 'text-right font-mono tabular-nums' : '', j === 0 ? 'font-semibold text-white' : 'text-zinc-300')}>
                      <span className={cx(top && 'rounded bg-ember-500/15 px-1.5 py-0.5 text-ember-300')}>{fmt(r[c.key])}</span>
                    </td>
                  );
                })}
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ───────────────────────── Insights ───────────────────────── */

function Insights({ block }: { block: B<'insights'> }) {
  return (
    <Panel title={block.title} icon={null}>
      <ul className="space-y-2.5">
        {block.items.map((it, i) => {
          const t = TONE[it.tone];
          const I = t.icon;
          return (
            <motion.li key={i} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ ...spring, delay: i * 0.05 }}
              className="flex gap-3 rounded-md border border-white/[0.06] bg-white/[0.02] p-3">
              <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-full ring-1', t.bg, t.ring)}><I className={cx('h-4 w-4', t.text)} aria-hidden /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-white">{it.title}</p>
                  <span className={cx('chip ring-1', t.bg, t.text, t.ring)}>{t.label}</span>
                </div>
                <p className="mt-0.5 text-sm text-zinc-400">{it.text}</p>
                {it.tags?.length ? <div className="mt-2 flex flex-wrap gap-1.5">{it.tags.map((g) => <span key={g} className="rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-zinc-400">{g}</span>)}</div> : null}
              </div>
            </motion.li>
          );
        })}
      </ul>
    </Panel>
  );
}

/* ───────────────────────── Squad recommendation ───────────────────────── */

function ScoreRing({ score, size = 52 }: { score: number; size?: number }) {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90" aria-label={`Score ${score}`}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.08)" strokeWidth={4} fill="none" />
      <motion.circle cx={size / 2} cy={size / 2} r={r} stroke={COLORS[0]} strokeWidth={4} fill="none" strokeLinecap="round" strokeDasharray={c}
        initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - score / 100) }} transition={{ duration: 1, ease: [0.22, 1, 0.36, 1], delay: 0.15 }} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="rotate-90 fill-white font-mono text-[15px] font-bold" style={{ transformOrigin: 'center' }}>{score}</text>
    </svg>
  );
}

const ROLE_ICON: Record<string, typeof Target> = { IGL: Crosshair, Assaulter: Swords, Sniper: Target, Support: ShieldCheck, Scout: Zap };

function PickCard({ p, i, sub }: { p: SquadPick; i: number; sub?: boolean }) {
  const RI = ROLE_ICON[p.gameRole] ?? Sparkles;
  return (
    <Tilt depth={18} max={7}>
    <motion.div initial={{ opacity: 0, y: 14, rotateX: -20 }} animate={{ opacity: 1, y: 0, rotateX: 0 }} transition={{ ...spring, delay: 0.08 * i }} style={{ transformPerspective: 700 }}
      className={cx('relative flex h-full items-center gap-3 overflow-hidden rounded-md border p-3 shadow-[0_12px_0_-6px_rgba(0,0,0,.55),0_20px_30px_-14px_rgba(0,0,0,.85)]', sub ? 'border-dashed border-white/15 bg-white/[0.02]' : 'border-ember-400/30 bg-gradient-to-r from-ember-500/[0.12] to-transparent')}>
      <span className="absolute left-0 top-0 font-display text-[44px] font-bold leading-none text-white/[0.04]">{sub ? 'S' : i + 1}</span>
      <Avatar name={p.ign} src={p.avatar} size={44} dim={sub} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-lg font-bold uppercase leading-tight text-white">{p.ign}</p>
        <p className="inline-flex items-center gap-1 text-xs text-ember-300"><RI className="h-3 w-3" aria-hidden />{p.gameRole || 'Role not set'}</p>
        <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-500">{p.reasons.join(' · ')}</p>
      </div>
      <ScoreRing score={p.score} />
    </motion.div>
    </Tilt>
  );
}

function SquadCard({ block, isCaptain }: { block: B<'squad'>; isCaptain: boolean }) {
  const toast = useToast();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  async function approve() {
    if (!block.matchId) return;
    setState('busy');
    try {
      await aiApi.applySquad(block.matchId, block.players.map((p) => p.id));
      setState('done');
      toast.success('Squad confirmed. Picked players are being alerted.');
    } catch (e) { setState('idle'); toast.error(e); }
  }
  return (
    <Panel title={block.title} subtitle={block.subtitle} action={<span className="chip bg-ember-500/15 text-ember-300 ring-1 ring-ember-400/30"><Sparkles className="h-3 w-3" aria-hidden />Recommended</span>}>
      <div className="grid gap-2.5 sm:grid-cols-2" style={{ perspective: 800 }}>
        {block.players.map((p, i) => <PickCard key={p.id} p={p} i={i} />)}
      </div>
      {block.substitute && (
        <div className="mt-3">
          <p className="mb-1.5 font-display text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500">Suggested substitute</p>
          <PickCard p={block.substitute} i={4} sub />
        </div>
      )}
      <p className="mt-3 text-sm text-zinc-400"><span className="font-semibold text-zinc-200">Why: </span>{block.reason}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
        <p className="text-xs text-zinc-500">{block.note}</p>
        {isCaptain && block.matchId && (
          <div className="flex flex-wrap gap-2">
            <Link to={`/matches/${block.matchId}/squad`} className="btn-ghost !px-3 !py-1.5 text-xs">Edit in squad picker</Link>
            {state === 'done' ? (
              <motion.span initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring} className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-300"><CheckCircle2 className="h-4 w-4" aria-hidden />Squad confirmed</motion.span>
            ) : (
              <Button className="!px-3 !py-1.5 text-xs" loading={state === 'busy'} onClick={approve} icon={<Check className="h-3.5 w-3.5" aria-hidden />}>Approve squad</Button>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

/* ───────────────────────── Match report ───────────────────────── */

function ReportCard({ block }: { block: B<'report'> }) {
  const tiles = [
    { label: 'Position', value: block.placement != null ? `#${block.placement}` : '–', icon: Trophy },
    { label: 'Total kills', value: block.kills, icon: Crosshair },
    { label: 'Team damage', value: block.damage, icon: Zap },
    { label: 'Points', value: block.points, icon: Target },
  ];
  return (
    <Panel title={block.title} subtitle={block.subtitle} action={<Link to={`/matches/${block.matchId}`} className="text-xs font-semibold text-ember-300 hover:text-ember-200">Open match</Link>}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((t, i) => (
          <motion.div key={t.label} initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...spring, delay: i * 0.05 }}
            className="rounded-md border border-white/[0.06] bg-white/[0.03] p-3">
            <p className="flex items-center gap-1.5 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500"><t.icon className="h-3.5 w-3.5 text-ember-400" aria-hidden />{t.label}</p>
            <p className="mt-1 font-mono text-2xl font-bold text-white">{typeof t.value === 'number' ? <CountUp value={t.value} /> : t.value}</p>
          </motion.div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 font-display text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500">AI observations</p>
          <ul className="space-y-1.5">
            {block.observations.map((o, i) => {
              const I = TONE[o.tone].icon;
              return <li key={i} className="flex gap-2 text-sm text-zinc-300"><I className={cx('mt-0.5 h-4 w-4 shrink-0', TONE[o.tone].text)} aria-hidden />{o.text}</li>;
            })}
          </ul>
        </div>
        {block.players.length > 0 && (
          <div>
            <p className="mb-2 font-display text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500">Players</p>
            <ul className="space-y-1">
              {block.players.map((p) => (
                <li key={String(p.player)} className="flex items-center gap-2 rounded bg-white/[0.02] px-2 py-1.5 text-sm">
                  <span className="flex-1 truncate font-semibold text-white">{p.player}{p.mvp ? <Trophy className="ml-1 inline h-3.5 w-3.5 text-ember-400" aria-label="MVP" /> : null}</span>
                  <span className="font-mono text-xs text-zinc-400">{fmt(p.kills)}K · {fmt(p.damage)} dmg · {fmt(p.assists)}A</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <p className="mt-4 rounded-md border border-ember-400/25 bg-ember-500/[0.08] p-3 text-sm text-zinc-200"><span className="font-display font-bold uppercase tracking-wider text-ember-300">Recommendation: </span>{block.recommendation}</p>
    </Panel>
  );
}

/* ───────────────────────── Heatmap ───────────────────────── */

function Heatmap({ block }: { block: B<'heatmap'> }) {
  const max = Math.max(1, ...block.values.flat().filter((v): v is number => v != null));
  const rows = block.rows.map((r, i) => ({ r, v: block.values[i] })).filter((x) => x.v.some((v) => v != null));
  return (
    <Panel title={block.title} subtitle={block.subtitle}>
      <div className="overflow-x-auto">
        <table className="mx-auto border-separate border-spacing-1 text-xs">
          <thead><tr><th />{block.cols.map((c) => <th key={c} scope="col" className="px-1 font-mono font-normal text-zinc-500">{c}</th>)}</tr></thead>
          <tbody>
            {rows.map(({ r, v }, i) => (
              <tr key={r}>
                <th scope="row" className="pr-2 text-left font-display font-bold uppercase tracking-wider text-zinc-400">{r}</th>
                {v.map((x, j) => (
                  <motion.td key={j} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...spring, delay: (i + j) * 0.02 }}
                    title={x == null ? 'No data' : `${x} ${block.unit ?? ''}`}
                    className="h-9 min-w-[44px] rounded text-center font-mono font-bold"
                    style={{ background: x == null ? 'rgba(255,255,255,.03)' : `rgba(255,138,31,${0.12 + 0.75 * (x / max)})`, color: x != null && x / max > 0.55 ? '#07070a' : '#d4d4d8' }}>
                    {x ?? ''}
                  </motion.td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ───────────────────────── Proposal (approval card) ───────────────────────── */

function ProposalCard({ block, isCaptain }: { block: B<'proposal'>; isCaptain: boolean }) {
  const toast = useToast();
  const { user } = useAuth();
  const [status, setStatus] = useState(block.status);
  const [result, setResult] = useState<string | null>(block.result ?? null);
  const [resultId, setResultId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(false);
  const self = block.approver === 'self';
  const canDecide = self ? Boolean(user && block.createdBy === user._id) : isCaptain;
  const opensMatch = ['scrim', 'reschedule', 'map'].includes(block.kind);

  function done(r: { status: string; resultId: string | null; result?: string }) {
    setStatus(r.status as typeof status);
    setResultId(r.resultId);
    setResult(r.result ?? null);
    aiStore.patchBlock(block.id, { status: r.status, result: r.result ?? null });
  }
  async function dismiss() {
    setBusy(true);
    try {
      const r = await aiApi.reject(block.id);
      done({ ...r, resultId: null });
      toast.success('Dismissed. Nothing changed.');
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  return (
    <Panel title={self ? 'Needs your OK' : 'Needs captain approval'} subtitle={block.title}
      className={cx(status === 'approved' && 'shadow-glow')}
      action={<span className={cx('chip ring-1', status === 'pending' ? 'bg-amber-400/10 text-amber-300 ring-amber-400/25' : status === 'approved' ? 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/25' : 'bg-zinc-500/10 text-zinc-400 ring-zinc-400/20')}>{status === 'rejected' ? 'dismissed' : status}</span>}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {block.lines.map((l) => (
          <div key={l.label} className="contents">
            <dt className="pt-0.5 font-display text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-500">{l.label}</dt>
            <dd className="min-w-0 break-words text-sm text-white">{l.value}</dd>
          </div>
        ))}
      </dl>
      {block.warnings.length > 0 && status === 'pending' && (
        <ul className="mt-3 space-y-1">
          {block.warnings.map((w) => <li key={w} className="flex gap-2 text-sm text-amber-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{w}</li>)}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {status === 'pending' && canDecide ? (
          <>
            <Button disabled={busy} onClick={() => setSheet(true)} icon={<Check className="h-4 w-4" aria-hidden />}>Approve</Button>
            <Button variant="ghost" loading={busy} onClick={dismiss} icon={<X className="h-4 w-4" aria-hidden />}>Dismiss</Button>
          </>
        ) : status === 'pending' ? (
          <p className="text-sm text-zinc-400">{self ? 'Waiting for the teammate who asked.' : 'Waiting for the captain to approve.'}</p>
        ) : status === 'approved' ? (
          <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />{result || 'Done.'}
            {resultId && opensMatch && <Link className="font-semibold text-ember-300 hover:text-ember-200" to={`/matches/${resultId}`}>Open match</Link>}
          </motion.p>
        ) : <p className="text-sm text-zinc-500">{status === 'expired' ? 'This card expired. Ask the AI again.' : 'Dismissed. Nothing changed.'}</p>}
      </div>
      {canDecide && <ApproveSheet block={block} open={sheet} onClose={() => setSheet(false)} onDone={done} />}
    </Panel>
  );
}
